import * as difficulty from "simulation/ai/petra/difficultyLevel.js";
import { SquareVectorDistance } from "simulation/ai/common-api/utils.js";

/**
 * ExpertFoodManager v0.3.5
 *
 * First real food-state subsystem for Expert.  The purpose is not to make Petra
 * a little better; it is to stop Petra-style worker churn for food.
 *
 * Rules:
 * - opening berry/apple workers stay on their current source until it is empty;
 * - max 8 civilians per berry cluster;
 * - max 2-4 civilians per apple/large fruit tree cluster;
 * - max 5 civilians per field;
 * - no field/farm transition while owned natural fruit is above the configured
 *   threshold;
 * - new/idle civilians take new food jobs, existing food workers do not abandon
 *   their resource to build another food building.
 */
export function ExpertFoodManager(HQ, constants)
{
	this.HQ = HQ;
	this.Constants = constants;
	this.maxBerryWorkers = 8;
	this.maxFieldWorkers = 5;
	this.appleWorkers = 4;
}

ExpertFoodManager.prototype.isActive = function(gameState)
{
	return this.HQ.Config.difficulty >= difficulty.EXPERT &&
		this.HQ.isExpertOpeningPhaseActive &&
		this.HQ.isExpertOpeningPhaseActive(gameState);
};

ExpertFoodManager.prototype.update = function(gameState)
{
	if (!this.isActive(gameState))
		return;

	const civilians = [];
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position() || !ent.hasClass("Civilian"))
			continue;
		if (ent.hasClass("CitizenSoldier") || ent.hasClass("Cavalry"))
			continue;
		civilians.push(ent);
	}

	this.protectActiveFoodWorkers(gameState, civilians);
	this.limitNaturalFoodSaturation(gameState, civilians);
	this.limitFieldSaturation(gameState, civilians);
	this.assignUnassignedCivilians(gameState, civilians);
};

ExpertFoodManager.prototype.protectActiveFoodWorkers = function(gameState, civilians)
{
	for (const ent of civilians)
	{
		const job = ent.getMetadata(PlayerID, "expertOpeningJob");
		const supplyId = ent.getMetadata(PlayerID, "supply");
		const supply = supplyId ? gameState.getEntityById(supplyId) : undefined;
		if (!supply || !supply.position || !supply.position())
			continue;
		if (supply.resourceSupplyAmount && supply.resourceSupplyAmount() <= 0)
			continue;

		// Productive food workers are locked. New/idle civilians expand food.
		if (job == "berries" || job == "berriesBuilder" || job == "farm")
			ent.setMetadata(PlayerID, "expertFoodLockedSupply", supplyId);
	}
};

ExpertFoodManager.prototype.getNaturalFoodClusterLimit = function(supply)
{
	if (!supply || !supply.resourceSupplyMax)
		return this.maxBerryWorkers;

	// In this mod apple trees are larger single fruit sources.  They should not
	// receive a full berry-bush work gang.
	const max = supply.resourceSupplyMax();
	if (max >= 350)
		return this.appleWorkers;
	return this.maxBerryWorkers;
};

ExpertFoodManager.prototype.isLockedToValidFoodSupply = function(gameState, ent, supplyFilter)
{
	const supplyId = ent.getMetadata(PlayerID, "expertFoodLockedSupply") ||
		ent.getMetadata(PlayerID, "supply");
	const supply = supplyId ? gameState.getEntityById(supplyId) : undefined;
	if (!supply || !supply.position || !supply.position())
		return false;
	if (supply.resourceSupplyAmount && supply.resourceSupplyAmount() <= 0)
		return false;
	if (supplyFilter && !supplyFilter(supply))
		return false;
	return true;
};

ExpertFoodManager.prototype.limitNaturalFoodSaturation = function(gameState, civilians)
{
	// Group fruit workers by nearby natural-food cluster.  This fixes the old bug
	// where the manager used one global "8 berry workers" cap and could still put
	// 11 workers on one local patch.
	const clusters = [];
	const radius = 14;
	const radiusSq = radius * radius;

	for (const ent of civilians)
	{
		const job = ent.getMetadata(PlayerID, "expertOpeningJob");
		if (job != "berries" && job != "berriesBuilder")
			continue;

		const supplyId = ent.getMetadata(PlayerID, "expertFoodLockedSupply") || ent.getMetadata(PlayerID, "supply");
		const supply = supplyId ? gameState.getEntityById(supplyId) : undefined;
		if (!supply || !supply.position || supply.hasClasses(["Animal", "Field"]))
			continue;

		let cluster;
		for (const candidate of clusters)
		{
			if (SquareVectorDistance(candidate.pos, supply.position()) <= radiusSq)
			{
				cluster = candidate;
				break;
			}
		}
		if (!cluster)
		{
			cluster = { "pos": supply.position(), "supply": supply, "workers": [] };
			clusters.push(cluster);
		}
		cluster.workers.push(ent);
	}

	for (const cluster of clusters)
	{
		const cap = this.getNaturalFoodClusterLimit(cluster.supply);
		if (cluster.workers.length <= cap)
			continue;

		// Keep the first workers on the current natural source. Redirect extras.
		for (let i = cap; i < cluster.workers.length; ++i)
			this.redirectExtraCivilian(gameState, cluster.workers[i]);
	}
};

