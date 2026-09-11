AttackEffects = class AttackEffects
{
};

Engine.LoadHelperScript("Attack.js");
Engine.LoadHelperScript("ValueModification.js");
Engine.LoadComponentScript("interfaces/DeathDamage.js");
Engine.LoadComponentScript("interfaces/ModifiersManager.js");
Engine.LoadComponentScript("DeathDamage.js");

const deadEnt = 60;
const player = 1;

ApplyValueModificationsToEntity = function(value, stat, ent)
{
	if (value == "DeathDamage/Damage/Pierce" && ent == deadEnt)
		return stat + 200;
	return stat;
};

const template = {
	"Shape": "Circular",
	"Range": 10.7,
	"FriendlyFire": "false",
	"Damage": {
		"Hack": 0.0,
		"Pierce": 15.0,
		"Crush": 35.0
	}
};

const effects = {
	"Damage": {
		"Hack": 0.0,
		"Pierce": 215.0,
		"Crush": 35.0
	}
};

let cmpDeathDamage = ConstructComponent(deadEnt, "DeathDamage", template);

const playersToDamage = [2, 3, 7];
const pos = new Vector2D(3, 4.2);

const result = {
	"type": "Death",
	"attackData": effects,
	"attacker": deadEnt,
	"attackerOwner": player,
	"origin": pos,
	"radius": template.Range,
	"shape": template.Shape,
	"friendlyFire": false
};

AttackHelper.CauseDamageOverArea = data => TS_ASSERT_UNEVAL_EQUALS(data, result);
AttackHelper.GetPlayersToDamage = () => playersToDamage;

AddMock(deadEnt, IID_Position, {
	"GetPosition2D": () => pos,
	"IsInWorld": () => true
});

AddMock(deadEnt, IID_Ownership, {
	"GetOwner": () => player
});

TS_ASSERT_UNEVAL_EQUALS(cmpDeathDamage.GetDeathDamageEffects(), effects);
cmpDeathDamage.CauseDeathDamage();

// Test splash damage bonus
effects.Bonuses = { "BonusCav": { "Classes": "Cavalry", "Multiplier": 3 } };
template.Bonuses = effects.Bonuses;
cmpDeathDamage = ConstructComponent(deadEnt, "DeathDamage", template);
result.attackData.Bonuses = effects.Bonuses;
TS_ASSERT_UNEVAL_EQUALS(cmpDeathDamage.GetDeathDamageEffects(), effects);
cmpDeathDamage.CauseDeathDamage();
