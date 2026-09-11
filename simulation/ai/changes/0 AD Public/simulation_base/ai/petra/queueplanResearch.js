import { ResourcesManager } from "simulation/ai/common-api/resources.js";
import { QueuePlan } from "simulation/ai/petra/queueplan.js";

export function ResearchPlan(gameState, type, rush = false)
{
	if (!QueuePlan.call(this, gameState, type, {}))
		return false;

	if (this.template.researchTime === undefined)
		return false;

	// Refine the estimated cost
	const researchers = this.getBestResearchers(gameState, true);
	if (researchers)
		this.cost = new ResourcesManager(this.template.cost(researchers[0]));

	this.category = "technology";
	this.rush = rush;

	return true;
}

ResearchPlan.prototype = Object.create(QueuePlan.prototype);

ResearchPlan.prototype.canStart = function(gameState)
{
	this.researchers = this.getBestResearchers(gameState);
	if (!this.researchers)
		return false;
	this.cost = new ResourcesManager(this.template.cost(this.researchers[0]));
	return true;
};

ResearchPlan.prototype.getBestResearchers = function(gameState, noRequirementCheck = false)
{
	const allResearchers = gameState.findResearchers(this.type, noRequirementCheck);
	if (!allResearchers || !allResearchers.hasEntities())
		return undefined;

	// Keep only researchers with smallest cost
	let costMin = Math.min();
	let researchers;
	for (const ent of allResearchers.values())
	{
		const cost = this.template.costSum(ent);
		if (cost === costMin)
			researchers.push(ent);
		else if (cost < costMin)
		{
			costMin = cost;
			researchers = [ent];
		}
	}
	return researchers;
};

ResearchPlan.prototype.isInvalid = function(gameState)
{
	return gameState.isResearched(this.type) || gameState.isResearching(this.type);
};

ResearchPlan.prototype.start = function(gameState)
{
	// Prefer researcher with shortest queues (no need to serialize this.researchers
	// as the functions canStart and start are always called on the same turn)
	this.researchers.sort((a, b) => a.trainingQueueTime() - b.trainingQueueTime());
	// Drop anything in the queue if we rush it.
	if (this.rush)
		this.researchers[0].stopAllProduction(0.45);
	this.researchers[0].research(this.type);
	this.onStart(gameState);
};

ResearchPlan.prototype.onStart = function(gameState)
{
	if (this.queueToReset)
		gameState.ai.queueManager.changePriority(this.queueToReset, gameState.ai.Config.priorities[this.queueToReset]);

	for (let i = gameState.getNumberOfPhases(); i > 0; --i)
	{
		if (this.type != gameState.getPhaseName(i))
			continue;
		gameState.ai.HQ.phasing = 0;
		gameState.ai.HQ.OnPhaseUp(gameState, i);
		break;
	}
};

ResearchPlan.prototype.Serialize = function()
{
	return {
		"category": this.category,
		"type": this.type,
		"ID": this.ID,
		"metadata": this.metadata,
		"cost": this.cost.Serialize(),
		"number": this.number,
		"rush": this.rush,
		"queueToReset": this.queueToReset || undefined
	};
};

ResearchPlan.prototype.Deserialize = function(gameState, data)
{
	for (const key in data)
		this[key] = data[key];

	this.cost = new ResourcesManager();
	this.cost.Deserialize(data.cost);
};
