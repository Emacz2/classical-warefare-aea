AttackEffects = class AttackEffects
{
	constructor() {}
	Receivers()
	{
		return [{
			"type": "Damage",
			"IID": "IID_Health",
			"method": "TakeDamage"
		},
		{
			"type": "Capture",
			"IID": "IID_Capturable",
			"method": "Capture"
		},
		{
			"type": "ApplyStatus",
			"IID": "IID_StatusEffectsReceiver",
			"method": "ApplyStatus"
		}];
	}
};

Engine.LoadHelperScript("Attack.js");
Engine.LoadHelperScript("Player.js");
Engine.LoadHelperScript("ValueModification.js");
Engine.LoadComponentScript("interfaces/Capturable.js");
Engine.LoadComponentScript("interfaces/Foundation.js");
Engine.LoadComponentScript("interfaces/Health.js");
Engine.LoadComponentScript("interfaces/Looter.js");
Engine.LoadComponentScript("interfaces/ModifiersManager.js");
Engine.LoadComponentScript("interfaces/PlayerManager.js");
Engine.LoadComponentScript("interfaces/Promotion.js");
Engine.LoadComponentScript("interfaces/Resistance.js");
Engine.LoadComponentScript("interfaces/StatisticsTracker.js");
Engine.LoadComponentScript("interfaces/StatusEffectsReceiver.js");
Engine.LoadComponentScript("Resistance.js");

class testResistance
{
	constructor()
	{
		this.cmpResistance = null;
		this.PlayerID = 1;
		this.EnemyID = 2;
		this.EntityID = 3;
		this.AttackerID = 4;
	}

	Reset(schema = {})
	{
		this.cmpResistance = ConstructComponent(this.EntityID, "Resistance", schema);
		DeleteMock(this.EntityID, IID_Capturable);
		DeleteMock(this.EntityID, IID_Health);
		DeleteMock(this.EntityID, IID_Identity);
		DeleteMock(this.EntityID, IID_StatusEffectsReceiver);
	}

	TestInvulnerability()
	{
		this.Reset();

		const damage = 5;
		const attackData = { "Damage": { "Name": damage } };
		const attackType = "Test";

		TS_ASSERT(!this.cmpResistance.IsInvulnerable());

		const cmpHealth = AddMock(this.EntityID, IID_Health, {
			"TakeDamage": (amount, __, ___) => {
				TS_ASSERT_EQUALS(amount, damage);
				return { "healthChange": -amount };
			}
		});
		const spy = new Spy(cmpHealth, "TakeDamage");
		const data = {
			"type": attackType,
			"attackData": attackData,
			"attacker": this.AttackerID,
			"attackerOwner": this.EnemyID
		};

		AttackHelper.HandleAttackEffects(this.EntityID, data);
		TS_ASSERT_EQUALS(spy._called, 1);

		this.cmpResistance.SetInvulnerability(true);

		TS_ASSERT(this.cmpResistance.IsInvulnerable());
		AttackHelper.HandleAttackEffects(this.EntityID, data);
		TS_ASSERT_EQUALS(spy._called, 1);
	}

	TestBonus()
	{
		this.Reset();

		const damage = 5;
		const bonus = 2;
		const classes = "Entity";
		const attackData = {
			"Damage": { "Name": damage },
			"Bonuses": {
				"bonus": {
					"Classes": classes,
					"Multiplier": bonus
				}
			}
		};

		AddMock(this.EntityID, IID_Identity, {
			"GetClassesList": () => [classes],
			"GetCiv": () => "civ"
		});

		const cmpHealth = AddMock(this.EntityID, IID_Health, {
			"TakeDamage": (amount, __, ___) => {
				TS_ASSERT_EQUALS(amount, damage * bonus);
				return { "healthChange": -amount };
			}
		});
		const spy = new Spy(cmpHealth, "TakeDamage");

		AttackHelper.HandleAttackEffects(this.EntityID, {
			"type": "Test",
			"attackData": attackData,
			"attacker": this.AttackerID,
			"attackerOwner": this.EnemyID
		});
		TS_ASSERT_EQUALS(spy._called, 1);
	}

