import { ResearchPlan } from "simulation/ai/petra/queueplanResearch.js";
import { Worker } from "simulation/ai/petra/worker.js";

/**
 * Manage the research
 */
export function ResearchManager(Config)
{
	this.Config = Config;
}

/**
 * Check if we can go to the next phase
 */
ResearchManager.prototype.checkPhase = function(gameState, queues)
{
	if (queues.majorTech.hasQueuedUnits())
		return;
	// Don't try to phase up if already trying to gather resources for a civil-centre or wonder
	if (queues.civilCentre.hasQueuedUnits() || queues.wonder.hasQueuedUnits())
		return;

	const currentPhaseIndex = gameState.currentPhase();
	const nextPhaseName = gameState.getPhaseName(currentPhaseIndex+1);
	if (!nextPhaseName)
		return;

	const petraRequirements =
		currentPhaseIndex == 1 && gameState.ai.HQ.getAccountedPopulation(gameState) >= this.Config.Economy.popPhase2 ||
		currentPhaseIndex == 2 && gameState.ai.HQ.getAccountedWorkers(gameState) > this.Config.Economy.workPhase3 ||
		currentPhaseIndex >= 3 && gameState.ai.HQ.getAccountedWorkers(gameState) > this.Config.Economy.workPhase4;
	if (petraRequirements && gameState.hasResearchers(nextPhaseName, true))
	{
		gameState.ai.HQ.phasing = currentPhaseIndex + 1;
		// Reset the queue priority in case it was changed during a previous phase update
		gameState.ai.queueManager.changePriority("majorTech", gameState.ai.Config.priorities.majorTech);
		queues.majorTech.addPlan(new ResearchPlan(gameState, nextPhaseName, true));
	}
};

ResearchManager.prototype.researchPopulationBonus = function(gameState, queues)
{
	if (queues.minorTech.hasQueuedUnits())
		return;

	const techs = gameState.findAvailableTech();
	for (const tech of techs)
	{
		if (!tech[1]._template.modifications)
			continue;
		// TODO may-be loop on all modifs and check if the effect if positive ?
		if (tech[1]._template.modifications[0].value !== "Population/Bonus")
			continue;
		queues.minorTech.addPlan(new ResearchPlan(gameState, tech[0]));
		break;
	}
};

ResearchManager.prototype.researchTradeBonus = function(gameState, queues)
{
	if (queues.minorTech.hasQueuedUnits())
		return;

	const techs = gameState.findAvailableTech();
	for (const tech of techs)
	{
		if (!tech[1]._template.modifications || !tech[1]._template.affects)
			continue;
		if (tech[1]._template.affects.indexOf("Trader") === -1)
			continue;
		// TODO may-be loop on all modifs and check if the effect if positive ?
		if (tech[1]._template.modifications[0].value !== "UnitMotion/WalkSpeed" &&
                    tech[1]._template.modifications[0].value !== "Trader/GainMultiplier")
			continue;
		queues.minorTech.addPlan(new ResearchPlan(gameState, tech[0]));
		break;
	}
};

/** Techs to be searched for as soon as they are available */
ResearchManager.prototype.researchWantedTechs = function(gameState, techs)
{
	const phase1 = gameState.currentPhase() === 1;
	const available = phase1 ? gameState.ai.queueManager.getAvailableResources(gameState) : null;
	const numWorkers = phase1 ? gameState.getOwnEntitiesByRole(Worker.ROLE_WORKER, true).length : 0;
	for (const tech of techs)
	{
		if (tech[0].indexOf("unlock_champion") == 0)
			return { "name": tech[0], "increasePriority": true };
		if (tech[0] == "traditional_army_sele" || tech[0] == "reformed_army_sele")
			return { "name": pickRandom(["traditional_army_sele", "reformed_army_sele"]), "increasePriority": true };

		if (!tech[1]._template.modifications)
			continue;
		const template = tech[1]._template;
		if (phase1)
		{
			const cost = template.cost;
			let costMax = 0;
			for (const res in cost)
				costMax = Math.max(costMax, Math.max(cost[res]-available[res], 0));
			if (10*numWorkers < costMax)
				continue;
		}
		for (const i in template.modifications)
		{
			if (gameState.ai.HQ.navalMap && template.modifications[i].value === "ResourceGatherer/Rates/food.fish")
				return { "name": tech[0], "increasePriority": this.CostSum(template.cost) < 400 };
			else if (template.modifications[i].value === "ResourceGatherer/Rates/food.fruit")
				return { "name": tech[0], "increasePriority": this.CostSum(template.cost) < 400 };
			else if (template.modifications[i].value === "ResourceGatherer/Rates/food.grain")
				return { "name": tech[0], "increasePriority": false };
			else if (template.modifications[i].value === "ResourceGatherer/Rates/wood.tree")
				return { "name": tech[0], "increasePriority": this.CostSum(template.cost) < 400 };
			else if (template.modifications[i].value.startsWith("ResourceGatherer/Capacities"))
				return { "name": tech[0], "increasePriority": false };
			else if (template.modifications[i].value === "Attack/Ranged/MaxRange")
				return { "name": tech[0], "increasePriority": false };
		}
	}
	return null;
};

