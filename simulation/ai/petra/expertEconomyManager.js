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
	this.openingLockTime = 420;
	this.minFoodReserve = 150;
	this.foodEmergencyReserve = 75;
	this.maxEarlyWoodReserve = 500;
	this.maxTransitionFoodWorkers = 18;
	this.civilianWoodCap = 20;
	this.totalWoodCap = 24;
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


ExpertEconomyManager.prototype.countOpeningCivilianWood = function(gameState)
{
	let count = 0;
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position || !ent.position())
			continue;
		if (!ent.hasClass("Civilian") || ent.hasClass("CitizenSoldier") || ent.hasClass("Cavalry"))
			continue;
		if (ent.getMetadata(PlayerID, "expertOpeningJob") == "wood")
			++count;
	}
	return count;
};

ExpertEconomyManager.prototype.chooseFoodJob = function(gameState)
{
	const base = this.HQ.baseManagers()[0];
	if (!base)
		return "berries";

	// If a food dropsite/farmstead foundation exists, commit new civilians to
	// building it before letting anyone gather from that new cluster.  This is
	// the critical rule for v0.4.5: no gathering from the second cluster until
	// the second farmstead is finished.
	const foodFoundation = this.HQ.findExpertOpeningDropsiteFoundation ?
		this.HQ.findExpertOpeningDropsiteFoundation(gameState, "food", base) : undefined;
	if (foodFoundation && (!this.HQ.getExpertOpeningFoundationBuilderCount ||
	    this.HQ.getExpertOpeningFoundationBuilderCount(gameState, foodFoundation) < 4))
		return "foodDropsiteBuilder";

	// Prefer any currently served natural food before farming.  Earlier versions
	// jumped to the farm role as soon as the transition threshold fired, which
	// produced huge wood floats and a food crash.
	if (this.HQ.findExpertOpeningAvailableNaturalFood &&
	    this.HQ.findExpertOpeningAvailableNaturalFood(gameState, base))
		return "berries";

	if (this.HQ.shouldExpertOpeningFarmTransition && this.HQ.shouldExpertOpeningFarmTransition(gameState))
		return "farm";

	return "berries";
};

ExpertEconomyManager.prototype.chooseOpeningJobForCivilian = function(gameState)
{
	const roles = this.HQ.countExpertOpeningCivilianRoles ?
		this.HQ.countExpertOpeningCivilianRoles(gameState) : { "food": 0, "wood": 0, "total": 0 };
	const civilianWood = this.countOpeningCivilianWood(gameState);
	const res = gameState.getResources();
	const food = res && res.food !== undefined ? res.food : 0;
	const wood = res && res.wood !== undefined ? res.wood : 0;

	// Keep the proven opening: first 7 civilians on food, then wood until the
	// opening wood target.
	if (roles.food < 7)
		return this.chooseFoodJob(gameState);
	if (roles.total < 24 && civilianWood < 17)
		return "wood";

	// v0.4.4 resource controller: once opening wood is established, stop feeding
	// the wood snowball.  Food shortages and wood float always force new civilians
	// into a food job.
	if (food < this.minFoodReserve || (wood > this.maxEarlyWoodReserve && roles.food < this.maxTransitionFoodWorkers) || civilianWood >= this.civilianWoodCap)
		return this.chooseFoodJob(gameState);

	if (civilianWood < this.civilianWoodCap)
		return "wood";

	return roles.food < this.maxTransitionFoodWorkers ? this.chooseFoodJob(gameState) : "wood";
};

ExpertEconomyManager.prototype.balanceOpeningCivilianJobs = function(gameState)
{
	if (!this.isActive(gameState))
		return;

	const res = gameState.getResources();
	const food = res && res.food !== undefined ? res.food : 0;
	const wood = res && res.wood !== undefined ? res.wood : 0;
	let civilianWood = this.countOpeningCivilianWood(gameState);
	const roles = this.HQ.countExpertOpeningCivilianRoles ?
		this.HQ.countExpertOpeningCivilianRoles(gameState) : { "food": 0, "total": 0 };
	let foodRoles = roles.food || 0;

	// Normal transition cap: after the first 20 civilian wood workers, every new
	// worker must go to food.  Emergency cap: if food collapses while wood floats,
	// reclaim only enough wood workers to restore a sane food crew.  The previous
	// v0.4.4 loop converted almost every wood worker to food/farm because food/wood
	// stockpile values do not change inside the loop.
	const emergency = food < this.foodEmergencyReserve && wood > this.maxEarlyWoodReserve;
	const desiredFood = emergency ? 14 : (food < this.minFoodReserve && wood > this.maxEarlyWoodReserve ? 12 : (wood > 900 && food < 800 ? 16 : 7));
	if (!emergency && civilianWood <= this.civilianWoodCap && foodRoles >= desiredFood)
		return;

	const civilians = this.HQ.getExpertOpeningSortedCivilians ? this.HQ.getExpertOpeningSortedCivilians(gameState) : [];
	for (let i = civilians.length - 1; i >= 0; --i)
	{
		if ((civilianWood <= this.civilianWoodCap && foodRoles >= desiredFood) ||
		    (emergency && (foodRoles >= desiredFood || civilianWood <= 17)))
			break;
		const ent = civilians[i];
		if (ent.getMetadata(PlayerID, "expertOpeningJob") != "wood")
			continue;
		// Keep the deterministic opening wood core unless food is actually crashing.
		if (!emergency && i < 24 && civilianWood <= 17)
			continue;
		ent.setMetadata(PlayerID, "expertOpeningJob", this.chooseFoodJob(gameState));
		ent.setMetadata(PlayerID, "expertFoodLockedSupply", undefined);
		ent.setMetadata(PlayerID, "supply", undefined);
		ent.setMetadata(PlayerID, "target-foundation", undefined);
		ent.setMetadata(PlayerID, "subrole", undefined);
		--civilianWood;
		++foodRoles;
	}
};
