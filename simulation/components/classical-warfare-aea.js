// Charge attack repeat time bonus for a while
Attack.prototype.ChargeRepeatTimeBonusEnd = function()
{
	this.StopAttacking("ChargeRepeatTimeBonusEnd");
};

const AttackStartAttacking = Attack.prototype.StartAttacking;
Attack.prototype.StartAttacking = function(target, type, callerIID, force)
{
	if (!AttackStartAttacking.apply(this, arguments))
		return false;
	const cmpModifiersManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ModifiersManager);
	if (cmpModifiersManager.HasAnyModifier("Charge RepeatTimeBonus", this.entity))
	{
		const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
		const cmpUnitAI = Engine.QueryInterface(this.entity, IID_UnitAI);
		cmpTimer.SetTimeout(this.entity, IID_Attack, "ChargeRepeatTimeBonusEnd", cmpUnitAI.template.Charge.RepeatTimeBonus.Duration);
	}
	return true;
};

// Randomize Melee attack
const DelayedDamageHit = DelayedDamage.prototype.Hit;
DelayedDamage.prototype.Hit = function(data, lateness)
{
	if (data.type == "Melee")
	{
		const r = Math.max(0, 1 + 0.2 * randomNormal2D()[0]);
		for (const damageType in data.attackData.Damage)
			data.attackData.Damage[damageType] *= r;
	}
	DelayedDamageHit.apply(this, arguments);
};

// Reduce range to ensure that the formation get close enough to attack
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

// Formation would approach again only when no units are still fighting
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

const roundCount = 20;
const attackType = "Ranged";

BuildingAI.prototype.FireArrows = function()
{
	if (!this.targetUnits.length && !this.unitAITarget)
	{
		if (!this.timer)
			return;

		const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
		cmpTimer.CancelTimer(this.timer);
		this.timer = undefined;
		return;
	}

	const cmpAttack = Engine.QueryInterface(this.entity, IID_Attack);
	if (!cmpAttack)
		return;

	if (this.currentRound > roundCount - 1)
		this.currentRound = 0;

	if (this.currentRound == 0)
		this.arrowsLeft = this.GetArrowCount();

	let arrowsToFire;
	if (this.currentRound == roundCount - 1)
		arrowsToFire = this.arrowsLeft;
	else
		arrowsToFire = Math.min(
			// shooting arrows in the first quarter of rounds results in a burst.
			this.GetArrowCount() / (roundCount / 4),
			this.arrowsLeft
		);

	if (arrowsToFire <= 0)
	{
		++this.currentRound;
		return;
	}

	// Add targets to a list.
	let targets = [];
	const addTarget = function(target)
	{
		const pref = (cmpAttack.GetPreference(target) ?? 49);
		targets.push({ "entityId": target, "preference": pref });
	};

	// Add the UnitAI target separately, as the UnitMotion and RangeManager implementations differ.
	if (this.unitAITarget && this.targetUnits.indexOf(this.unitAITarget) == -1)
		addTarget(this.unitAITarget);

	else if (this.unitAITarget && this.targetUnits.indexOf(this.unitAITarget) != -1)
		this.focusTargets = [{ "entityId": this.unitAITarget }];

	if (!this.focusTargets.length)
	{
		for (const target of this.targetUnits)
			addTarget(target);
		// Sort targets by preference and then randomness.
		targets = shuffleArray(targets);
		targets.sort((a, b) => a.preference - b.preference);
	}
	else
		targets = this.focusTargets;

	// The obstruction manager performs approximate range checks.
	// so we need to verify them here.
	// TODO: perhaps an optional 'precise' mode to range queries would be more performant.
	const cmpObstructionManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ObstructionManager);
	const range = cmpAttack.GetRange(attackType);
	const yOrigin = cmpAttack.GetAttackYOrigin(attackType);

	let firedArrows = 0;
	let targetIndex = 0;
	while (firedArrows < arrowsToFire && targetIndex < targets.length)
	{

		const selectedTarget = targets[targetIndex].entityId;
		if (this.CheckTargetVisible(selectedTarget) && cmpObstructionManager.IsInTargetParabolicRange(
			this.entity,
			selectedTarget,
			range.min,
			range.max,
			yOrigin,
			false))
		{
			cmpAttack.PerformAttack(attackType, selectedTarget);
			PlaySound("attack_" + attackType.toLowerCase(), this.entity);
			++firedArrows;
		}
		else
			++targetIndex;// Could not attack target, try a different target.
	}
	targets.splice(0, targetIndex);
	this.arrowsLeft -= firedArrows;
	++this.currentRound;
};
