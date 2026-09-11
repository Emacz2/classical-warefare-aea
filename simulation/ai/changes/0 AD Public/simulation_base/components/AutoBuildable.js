class AutoBuildable
{
	Init()
	{
		this.UpdateRate();
	}

	/**
	 * @return {number} - The rate with technologies and aura modification applied.
	 */
	GetRate()
	{
		return this.rate;
	}

	UpdateRate()
	{
		this.rate = ApplyValueModificationsToEntity("AutoBuildable/Rate", +this.template.Rate, this.entity);
		if (this.rate)
			this.StartTimer();
	}

	StartTimer()
	{
		if (this.timer || !this.rate)
			return;

		const cmpFoundation = Engine.QueryInterface(this.entity, IID_Foundation);
		if (!cmpFoundation)
			return;

		cmpFoundation.AddBuilder(this.entity);
		const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
		this.timer = cmpTimer.SetInterval(this.entity, IID_AutoBuildable, "AutoBuild", 0, 1000, undefined);
	}

	CancelTimer()
	{
		if (!this.timer)
			return;

		const cmpFoundation = Engine.QueryInterface(this.entity, IID_Foundation);
		if (cmpFoundation)
			cmpFoundation.RemoveBuilder(this.entity);

		const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
		cmpTimer.CancelTimer(this.timer);
		delete this.timer;
	}

	AutoBuild()
	{
		if (!this.rate)
		{
			this.CancelTimer();
			return;
		}
		const cmpFoundation = Engine.QueryInterface(this.entity, IID_Foundation);
		if (!cmpFoundation)
		{
			this.CancelTimer();
			return;
		}

		cmpFoundation.Build(this.entity, this.rate);
	}

	OnValueModification(msg)
	{
		if (msg.component != "AutoBuildable")
			return;

		this.UpdateRate();
	}

	OnOwnershipChanged(msg)
	{
		if (msg.to == INVALID_PLAYER)
			return;

		this.UpdateRate();
	}
}

AutoBuildable.prototype.Schema =
	"<a:help>Defines whether the entity can be built by itself.</a:help>" +
	"<a:example>" +
		"<Rate>1.0</Rate>" +
	"</a:example>" +
	"<element name='Rate' a:help='The rate at which the building autobuilds.'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>";

Engine.RegisterComponentType(IID_AutoBuildable, "AutoBuildable", AutoBuildable);