	TestDamageResistanceApplies()
	{
		const resistanceValue = 2;
		const damageType = "Name";
		this.Reset({
			"Entity": {
				"Damage": {
					[damageType]: resistanceValue
				}
			}
		});

		const damage = 5;
		const attackData = {
			"Damage": { "Name": damage }
		};

		const cmpHealth = AddMock(this.EntityID, IID_Health, {
			"TakeDamage": (amount, __, ___) => {
				TS_ASSERT_EQUALS(amount, damage * Math.pow(0.9, resistanceValue));
				return { "healthChange": -amount };
			}
		});
		const spy = new Spy(cmpHealth, "TakeDamage");

		AttackHelper.HandleAttackEffects(this.EntityID, {
			"type": "Test",
			"attackData": attackData,
			"attacker": this.AttackerID,
			"attackerOwner": this.EnemyID
		});
		TS_ASSERT_EQUALS(spy._called, 1);
	}

	TestCaptureResistanceApplies()
	{
		const resistanceValue = 2;
		this.Reset({
			"Entity": {
				"Capture": resistanceValue
			}
		});

		const damage = 5;
		const attackData = {
			"Capture": damage
		};

		const cmpCapturable = AddMock(this.EntityID, IID_Capturable, {
			"Capture": (amount, __, ___) => {
				TS_ASSERT_EQUALS(amount, damage * Math.pow(0.9, resistanceValue));
				return { "captureChange": amount };
			}
		});
		const spy = new Spy(cmpCapturable, "Capture");

		AttackHelper.HandleAttackEffects(this.EntityID, {
			"type": "Test",
			"attackData": attackData,
			"attacker": this.AttackerID,
			"attackerOwner": this.EnemyID
		});
		TS_ASSERT_EQUALS(spy._called, 1);
	}

	TestStatusEffectsResistancesApplies()
	{
		// Test duration reduction.
		const durationFactor = 0.5;
		const statusName = "statusName";
		this.Reset({
			"Entity": {
				"ApplyStatus": {
					[statusName]: {
						"Duration": durationFactor
					}
				}
			}
		});

		const duration = 10;
		let attackData = {
			"ApplyStatus": {
				[statusName]: {
					"Duration": duration
				}
			}
		};

		let cmpStatusEffectsReceiver = AddMock(this.EntityID, IID_StatusEffectsReceiver, {
			"ApplyStatus": (effectData, __, ___) => {
				TS_ASSERT_EQUALS(effectData[statusName].Duration, duration * durationFactor);
				return { "inflictedStatuses": Object.keys(effectData) };
			}
		});
		let spy = new Spy(cmpStatusEffectsReceiver, "ApplyStatus");

		AttackHelper.HandleAttackEffects(this.EntityID, {
			"type": "Test",
			"attackData": attackData,
			"attacker": this.AttackerID,
			"attackerOwner": this.EnemyID
		});
		TS_ASSERT_EQUALS(spy._called, 1);

		// Test blocking.
		this.Reset({
			"Entity": {
				"ApplyStatus": {
					[statusName]: {
						"BlockChance": "1"
					}
				}
			}
		});

		cmpStatusEffectsReceiver = AddMock(this.EntityID, IID_StatusEffectsReceiver, {
			"ApplyStatus": (effectData, __, ___) => {
				TS_ASSERT_UNEVAL_EQUALS(effectData, {});
				return { "inflictedStatuses": Object.keys(effectData) };
			}
		});
		spy = new Spy(cmpStatusEffectsReceiver, "ApplyStatus");

		AttackHelper.HandleAttackEffects(this.EntityID, {
			"type": "Test",
			"attackData": attackData,
			"attacker": this.AttackerID,
			"attackerOwner": this.EnemyID
		});
		TS_ASSERT_EQUALS(spy._called, 1);

		// Test multiple resistances.
		const reducedStatusName = "reducedStatus";
		const blockedStatusName = "blockedStatus";
		this.Reset({
			"Entity": {
				"ApplyStatus": {
					[reducedStatusName]: {
						"Duration": durationFactor
					},
					[blockedStatusName]: {
						"BlockChance": "1"
					}
				}
			}
		});

		attackData = {
			"ApplyStatus": {
				[reducedStatusName]: {
					"Duration": duration
				},
				[blockedStatusName]: {
					"Duration": duration
				}
			}
		};

		cmpStatusEffectsReceiver = AddMock(this.EntityID, IID_StatusEffectsReceiver, {
			"ApplyStatus": (effectData, __, ___) => {
				TS_ASSERT_EQUALS(effectData[reducedStatusName].Duration, duration * durationFactor);
				TS_ASSERT_UNEVAL_EQUALS(Object.keys(effectData), [reducedStatusName]);
				return { "inflictedStatuses": Object.keys(effectData) };
			}
		});
		spy = new Spy(cmpStatusEffectsReceiver, "ApplyStatus");

		AttackHelper.HandleAttackEffects(this.EntityID, {
			"type": "Test",
			"attackData": attackData,
			"attacker": this.AttackerID,
			"attackerOwner": this.EnemyID
		});
		TS_ASSERT_EQUALS(spy._called, 1);
	}

