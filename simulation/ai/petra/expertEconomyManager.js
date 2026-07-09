import * as difficulty from "simulation/ai/petra/difficultyLevel.js";

export const ExpertOpeningConstants = {
	maxHouseWalkTime: 4.0,          // seconds round trip
	maxHouseDistance: 5,            // meters from active worksite / dropsite border
	berryTransition: 0.25,          // start food transition when first fruit cluster is 25% left
	firstWoodSaturation: 16,        // civilians sent to wood before new civilians return to food
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

	// Avoid field-foundation spam. Expert should place a farm only when civilians
	// can immediately build and then work it. One pending/built-step at a time is
	// safer than dropping several empty foundations.
	if (queues.field && queues.field.plans.length > 1)
		queues.field.plans = queues.field.plans.slice(0, 1);
};
