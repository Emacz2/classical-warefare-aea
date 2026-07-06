import { ResourcesManager } from "simulation/ai/common-api/resources.js";
import { aiWarn } from "simulation/ai/common-api/utils.js";

/**
 * Common functions and variables to all queue plans.
 */

export function QueuePlan(gameState, type, metadata)
{
	this.type = gameState.applyCiv(type);
	this.metadata = metadata;

	this.template = gameState.getTemplate(this.type);
	if (!this.template)
	{
		aiWarn("Tried to add the inexisting template " + this.type + " to Petra.");
		return false;
	}
	this.ID = gameState.ai.uniqueIDs.plans++;
	this.cost = new ResourcesManager(this.template.cost());
	this.number = 1;
	this.category = "";

	return true;
}

/** Check the content of this queue */
QueuePlan.prototype.isInvalid = function(gameState)
{
	return false;
};

/** if true, the queue manager will begin increasing this plan's account. */
QueuePlan.prototype.isGo = function(gameState)
{
	return true;
};

/** can we start this plan immediately? */
QueuePlan.prototype.canStart = function(gameState)
{
	return false;
};

/** process the plan. */
QueuePlan.prototype.start = function(gameState)
{
	// should call onStart.
};

QueuePlan.prototype.getCost = function()
{
	const costs = new ResourcesManager();
	costs.add(this.cost);
	if (this.number !== 1)
		costs.multiply(this.number);
	return costs;
};

/**
 * On Event functions.
 * Can be used to do some specific stuffs
 * Need to be updated to actually do something if you want them to.
 * this is called by "Start" if it succeeds.
 */
QueuePlan.prototype.onStart = function(gameState)
{
};
