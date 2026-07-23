Attack.prototype.ChargeRepeatTimeBonusEnd = function()
{
	this.StopAttacking("ChargeRepeatTimeBonusEnd");
};

const AttackGetAttackEffectsData = Attack.prototype.GetAttackEffectsData;
Attack.prototype.GetAttackEffectsData = function(type, splash)
{
	const attackData = AttackGetAttackEffectsData.apply(this, arguments);
	if (type == "Melee")
	{
		const r = Math.max(0, 1 + 0.2 * randomNormal2D()[0]);
		for (const damageType in attackData.Damage)
			attackData.Damage[damageType] *= r;
	}
	return attackData;
};

const AttackStartAttacking = Attack.prototype.StartAttacking;
Attack.prototype.StartAttacking = function(target, type, callerIID, force)
{
	if (!AttackStartAttacking.apply(this, arguments))
		return false;
	const cmpModifiersManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ModifiersManager);
	if (cmpModifiersManager.HasAnyModifier("Charge RepeatTimeBonus", this.entity))
	{
		const cmpUnitAI = Engine.QueryInterface(this.entity, IID_UnitAI);
		cmpTimer.SetTimeout(this.entity, IID_Attack, "ChargeRepeatTimeBonusEnd", cmpUnitAI.template.Charge.RepeatTimeBonus.Duration);
	}
	return true;
};

FormationAttack.prototype.GetRange = function(target)
{
	var result = { "min": 0, "max": -1 };
	var cmpFormation = Engine.QueryInterface(this.entity, IID_Formation);
	if (!cmpFormation)
	{
		warn("FormationAttack component used on a non-formation entity");
		return result;
	}
	var members = cmpFormation.GetMembers();
	for (var ent of members)
	{
		var cmpAttack = Engine.QueryInterface(ent, IID_Attack);
		if (!cmpAttack)
			continue;

		var type = cmpAttack.GetBestAttackAgainst(target);
		if (!type)
			continue;

		// if the formation can attack, take the minimum max range (so units are certainly in range),
		// If the formation can't attack, take the maximum max range as the point where the formation will be disbanded
		// Always take the minimum min range (to not get impossible situations)
		var range = cmpAttack.GetRange(type);

		if (range.max < result.max || result.max < 0)
			result.max = range.max;
		if (range.min < result.min)
			result.min = range.min;
	}
	return result;
};

Formation.prototype.variablesToSerialize.push("attackingEntities");

Formation.prototype.SetAttackingEntity = function(ent)
{
	if (!this.attackingEntities)
		this.attackingEntities = new Set();
	this.attackingEntities.add(ent);
};

Formation.prototype.UnsetAttackingEntity = function(ent)
{
	if (!this.attackingEntities)
		this.attackingEntities = new Set();
	this.attackingEntities.delete(ent);
};

Formation.prototype.AreSomeMembersAttacking = function()
{
	if (!this.attackingEntities)
		return false;
	const bugs = [];
	for (const e of this.attackingEntities)
	{
		if (this.members.includes(e))
		{
			bugs.forEach(e => this.attackingEntities.delete(e));
			return true;
		}
		bugs.push(e);
	}
	return false;
};

