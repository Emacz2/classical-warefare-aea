export function byType(type)
{
	return {
		"func": ent => ent.templateName() == type,
		"dynamicProperties": []
	};
}

export function byClass(cls)
{
	return {
		"func": ent => ent.hasClass(cls),
		"dynamicProperties": []
	};
}

export function byClasses(clsList)
{
	return {
		"func": ent => ent.hasClasses(clsList),
		"dynamicProperties": []
	};
}

export function byMetadata(player, key, value)
{
	return {
		"func": ent => ent.getMetadata(player, key) == value,
		"dynamicProperties": ['metadata.' + key]
	};
}

export function byHasMetadata(player, key)
{
	return {
		"func": ent => ent.getMetadata(player, key) !== undefined,
		"dynamicProperties": ['metadata.' + key]
	};
}

export function and(filter1, filter2)
{
	return {
		"func": ent => filter1.func(ent) && filter2.func(ent),
		"dynamicProperties": filter1.dynamicProperties.concat(filter2.dynamicProperties)
	};
}

export function or(filter1, filter2)
{
	return {
		"func": ent => filter1.func(ent) || filter2.func(ent),
		"dynamicProperties": filter1.dynamicProperties.concat(filter2.dynamicProperties)
	};
}

export function not(filter)
{
	return {
		"func": ent => !filter.func(ent),
		"dynamicProperties": filter.dynamicProperties
	};
}

export function byOwner(owner)
{
	return {
		"func": ent => ent.owner() == owner,
		"dynamicProperties": ['owner']
	};
}

export function byNotOwner(owner)
{
	return {
		"func": ent => ent.owner() != owner,
		"dynamicProperties": ['owner']
	};
}

export function byOwners(owners)
{
	return {
		"func": ent => owners.some(owner => owner == ent.owner()),
		"dynamicProperties": ['owner']
	};
}

export function byCanGarrison()
{
	return {
		"func": ent => ent.garrisonMax() > 0,
		"dynamicProperties": []
	};
}

export function byTrainingQueue()
{
	return {
		"func": ent => ent.trainingQueue(),
		"dynamicProperties": ['trainingQueue']
	};
}

export function byResearchAvailable(gameState, civ)
{
	return {
		"func": ent => ent.researchableTechs(gameState, civ) !== undefined,
		"dynamicProperties": []
	};
}

export function byCanAttackClass(aClass)
{
	return {
		"func": ent => ent.canAttackClass(aClass),
		"dynamicProperties": []
	};
}

export function byCanAttackTarget(target)
{
	return {
		"func": ent => ent.canAttackTarget(target),
		"dynamicProperties": []
	};
}

export function isGarrisoned()
{
	return {
		"func": ent => ent.position() === undefined,
		"dynamicProperties": []
	};
}

export function isIdle()
{
	return {
		"func": ent => ent.isIdle(),
		"dynamicProperties": ['idle']
	};
}

export function isFoundation()
{
	return {
		"func": ent => ent.foundationProgress() !== undefined,
		"dynamicProperties": []
	};
}

export function isBuilt()
{
	return {
		"func": ent => ent.foundationProgress() === undefined,
		"dynamicProperties": []
	};
}

export function hasDefensiveFire()
{
	return {
		"func": ent => ent.hasDefensiveFire(),
		"dynamicProperties": []
	};
}

export function isDropsite(resourceType)
{
	return {
		"func": ent => ent.isResourceDropsite(resourceType),
		"dynamicProperties": []
	};
}

export function isTreasure()
{
	return {
		"func": ent => {
			if (!ent.isTreasure())
				return false;

			// Don't go for floating treasures since we might not be able
			// to reach them and that kills the pathfinder.
			const template = ent.templateName();
			return template != "gaia/treasure/shipwreck_debris" &&
			    template != "gaia/treasure/shipwreck";
		},
		"dynamicProperties": []
	};
}

export function byResource(resourceType)
{
	return {
		"func": ent => {
			if (!ent.resourceSupplyMax())
				return false;

			const type = ent.resourceSupplyType();
			if (!type)
				return false;

			// Skip targets that are too hard to hunt
			if (!ent.isHuntable() || ent.hasClass("SeaCreature"))
				return false;

			return resourceType == type.generic;
		},
		"dynamicProperties": []
	};
}

export function isHuntable()
{
	// Skip targets that are too hard to hunt and don't go for the fish! TODO: better accessibility checks
	return {
		"func": ent => ent.hasClass("Animal") && ent.resourceSupplyMax() &&
			         ent.isHuntable() && !ent.hasClass("SeaCreature"),
		"dynamicProperties": []
	};
}

export function isFishable()
{
	// temporarily do not fish moving fish (i.e. whales)
	return {
		"func": ent => !ent.get("UnitMotion") && ent.hasClass("SeaCreature") && ent.resourceSupplyMax(),
		"dynamicProperties": []
	};
}
