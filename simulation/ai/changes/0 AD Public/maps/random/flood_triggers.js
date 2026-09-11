// In what steps the watherlevel rises [s].
Trigger.prototype.deltaTime = 2.4;
// By how much the water level changes each step [m].
Trigger.prototype.deltaWaterLevel = 0.5;

Trigger.prototype.warningDuration = 14.4;

Trigger.prototype.drownDepth = 2;

Trigger.prototype.warning = markForTranslation("The flood continues. Soon the waters will swallow the land. You should evacuate the units.");

Trigger.prototype.RiseWaterLevel = function(targetWaterLevel)
{
	Engine.QueryInterface(SYSTEM_ENTITY, IID_WaterManager).SetWaterLevel(targetWaterLevel);

	const cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);

	for (const ent of cmpRangeManager.GetGaiaAndNonGaiaEntities())
	{
		const cmpPosition = Engine.QueryInterface(ent, IID_Position);
		if (!cmpPosition || !cmpPosition.IsInWorld())
			continue;

		const pos = cmpPosition.GetPosition();
		if (pos.y + this.drownDepth >= targetWaterLevel)
			continue;

		const cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
		if (!cmpIdentity)
			continue;

		const templateName = cmpTemplateManager.GetCurrentTemplateName(ent);

		// Animals and units drown
		const cmpHealth = Engine.QueryInterface(ent, IID_Health);
		if (cmpHealth && cmpIdentity.HasClass("Organic"))
		{
			cmpHealth.Kill();
			continue;
		}

		// Resources and buildings become actors
		// Do not use ChangeEntityTemplate for performance and
		// because we don't need nor want the effects of MT_EntityRenamed

		const cmpVisualActor = Engine.QueryInterface(ent, IID_Visual);
		if (!cmpVisualActor)
			continue;

		const height = cmpPosition.GetHeightOffset();
		const rot = cmpPosition.GetRotation();

		const actorTemplate = cmpTemplateManager.GetTemplate(templateName).VisualActor.Actor;
		const seed = cmpVisualActor.GetActorSeed();
		Engine.DestroyEntity(ent);

		const newEnt = Engine.AddEntity("actor|" + actorTemplate);
		Engine.QueryInterface(newEnt, IID_Visual).SetActorSeed(seed);

		const cmpNewPos = Engine.QueryInterface(newEnt, IID_Position);
		cmpNewPos.JumpTo(pos.x, pos.z);
		cmpNewPos.SetHeightOffset(height);
		cmpNewPos.SetXZRotation(rot.x, rot.z);
		cmpNewPos.SetYRotation(rot.y);
	}
};

Trigger.prototype.RaiseWaterLevelStep = function(finalWaterLevel)
{
	const waterManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_WaterManager);
	const nextExpectedWaterLevel = waterManager.GetWaterLevel() + this.deltaWaterLevel;

	if (nextExpectedWaterLevel >= finalWaterLevel)
	{
		this.RiseWaterLevel(finalWaterLevel);
		return;
	}

	this.RiseWaterLevel(nextExpectedWaterLevel);
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Trigger).DoAfterDelay(this.deltaTime * 1000,
		"RaiseWaterLevelStep", finalWaterLevel);
};

Trigger.prototype.DisplayWarning = function()
{
	Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface).AddTimeNotification(
		{ "message": this.warning });
};

// override
Trigger.prototype.OnGlobalInitGame = function(msg)
{
	if (InitAttributes.settings.waterLevel === "Shallow")
		return;

	const currentWaterLevel = Engine.QueryInterface(SYSTEM_ENTITY, IID_WaterManager).GetWaterLevel();

	if (InitAttributes.settings.waterLevel === "Deep")
	{
		this.RiseWaterLevel(currentWaterLevel + 1);
		return;
	}

	const schedule = (targetWaterLevel, riseStartTime) => {
		this.DoAfterDelay(riseStartTime * 1000, "RaiseWaterLevelStep", targetWaterLevel);
		this.DoAfterDelay((riseStartTime - this.warningDuration) * 1000, "DisplayWarning");
	};

	schedule(currentWaterLevel + 1, 260);
	schedule(currentWaterLevel + 5, 1560);
};
