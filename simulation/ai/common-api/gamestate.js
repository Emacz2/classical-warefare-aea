import { Template } from "simulation/ai/common-api/entity.js";
import * as filters from "simulation/ai/common-api/filters.js";
import { ResourcesManager } from "simulation/ai/common-api/resources.js";
import { Technology } from "simulation/ai/common-api/technology.js";

/**
 * Provides an API for the rest of the AI scripts to query the world state at a
 * higher level than the raw data.
 */
export function GameState()
{
	this.ai = null; // must be updated by the AIs.
}

GameState.prototype.init = function(SharedScript, state, player)
{
	this.sharedScript = SharedScript;
	this.EntCollecNames = SharedScript._entityCollectionsName;
	this.timeElapsed = SharedScript.timeElapsed;
	this.circularMap = SharedScript.circularMap;
	this.templates = SharedScript._templates;
	this.entities = SharedScript.entities;
	this.player = player;
	this.playerData = SharedScript.playersData[this.player];
	this.victoryConditions = SharedScript.victoryConditions;
	this.alliedVictory = SharedScript.alliedVictory;
	this.ceasefireActive = SharedScript.ceasefireActive;
	this.ceasefireTimeRemaining = SharedScript.ceasefireTimeRemaining;

	// get the list of possible phases for this civ:
	// we assume all of them are researchable from the civil center
	this.phases = [];
	const cctemplate = this.getTemplate(this.applyCiv("structures/{civ}/civil_centre"));
	if (!cctemplate)
		return;
	const civ = this.getPlayerCiv();
	const techs = cctemplate.researchableTechs(this, civ);

	const phaseData = {};
	const phaseMap = {};
	for (let techName of techs)
	{
		if (!techName.startsWith("phase"))
			continue;
		let techData = this.getTemplate(techName);

		if (techData._definesPair)
		{
			// Randomly pick a non-disabled choice from the phase-pair.
			techName = pickRandom([techData._template.top, techData._template.bottom].filter(tech => !this.playerData.disabledTechnologies[tech])) || techData._template.top;

			const supersedes = techData._template.supersedes;
			techData = clone(this.getTemplate(techName));
			if (supersedes)
				techData._template.supersedes = supersedes;
		}

		phaseData[techName] = GetTechnologyBasicDataHelper(techData._template, civ);
		if (phaseData[techName].replaces)
			phaseMap[phaseData[techName].replaces[0]] = techName;
	}

	this.phases = UnravelPhases(phaseData).map(phaseName => ({
		"name": phaseMap[phaseName] || phaseName,
		"requirements": phaseMap[phaseName] ? phaseData[phaseMap[phaseName]].reqs : []
	}));
};

GameState.prototype.update = function(SharedScript)
{
	this.timeElapsed = SharedScript.timeElapsed;
	this.playerData = SharedScript.playersData[this.player];
	this.ceasefireActive = SharedScript.ceasefireActive;
	this.ceasefireTimeRemaining = SharedScript.ceasefireTimeRemaining;
};

GameState.prototype.updatingCollection = function(id, filter, parentCollection)
{
	const gid = "player-" + this.player + "-" + id;	// automatically add the player ID
	return this.updatingGlobalCollection(gid, filter, parentCollection);
};

GameState.prototype.destroyCollection = function(id)
{
	const gid = "player-" + this.player + "-" + id;	// automatically add the player ID
	this.destroyGlobalCollection(gid);
};

GameState.prototype.updatingGlobalCollection = function(gid, filter, parentCollection)
{
	if (this.EntCollecNames.has(gid))
		return this.EntCollecNames.get(gid);

	const collection = parentCollection ? parentCollection.filter(filter) : this.entities.filter(filter);
	collection.registerUpdates();
	this.EntCollecNames.set(gid, collection);
	return collection;
};

GameState.prototype.destroyGlobalCollection = function(gid)
{
	if (!this.EntCollecNames.has(gid))
		return;

	this.sharedScript.removeUpdatingEntityCollection(this.EntCollecNames.get(gid));
	this.EntCollecNames.delete(gid);
};

