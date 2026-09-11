function AlertRaiser() {}

AlertRaiser.prototype.Schema =
	"<element name='List' a:help='Classes of entities which are affected by this alert raiser'>" +
		"<attribute name='datatype'>" +
			"<value>tokens</value>" +
		"</attribute>" +
		"<text/>" +
	"</element>" +
	"<element name='RaiseAlertRange'><data type='integer'/></element>" +
	"<element name='EndOfAlertRange'><data type='integer'/></element>" +
	"<element name='SearchRange'><data type='integer'/></element>";

AlertRaiser.prototype.Init = function()
{
	// Store the last time the alert was used so players can't lag the game by raising alerts repeatedly.
	this.lastTime = 0;
};

AlertRaiser.prototype.GetTargetClasses = function()
{
	return this.template.List._string;
};

AlertRaiser.prototype.UnitFilter = function(unit)
{
	const cmpIdentity = Engine.QueryInterface(unit, IID_Identity);
	return cmpIdentity && MatchesClassList(cmpIdentity.GetClassesList(), this.GetTargetClasses());
};

AlertRaiser.prototype.RaiseAlert = function()
{
	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	if (cmpTimer.GetTime() == this.lastTime)
		return;

	this.lastTime = cmpTimer.GetTime();
	PlaySound("alert_raise", this.entity);

	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	if (!cmpOwnership || cmpOwnership.GetOwner() == INVALID_PLAYER)
		return;

	const owner = cmpOwnership.GetOwner();
	const cmpDiplomacy = QueryPlayerIDInterface(owner, IID_Diplomacy);
	const mutualAllies = cmpDiplomacy ? cmpDiplomacy.GetMutualAllies() : [owner];
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);

	// Store the number of available garrison spots so that units don't try to garrison in buildings that will be full
	const reserved = new Map();

	const units = cmpRangeManager.ExecuteQuery(this.entity, 0, +this.template.RaiseAlertRange, [owner], IID_UnitAI, true).filter(ent => this.UnitFilter(ent));
	for (const unit of units)
	{
		const cmpGarrisonable = Engine.QueryInterface(unit, IID_Garrisonable);
		if (!cmpGarrisonable)
			continue;

		const size = cmpGarrisonable.TotalSize();
		const cmpUnitAI = Engine.QueryInterface(unit, IID_UnitAI);

		const holder = cmpRangeManager.ExecuteQuery(unit, 0, +this.template.SearchRange, mutualAllies, IID_GarrisonHolder, true).find(ent => {
			// Ignore moving garrison holders
			if (Engine.QueryInterface(ent, IID_UnitAI))
				return false;

			// Ensure that the garrison holder is within range of the alert raiser
			if (+this.template.EndOfAlertRange > 0 && PositionHelper.DistanceBetweenEntities(this.entity, ent) > +this.template.EndOfAlertRange)
				return false;

			if (!cmpUnitAI.CheckTargetVisible(ent))
				return false;

			const cmpGarrisonHolder = Engine.QueryInterface(ent, IID_GarrisonHolder);
			if (!reserved.has(ent))
				reserved.set(ent, cmpGarrisonHolder.GetCapacity() - cmpGarrisonHolder.OccupiedSlots());

			return cmpGarrisonHolder.IsAllowedToGarrison(unit) && reserved.get(ent) >= size;
		});

		if (holder)
		{
			reserved.set(holder, reserved.get(holder) - size);
			cmpUnitAI.Garrison(holder, false, false);
		}
		else
			// If no available spots, stop moving
			cmpUnitAI.ReplaceOrder("Stop", { "force": true });
	}
};

AlertRaiser.prototype.EndOfAlert = function()
{
	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	if (cmpTimer.GetTime() == this.lastTime)
		return;

	this.lastTime = cmpTimer.GetTime();
	PlaySound("alert_end", this.entity);

	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	if (!cmpOwnership || cmpOwnership.GetOwner() == INVALID_PLAYER)
		return;

	const owner = cmpOwnership.GetOwner();
	const cmpDiplomacy = QueryPlayerIDInterface(owner, IID_Diplomacy);
	const mutualAllies = cmpDiplomacy ? cmpDiplomacy.GetMutualAllies() : [owner];
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);

	// Units that are not garrisoned should go back to work
	const units = cmpRangeManager.ExecuteQuery(this.entity, 0, +this.template.EndOfAlertRange, [owner], IID_UnitAI, true).filter(ent => this.UnitFilter(ent));
	for (const unit of units)
	{
		const cmpUnitAI = Engine.QueryInterface(unit, IID_UnitAI);
		if (cmpUnitAI.HasWorkOrders() && cmpUnitAI.ShouldRespondToEndOfAlert())
			cmpUnitAI.BackToWork();
		else if (cmpUnitAI.ShouldRespondToEndOfAlert())
			// Stop rather than continue to try to garrison
			cmpUnitAI.ReplaceOrder("Stop", { "force": true });
	}

	// Units that are garrisoned should ungarrison and go back to work
	const holders = cmpRangeManager.ExecuteQuery(this.entity, 0, +this.template.EndOfAlertRange, mutualAllies, IID_GarrisonHolder, true);
	if (Engine.QueryInterface(this.entity, IID_GarrisonHolder))
		holders.push(this.entity);

	for (const holder of holders)
	{
		if (Engine.QueryInterface(holder, IID_UnitAI))
			continue;

		const cmpGarrisonHolder = Engine.QueryInterface(holder, IID_GarrisonHolder);
		const garrisonedUnits = cmpGarrisonHolder.GetEntities().filter(ent => {
			const cmpOwner = Engine.QueryInterface(ent, IID_Ownership);
			return cmpOwner && cmpOwner.GetOwner() == owner && this.UnitFilter(ent);
		});

		for (const unit of garrisonedUnits)
			if (cmpGarrisonHolder.Unload(unit))
			{
				const cmpUnitAI = Engine.QueryInterface(unit, IID_UnitAI);
				if (cmpUnitAI.HasWorkOrders())
					cmpUnitAI.BackToWork();
				else
					// Stop rather than walk to the rally point
					cmpUnitAI.ReplaceOrder("Stop", { "force": true });
			}
	}
};

Engine.RegisterComponentType(IID_AlertRaiser, "AlertRaiser", AlertRaiser);
