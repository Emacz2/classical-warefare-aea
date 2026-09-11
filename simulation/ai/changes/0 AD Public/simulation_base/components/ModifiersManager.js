function ModifiersManager() {}

ModifiersManager.prototype.Schema =
	"<a:component type='system'/><empty/>";

ModifiersManager.prototype.Init = function()
{
	// TODO:
	//  - add a way to show an icon for a given modifier ID
	//    > Note that aura code shows icons when the source is selected, so that's specific to them.
	//  - support stacking modifiers (MultiKeyMap handles it but not this manager).

	// The cache computes values lazily when they are needed.
	// Helper functions remove items that have been changed to ensure we stay up-to-date.
	this.cachedValues = new Map(); // Keyed by property name, entity ID, original values.

	// When changing global modifiers, all entity-local caches are invalidated. This helps with that.
	// TODO: it might be worth keying by classes here.
	this.playerEntitiesCached = new Map(); // Keyed by player ID, property name, entity ID.

	this.modifiersStorage = new MultiKeyMap(); // Keyed by property name, entity.

	this.modifiersStorage._OnItemModified = (prim, sec, itemID) => this.ModifiersChanged.apply(this, [prim, sec, itemID]);
};

ModifiersManager.prototype.Serialize = function()
{
	// The value cache will be affected by property reads from the GUI and other places so we shouldn't serialize it.
	// Furthermore it is cyclically self-referencing.
	// We need to store the player for the Player-Entities cache.
	const players = [];
	this.playerEntitiesCached.forEach((_, player) => players.push(player));
	return {
		"modifiersStorage": this.modifiersStorage.Serialize(),
		"players": players
	};
};

ModifiersManager.prototype.Deserialize = function(data)
{
	this.Init();
	this.modifiersStorage.Deserialize(data.modifiersStorage);
	data.players.forEach(player => this.playerEntitiesCached.set(player, new Map()));
};

/**
 * Inform entities that we have changed possibly all values affected by that property.
 * It's not hugely efficient and would be nice to batch.
 * Invalidate caches where relevant.
 */
ModifiersManager.prototype.ModifiersChanged = function(propertyName, entity)
{
	const playerCache = this.playerEntitiesCached.get(entity);
	this.InvalidateCache(propertyName, entity, playerCache);

	if (playerCache)
	{
		const cmpPlayer = Engine.QueryInterface(entity, IID_Player);
		if (cmpPlayer)
			this.SendPlayerModifierMessages(propertyName, cmpPlayer.GetPlayerID());
	}
	else
		Engine.PostMessage(entity, MT_ValueModification, { "entities": [entity], "component": propertyName.split("/")[0], "valueNames": [propertyName] });
};

ModifiersManager.prototype.SendPlayerModifierMessages = function(propertyName, player)
{
	// TODO: it would be preferable to be able to batch this (i.e. one message for several properties)
	Engine.PostMessage(SYSTEM_ENTITY, MT_TemplateModification, { "player": player, "component": propertyName.split("/")[0], "valueNames": [propertyName] });
	// AIInterface wants the entities potentially affected.
	// TODO: improve on this
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const ents = cmpRangeManager.GetEntitiesByPlayer(player);
	Engine.BroadcastMessage(MT_ValueModification, { "entities": ents, "component": propertyName.split("/")[0], "valueNames": [propertyName] });
};

ModifiersManager.prototype.InvalidatePlayerEntCache = function(valueCache, propertyName, entsMap)
{
	entsMap = entsMap.get(propertyName);
	if (entsMap)
	{
		// Invalidate all local caches directly (for simplicity in ApplyModifiers).
		entsMap.forEach(ent => valueCache.set(ent, new Map()));
		entsMap.clear();
	}
};

ModifiersManager.prototype.InvalidateCache = function(propertyName, entity, playerCache)
{
	const valueCache = this.cachedValues.get(propertyName);
	if (!valueCache)
		return;

	if (playerCache)
		this.InvalidatePlayerEntCache(valueCache, propertyName, playerCache);
	valueCache.set(entity, new Map());
};