/**
 * Reset the entities collections which depend on diplomacy
 */
GameState.prototype.resetOnDiplomacyChanged = function()
{
	for (const name of this.EntCollecNames.keys())
		if (name.startsWith("player-" + this.player + "-diplo"))
			this.destroyGlobalCollection(name);
};

GameState.prototype.getTimeElapsed = function()
{
	return this.timeElapsed;
};

GameState.prototype.getBarterPrices = function()
{
	return this.playerData.barterPrices;
};

GameState.prototype.getVictoryConditions = function()
{
	return this.victoryConditions;
};

GameState.prototype.getAlliedVictory = function()
{
	return this.alliedVictory;
};

GameState.prototype.isCeasefireActive = function()
{
	return this.ceasefireActive;
};

GameState.prototype.getTemplate = function(type)
{
	if (TechnologyTemplates.Has(type))
		return new Technology(type);

	if (this.templates[type] === undefined)
		this.sharedScript.GetTemplate(type);

	return this.templates[type] ? new Template(this.sharedScript, type, this.templates[type]) : null;
};

/** Return the template of the structure built from this foundation */
GameState.prototype.getBuiltTemplate = function(foundationName)
{
	if (!foundationName.startsWith("foundation|"))
	{
		warn("Foundation " + foundationName + " not recognized as a foundation.");
		return null;
	}
	return this.getTemplate(foundationName.substr(11));
};

GameState.prototype.applyCiv = function(str)
{
	return str.replace(/\{civ\}/g, this.playerData.civ);
};

GameState.prototype.getPlayerCiv = function(player)
{
	return player !== undefined ? this.sharedScript.playersData[player].civ : this.playerData.civ;
};

GameState.prototype.currentPhase = function()
{
	for (let i = this.phases.length; i > 0; --i)
		if (this.isResearched(this.phases[i-1].name))
			return i;
	return 0;
};

GameState.prototype.getNumberOfPhases = function()
{
	return this.phases.length;
};

GameState.prototype.getPhaseName = function(i)
{
	return this.phases[i-1] ? this.phases[i-1].name : undefined;
};

GameState.prototype.getPhaseEntityRequirements = function(i)
{
	const entityReqs = [];

	for (const requirement of this.phases[i-1].requirements)
	{
		if (!requirement.entities)
			continue;
		for (const entity of requirement.entities)
			if (entity.check == "count")
				entityReqs.push({
					"class": entity.class,
					"count": entity.number
				});
	}

	return entityReqs;
};

GameState.prototype.isResearched = function(template)
{
	return this.playerData.researchedTechs.has(template);
};

GameState.prototype.isResearching = function(template)
{
	return this.playerData.researchQueued.has(template);
};

/** this is an "in-absolute" check that doesn't check if we have a building to research from. */
GameState.prototype.canResearch = function(techTemplateName, noRequirementCheck)
{
	if (this.playerData.disabledTechnologies[techTemplateName])
		return false;

	const template = this.getTemplate(techTemplateName);
	if (!template)
		return false;

	if (this.playerData.researchQueued.has(techTemplateName) ||
	    this.playerData.researchedTechs.has(techTemplateName))
		return false;

	if (noRequirementCheck)
		return true;

	// if this is a pair, we must check that the pair tech is not being researched
	if (template.pair())
	{
		const other = template.pairedWith();
		if (this.playerData.researchQueued.has(other) ||
		    this.playerData.researchedTechs.has(other))
			return false;
	}

	return this.checkTechRequirements(template.requirements(this.playerData.civ));
};

/**
 * Private function for checking a set of requirements is met.
 * Basically copies TechnologyManager, but compares against
 * variables only available within the AI
 */
