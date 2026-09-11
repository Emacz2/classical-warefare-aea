function Upgrade() {}

const UPGRADING_PROGRESS_INTERVAL = 250;

Upgrade.prototype.Schema =
	"<oneOrMore>" +
		"<element>" +
			"<anyName />" +
			"<interleave>" +
				"<element name='Entity' a:help='Entity to upgrade to'>" +
					"<text/>" +
				"</element>" +
				"<optional>" +
					"<element name='Icon' a:help='Icon to show in the GUI'>" +
						"<text/>" +
					"</element>" +
				"</optional>" +
				"<optional>" +
					"<element name='Variant' a:help='The name of the variant to switch to when upgrading'>" +
						"<text/>" +
					"</element>" +
				"</optional>" +
				"<optional>" +
					"<element name='Tooltip' a:help='This will be added to the tooltip to help the player choose why to upgrade.'>" +
						"<text/>" +
					"</element>" +
				"</optional>" +
				"<optional>" +
					"<element name='Time' a:help='Time required to upgrade this entity, in seconds'>" +
						"<data type='nonNegativeInteger'/>" +
					"</element>" +
				"</optional>" +
				"<optional>" +
					"<element name='Cost' a:help='Resource cost to upgrade this unit'>" +
						"<oneOrMore>" +
							"<choice>" +
								Resources.BuildSchema("nonNegativeInteger") +
							"</choice>" +
						"</oneOrMore>" +
					"</element>" +
				"</optional>" +
				"<optional>" +
					RequirementsHelper.BuildSchema() +
				"</optional>" +
				"<optional>" +
					"<element name='CheckPlacementRestrictions' a:help='Upgrading will check for placement restrictions (nb:GUI only)'><empty/></element>" +
				"</optional>" +
			"</interleave>" +
		"</element>" +
	"</oneOrMore>";

Upgrade.prototype.Init = function()
{
	this.elapsedTime = 0;
	this.expendedResources = {};
};

// This will also deal with the "OnDestroy" case.
Upgrade.prototype.OnOwnershipChanged = function(msg)
{
	if (!this.completed)
		this.CancelUpgrade(msg.from);

	if (msg.to != INVALID_PLAYER)
	{
		this.owner = msg.to;
		this.DetermineUpgrades();
	}
};

Upgrade.prototype.DetermineUpgrades = function()
{
	this.upgradeTemplates = {};

	for (const choice in this.template)
	{
		const nativeCiv = Engine.QueryInterface(this.entity, IID_Identity).GetCiv();
		const playerCiv = QueryPlayerIDInterface(this.owner, IID_Identity).GetCiv();
		const name = this.template[choice].Entity.
			replace(/\{native\}/g, nativeCiv).
			replace(/\{civ\}/g, playerCiv);

		if (!Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager).TemplateExists(name))
			continue;

		if (this.upgradeTemplates[name])
			warn("Upgrade Component: entity " + this.entity + " has two upgrades to the same entity, only the last will be used.");

		this.upgradeTemplates[name] = choice;
	}
};

Upgrade.prototype.ChangeUpgradedEntityCount = function(amount)
{
	if (!this.IsUpgrading())
		return;

	const cmpTempMan = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	const template = cmpTempMan.GetTemplate(this.upgrading);

	let categoryTo;
	if (template.TrainingRestrictions)
		categoryTo = template.TrainingRestrictions.Category;
	else if (template.BuildRestrictions)
		categoryTo = template.BuildRestrictions.Category;

	if (!categoryTo)
		return;

	let categoryFrom;
	const cmpTrainingRestrictions = Engine.QueryInterface(this.entity, IID_TrainingRestrictions);
	const cmpBuildRestrictions = Engine.QueryInterface(this.entity, IID_BuildRestrictions);
	if (cmpTrainingRestrictions)
		categoryFrom = cmpTrainingRestrictions.GetCategory();
	else if (cmpBuildRestrictions)
		categoryFrom = cmpBuildRestrictions.GetCategory();

	if (categoryTo == categoryFrom)
		return;

	const cmpEntityLimits = QueryPlayerIDInterface(this.owner, IID_EntityLimits);
	if (cmpEntityLimits)
		cmpEntityLimits.ChangeCount(categoryTo, amount);
};

Upgrade.prototype.CanUpgradeTo = function(template)
{
	return this.upgradeTemplates[template] !== undefined;
};

Upgrade.prototype.GetUpgrades = function()
{
	const ret = [];

	for (const option in this.upgradeTemplates)
	{
		const choice = this.template[this.upgradeTemplates[option]];

		let cost = {};
		if (choice.Cost)
			cost = this.GetResourceCosts(option);
		if (choice.Time)
			cost.time = this.GetUpgradeTime(option);

		const hasCost = choice.Cost || choice.Time;
		ret.push({
			"entity": option,
			"icon": choice.Icon || undefined,
			"cost": hasCost ? cost : undefined,
			"tooltip": choice.Tooltip || undefined,
			"requirements": this.GetRequirements(option),
		});
	}

	return ret;
};

Upgrade.prototype.CancelTimer = function()
{
	if (!this.timer)
		return;

	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	cmpTimer.CancelTimer(this.timer);
	delete this.timer;
};

Upgrade.prototype.IsUpgrading = function()
{
	return !!this.upgrading;
};

Upgrade.prototype.GetUpgradingTo = function()
{
	return this.upgrading;
};