/** Techs to be searched for as soon as they are available, but only after phase 2 */
ResearchManager.prototype.researchPreferredTechs = function(gameState, techs)
{
	const phase2 = gameState.currentPhase() === 2;
	const available = phase2 ? gameState.ai.queueManager.getAvailableResources(gameState) : null;
	const numWorkers = phase2 ? gameState.getOwnEntitiesByRole(Worker.ROLE_WORKER, true).length : 0;
	for (const tech of techs)
	{
		if (!tech[1]._template.modifications)
			continue;
		const template = tech[1]._template;
		if (phase2)
		{
			const cost = template.cost;
			let costMax = 0;
			for (const res in cost)
				costMax = Math.max(costMax, Math.max(cost[res]-available[res], 0));
			if (10*numWorkers < costMax)
				continue;
		}
		for (const i in template.modifications)
		{
			if (template.modifications[i].value === "ResourceGatherer/Rates/stone.rock")
				return { "name": tech[0], "increasePriority": this.CostSum(template.cost) < 400 };
			else if (template.modifications[i].value === "ResourceGatherer/Rates/metal.ore")
				return { "name": tech[0], "increasePriority": this.CostSum(template.cost) < 400 };
			else if (template.modifications[i].value === "BuildingAI/DefaultArrowCount")
			{
				// CWA/Petra: Do not buy civic-center / defensive arrow upgrades just because
				// they are available. They are useful only when our base is under real
				// pressure or enemies are close enough that the upgrade can matter now.
				if (!this.shouldResearchDefensiveRangeUpgrade(gameState))
					continue;

				return { "name": tech[0], "increasePriority": this.CostSum(template.cost) < 400 };
			}
			else if (template.modifications[i].value === "Health/RegenRate")
				return { "name": tech[0], "increasePriority": false };
			else if (template.modifications[i].value === "Health/IdleRegenRate")
				return { "name": tech[0], "increasePriority": false };
		}
	}
	return null;
};

/**
 * CWA/Petra: Defensive ranged / arrow-count upgrades should be reactive, not automatic.
 *
 * Research them when the defense manager has active enemy armies near our bases or
 * when a known enemy unit is close to one of our civic centers / major dropsites.
 * Otherwise, save the resources for economy, production, and normal techs.
 */
ResearchManager.prototype.shouldResearchDefensiveRangeUpgrade = function(gameState)
{
	const defenseManager = gameState.ai && gameState.ai.HQ ? gameState.ai.HQ.defenseManager : undefined;
	if (defenseManager && defenseManager.armies)
	{
		for (const army of defenseManager.armies)
		{
			if (!army || !army.foePosition || !army.foeEntities || !army.foeEntities.length)
				continue;

			// About 90m. Close enough that a CC/tower range upgrade can matter soon.
			if (gameState.ai.HQ && gameState.ai.HQ.baseManagers)
				for (const base of gameState.ai.HQ.baseManagers)
					if (base && base.position && SquareVectorDistance(base.position(), army.foePosition) < 8100)
						return true;
		}
	}

	const ownStructures = gameState.getOwnStructures().filter(ent =>
		ent.position() &&
		(ent.hasClass("CivCentre") || ent.hasClass("Fortress") || ent.hasClass("Tower")));
	if (!ownStructures.hasEntities())
		return false;

	const enemyUnits = gameState.getEnemyUnits().filter(ent =>
		ent.position() &&
		!ent.hasClass("Support") &&
		!ent.hasClass("Domestic") &&
		ent.attackTypes() !== undefined);
	if (!enemyUnits.hasEntities())
		return false;

	for (const structure of ownStructures.toEntityArray())
	{
		const pos = structure.position();
		for (const enemy of enemyUnits.toEntityArray())
			// About 80m from an important defensive structure.
			if (SquareVectorDistance(pos, enemy.position()) < 6400)
				return true;
	}

	return false;
};

ResearchManager.prototype.update = function(gameState, queues)
{
	if (queues.minorTech.hasQueuedUnits() || queues.majorTech.hasQueuedUnits())
		return;

	const techs = gameState.findAvailableTech();

	let techName = this.researchWantedTechs(gameState, techs);
	if (techName)
	{
		if (techName.increasePriority)
		{
			gameState.ai.queueManager.changePriority("minorTech", 2*this.Config.priorities.minorTech);
			const plan = new ResearchPlan(gameState, techName.name);
			plan.queueToReset = "minorTech";
			queues.minorTech.addPlan(plan);
		}
		else
			queues.minorTech.addPlan(new ResearchPlan(gameState, techName.name));
		return;
	}

	if (gameState.currentPhase() < 2)
		return;

	techName = this.researchPreferredTechs(gameState, techs);
	if (techName)
	{
		if (techName.increasePriority)
		{
			gameState.ai.queueManager.changePriority("minorTech", 2*this.Config.priorities.minorTech);
			const plan = new ResearchPlan(gameState, techName.name);
			plan.queueToReset = "minorTech";
			queues.minorTech.addPlan(plan);
		}
		else
			queues.minorTech.addPlan(new ResearchPlan(gameState, techName.name));
		return;
	}

	if (gameState.currentPhase() < 3)
		return;

	// remove some techs not yet used by this AI
	// remove also sharedLos if we have no ally
	for (let i = 0; i < techs.length; ++i)
	{
		const template = techs[i][1]._template;
		if (template.affects && template.affects.length === 1 &&
			(template.affects[0] === "Healer" || template.affects[0] === "Outpost" || template.affects[0] === "Wall"))
		{
			techs.splice(i--, 1);
			continue;
		}
		if (template.modifications && template.modifications.length === 1 &&
			this.Config.unusedNoAllyTechs.includes(template.modifications[0].value) &&
			!gameState.hasAllies())
		{
			techs.splice(i--, 1);
			continue;
		}
	}
	if (!techs.length)
		return;

	// randomly pick one. No worries about pairs in that case.
	queues.minorTech.addPlan(new ResearchPlan(gameState, pickRandom(techs)[0]));
};

ResearchManager.prototype.CostSum = function(cost)
{
	let costSum = 0;
	for (const res in cost)
		costSum += cost[res];
	return costSum;
};

ResearchManager.prototype.Serialize = function()
{
	return {};
};

ResearchManager.prototype.Deserialize = function(data)
{
};
