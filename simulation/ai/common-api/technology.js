LoadModificationTemplates();

/** Wrapper around a technology template */
export function Technology(templateName)
{
	this._templateName = templateName;
	const template = TechnologyTemplates.Get(templateName);

	// check if this is one of two paired technologies.
	this._isPair = template.pair !== undefined;
	if (this._isPair)
	{
		const pairTech = TechnologyTemplates.Get(template.pair);
		this._pairedWith = pairTech.top == templateName ? pairTech.bottom : pairTech.top;
	}

	// check if it only defines a pair:
	this._definesPair = template.top !== undefined;
	this._template = template;
}

/** returns generic, or specific if civ provided. */
Technology.prototype.name = function(civ)
{
	if (civ === undefined)
		return this._template.genericName;

	if (this._template.specificName === undefined || this._template.specificName[civ] === undefined)
		return undefined;
	return this._template.specificName[civ];
};

Technology.prototype.pairDef = function()
{
	return this._definesPair;
};

/** in case this defines a pair only, returns the two paired technologies. */
Technology.prototype.getPairedTechs = function()
{
	if (!this._definesPair)
		return undefined;

	return [
		new Technology(this._template.top),
		new Technology(this._template.bottom)
	];
};

Technology.prototype.pair = function()
{
	if (!this._isPair)
		return undefined;
	return this._template.pair;
};

Technology.prototype.pairedWith = function()
{
	if (!this._isPair)
		return undefined;
	return this._pairedWith;
};

Technology.prototype.cost = function(researcher)
{
	if (!this._template.cost)
		return undefined;
	const cost = {};
	for (const type in this._template.cost)
	{
		cost[type] = +this._template.cost[type];
		if (researcher)
			cost[type] *= researcher.techCostMultiplier(type);
	}
	return cost;
};

Technology.prototype.costSum = function(researcher)
{
	const cost = this.cost(researcher);
	if (!cost)
		return 0;
	let ret = 0;
	for (const type in cost)
		ret += cost[type];
	return ret;
};

Technology.prototype.researchTime = function()
{
	return this._template.researchTime || 0;
};

Technology.prototype.requirements = function(civ)
{
	return DeriveTechnologyRequirements(this._template, civ);
};

Technology.prototype.autoResearch = function()
{
	if (!this._template.autoResearch)
		return undefined;
	return this._template.autoResearch;
};

Technology.prototype.supersedes = function()
{
	if (!this._template.supersedes)
		return undefined;
	return this._template.supersedes;
};

Technology.prototype.modifications = function()
{
	if (!this._template.modifications)
		return undefined;
	return this._template.modifications;
};

Technology.prototype.affects = function()
{
	if (!this._template.affects)
		return undefined;
	return this._template.affects;
};

Technology.prototype.isAffected = function(classes)
{
	return this._template.affects && this._template.affects.some(affect => MatchesClassList(classes, affect));
};