GameState.prototype.checkTechRequirements = function(reqs)
{
	if (!reqs)
		return false;

	if (!reqs.length)
		return true;

	const doesEntitySpecPass = entity => {
		switch (entity.check)
		{
		case "count":
			return this.playerData.classCounts[entity.class] &&
					this.playerData.classCounts[entity.class] >= entity.number;

		case "variants":
			return this.playerData.typeCountsByClass[entity.class] &&
					Object.keys(this.playerData.typeCountsByClass[entity.class]).length >= entity.number;

		default:
			return true;
		}
	};

	return reqs.some(req => {
		return Object.keys(req).every(type => {
			switch (type)
			{
			case "techs":
				return req[type].every(tech => this.playerData.researchedTechs.has(tech));

			case "entities":
				return req[type].every(doesEntitySpecPass);
			default:
				return false;
			}
		});
	});
};

GameState.prototype.getPassabilityMap = function()
{
	return this.sharedScript.passabilityMap;
};

GameState.prototype.getPassabilityClassMask = function(name)
{
	if (!this.sharedScript.passabilityClasses[name])
		error("Tried to use invalid passability class name '" + name + "'");
	return this.sharedScript.passabilityClasses[name];
};

GameState.prototype.getResources = function()
{
	return new ResourcesManager(this.playerData.resourceCounts);
};

GameState.prototype.getPopulation = function()
{
	return this.playerData.popCount;
};

GameState.prototype.getPopulationLimit = function() {
	return this.playerData.popLimit;
};

GameState.prototype.getPopulationMax = function() {
	return this.playerData.popMax;
};

GameState.prototype.getPlayerID = function()
{
	return this.player;
};

GameState.prototype.hasAllies = function()
{
	for (const i in this.playerData.isAlly)
		if (this.playerData.isAlly[i] && +i !== this.player &&
		    this.sharedScript.playersData[i].state !== "defeated")
			return true;
	return false;
};

GameState.prototype.hasEnemies = function()
{
	for (const i in this.playerData.isEnemy)
		if (this.playerData.isEnemy[i] && +i !== 0 &&
		    this.sharedScript.playersData[i].state !== "defeated")
			return true;
	return false;
};

GameState.prototype.hasNeutrals = function()
{
	for (const i in this.playerData.isNeutral)
		if (this.playerData.isNeutral[i] &&
		    this.sharedScript.playersData[i].state !== "defeated")
			return true;
	return false;
};

GameState.prototype.isPlayerNeutral = function(id)
{
	return this.playerData.isNeutral[id];
};

GameState.prototype.isPlayerAlly = function(id)
{
	return this.playerData.isAlly[id];
};

GameState.prototype.isPlayerMutualAlly = function(id)
{
	return this.playerData.isMutualAlly[id];
};

GameState.prototype.isPlayerEnemy = function(id)
{
	return this.playerData.isEnemy[id];
};

/** Return the number of players currently enemies, not including gaia */
GameState.prototype.getNumPlayerEnemies = function()
{
	let num = 0;
	for (let i = 1; i < this.playerData.isEnemy.length; ++i)
		if (this.playerData.isEnemy[i] &&
		    this.sharedScript.playersData[i].state != "defeated")
			++num;
	return num;
};

GameState.prototype.getEnemies = function()
{
	const ret = [];
	for (const i in this.playerData.isEnemy)
		if (this.playerData.isEnemy[i])
			ret.push(+i);
	return ret;
};

GameState.prototype.getNeutrals = function()
{
	const ret = [];
	for (const i in this.playerData.isNeutral)
		if (this.playerData.isNeutral[i])
			ret.push(+i);
	return ret;
};

GameState.prototype.getAllies = function()
{
	const ret = [];
	for (const i in this.playerData.isAlly)
		if (this.playerData.isAlly[i])
			ret.push(+i);
	return ret;
};

GameState.prototype.getExclusiveAllies = function()
{	// Player is not included
	const ret = [];
	for (const i in this.playerData.isAlly)
		if (this.playerData.isAlly[i] && +i !== this.player)
			ret.push(+i);
	return ret;
};

