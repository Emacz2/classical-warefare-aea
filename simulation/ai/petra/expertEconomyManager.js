import * as difficulty from "simulation/ai/petra/difficultyLevel.js";

export const ExpertOpeningConstants = {
	maxHouseWalkTime: 4.0,          // seconds round trip
	maxHouseDistance: 5,            // meters from active worksite / dropsite border
	berryTransition: 0.30,          // transition planning when fruit is 30% left
	firstWoodSaturation: 20,        // civilians sent to wood before new civilians return to food
	farmsteadSpacing: 30,           // minimum meters between early farmsteads
	woodlineRoundTrip: 4.0,         // seconds round trip before improving wood dropsites
	farmMaxDistance: 2.0            // desired farm edge distance from food dropsite border
};

/**
 * ExpertEconomyManager v0.3
 *
 * This is the first dedicated Expert subsystem. It does not replace Petra; it
 * constrains Petra's early economic decisions so Expert follows the design rules
 * we are testing: grow civilians quickly, avoid early stables, do not waste wood
 * on unused foundations, and keep worker roles aligned with their gather rates.
 */
export function ExpertEconomyManager(HQ)
{
	this.HQ = HQ;
	this.workerTarget5Min = 75;
	this.openingLockTime = 300;
	this.minFoodReserve = 180;
	this.maxEarlyWoodReserve = 550;
}

ExpertEconomyManager.prototype.isActive = function(gameState)
{
	return this.HQ.Config.difficulty >= difficulty.EXPERT &&
		gameState.ai.elapsedTime <= this.openingLockTime;
};

ExpertEconomyManager.prototype.update = function(gameState, queues)
{
	if (this.HQ.Config.difficulty < difficulty.EXPERT)
		return;

	// Population target: through 5 minutes, bias all economic decisions toward
	// reaching at least 75 population. The normal Petra target can still take over
	// after the opening lock expires.
	if (gameState.ai.elapsedTime <= this.openingLockTime)
		this.HQ.targetNumWorkers = Math.max(this.HQ.targetNumWorkers, this.workerTarget5Min);

	if (!queues)
		return;

	this.cleanEarlyQueues(gameState, queues);
	this.balanceOpeningCivilianJobs(gameState);
};

ExpertEconomyManager.prototype.cleanEarlyQueues = function(gameState, queues)
{
	if (!this.isActive(gameState))
		return;

	// No early citizen-soldier training while we are chasing the 5-minute civilian
	// target. This mirrors the opening CC lock but now lives in the Expert subsystem.
	if (queues.citizenSoldier)
		queues.citizenSoldier.empty();

	// Remove generic house plans during the Expert economy opening.  Generic Petra
	// house plans have no expertOpeningHouse metadata and are the source of the
	// far-away house foundations we kept seeing.  Expert houses are created by
	// Headquarters.ensureExpertOpeningHouse() with a close worksite anchor.
	if (queues.house && queues.house.plans.length)
		queues.house.plans = queues.house.plans.filter(plan =>
			plan.metadata && plan.metadata.expertOpeningHouse);

	// Remove early stable plans, but keep barracks/range plans in case the normal AI
	// has already queued one for basic defense. Stable timing will become a future
	// cavalry-strategy rule instead of a default opening rule.
	if (queues.militaryBuilding && queues.militaryBuilding.plans.length)
		queues.militaryBuilding.plans = queues.militaryBuilding.plans.filter(plan =>
			!plan.type || plan.type.indexOf("/stable") == -1);

	// v0.3.5 task commitment: no field plans before the natural-food transition,
	// and never more than one pending field plan.
	if (queues.field && queues.field.plans.length)
	{
		if (this.HQ.shouldExpertOpeningFarmTransition && !this.HQ.shouldExpertOpeningFarmTransition(gameState))
			queues.field.empty();
		else if (queues.field.plans.length > 1)
			queues.field.plans = queues.field.plans.slice(0, 1);
	}
};


ExpertEconomyManager.prototype.getOpeningResourceBias = function(gameState)
{
	const res = gameState.getResources();
	const food = res && res.food !== undefined ? res.food : 0;
	const wood = res && res.wood !== undefined ? res.wood : 0;

	if (food < this.minFoodReserve)
		return "food";
	if (wood > this.maxEarlyWoodReserve && food < wood * 0.6)
		return "food";
	if (wood < 250 && food > 250)
		return "wood";
	return "balanced";
};

ExpertEconomyManager.prototype.balanceOpeningCivilianJobs = function(gameState)
{
	if (!this.isActive(gameState))
		return;

	const bias = this.getOpeningResourceBias(gameState);
	let woodCivs = 0;
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position() || !ent.hasClass("Civilian") || ent.hasClass("CitizenSoldier") || ent.hasClass("Cavalry"))
			continue;
		if (ent.getMetadata(PlayerID, "expertOpeningJob") == "wood")
			++woodCivs;
	}

	// If we are floating wood and starving food, stop sending new civilians to wood.
	// Active wood workers are not yanked immediately; new/idle civilians are biased
	// back to food so Expert recovers without oscillating every turn.
	if (bias != "food")
		return;

	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position() || !ent.hasClass("Civilian") || ent.hasClass("CitizenSoldier") || ent.hasClass("Cavalry"))
			continue;
		if (ent.getMetadata(PlayerID, "expertOpeningJob") != "wood")
			continue;
		if (woodCivs <= 12)
			break;
		const subrole = ent.getMetadata(PlayerID, "subrole");
		// Prefer reassigning only idle/new workers so existing productive woodcutters
		// can drop off naturally before changing roles in a later version.
		if (subrole !== undefined && subrole !== null)
			continue;
		ent.setMetadata(PlayerID, "expertOpeningJob", undefined);
		--woodCivs;
	}
};
