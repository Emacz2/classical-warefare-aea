/**
 * CWA phase-scaled cavalry ceiling.
 *
 * This is intentionally separate from EntityLimits so existing one-category
 * TrainingRestrictions caps (SpartCav, BodyguardCavalry, etc.) remain intact.
 */
function CavalryLimits() {}

CavalryLimits.prototype.Schema =
	"<a:help>Limits cavalry to a phase-dependent percentage of the player's effective maximum population.</a:help>" +
	"<element name='Village'><ref name='nonNegativeDecimal'/></element>" +
	"<element name='Town'><ref name='nonNegativeDecimal'/></element>" +
	"<element name='City'><ref name='nonNegativeDecimal'/></element>" +
	"<optional><element name='Empire'><ref name='nonNegativeDecimal'/></element></optional>";

CavalryLimits.prototype.Init = function()
{
	// Cavalry that currently exists and is owned by this player.
	this.liveCount = 0;
	// Cavalry already reserved in training queues.  Reserving at queue-time
	// prevents several Stables from bypassing the cap simultaneously.
	this.queuedCount = 0;
};

CavalryLimits.prototype.IsCavalryTemplate = function(templateName)
{
	if (!templateName)
		return false;

	const cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	const template = cmpTemplateManager.GetTemplate(templateName);
	if (!template || !template.Identity || !template.Identity.VisibleClasses)
		return false;

	const visibleClasses = template.Identity.VisibleClasses._string || template.Identity.VisibleClasses;
	return String(visibleClasses).split(/\s+/).indexOf("Cavalry") !== -1;
};

CavalryLimits.prototype.IsCavalryIdentity = function(cmpIdentity)
{
	return !!cmpIdentity && cmpIdentity.GetVisibleClassesList().indexOf("Cavalry") !== -1;
};

CavalryLimits.prototype.GetPercentage = function()
{
	const cmpTechnologyManager = Engine.QueryInterface(this.entity, IID_TechnologyManager);
	const cmpIdentity = Engine.QueryInterface(this.entity, IID_Identity);
	const civ = cmpIdentity ? cmpIdentity.GetCiv() : "";

	if (cmpTechnologyManager)
	{
		const researched = tech => !!tech && cmpTechnologyManager.IsTechnologyResearched(tech);

		if (this.template.Empire !== undefined &&
			(researched("phase_empi_" + civ) || researched("phase_empire") || researched("phase_empi")))
			return +this.template.Empire;

		if (researched("phase_city_" + civ) || researched("phase_city"))
			return +this.template.City;

		if (researched("phase_town_" + civ) || researched("phase_town"))
			return +this.template.Town;
	}

	return +this.template.Village;
};

CavalryLimits.prototype.GetLimit = function()
{
	const cmpPlayer = Engine.QueryInterface(this.entity, IID_Player);
	if (!cmpPlayer)
		return 0;

	// GetMaxPopulation() is already the EFFECTIVE maximum after modifiers.
	// Example: Sparta's -10% and Persia's Empire +10% are therefore automatic.
	return Math.floor(cmpPlayer.GetMaxPopulation() * this.GetPercentage() / 100);
};

CavalryLimits.prototype.GetCount = function()
{
	return this.liveCount + this.queuedCount;
};

CavalryLimits.prototype.NotifyLimit = function(limit)
{
	const cmpPlayer = Engine.QueryInterface(this.entity, IID_Player);
	const cmpGUIInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
	if (!cmpPlayer || !cmpGUIInterface)
		return;

	cmpGUIInterface.PushNotification({
		"players": [cmpPlayer.GetPlayerID()],
		"message": markForTranslation("Cavalry training limit of %(limit)s reached"),
		"translateMessage": true,
		"parameters": { "limit": limit }
	});
};

CavalryLimits.prototype.AllowedToTrain = function(templateName, count)
{
	if (!this.IsCavalryTemplate(templateName))
		return true;

	const limit = this.GetLimit();
	if (this.GetCount() + count <= limit)
		return true;

	this.NotifyLimit(limit);
	return false;
};

CavalryLimits.prototype.ReserveTraining = function(templateName, count)
{
	if (this.IsCavalryTemplate(templateName))
		this.queuedCount += count;
};

CavalryLimits.prototype.ReleaseTraining = function(templateName, count)
{
	if (!this.IsCavalryTemplate(templateName))
		return;

	this.queuedCount -= count;
	if (this.queuedCount < 0)
	{
		warn("CavalryLimits: queued cavalry count fell below zero; correcting to zero.");
		this.queuedCount = 0;
	}
};

CavalryLimits.prototype.OnGlobalOwnershipChanged = function(msg)
{
	const cmpPlayer = Engine.QueryInterface(this.entity, IID_Player);
	if (!cmpPlayer)
		return;

	const playerID = cmpPlayer.GetPlayerID();
	let modifier = 0;
	if (msg.from == playerID)
		modifier = -1;
	else if (msg.to == playerID)
		modifier = 1;
	else
		return;

	const cmpIdentity = Engine.QueryInterface(msg.entity, IID_Identity);
	if (!this.IsCavalryIdentity(cmpIdentity))
		return;

	this.liveCount += modifier;
	if (this.liveCount < 0)
	{
		warn("CavalryLimits: live cavalry count fell below zero; correcting to zero.");
		this.liveCount = 0;
	}
};

Engine.RegisterComponentType(IID_CavalryLimits, "CavalryLimits", CavalryLimits);
