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
	this.activeUntil = 420;
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
		// v0.4.5: OpeningManager owns food expansion during the first five
		// minutes too.  Otherwise the first berry cluster can run dry while
		// Petra is blocked and no one creates/finishes the second farmstead.
		if (this.HQ.ensureExpertOpeningAdditionalFoodDropsites)
			this.HQ.ensureExpertOpeningAdditionalFoodDropsites(gameState, queues);
		if (this.HQ.ensureExpertOpeningFarms)
			this.HQ.ensureExpertOpeningFarms(gameState, queues);
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
	{
		// During the pure opening, block soldier training.  After five minutes,
		// TransitionManager may queue Expert citizen soldiers from the first barracks.
		if (gameState.ai.elapsedTime < 300)
			queues.citizenSoldier.empty();
		else
			queues.citizenSoldier.plans = queues.citizenSoldier.plans.filter(plan =>
				plan.metadata && plan.metadata.expertTransitionCitizenSoldier);
	}
	if (queues.majorTech)
		queues.majorTech.empty();
	if (queues.field)
	{
		// v0.4.6: before farm transition, remove all fields. Once natural food is
		// low, Expert owns field construction; do not delete the committed farm plan.
		if (!this.HQ.shouldExpertOpeningFarmTransition || !this.HQ.shouldExpertOpeningFarmTransition(gameState))
			queues.field.empty();
		else
			queues.field.plans = queues.field.plans.filter(plan =>
				plan.metadata && plan.metadata.expertOpeningFarm);
	}
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
	let size;
	if (roles.total < 24)
		size = 3;
	else if (food < 150)
		// Do not drain the last food into tiny batches while the economy is trying
		// to recover.  Queue a modest batch only when it is affordable.
		size = food >= 100 ? 2 : 0;
	else
		size = food >= 700 ? 6 : food >= 450 ? 5 : food >= 250 ? 4 : 3;
	const freeSlots = gameState.getPopulationLimit() - this.HQ.getAccountedPopulation(gameState);
	if (freeSlots <= 0 || size <= 0)
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

	for (const ent of this.HQ.getExpertOpeningSortedCivilians(gameState))
	{
		if (ent.getMetadata(PlayerID, "expertOpeningJob") !== undefined)
			continue;

		this.HQ.claimExpertOpeningWorker(gameState, base, ent);
		const job = this.HQ.expertEconomyManager && this.HQ.expertEconomyManager.chooseOpeningJobForCivilian ?
			this.HQ.expertEconomyManager.chooseOpeningJobForCivilian(gameState) : "wood";

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