/**
 * @returns originalValue after modifiers.
 */
ModifiersManager.prototype.FetchModifiedProperty = function(classesList, propertyName, originalValue, target)
{
	const modifs = this.modifiersStorage.GetItems(propertyName, target);
	if (!modifs.length)
		return originalValue;
	// Flatten the list of modifications
	const modifications = [];
	modifs.forEach(item => { modifications.push(item.value); });
	return GetTechModifiedProperty(modifications.flat(), classesList, originalValue);
};

ModifiersManager.prototype.Cache = function(classesList, propertyName, originalValue, newValue, entity)
{
	let cache = this.cachedValues.get(propertyName);
	if (!cache)
		cache = this.cachedValues.set(propertyName, new Map()).get(propertyName);

	let cache2 = cache.get(entity);
	if (!cache2)
		cache2 = cache.set(entity, new Map()).get(entity);

	cache2.set(originalValue, newValue);
};

/**
 * Caching system in front of FetchModifiedProperty(), as calling that every time is quite slow.
 * This recomputes lazily.
 * Applies per-player modifiers before per-entity modifiers, so the latter take priority;
 * @param propertyName - Handle of a technology property (eg Attack/Ranged/Pierce) that was changed.
 * @param originalValue - template/raw/before-modifiers value.
		Note that if this is supposed to be a number (i.e. you call add/multiply on it)
		You must make sure to pass a number and not a string (by using + if necessary)
 * @param ent - ID of the target entity
 * @returns originalValue after the modifiers
 */
ModifiersManager.prototype.ApplyModifiers = function(propertyName, originalValue, entity)
{
	let newValue = this.cachedValues.get(propertyName);
	if (newValue !== undefined)
	{
		newValue = newValue.get(entity);
		if (newValue !== undefined)
		{
			newValue = newValue.get(originalValue);
			if (newValue !== undefined)
				return newValue;
		}
	}

	newValue = originalValue;

	const cmpIdentity = QueryMiragedInterface(entity, IID_Identity);
	if (!cmpIdentity)
		return originalValue;
	const classesList = cmpIdentity.GetClassesList();

	// Get the entity ID of the player / owner of the entity, since we use that to store per-player modifiers
	// (this prevents conflicts between player ID and entity ID).
	const ownerPlayer = Engine.QueryInterface(entity, IID_Ownership)?.GetOwner();

	// Apply player-wide modifiers before entity-local modifiers.
	if (ownerPlayer !== undefined && ownerPlayer !== INVALID_PLAYER)
	{
		const ownerEntity = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetPlayerByID(ownerPlayer);
		let pc = this.playerEntitiesCached.get(ownerEntity).get(propertyName);
		if (!pc)
			pc = this.playerEntitiesCached.get(ownerEntity).set(propertyName, new Set()).get(propertyName);
		pc.add(entity);
		newValue = this.FetchModifiedProperty(classesList, propertyName, newValue, ownerEntity);
	}
	newValue = this.FetchModifiedProperty(classesList, propertyName, newValue, entity);
	this.Cache(classesList, propertyName, originalValue, newValue, entity);

	return newValue;
};

/**
 * Alternative version of ApplyModifiers, applies to templates instead of entities.
 * Only needs to handle global modifiers.
 */
ModifiersManager.prototype.ApplyTemplateModifiers = function(propertyName, originalValue, template, player)
{
	if (!template || !template.Identity)
		return originalValue;

	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	return this.FetchModifiedProperty(GetIdentityClasses(template.Identity), propertyName, originalValue, cmpPlayerManager.GetPlayerByID(player));
};

/**
 * For efficiency in InvalidateCache, keep playerEntitiesCached updated.
 */