Upgrade.prototype.WillCheckPlacementRestrictions = function(template)
{
	if (!this.upgradeTemplates[template])
		return undefined;

	// is undefined by default so use X in Y
	return "CheckPlacementRestrictions" in this.template[this.upgradeTemplates[template]];
};

Upgrade.prototype.GetRequirements = function(templateArg)
{
	const choice = this.upgradeTemplates[templateArg] || templateArg;

	if (this.template[choice].Requirements)
		return this.template[choice].Requirements;

	if (!("Requirements" in this.template[choice]))
		return undefined;

	const cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	const cmpIdentity = Engine.QueryInterface(this.entity, IID_Identity);

	let entType = this.template[choice].Entity;
	if (cmpIdentity)
		entType = entType.replace(/\{civ\}/g, cmpIdentity.GetCiv());

	const template = cmpTemplateManager.GetTemplate(entType);
	return template.Identity.Requirements || undefined;
};

Upgrade.prototype.GetResourceCosts = function(template)
{
	if (!this.upgradeTemplates[template])
		return undefined;

	if (this.IsUpgrading() && template == this.GetUpgradingTo())
		return clone(this.expendedResources);

	const choice = this.upgradeTemplates[template];
	if (!this.template[choice].Cost)
		return {};

	const costs = {};
	for (const r in this.template[choice].Cost)
		costs[r] = ApplyValueModificationsToEntity("Upgrade/Cost/"+r, +this.template[choice].Cost[r], this.entity);

	return costs;
};

Upgrade.prototype.Upgrade = function(template)
{
	if (this.IsUpgrading() || !this.upgradeTemplates[template])
		return false;

	const cmpPlayer = QueryOwnerInterface(this.entity, IID_Player);
	if (!cmpPlayer)
		return false;

	const cmpProductionQueue = Engine.QueryInterface(this.entity, IID_ProductionQueue);
	if (cmpProductionQueue && cmpProductionQueue.HasQueuedProduction())
	{
		const cmpGUIInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
		cmpGUIInterface.PushNotification({
			"players": [cmpPlayer.GetPlayerID()],
			"message": markForTranslation("Entity is producing. Cannot start upgrading."),
			"translateMessage": true
		});
		return false;
	}

	this.expendedResources = this.GetResourceCosts(template);
	if (!cmpPlayer || !cmpPlayer.TrySubtractResources(this.expendedResources))
	{
		this.expendedResources = {};
		return false;
	}

	this.upgrading = template;
	this.SetUpgradeAnimationVariant();

	// Prevent cheating
	this.ChangeUpgradedEntityCount(1);

	if (this.GetUpgradeTime(template) !== 0)
	{
		const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
		this.timer = cmpTimer.SetInterval(this.entity, IID_Upgrade, "UpgradeProgress", 0, UPGRADING_PROGRESS_INTERVAL, { "upgrading": template });
	}
	else
		this.UpgradeProgress();

	return true;
};

Upgrade.prototype.CancelUpgrade = function(owner)
{
	if (!this.IsUpgrading())
		return;

	const cmpPlayer = QueryPlayerIDInterface(owner, IID_Player);
	if (cmpPlayer)
		cmpPlayer.AddResources(this.expendedResources);

	this.expendedResources = {};
	this.ChangeUpgradedEntityCount(-1);

	// Do not update visual actor if the animation didn't change.
	const choice = this.upgradeTemplates[this.upgrading];
	if (choice && this.template[choice].Variant)
	{
		const cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
		if (cmpVisual)
			cmpVisual.SelectAnimation("idle", false, 1.0);
	}

	delete this.upgrading;
	this.CancelTimer();
	this.SetElapsedTime(0);
};

Upgrade.prototype.GetUpgradeTime = function(templateArg)
{
	const template = this.upgrading || templateArg;
	const choice = this.upgradeTemplates[template];

	if (!choice)
		return undefined;

	if (!this.template[choice].Time)
		return 0;

	return ApplyValueModificationsToEntity("Upgrade/Time", +this.template[choice].Time, this.entity);
};

Upgrade.prototype.GetElapsedTime = function()
{
	return this.elapsedTime;
};

Upgrade.prototype.GetProgress = function()
{
	if (!this.IsUpgrading())
		return undefined;
	return this.GetUpgradeTime() == 0 ? 1 : Math.min(this.elapsedTime / 1000.0 / this.GetUpgradeTime(), 1.0);
};

Upgrade.prototype.SetElapsedTime = function(time)
{
	this.elapsedTime = time;
	Engine.PostMessage(this.entity, MT_UpgradeProgressUpdate, null);
};

Upgrade.prototype.SetUpgradeAnimationVariant = function()
{
	const choice = this.upgradeTemplates[this.upgrading];

	if (!choice || !this.template[choice].Variant)
		return;

	const cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
	if (!cmpVisual)
		return;

	cmpVisual.SelectAnimation(this.template[choice].Variant, false, 1.0);
};

Upgrade.prototype.UpgradeProgress = function(data, lateness)
{
	if (this.elapsedTime/1000.0 < this.GetUpgradeTime())
	{
		this.SetElapsedTime(this.GetElapsedTime() + UPGRADING_PROGRESS_INTERVAL + lateness);
		return;
	}

	this.CancelTimer();

	this.completed = true;
	this.ChangeUpgradedEntityCount(-1);
	this.expendedResources = {};

	const newEntity = ChangeEntityTemplate(this.entity, this.upgrading);

	if (newEntity)
		PlaySound("upgraded", newEntity);
};

Engine.RegisterComponentType(IID_Upgrade, "Upgrade", Upgrade);
