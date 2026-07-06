import * as filters from "simulation/ai/common-api/filters.js";
import { aiWarn } from "simulation/ai/common-api/utils.js";

/**
 * One task of this manager is to cache the list of structures we have builders for,
 * to avoid having to loop on all entities each time.
 * It also takes care of the structures we can't currently build and should not try to build endlessly.
 */

export function BuildManager()
{
	// List of buildings we have builders for, with number of possible builders.
	this.builderCounters = new Map();
	// List of buildings we can't currently build (because no room, no builder or whatever),
	// with time we should wait before trying again to build it.
	this.unbuildables = new Map();
}

/** Initialization at start of game */
BuildManager.prototype.init = function(gameState)
{
	const civ = gameState.getPlayerCiv();
	for (const ent of gameState.getOwnUnits().values())
		this.incrementBuilderCounters(civ, ent, 1);
};

BuildManager.prototype.incrementBuilderCounters = function(civ, ent, increment)
{
	for (const buildable of ent.buildableEntities(civ))
	{
		if (this.builderCounters.has(buildable))
		{
			const count = this.builderCounters.get(buildable) + increment;
			if (count < 0)
			{
				aiWarn(" Petra error in incrementBuilderCounters for " + buildable +
					" with count < 0");
				continue;
			}
			this.builderCounters.set(buildable, count);
		}
		else if (increment > 0)
			this.builderCounters.set(buildable, increment);
		else
			aiWarn(" Petra error in incrementBuilderCounters for " + buildable + " not yet set");
	}
};

/** Update the builders counters */
BuildManager.prototype.checkEvents = function(gameState, events)
{
	this.elapsedTime = gameState.ai.elapsedTime;
	const civ = gameState.getPlayerCiv();

	for (const evt of events.Create)
	{
		if (events.Destroy.some(e => e.entity == evt.entity))
			continue;
		const ent = gameState.getEntityById(evt.entity);
		if (ent && ent.isOwn(PlayerID) && ent.hasClass("Unit"))
			this.incrementBuilderCounters(civ, ent, 1);
	}

	for (const evt of events.Destroy)
	{
		if (events.Create.some(e => e.entity == evt.entity) || !evt.entityObj)
			continue;
		const ent = evt.entityObj;
		if (ent && ent.isOwn(PlayerID) && ent.hasClass("Unit"))
			this.incrementBuilderCounters(civ, ent, -1);
	}

	for (const evt of events.OwnershipChanged)   // capture events
	{
		let increment;
		if (evt.from == PlayerID)
			increment = -1;
		else if (evt.to == PlayerID)
			increment = 1;
		else
			continue;
		const ent = gameState.getEntityById(evt.entity);
		if (ent && ent.hasClass("Unit"))
			this.incrementBuilderCounters(civ, ent, increment);
	}

	for (const evt of events.ValueModification)
	{
		if (evt.component != "Builder" ||
		        !evt.valueNames.some(val => val.startsWith("Builder/Entities/")))
			continue;

		// Unfortunately there really is not an easy way to determine the changes
		// at this stage, so we simply have to dump the cache.
		this.builderCounters = new Map();

		for (const ent of gameState.getOwnUnits().values())
			this.incrementBuilderCounters(civ, ent, 1);
	}
};


/**
 * Get the buildable structures passing a filter.
 */
BuildManager.prototype.findStructuresByFilter = function(gameState, filter)
{
	const result = [];
	for (const [templateName, count] of this.builderCounters)
	{
		if (!count || gameState.isTemplateDisabled(templateName))
			continue;
		const template = gameState.getTemplate(templateName);
		if (!template || !template.available(gameState))
			continue;
		if (filter.func(template))
			result.push(templateName);
	}
	return result;
};

/**
 * Get the first buildable structure with a given class
 * TODO when several available, choose the best one
 */
BuildManager.prototype.findStructureWithClass = function(gameState, classes)
{
	return this.findStructuresByFilter(gameState, filters.byClasses(classes))[0];
};

BuildManager.prototype.hasBuilder = function(template)
{
	const numBuilders = this.builderCounters.get(template);
	return numBuilders && numBuilders > 0;
};

BuildManager.prototype.isUnbuildable = function(gameState, template)
{
	return this.unbuildables.has(template) && this.unbuildables.get(template).time > gameState.ai.elapsedTime;
};

BuildManager.prototype.setBuildable = function(template)
{
	if (this.unbuildables.has(template))
		this.unbuildables.delete(template);
};

/** Time is the duration in second that we will wait before checking again if it is buildable */
BuildManager.prototype.setUnbuildable = function(gameState, template, time = 90, reason = "room")
{
	if (!this.unbuildables.has(template))
		this.unbuildables.set(template, { "reason": reason, "time": gameState.ai.elapsedTime + time });
	else
	{
		const unbuildable = this.unbuildables.get(template);
		if (unbuildable.time < gameState.ai.elapsedTime + time)
		{
			unbuildable.reason = reason;
			unbuildable.time = gameState.ai.elapsedTime + time;
		}
	}
};

/** Return the number of unbuildables due to missing room */
BuildManager.prototype.numberMissingRoom = function(gameState)
{
	let num = 0;
	for (const unbuildable of this.unbuildables.values())
		if (unbuildable.reason == "room" && unbuildable.time > gameState.ai.elapsedTime)
			++num;
	return num;
};

/** Reset the unbuildables due to missing room */
BuildManager.prototype.resetMissingRoom = function(gameState)
{
	for (const [key, unbuildable] of this.unbuildables)
		if (unbuildable.reason == "room")
			this.unbuildables.delete(key);
};

BuildManager.prototype.Serialize = function()
{
	return {
		"builderCounters": this.builderCounters,
		"unbuildables": this.unbuildables
	};
};

BuildManager.prototype.Deserialize = function(data)
{
	for (const key in data)
		this[key] = data[key];
};