GameState.prototype.getMutualAllies = function()
{
	const ret = [];
	for (const i in this.playerData.isMutualAlly)
		if (this.playerData.isMutualAlly[i] &&
		    this.sharedScript.playersData[i].isMutualAlly[this.player])
			ret.push(+i);
	return ret;
};

GameState.prototype.isEntityAlly = function(ent)
{
	if (!ent)
		return false;
	return this.playerData.isAlly[ent.owner()];
};

GameState.prototype.isEntityExclusiveAlly = function(ent)
{
	if (!ent)
		return false;
	return this.playerData.isAlly[ent.owner()] && ent.owner() !== this.player;
};

GameState.prototype.isEntityEnemy = function(ent)
{
	if (!ent)
		return false;
	return this.playerData.isEnemy[ent.owner()];
};

GameState.prototype.isEntityOwn = function(ent)
{
	if (!ent)
		return false;
	return ent.owner() === this.player;
};

GameState.prototype.getEntityById = function(id)
{
	return this.entities._entities.get(+id);
};

GameState.prototype.getEntities = function(id)
{
	if (id === undefined)
		return this.entities;

	return this.updatingGlobalCollection("player-" + id + "-entities", filters.byOwner(id));
};

GameState.prototype.getStructures = function()
{
	return this.updatingGlobalCollection("structures", filters.byClass("Structure"), this.entities);
};

GameState.prototype.getOwnEntities = function()
{
	return this.updatingGlobalCollection("player-" + this.player + "-entities",
		filters.byOwner(this.player));
};

GameState.prototype.getOwnStructures = function()
{
	return this.updatingGlobalCollection("player-" + this.player + "-structures",
		filters.byClass("Structure"), this.getOwnEntities());
};

GameState.prototype.getOwnUnits = function()
{
	return this.updatingGlobalCollection("player-" + this.player + "-units", filters.byClass("Unit"),
		this.getOwnEntities());
};

GameState.prototype.getAllyEntities = function()
{
	return this.entities.filter(filters.byOwners(this.getAllies()));
};

GameState.prototype.getExclusiveAllyEntities = function()
{
	return this.entities.filter(filters.byOwners(this.getExclusiveAllies()));
};

GameState.prototype.getAllyStructures = function(allyID)
{
	if (allyID == undefined)
	{
		return this.updatingCollection("diplo-ally-structures", filters.byOwners(this.getAllies()),
			this.getStructures());
	}

	return this.updatingGlobalCollection("player-" + allyID + "-structures", filters.byOwner(allyID),
		this.getStructures());
};

GameState.prototype.getNeutralStructures = function()
{
	return this.getStructures().filter(filters.byOwners(this.getNeutrals()));
};

GameState.prototype.getEnemyEntities = function()
{
	return this.entities.filter(filters.byOwners(this.getEnemies()));
};

GameState.prototype.getEnemyStructures = function(enemyID)
{
	if (enemyID === undefined)
	{
		return this.updatingCollection("diplo-enemy-structures", filters.byOwners(this.getEnemies()),
			this.getStructures());
	}

	return this.updatingGlobalCollection("player-" + enemyID + "-structures", filters.byOwner(enemyID),
		this.getStructures());
};

GameState.prototype.getEnemyUnits = function(enemyID)
{
	if (enemyID === undefined)
		return this.getEnemyEntities().filter(filters.byClass("Unit"));

	return this.updatingGlobalCollection("player-" + enemyID + "-units", filters.byClass("Unit"),
		this.getEntities(enemyID));
};

/** if maintain is true, this will be stored. Otherwise it's one-shot. */
GameState.prototype.getOwnEntitiesByMetadata = function(key, value, maintain)
{
	if (maintain)
	{
		return this.updatingCollection(key + "-" + value, filters.byMetadata(this.player, key, value),
			this.getOwnEntities());
	}
	return this.getOwnEntities().filter(filters.byMetadata(this.player, key, value));
};

GameState.prototype.getOwnEntitiesByRole = function(role, maintain)
{
	return this.getOwnEntitiesByMetadata("role", role, maintain);
};