ExpertFoodManager.prototype.limitFieldSaturation = function(gameState, civilians)
{
	const byField = new Map();
	for (const ent of civilians)
	{
		if (ent.getMetadata(PlayerID, "expertOpeningJob") != "farm")
			continue;
		const supplyId = ent.getMetadata(PlayerID, "supply");
		if (!supplyId)
			continue;
		const supply = gameState.getEntityById(supplyId);
		if (!supply || !supply.hasClass || !supply.hasClass("Field"))
			continue;
		if (!byField.has(supplyId))
			byField.set(supplyId, []);
		byField.get(supplyId).push(ent);
	}

	for (const workers of byField.values())
	{
		if (workers.length <= this.maxFieldWorkers)
			continue;
		for (let i = this.maxFieldWorkers; i < workers.length; ++i)
			this.redirectExtraCivilian(gameState, workers[i]);
	}
};

ExpertFoodManager.prototype.assignUnassignedCivilians = function(gameState, civilians)
{
	for (const ent of civilians)
	{
		if (ent.getMetadata(PlayerID, "expertOpeningJob") !== undefined)
			continue;

		const woodCount = this.countCiviliansWithJobs(civilians, ["wood"]);
		const naturalFood = this.HQ.findExpertOpeningAvailableNaturalFood &&
			this.HQ.findExpertOpeningAvailableNaturalFood(gameState, this.HQ.baseManagers()[0], ent);

		const bias = this.HQ.expertEconomyManager ?
			this.HQ.expertEconomyManager.getOpeningResourceBias(gameState) : "balanced";

		// v0.3.7: the higher-level EconomyManager can stop the wood flood when
		// food is low or wood is floating.  Wood target is a preference, not a
		// command that ignores resource imbalance.
		if (bias != "food" && !this.HQ.shouldExpertOpeningFarmTransition(gameState) &&
		    woodCount < this.Constants.firstWoodSaturation)
			ent.setMetadata(PlayerID, "expertOpeningJob", "wood");
		else if (naturalFood)
			ent.setMetadata(PlayerID, "expertOpeningJob", "berries");
		else if (this.HQ.shouldExpertOpeningFarmTransition(gameState))
			ent.setMetadata(PlayerID, "expertOpeningJob", "farm");
		else
			ent.setMetadata(PlayerID, "expertOpeningJob", bias == "food" ? "berries" : "wood");
	}
};

ExpertFoodManager.prototype.redirectExtraCivilian = function(gameState, ent)
{
	const base = this.HQ.baseManagers()[0];
	const naturalFood = this.HQ.findExpertOpeningAvailableNaturalFood &&
		this.HQ.findExpertOpeningAvailableNaturalFood(gameState, base, ent);
	const woodCount = this.countExpertCivilianJob(gameState, "wood");

	const bias = this.HQ.expertEconomyManager ?
		this.HQ.expertEconomyManager.getOpeningResourceBias(gameState) : "balanced";
	if (bias != "food" && !this.HQ.shouldExpertOpeningFarmTransition(gameState) &&
	    woodCount < this.Constants.firstWoodSaturation)
		ent.setMetadata(PlayerID, "expertOpeningJob", "wood");
	else if (naturalFood)
		ent.setMetadata(PlayerID, "expertOpeningJob", "berries");
	else if (this.HQ.shouldExpertOpeningFarmTransition(gameState))
		ent.setMetadata(PlayerID, "expertOpeningJob", "farm");
	else
		ent.setMetadata(PlayerID, "expertOpeningJob", bias == "food" ? "berries" : "wood");

	ent.setMetadata(PlayerID, "expertFoodLockedSupply", undefined);
};

ExpertFoodManager.prototype.countCiviliansWithJobs = function(civilians, jobs)
{
	let count = 0;
	for (const ent of civilians)
		if (jobs.indexOf(ent.getMetadata(PlayerID, "expertOpeningJob")) != -1)
			++count;
	return count;
};

ExpertFoodManager.prototype.countExpertCivilianJob = function(gameState, job)
{
	let count = 0;
	for (const ent of gameState.getOwnUnits().values())
		if (ent && ent.position() && ent.hasClass("Civilian") &&
		    !ent.hasClass("CitizenSoldier") && ent.getMetadata(PlayerID, "expertOpeningJob") == job)
			++count;
	return count;
};

ExpertFoodManager.prototype.countClusterWorkers = function(gameState, supply, radius)
{
	if (!supply || !supply.position())
		return 0;

	const radiusSq = radius * radius;
	let count = 0;
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position() || !ent.hasClass("Civilian") || ent.hasClass("CitizenSoldier"))
			continue;
		const supplyId = ent.getMetadata(PlayerID, "expertFoodLockedSupply") || ent.getMetadata(PlayerID, "supply");
		const assigned = supplyId ? gameState.getEntityById(supplyId) : undefined;
		if (!assigned || !assigned.position())
			continue;
		if (SquareVectorDistance(assigned.position(), supply.position()) <= radiusSq)
			++count;
	}
	return count;
};

ExpertFoodManager.prototype.countFieldWorkers = function(gameState, field)
{
	if (!field)
		return 0;

	let count = field.resourceSupplyNumGatherers ? field.resourceSupplyNumGatherers() : 0;
	for (const ent of gameState.getOwnUnits().values())
		if (ent && ent.position() && ent.getMetadata(PlayerID, "supply") == field.id())
			++count;
	return count;
};
