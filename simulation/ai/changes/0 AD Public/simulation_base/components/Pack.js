function Pack() {}

Pack.prototype.Schema =
	"<element name='Entity' a:help='Entity to transform into'>" +
		"<text/>" +
	"</element>" +
	"<element name='Time' a:help='Time required to transform this entity, in milliseconds'>" +
		"<data type='nonNegativeInteger'/>" +
	"</element>" +
	"<element name='State' a:help='Whether this entity is packed or unpacked'>" +
		"<choice>" +
			"<value>packed</value>" +
			"<value>unpacked</value>" +
		"</choice>" +
	"</element>";

/**
 * Interval of the timer that updates the packing progress.
 * @type {number}
 */
Pack.prototype.PACKING_INTERVAL = 250;

Pack.prototype.Init = function()
{
	this.packed = this.template.State == "packed";
	this.packing = false;
	this.elapsedTime = 0;
	this.timer = undefined;
};

Pack.prototype.OnDestroy = function()
{
	this.CancelTimer();
};

Pack.prototype.CancelTimer = function()
{
	if (this.timer)
	{
		const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
		cmpTimer.CancelTimer(this.timer);
		this.timer = undefined;
	}
};

Pack.prototype.IsPacked = function()
{
	return this.packed;
};

Pack.prototype.IsPacking = function()
{
	return this.packing;
};

Pack.prototype.CanPack = function()
{
	return !this.packing && !this.packed;
};

Pack.prototype.CanUnpack = function()
{
	return !this.packing && this.packed;
};

Pack.prototype.Pack = function()
{
	if (this.IsPacked() || this.IsPacking())
		return;

	this.packing = true;

	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	this.timer = cmpTimer.SetInterval(this.entity, IID_Pack, "PackProgress", 0, this.PACKING_INTERVAL, null);

	const cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
	if (cmpVisual)
		cmpVisual.SelectAnimation("packing", true, 1.0);
};

Pack.prototype.Unpack = function()
{
	if (!this.IsPacked() || this.IsPacking())
		return;

	this.packing = true;

	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	this.timer = cmpTimer.SetInterval(this.entity, IID_Pack, "PackProgress", 0, this.PACKING_INTERVAL, null);

	const cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
	if (cmpVisual)
		cmpVisual.SelectAnimation("unpacking", true, 1.0);
};

Pack.prototype.CancelPack = function()
{
	if (!this.IsPacking())
		return;

	this.CancelTimer();
	this.packing = false;
	this.SetElapsedTime(0);

	// Clear animation
	const cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
	if (cmpVisual)
		cmpVisual.SelectAnimation("idle", false, 1.0);
};

Pack.prototype.GetPackTime = function()
{
	return ApplyValueModificationsToEntity("Pack/Time", +this.template.Time, this.entity);
};

Pack.prototype.GetElapsedTime = function()
{
	return this.elapsedTime;
};

Pack.prototype.GetProgress = function()
{
	return Math.min(this.elapsedTime / this.GetPackTime(), 1);
};

Pack.prototype.SetElapsedTime = function(time)
{
	this.elapsedTime = time;
	Engine.PostMessage(this.entity, MT_PackProgressUpdate, { "progress": this.elapsedTime });
};

Pack.prototype.PackProgress = function(data, lateness)
{
	if (this.elapsedTime < this.GetPackTime())
	{
		this.SetElapsedTime(this.GetElapsedTime() + this.PACKING_INTERVAL + lateness);
		return;
	}

	this.CancelTimer();
	this.packed = !this.packed;
	this.packing = false;

	Engine.PostMessage(this.entity, MT_PackFinished, { "packed": this.packed });

	const newEntity = ChangeEntityTemplate(this.entity, this.template.Entity);

	if (newEntity)
		PlaySound(this.packed ? "packed" : "unpacked", newEntity);

};

Engine.RegisterComponentType(IID_Pack, "Pack", Pack);