GameState.prototype.getOwnEntitiesByType = function(type, maintain)
{
	const filter = filters.byType(type);
	if (maintain)
		return this.updatingCollection("type-" + type, filter, this.getOwnEntities());
	return this.getOwnEntities().filter(filter);
};

GameState.prototype.getOwnEntitiesByClass = function(cls, maintain)
{
	const filter = filters.byClass(cls);
	if (maintain)
		return this.updatingCollection("class-" + cls, filter, this.getOwnEntities());
	return this.getOwnEntities().filter(filter);
};

GameState.prototype.getOwnFoundationsByClass = function(cls, maintain)
{
	const filter = filters.byClass(cls);
	if (maintain)
		return this.updatingCollection("foundations-class-" + cls, filter, this.getOwnFoundations());
	return this.getOwnFoundations().filter(filter);
};

GameState.prototype.getOwnTrainingFacilities = function()
{
	return this.updatingGlobalCollection("player-" + this.player + "-training-facilities",
		filters.byTrainingQueue(), this.getOwnEntities());
};

GameState.prototype.getOwnResearchFacilities = function()
{
	return this.updatingGlobalCollection("player-" + this.player + "-research-facilities",
		filters.byResearchAvailable(this, this.playerData.civ), this.getOwnEntities());
};


GameState.prototype.countEntitiesByType = function(type, maintain)
{
	return this.getOwnEntitiesByType(type, maintain).length;
};

GameState.prototype.countEntitiesAndQueuedByType = function(type, maintain)
{
	const template = this.getTemplate(type);
	if (!template)
		return 0;

	let count = this.countEntitiesByType(type, maintain);

	// Count building foundations
	if (template.hasClass("Structure") === true)
		count += this.countFoundationsByType(type, true);
	else if (template.resourceSupplyType() !== undefined)	// animal resources
		count += this.countEntitiesByType("resource|" + type, true);
	else
	{
		// Count entities in building production queues
		// TODO: maybe this fails for corrals.
		this.getOwnTrainingFacilities().forEach(function(ent) {
			for (const item of ent.trainingQueue())
				if (item.unitTemplate == type)
					count += item.count;
		});
	}

	return count;
};

GameState.prototype.countFoundationsByType = function(type, maintain)
{
	const foundationType = "foundation|" + type;

	if (maintain)
	{
		return this.updatingCollection("foundation-type-" + type, filters.byType(foundationType),
			this.getOwnFoundations()).length;
	}

	let count = 0;
	this.getOwnStructures().forEach(function(ent) {
		if (ent.templateName() == foundationType)
			++count;
	});
	return count;
};

GameState.prototype.countOwnEntitiesByRole = function(role)
{
	return this.getOwnEntitiesByRole(role, "true").length;
};

GameState.prototype.countOwnEntitiesAndQueuedWithRole = function(role)
{
	let count = this.countOwnEntitiesByRole(role);

	// Count entities in building production queues
	this.getOwnTrainingFacilities().forEach(function(ent) {
		for (const item of ent.trainingQueue())
			if (item.metadata && item.metadata.role && item.metadata.role == role)
				count += item.count;
	});
	return count;
};

GameState.prototype.countOwnQueuedEntitiesWithMetadata = function(data, value)
{
	// Count entities in building production queues
	let count = 0;
	this.getOwnTrainingFacilities().forEach(function(ent) {
		for (const item of ent.trainingQueue())
			if (item.metadata && item.metadata[data] && item.metadata[data] == value)
				count += item.count;
	});
	return count;
};

GameState.prototype.getOwnFoundations = function()
{
	return this.updatingGlobalCollection("player-" + this.player + "-foundations",
		filters.isFoundation(), this.getOwnStructures());
};

GameState.prototype.getOwnDropsites = function(resource)
{
	if (resource)
	{
		return this.updatingCollection("ownDropsite-" + resource, filters.isDropsite(resource),
			this.getOwnEntities());
	}
	return this.updatingCollection("ownDropsite-all", filters.isDropsite(), this.getOwnEntities());
};

