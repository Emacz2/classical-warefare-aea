// Expert IT14.91 resource forecast.
// The strategy tells us what we intend to buy; this module asks whether the map and
// current economy can actually fund it.  All values are resource units / seconds.

const RESOURCE_TYPES = ["food", "wood", "stone", "metal"];

function finite(value, fallback = 0)
{
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function nonNegative(value)
{
	return Math.max(0, finite(value));
}

function buildResourceForecast(input = {})
{
	const shortHorizon = Math.max(20, finite(input.shortHorizon, 60));
	const mediumHorizon = Math.max(shortHorizon + 20, finite(input.mediumHorizon, 150));
	const floatHorizon = Math.max(15, finite(input.floatHorizon, 60));
	const result = { shortHorizon, mediumHorizon, resources: {} };

	for (const type of RESOURCE_TYPES)
	{
		const bank = nonNegative(input.banks && input.banks[type]);
		const income = nonNegative(input.incomeRates && input.incomeRates[type]);
		const measuredSpend = nonNegative(input.spendRates && input.spendRates[type]);
		const baselineSpend = nonNegative(input.baselineSpend && input.baselineSpend[type]);
		// A strategy baseline prevents an untouched starting bank from looking infinitely
		// healthy before the first few queue purchases warm up the measured spend EMA.
		// Conversely, one 800-resource phase/tech payment must not look like a permanent
		// 200-resources/second burn rate for the next minute. Clamp bursty measured spend.
		const measuredSpendCap = Math.max(baselineSpend * 3.5, baselineSpend + 10);
		const spendRate = Math.max(baselineSpend, Math.min(measuredSpend, measuredSpendCap));
		const ownAccessible = nonNegative(input.accessibleOwn && input.accessibleOwn[type]);
		const neutralAccessible = nonNegative(input.accessibleNeutral && input.accessibleNeutral[type]);
		const accessible = ownAccessible + neutralAccessible;
		const queued = nonNegative(input.queuedCosts && input.queuedCosts[type]);
		const reserve = nonNegative(input.reserves && input.reserves[type]);
		const minimumFloat = nonNegative(input.minimumFloat && input.minimumFloat[type]);
		const shortAccessWeight = Math.max(0, Math.min(1, finite(input.shortAccessWeight, 0.35)));
		const mediumAccessWeight = Math.max(shortAccessWeight, Math.min(1, finite(input.mediumAccessWeight, 0.75)));

		const shortDemand = Math.max(queued, spendRate * shortHorizon) + reserve;
		const mediumDemand = Math.max(queued, spendRate * mediumHorizon) + reserve;
		const shortAvailable = bank + income * shortHorizon + accessible * shortAccessWeight;
		const mediumAvailable = bank + income * mediumHorizon + accessible * mediumAccessWeight;
		const shortMargin = shortAvailable - shortDemand;
		const mediumMargin = mediumAvailable - mediumDemand;
		const stockRunway = spendRate > 0.05 ? (bank + accessible * mediumAccessWeight) / spendRate : 99999;
		const incomeCoverage = spendRate > 0.05 ? income / spendRate : 9;
		const dynamicCeiling = Math.max(minimumFloat, reserve + queued + spendRate * floatHorizon);
		const floatAmount = Math.max(0, bank - dynamicCeiling);

		let status = "balanced";
		if (shortMargin < 0 || stockRunway < shortHorizon * 0.70)
			status = "critical";
		else if (mediumMargin < 0 || stockRunway < mediumHorizon * 0.80)
			status = "short";
		else if (floatAmount > Math.max(250, dynamicCeiling * 0.35) && incomeCoverage >= 0.65)
			status = "surplus";

		const needBase = Math.max(0, -shortMargin) * 2 + Math.max(0, -mediumMargin);
		const runwayPenalty = Math.max(0, mediumHorizon - Math.min(mediumHorizon, stockRunway)) * Math.max(1, spendRate);
		const needScore = needBase + runwayPenalty + (status === "critical" ? 1500 : status === "short" ? 500 : 0);
		const surplusScore = floatAmount + Math.max(0, mediumMargin) * 0.15;
		const coverageRatio = mediumDemand > 0 ? mediumAvailable / mediumDemand : 9;

		result.resources[type] = {
			type, bank, income, measuredSpend, baselineSpend, spendRate, queued, reserve,
			ownAccessible, neutralAccessible, accessible,
			shortDemand, mediumDemand, shortAvailable, mediumAvailable,
			shortMargin, mediumMargin, stockRunway, incomeCoverage,
			dynamicCeiling, floatAmount, status, needScore, surplusScore, coverageRatio
		};
	}

	result.rankedNeeds = RESOURCE_TYPES.map(type => result.resources[type])
		.sort((a, b) => b.needScore - a.needScore || a.coverageRatio - b.coverageRatio || a.type.localeCompare(b.type));
	result.rankedSurplus = RESOURCE_TYPES.map(type => result.resources[type])
		.sort((a, b) => b.surplusScore - a.surplusScore || b.coverageRatio - a.coverageRatio || a.type.localeCompare(b.type));
	return result;
}

function forecastBalanceDirective(forecast, allowedTargets = RESOURCE_TYPES)
{
	if (!forecast || !forecast.resources)
		return { active: false, forecast: true };
	const allowed = new Set(allowedTargets && allowedTargets.length ? allowedTargets : RESOURCE_TYPES);
	const candidates = RESOURCE_TYPES.filter(type => allowed.has(type)).map(type => forecast.resources[type]).filter(Boolean);
	if (!candidates.length)
		return { active: false, forecast: true };
	const target = candidates.slice().sort((a, b) => b.needScore - a.needScore || a.coverageRatio - b.coverageRatio)[0];
	const donors = RESOURCE_TYPES.map(type => forecast.resources[type]).filter(item => item && item.type !== target.type)
		.sort((a, b) => b.surplusScore - a.surplusScore || b.coverageRatio - a.coverageRatio);
	const surplus = donors[0];
	const shortage = target.status === "critical" || target.status === "short";
	const realSurplus = !!(surplus && (surplus.status === "surplus" || surplus.floatAmount >= 300 || surplus.coverageRatio >= 1.5));
	const floatCorrection = !!(surplus && surplus.floatAmount >= 600 && target.coverageRatio + 0.25 < surplus.coverageRatio);
	const active = (shortage && !!surplus) || floatCorrection;
	const ratio = surplus ? surplus.coverageRatio / Math.max(0.20, target.coverageRatio) : 1;
	return {
		active,
		strong: active && (target.status === "critical" || (realSurplus && ratio >= 1.8)),
		extreme: active && (target.status === "critical" && realSurplus || ratio >= 3),
		forecast: true,
		forecastCritical: target.status === "critical",
		target: target.type,
		surplus: surplus && surplus.type,
		ratio,
		targetStatus: target.status,
		targetCoverage: target.coverageRatio,
		surplusCoverage: surplus ? surplus.coverageRatio : 0
	};
}

export { RESOURCE_TYPES, buildResourceForecast, forecastBalanceDirective };
