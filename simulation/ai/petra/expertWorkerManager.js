import * as difficulty from "simulation/ai/petra/difficultyLevel.js";

/**
 * ExpertWorkerManager v0.4.1
 *
 * This is the first ownership layer for Expert.  Petra can still provide the
 * low-level gather/build commands, but during the opening/transition Expert owns
 * civilian worker roles and re-enforces them after Petra's base managers run.
 *
 * Initial policy:
 *  - keep the successful first-24 opening roles intact;
 *  - first 4 civilians stay on the opening farmstead until it is built;
 *  - civilians 5-7 remain on the first food cluster;
 *  - civilians 8-24 are wood workers;
 *  - after the scripted opening, no civilian is allowed to remain unowned/idle:
 *    fill the wood target first, then hand new workers to food/farm transition.
 */
export function ExpertWorkerManager(HQ, constants)
{
	this.HQ = HQ;
	this.Constants = constants;
	this.activeUntil = 420;
	this.openingFoodCivilians = 7;
	this.openingTotalWoodWorkers = constants.firstWoodSaturation || 20;
}

ExpertWorkerManager.prototype.isActive = function(gameState)
{
	return this.HQ.Config.difficulty >= difficulty.EXPERT &&
		this.HQ.isExpertOpeningPhaseActive &&
		gameState.ai.elapsedTime <= this.activeUntil;
};

ExpertWorkerManager.prototype.update = function(gameState)
{
	if (!this.isActive(gameState))
		return;

	const base = this.HQ.baseManagers()[0];
	if (!base)
		return;

	if (this.HQ.ensureExpertOpeningPlan)
		this.HQ.ensureExpertOpeningPlan(gameState);

	// Re-apply the deterministic first-24 role script every turn.  This is the
	// key difference from Petra: the first opening roles are owned, not suggested.
	if (this.HQ.assignExpertOpeningFirst24CivilianRoles)
		this.HQ.assignExpertOpeningFirst24CivilianRoles(gameState);

	this.assignUnownedCivilians(gameState, base);
	if (this.HQ.expertEconomyManager && this.HQ.expertEconomyManager.balanceOpeningCivilianJobs)
		this.HQ.expertEconomyManager.balanceOpeningCivilianJobs(gameState);
	this.enforceOwnedWorkers(gameState, base);
};

ExpertWorkerManager.prototype.assignUnownedCivilians = function(gameState, base)
{
	for (const ent of this.HQ.getExpertOpeningSortedCivilians(gameState))
	{
		if (ent.getMetadata(PlayerID, "expertOpeningJob") !== undefined)
			continue;

		const job = this.HQ.expertEconomyManager && this.HQ.expertEconomyManager.chooseOpeningJobForCivilian ?
			this.HQ.expertEconomyManager.chooseOpeningJobForCivilian(gameState) : "wood";
		this.claim(ent, base, job);
	}
};

ExpertWorkerManager.prototype.claim = function(ent, base, job)
{
	ent.setMetadata(PlayerID, "base", base.ID);
	ent.setMetadata(PlayerID, "role", undefined);
	ent.setMetadata(PlayerID, "expertOpeningJob", job);
	ent.setMetadata(PlayerID, "subrole", undefined);
	ent.setMetadata(PlayerID, "target-foundation", undefined);
	ent.setMetadata(PlayerID, "supply", undefined);
	if (job != "berries" && job != "farm")
		ent.setMetadata(PlayerID, "expertFoodLockedSupply", undefined);
};

ExpertWorkerManager.prototype.enforceOwnedWorkers = function(gameState, base)
{
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position || !ent.position())
			continue;
		if (!this.HQ.isExpertOpeningEconomyUnit || !this.HQ.isExpertOpeningEconomyUnit(ent))
			continue;
		const job = ent.getMetadata(PlayerID, "expertOpeningJob");
		if (job === undefined)
			continue;
		if (this.HQ.claimExpertOpeningWorker)
			this.HQ.claimExpertOpeningWorker(gameState, base, ent);
		if (this.HQ.enforceExpertOpeningPhase)
			this.HQ.enforceExpertOpeningPhase(gameState, ent);
	}
};