GameState.prototype.getAnyDropsites = function(resource)
{
	if (resource)
		return this.updatingGlobalCollection("anyDropsite-" + resource, filters.isDropsite(resource), this.getEntities());
	return this.updatingGlobalCollection("anyDropsite-all", filters.isDropsite(), this.getEntities());
};

GameState.prototype.getResourceSupplies = function(resource)
{
	return this.updatingGlobalCollection("resource-" + resource, filters.byResource(resource),
		this.getEntities());
};

GameState.prototype.getHuntableSupplies = function()
{
	return this.updatingGlobalCollection("resource-hunt", filters.isHuntable(), this.getEntities());
};

GameState.prototype.getFishableSupplies = function()
{
	return this.updatingGlobalCollection("resource-fish", filters.isFishable(), this.getEntities());
};

/** This returns only units from buildings. */
GameState.prototype.findTrainableUnits = function(classes, anticlasses)
{
	const allTrainable = [];
	const civ = this.playerData.civ;
	this.getOwnTrainingFacilities().forEach(function(ent) {
		const trainable = ent.trainableEntities(civ);
		if (!trainable)
			return;
		for (const unit of trainable)
			if (allTrainable.indexOf(unit) === -1)
				allTrainable.push(unit);
	});
	const ret = [];
	const limits = this.getEntityLimits();
	const current = this.getEntityCounts();
	const matchCounts = this.getEntityMatchCounts();
	for (const trainable of allTrainable)
	{
		if (this.isTemplateDisabled(trainable))
			continue;
		const template = this.getTemplate(trainable);
		if (!template || !template.available(this))
			continue;
		const limit = template.matchLimit();
		if (matchCounts && limit && matchCounts[trainable] >= limit)
			continue;
		if (!template.hasClasses(classes) || template.hasClasses(anticlasses))
			continue;
		const category = template.trainingCategory();
		if (category && limits[category] && current[category] >= limits[category])
			continue;

		ret.push([trainable, template]);
	}
	return ret;
};

/**
 * Return all techs which can currently be researched
 * Does not factor cost.
 * If there are pairs, both techs are returned.
 */
GameState.prototype.findAvailableTech = function()
{
	const allResearchable = [];
	const civ = this.playerData.civ;
	for (const ent of this.getOwnEntities().values())
	{
		const searchable = ent.researchableTechs(this, civ);
		if (!searchable)
			continue;
		for (const tech of searchable)
			if (!this.playerData.disabledTechnologies[tech] && allResearchable.indexOf(tech) === -1)
				allResearchable.push(tech);
	}

	const ret = [];
	for (const tech of allResearchable)
	{
		const template = this.getTemplate(tech);
		if (template.pairDef())
		{
			const techs = template.getPairedTechs();
			if (this.canResearch(techs[0]._templateName))
				ret.push([techs[0]._templateName, techs[0]]);
			if (this.canResearch(techs[1]._templateName))
				ret.push([techs[1]._templateName, techs[1]]);
		}
		else if (this.canResearch(tech))
		{
			// Phases are treated separately
			if (this.phases.every(phase => template._templateName != phase.name))
				ret.push([tech, template]);
		}
	}
	return ret;
};

/**
 * Return true if we have a building able to train that template
 */
GameState.prototype.hasTrainer = function(template)
{
	const civ = this.playerData.civ;
	for (const ent of this.getOwnTrainingFacilities().values())
	{
		const trainable = ent.trainableEntities(civ);
		if (trainable && trainable.indexOf(template) !== -1)
			return true;
	}
	return false;
};

/**
 * Find buildings able to train that template.
 */
GameState.prototype.findTrainers = function(template)
{
	const civ = this.playerData.civ;
	return this.getOwnTrainingFacilities().filter(function(ent) {
		const trainable = ent.trainableEntities(civ);
		return trainable && trainable.indexOf(template) !== -1;
	});
};

/**
 * Get any unit that is capable of constructing the given building type.
 */