	TestResistanceAndBonus()
	{
		const resistanceValue = 2;
		const damageType = "Name";
		this.Reset({
			"Entity": {
				"Damage": {
					[damageType]: resistanceValue
				}
			}
		});

		const damage = 5;
		const bonus = 2;
		const classes = "Entity";
		const attackData = {
			"Damage": { "Name": damage },
			"Bonuses": {
				"bonus": {
					"Classes": classes,
					"Multiplier": bonus
				}
			}
		};

		AddMock(this.EntityID, IID_Identity, {
			"GetClassesList": () => [classes],
			"GetCiv": () => "civ"
		});

		const cmpHealth = AddMock(this.EntityID, IID_Health, {
			"TakeDamage": (amount, __, ___) => {
				TS_ASSERT_EQUALS(amount, damage * bonus * Math.pow(0.9, resistanceValue));
				return { "healthChange": -amount };
			}
		});
		const spy = new Spy(cmpHealth, "TakeDamage");

		AttackHelper.HandleAttackEffects(this.EntityID, {
			"type": "Test",
			"attackData": attackData,
			"attacker": this.AttackerID,
			"attackerOwner": this.EnemyID
		});
		TS_ASSERT_EQUALS(spy._called, 1);
	}

	TestMultipleEffects()
	{
		const captureResistanceValue = 2;
		this.Reset({
			"Entity": {
				"Capture": captureResistanceValue
			}
		});

		const damage = 5;
		const bonus = 2;
		const classes = "Entity";
		const attackData = {
			"Damage": { "Name": damage },
			"Capture": damage,
			"Bonuses": {
				"bonus": {
					"Classes": classes,
					"Multiplier": bonus
				}
			}
		};

		AddMock(this.EntityID, IID_Identity, {
			"GetClassesList": () => [classes],
			"GetCiv": () => "civ"
		});

		const cmpCapturable = AddMock(this.EntityID, IID_Capturable, {
			"Capture": (amount, __, ___) => {
				TS_ASSERT_EQUALS(amount, damage * bonus * Math.pow(0.9, captureResistanceValue));
				return { "captureChange": amount };
			}
		});
		const cmpHealth = AddMock(this.EntityID, IID_Health, {
			"TakeDamage": (amount, __, ___) => {
				TS_ASSERT_EQUALS(amount, damage * bonus);
				return { "healthChange": -amount };
			},
			"GetHitpoints": () => 1,
			"GetMaxHitpoints": () => 1
		});
		const healthSpy = new Spy(cmpHealth, "TakeDamage");
		const captureSpy = new Spy(cmpCapturable, "Capture");

		AttackHelper.HandleAttackEffects(this.EntityID, {
			"type": "Test",
			"attackData": attackData,
			"attacker": this.AttackerID,
			"attackerOwner": this.EnemyID
		});
		TS_ASSERT_EQUALS(healthSpy._called, 1);
		TS_ASSERT_EQUALS(captureSpy._called, 1);
	}
}

const cmp = new testResistance();
cmp.TestInvulnerability();
cmp.TestBonus();
cmp.TestDamageResistanceApplies();
cmp.TestCaptureResistanceApplies();
cmp.TestStatusEffectsResistancesApplies();
cmp.TestResistanceAndBonus();
cmp.TestMultipleEffects();