ModifiersManager.prototype.OnGlobalPlayerEntityChanged = function(msg)
{
	if (msg.to != INVALID_PLAYER && !this.playerEntitiesCached.has(msg.to))
		this.playerEntitiesCached.set(msg.to, new Map());

	if (msg.from != INVALID_PLAYER && this.playerEntitiesCached.has(msg.from))
	{
		this.playerEntitiesCached.get(msg.from).forEach(propName => this.InvalidateCache(propName, msg.from));
		this.playerEntitiesCached.delete(msg.from);
	}
};

/**
 * Handle modifiers when an entity changes owner.
 * We do not retain the original modifiers for now.
 */
ModifiersManager.prototype.OnGlobalOwnershipChanged = function(msg)
{
	if (msg.to == INVALID_PLAYER)
		return;

	// Invalidate all caches.
	for (const propName of this.cachedValues.keys())
		this.InvalidateCache(propName, msg.entity);

	const cmpIdentity = Engine.QueryInterface(msg.entity, IID_Identity);
	if (!cmpIdentity)
		return;
	const classes = cmpIdentity.GetClassesList();

	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const oldOwner = cmpPlayerManager.GetPlayerByID(msg.from);
	const newOwner = cmpPlayerManager.GetPlayerByID(msg.to);

	// Warn entities that our values have changed.
	// Local modifiers will be added by the relevant components, so no need to check for them here.
	const modifiedComponents = {};
	const fetchPlayerModifiedValueNames = (owner) => {
		if (!owner)
			return;
		const playerModifs = this.modifiersStorage.GetAllItems(owner);
		for (const propertyName in playerModifs)
		{
			// We only need to find one one tech per component for a match.
			const component = propertyName.split("/")[0];
			// Only inform if the modifier actually applies to the entity as an optimisation.
			// TODO: would it be better to call FetchModifiedProperty here and compare values?
			playerModifs[propertyName].forEach(item => item.value.forEach(modif => {
				if (!DoesModificationApply(modif, classes))
					return;
				if (!modifiedComponents[component])
					modifiedComponents[component] = new Set();
				modifiedComponents[component].add(propertyName);
			}));
		}
	};

	// We'll assume these are always different.
	fetchPlayerModifiedValueNames(oldOwner);
	fetchPlayerModifiedValueNames(newOwner);

	for (const component in modifiedComponents)
		Engine.PostMessage(msg.entity, MT_ValueModification, { "entities": [msg.entity], "component": component, "valueNames": Array.from(modifiedComponents[component]) });
};

/**
 * The following functions simply proxy MultiKeyMap's interface.
 */
ModifiersManager.prototype.AddModifier = function(propName, ModifID, Modif, entity, stackable = false) {
	return this.modifiersStorage.AddItem(propName, ModifID, Modif, entity, stackable);
};

ModifiersManager.prototype.AddModifiers = function(ModifID, Modifs, entity, stackable = false) {
	return this.modifiersStorage.AddItems(ModifID, Modifs, entity, stackable);
};

ModifiersManager.prototype.RemoveModifier = function(propName, ModifID, entity, stackable = false) {
	return this.modifiersStorage.RemoveItem(propName, ModifID, entity, stackable);
};

ModifiersManager.prototype.RemoveAllModifiers = function(ModifID, entity, stackable = false) {
	return this.modifiersStorage.RemoveAllItems(ModifID, entity, stackable);
};

ModifiersManager.prototype.HasModifier = function(propName, ModifID, entity) {
	return this.modifiersStorage.HasItem(propName, ModifID, entity);
};

ModifiersManager.prototype.HasAnyModifier = function(ModifID, entity) {
	return this.modifiersStorage.HasAnyItem(ModifID, entity);
};

ModifiersManager.prototype.GetModifiers = function(propName, entity, stackable = false) {
	return this.modifiersStorage.GetItems(propName, entity, stackable);
};

ModifiersManager.prototype.GetAllModifiers = function(entity, stackable = false) {
	return this.modifiersStorage.GetAllItems(entity, stackable);
};

Engine.RegisterSystemComponentType(IID_ModifiersManager, "ModifiersManager", ModifiersManager);
