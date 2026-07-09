import * as difficulty from "simulation/ai/petra/difficultyLevel.js";
import { ConstructionPlan } from "simulation/ai/petra/queueplanBuilding.js";
import { Worker } from "simulation/ai/petra/worker.js";

/**
 * ExpertTransitionManager v0.4
 *
 * Owns the handoff after the deterministic first-24 civilian opening.
 * The opening script gets us to:
 *   - 7 civilians on food,
 *   - the remaining first-24 civilians on wood,
 *   - citizen soldiers on wood/building duty.
 *
 * TransitionManager then prevents the "no owner" idle-worker state by assigning
 * every new/idle civilian to the next strategic job, queues houses early enough
 * to avoid pop block, and starts the first barracks once the wood economy exists.
 */
export function ExpertTransitionManager(HQ, constants)
{
	this.HQ = HQ;
	this.constants = constants;
	this.transitionWindow = 360;
	this.minBarracksTime = 150; // 2:30
	this.barracksWoodReserve = 200;
	this.targetFoodCivilians = 7;
	this.targetTotalWoodWorkers = 20; // civilians + citizen soldiers
	this.startedBarracks = false;
}

ExpertTransitionManager.prototype.isActive = function(gameState)
{
	if (this.HQ.Config.difficulty < difficulty.EXPERT)
		return false;
	if (!this.HQ.isExpertOpeningPhaseActive || !this.HQ.isExpertOpeningPhaseActive(gameState))
		return false;

	const roles = this.HQ.countExpertOpeningCivilianRoles ?
		this.HQ.countExpertOpeningCivilianRoles(gameState) : { "total": 0 };
	return roles.total >= 24 && gameState.ai.elapsedTime <= this.transitionWindow;
};

ExpertTransitionManager.prototype.update = function(gameState, queues)
{
	if (!this.isActive(gameState))
		return;

	this.assignUnownedCivilians(gameState);
	this.queueBarracks(gameState, queues);
};

ExpertTransitionManager.prototype.countFoodCivilians = function(gameState)
{
	let count = 0;
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position || !ent.position() || !ent.hasClass("Civilian") || ent.hasClass("CitizenSoldier") || ent.hasClass("Cavalry"))
			continue;
		const job = ent.getMetadata(PlayerID, "expertOpeningJob");
		if (job == "berries" || job == "berriesBuilder" || job == "farm" || job == "farmBuilder" || job == "foodDropsiteBuilder")
			++count;
	}
	return count;
};

ExpertTransitionManager.prototype.countTotalWoodWorkers = function(gameState)
{
	let count = 0;
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position || !ent.position())
			continue;
		const job = ent.getMetadata(PlayerID, "expertOpeningJob");
		if (job == "wood" || job == "woodBuilder")
			++count;
	}
	return count;
};

ExpertTransitionManager.prototype.assignUnownedCivilians = function(gameState)
{
	const base = this.HQ.baseManagers()[0];
	if (!base)
		return;

	let food = this.countFoodCivilians(gameState);
	let wood = this.countTotalWoodWorkers(gameState);
	const res = gameState.getResources();
	const strongWoodFloat = res && res.wood > 500 && (!res.food || res.food < 250);

	for (const ent of this.HQ.getExpertOpeningSortedCivilians(gameState))
	{
		if (ent.getMetadata(PlayerID, "expertOpeningJob") !== undefined)
			continue;

		let job;
		if (food < this.targetFoodCivilians)
		{
			job = "berries";
			++food;
		}
		else if (wood < this.targetTotalWoodWorkers && !strongWoodFloat)
		{
			job = "wood";
			++wood;
		}
		else
		{
			// After the opening wood target is established, new civilians move the
			// economy toward the next food source/farm transition instead of idling.
			job = this.HQ.shouldExpertOpeningFarmTransition && this.HQ.shouldExpertOpeningFarmTransition(gameState) ?
				"farm" : "berries";
			++food;
		}

		ent.setMetadata(PlayerID, "expertOpeningJob", job);
		ent.setMetadata(PlayerID, "expertFoodLockedSupply", undefined);
		ent.setMetadata(PlayerID, "supply", undefined);
		ent.setMetadata(PlayerID, "target-foundation", undefined);
		ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_IDLE);
		this.HQ.claimExpertOpeningWorker(gameState, base, ent);
		this.HQ.enforceExpertOpeningPhase(gameState, ent);
	}
};

ExpertTransitionManager.prototype.hasBarracksOrPlan = function(gameState, queues)
{
	if (gameState.getOwnEntitiesByClass("Barracks", true).hasEntities())
		return true;
	if (gameState.getOwnFoundations().filter(ent => ent.hasClass && ent.hasClass("Barracks")).hasEntities())
		return true;
	if (queues && queues.militaryBuilding && queues.militaryBuilding.plans.some(plan =>
		plan.metadata && plan.metadata.expertTransitionBarracks))
		return true;
	return false;
};

ExpertTransitionManager.prototype.queueBarracks = function(gameState, queues)
{
	if (!queues || !queues.militaryBuilding)
		return;
	if (gameState.ai.elapsedTime < this.minBarracksTime)
		return;
	if (this.hasBarracksOrPlan(gameState, queues))
		return;

	const res = gameState.getResources();
	if (!res || res.wood < this.barracksWoodReserve)
		return;
	if (this.countTotalWoodWorkers(gameState) < this.targetTotalWoodWorkers)
		return;
	if (gameState.getPopulation() > 0.90 * gameState.getPopulationLimit())
		return;

	const barracksTemplate = this.HQ.canBuild(gameState, "structures/{civ}/barracks") ?
		"structures/{civ}/barracks" :
		(this.HQ.canBuild(gameState, "structures/{civ}/range") ? "structures/{civ}/range" : undefined);
	if (!barracksTemplate)
		return;

	queues.militaryBuilding.plans = queues.militaryBuilding.plans.filter(plan =>
		plan.metadata && plan.metadata.expertTransitionBarracks);
	queues.militaryBuilding.addPlan(new ConstructionPlan(gameState, barracksTemplate,
		{ "base": this.HQ.baseManagers()[0] ? this.HQ.baseManagers()[0].ID : 0,
		  "militaryBase": true,
		  "expertTransitionBarracks": true,
		  "expertOpeningHouse": false }));
};
