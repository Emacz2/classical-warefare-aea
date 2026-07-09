import * as difficulty from "simulation/ai/petra/difficultyLevel.js";
import { SquareVectorDistance } from "simulation/ai/common-api/utils.js";

/**
 * ExpertConstructionManager v0.3.7
 *
 * This is the first small "task commitment" layer.  Its job is not to choose
 * every building in the game.  It prevents Petra-style frozen foundations by
 * reserving builders before a food construction task is allowed to exist.
 */
export function ExpertConstructionManager(HQ, constants)
{
	this.HQ = HQ;
	this.Constants = constants;
	this.maxFoodDropsiteBuilders = 4;
	this.maxFieldBuilders = 2;
}

ExpertConstructionManager.prototype.isActive = function(gameState)
{
	return this.HQ.Config.difficulty >= difficulty.EXPERT &&
		this.HQ.isExpertOpeningPhaseActive &&
		this.HQ.isExpertOpeningPhaseActive(gameState);
};

ExpertConstructionManager.prototype.update = function(gameState, queues)
{
	if (!this.isActive(gameState))
		return;
	this.cleanUncommittedFoodPlans(gameState, queues);
	this.reserveFoodBuilders(gameState);
};

ExpertConstructionManager.prototype.cleanUncommittedFoodPlans = function(gameState, queues)
{
	if (!queues)
		return;

	// Do not let Petra queue multiple food foundations that nobody is committed
	// to finish.  Expert handles one food dropsite task and one field task at a time.
	if (queues.dropsites && queues.dropsites.plans.length)
	{
		let keptFoodPlan = false;
		queues.dropsites.plans = queues.dropsites.plans.filter(plan => {
			if (!plan.metadata || !plan.metadata.expertOpening || plan.metadata.type != "food")
				return true;
			if (keptFoodPlan)
				return false;
			keptFoodPlan = true;
			return true;
		});
	}

	if (queues.field && queues.field.plans.length > 1)
		queues.field.plans = queues.field.plans.slice(0, 1);
};

ExpertConstructionManager.prototype.reserveFoodBuilders = function(gameState)
{
	const base = this.HQ.baseManagers()[0];
	if (!base)
		return;

	const foodFoundation = this.HQ.findExpertOpeningDropsiteFoundation &&
		this.HQ.findExpertOpeningDropsiteFoundation(gameState, "food", base);
	if (foodFoundation)
		this.reserveCiviliansForFoundation(gameState, foodFoundation, "foodDropsiteBuilder", this.maxFoodDropsiteBuilders);

	const fieldFoundation = this.HQ.findExpertOpeningFieldFoundation &&
		this.HQ.findExpertOpeningFieldFoundation(gameState, base);
	if (fieldFoundation)
		this.reserveCiviliansForFoundation(gameState, fieldFoundation, "farmBuilder", this.maxFieldBuilders);
};

ExpertConstructionManager.prototype.reserveCiviliansForFoundation = function(gameState, foundation, job, maxBuilders)
{
	if (!foundation || !foundation.position())
		return;

	let committed = 0;
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position() || !ent.hasClass("Civilian") || ent.hasClass("CitizenSoldier"))
			continue;
		if (ent.getMetadata(PlayerID, "target-foundation") == foundation.id() ||
		    ent.getMetadata(PlayerID, "expertOpeningJob") == job)
			++committed;
	}
	if (committed >= maxBuilders)
		return;

	const candidates = [];
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position() || !ent.hasClass("Civilian") || ent.hasClass("CitizenSoldier") || ent.hasClass("Cavalry"))
			continue;
		if (!ent.isBuilder || !ent.isBuilder())
			continue;
		const currentJob = ent.getMetadata(PlayerID, "expertOpeningJob");
		const locked = ent.getMetadata(PlayerID, "expertFoodLockedSupply");
		// Active food workers are protected.  Only idle/new/farm-transition workers
		// are allowed to become builders for a new food task.
		if (locked && currentJob != "farm" && currentJob != "farmBuilder" && currentJob != "foodDropsiteBuilder")
			continue;
		if (currentJob && currentJob != "farm" && currentJob != "wood" && currentJob != "foodDropsiteBuilder" && currentJob != "farmBuilder")
			continue;
		candidates.push(ent);
	}
	candidates.sort((a, b) => SquareVectorDistance(a.position(), foundation.position()) -
		SquareVectorDistance(b.position(), foundation.position()));

	for (const ent of candidates)
	{
		if (committed >= maxBuilders)
			break;
		ent.setMetadata(PlayerID, "expertOpeningJob", job);
		ent.setMetadata(PlayerID, "target-foundation", foundation.id());
		ent.setMetadata(PlayerID, "expertFoodLockedSupply", undefined);
		++committed;
	}
};