GameState.prototype.findBuilder = function(template)
{
	const civ = this.getPlayerCiv();
	for (const ent of this.getOwnUnits().values())
	{
		const buildable = ent.buildableEntities(civ);
		if (buildable && buildable.indexOf(template) !== -1)
			return ent;
	}
	return undefined;
};

/** Return true if one of our buildings is capable of researching the given tech */
GameState.prototype.hasResearchers = function(templateName, noRequirementCheck)
{
	// let's check we can research the tech.
	if (!this.canResearch(templateName, noRequirementCheck))
		return false;

	const template = this.getTemplate(templateName);
	if (template.autoResearch())
		return true;

	const civ = this.playerData.civ;

	for (const ent of this.getOwnResearchFacilities().values())
	{
		const techs = ent.researchableTechs(this, civ);
		for (const tech of techs)
		{
			const temp = this.getTemplate(tech);
			if (temp.pairDef())
			{
				const pairedTechs = temp.getPairedTechs();
				if (pairedTechs[0]._templateName == templateName ||
				    pairedTechs[1]._templateName == templateName)
					return true;
			}
			else if (tech == templateName)
				return true;
		}
	}
	return false;
};

/** Find buildings that are capable of researching the given tech */
GameState.prototype.findResearchers = function(templateName, noRequirementCheck)
{
	// let's check we can research the tech.
	if (!this.canResearch(templateName, noRequirementCheck))
		return undefined;

	const self = this;
	const civ = this.playerData.civ;

	return this.getOwnResearchFacilities().filter(function(ent) {
		const techs = ent.researchableTechs(self, civ);
		for (const tech of techs)
		{
			const thisTemp = self.getTemplate(tech);
			if (thisTemp.pairDef())
			{
				const pairedTechs = thisTemp.getPairedTechs();
				if (pairedTechs[0]._templateName == templateName ||
				    pairedTechs[1]._templateName == templateName)
					return true;
			}
			else if (tech == templateName)
				return true;
		}
		return false;
	});
};

GameState.prototype.getEntityLimits = function()
{
	return this.playerData.entityLimits;
};

GameState.prototype.getEntityMatchCounts = function()
{
	return this.playerData.matchEntityCounts;
};

GameState.prototype.getEntityCounts = function()
{
	return this.playerData.entityCounts;
};

GameState.prototype.isTemplateAvailable = function(templateName)
{
	if (this.templates[templateName] === undefined)
		this.sharedScript.GetTemplate(templateName);
	return this.templates[templateName] && !this.isTemplateDisabled(templateName);
};

GameState.prototype.isTemplateDisabled = function(templateName)
{
	if (!this.playerData.disabledTemplates[templateName])
		return false;
	return this.playerData.disabledTemplates[templateName];
};

/** Checks whether the maximum number of buildings have been constructed for a certain catergory */
GameState.prototype.isEntityLimitReached = function(category)
{
	if (this.playerData.entityLimits[category] === undefined ||
	    this.playerData.entityCounts[category] === undefined)
		return false;
	return this.playerData.entityCounts[category] >= this.playerData.entityLimits[category];
};

GameState.prototype.getTraderTemplatesGains = function()
{
	const shipMechantTemplateName = this.applyCiv("units/{civ}/ship_merchant");
	const supportTraderTemplateName = this.applyCiv("units/{civ}/support_trader");
	const shipMerchantTemplate = !this.isTemplateDisabled(shipMechantTemplateName) && this.getTemplate(shipMechantTemplateName);
	const supportTraderTemplate = !this.isTemplateDisabled(supportTraderTemplateName) && this.getTemplate(supportTraderTemplateName);
	const norm = TradeGainNormalization(this.sharedScript.mapSize);
	const ret = {};
	if (supportTraderTemplate)
		ret.landGainMultiplier = norm * supportTraderTemplate.gainMultiplier();
	if (shipMerchantTemplate)
		ret.navalGainMultiplier = norm * shipMerchantTemplate.gainMultiplier();
	return ret;
};
