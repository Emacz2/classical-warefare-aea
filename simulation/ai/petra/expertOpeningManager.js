import * as difficulty from "simulation/ai/petra/difficultyLevel.js";
import { TrainingPlan } from "simulation/ai/petra/queueplanTraining.js";
import { Worker } from "simulation/ai/petra/worker.js";

/**
 * ExpertOpeningManager v0.4.3
 *
 * This is the first manager intended to own the opening outright instead of
 * negotiating with Petra's normal economic planner.  For the first five minutes
 * it acts as the conductor: clean Petra's generic opening queues, maintain the
 * deterministic first-24 civilian script, keep one tight house task, and make
 * sure every owned worker receives Expert's current task every update.
 */
export function ExpertOpeningManager(HQ, constants)
{
	this.HQ = HQ;
	this.Constants = constants;
	this.activeUntil = 300;
	this.firstFoodCivilians = 7;
	this.firstWoodWorkersTotal = constants.firstWoodSaturation || 20;
}

ExpertOpeningManager.prototype.isActive = function(gameState)
{
	return this.HQ.Config.difficulty >= difficulty.EXPERT &&
		gameState.ai.elapsedTime <= this.activeUntil;
};

ExpertOpeningManager.prototype.update = function(gameState, queues)
{
	if (!this.isActive(gameState))
		return false;

	this.cleanQueues(gameState, queues);

	this.HQ.ensureExpertOpeningPlan(gameState);
	this.HQ.ensureExpertOpeningWoodDropsite(gameState);
	this.HQ.ensureExpertOpeningFoodDropsite(gameState);

	if (queues)
	{
		this.HQ.researchExpertOpeningBerryTech(gameState, queues);
		this.HQ.researchExpertOpeningWoodTech(gameState, queues);
		this.HQ.ensureExpertOpeningHouse(gameState, queues);
		this.controlCivicCentreTraining(gameState, queues);
	}

	this.assignCivilianRoles(gameState);
	this.enforceWorkers(gameState);
	return true;
};

ExpertOpeningManager.prototype.cleanQueues = function(gameState, queues)
{
	if (!queues)
		return;

	if (queues.citizenSoldier)
		queues.citizenSoldier.empty();
	if (queues.majorTech)
		queues.majorTech.empty();
	if (queues.field)
		queues.field.empty();
	if (queues.dropsites)
		queues.dropsites.plans = queues.dropsites.plans.filter(plan =>
			plan.metadata && plan.metadata.expertOpening);
	if (queues.house)
		queues.house.plans = queues.house.plans.filter(plan =>
			plan.metadata && plan.metadata.expertOpeningHouse);
	if (queues.militaryBuilding)
		queues.militaryBuilding.plans = queues.militaryBuilding.plans.filter(plan =>
			plan.metadata && plan.metadata.expertTransitionBarracks);
	if (queues.minorTech && queues.minorTech.plans.length)
		queues.minorTech.plans = queues.minorTech.plans.filter(plan =>
			plan.metadata && (plan.metadata.expertOpeningBerryTech || plan.metadata.expertOpeningWoodTech));
};

ExpertOpeningManager.prototype.controlCivicCentreTraining = function(gameState, queues)
{
	if (!queues || !queues.villager)
		return;

	const templateDef = this.HQ.findBestTrainableUnit(gameState, ["Support+Worker"], [["costsResource", 1, "food"]]);
	if (!templateDef)
		return;

	queues.villager.plans = queues.villager.plans.filter(plan =>
		plan.metadata && plan.metadata.expertOpeningNewSupport);
	if (queues.villager.plans.length > 1)
		queues.villager.plans = queues.villager.plans.slice(0, 1);
	if (queues.villager.hasQueuedUnits())
		return;

	const roles = this.HQ.countExpertOpeningCivilianRoles ?
		this.HQ.countExpertOpeningCivilianRoles(gameState) : { "total": 0 };
	const food = gameState.getResources().food || 0;
	let size = roles.total < 24 ? 3 : (food >= 600 ? 6 : food >= 425 ? 5 : food >= 250 ? 4 : 3);
	const freeSlots = gameState.getPopulationLimit() - this.HQ.getAccountedPopulation(gameState);
	if (freeSlots <= 0)
		return;
	size = Math.max(1, Math.min(size, freeSlots));

	queues.villager.addPlan(new TrainingPlan(gameState, templateDef,
		{ "role": Worker.ROLE_WORKER, "base": 0, "support": true, "expertOpeningNewSupport": true }, size, size));
};

ExpertOpeningManager.prototype.assignCivilianRoles = function(gameState)
{
	const base = this.HQ.baseManagers()[0];
	if (!base)
		return;

	// Deterministic first-24 script: this is the successful opening and should be
	// treated as the source of truth.
	this.HQ.assignExpertOpeningFirst24CivilianRoles(gameState);

	let food = this.HQ.countExpertOpeningFoodCivilians(gameState);
	let wood = this.HQ.countExpertOpeningTotalWoodWorkers(gameState);
	for (const ent of this.HQ.getExpertOpeningSortedCivilians(gameState))
	{
		if (ent.getMetadata(PlayerID, "expertOpeningJob") !== undefined)
			continue;

		this.HQ.claimExpertOpeningWorker(gameState, base, ent);
		let job;
		if (food < this.firstFoodCivilians)
		{
			job = "berries";
			++food;
		}
		else if (wood < this.firstWoodWorkersTotal)
		{
			job = "wood";
			++wood;
		}
		else
			// After the first wood target, later civilians are held as wood until the
			// next manager deliberately opens a new food cluster. This avoids Petra
			// sending them to distant unserved berries during the opening.
			job = "wood";

		ent.setMetadata(PlayerID, "expertOpeningJob", job);
		ent.setMetadata(PlayerID, "expertFoodLockedSupply", undefined);
		ent.setMetadata(PlayerID, "supply", undefined);
		ent.setMetadata(PlayerID, "target-foundation", undefined);
		ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_IDLE);
	}
};

ExpertOpeningManager.prototype.enforceWorkers = function(gameState)
{
	const base = this.HQ.baseManagers()[0];
	if (!base)
		return;

	for (const ent of gameState.getOwnUnits().values())
	{
		if (!this.HQ.isExpertOpeningEconomyUnit(ent))
			continue;
		this.HQ.claimExpertOpeningWorker(gameState, base, ent);
		if (ent.getMetadata(PlayerID, "expertOpeningJob") === undefined)
			continue;
		this.HQ.enforceExpertOpeningPhase(gameState, ent);
	}
};
