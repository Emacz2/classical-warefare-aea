Engine.LoadComponentScript("interfaces/ModifiersManager.js");
Engine.LoadComponentScript("ModifiersManager.js");
Engine.LoadHelperScript("Player.js");
Engine.LoadHelperScript("ValueModification.js");
Engine.LoadComponentScript("interfaces/Health.js");

let cmpModifiersManager = ConstructComponent(SYSTEM_ENTITY, "ModifiersManager", {});
cmpModifiersManager.Init();

// These should be different as that is the general case.
const PLAYER_ID_FOR_TEST = 2;
const PLAYER_ENTITY_ID = 3;
const STRUCTURE_ENTITY_ID = 5;

AddMock(SYSTEM_ENTITY, IID_RangeManager, {
	"GetEntitiesByPlayer": () => [],
});

AddMock(SYSTEM_ENTITY, IID_PlayerManager, {
	"GetPlayerByID": (a) => PLAYER_ENTITY_ID
});

AddMock(PLAYER_ENTITY_ID, IID_Player, {
	"GetPlayerID": () => PLAYER_ID_FOR_TEST
});

const entitiesToTest = [STRUCTURE_ENTITY_ID, 6, 7, 8];
for (const ent of entitiesToTest)
	AddMock(ent, IID_Ownership, {
		"GetOwner": () => PLAYER_ID_FOR_TEST
	});

AddMock(PLAYER_ENTITY_ID, IID_Identity, {
	"GetClassesList": () => "Player",
});
AddMock(STRUCTURE_ENTITY_ID, IID_Identity, {
	"GetClassesList": () => "Structure",
});
AddMock(6, IID_Identity, {
	"GetClassesList": () => "Infantry",
});
AddMock(7, IID_Identity, {
	"GetClassesList": () => "Unit",
});
AddMock(8, IID_Identity, {
	"GetClassesList": () => "Structure Unit",
});

// Sprinkle random serialisation cycles.
function SerializationCycle()
{
	const data = cmpModifiersManager.Serialize();
	cmpModifiersManager = ConstructComponent(SYSTEM_ENTITY, "ModifiersManager", {});
	cmpModifiersManager.Deserialize(data);
}

cmpModifiersManager.OnGlobalPlayerEntityChanged({ "player": PLAYER_ID_FOR_TEST, "from": -1, "to": PLAYER_ENTITY_ID });

cmpModifiersManager.AddModifier("Test_A", "Test_A_0", [{ "affects": ["Structure"], "add": 10 }], 10, "testLol");

cmpModifiersManager.AddModifier("Test_A", "Test_A_0", [{ "affects": ["Structure"], "add": 10 }], PLAYER_ENTITY_ID);
cmpModifiersManager.AddModifier("Test_A", "Test_A_1", [{ "affects": ["Infantry"], "add": 5 }], PLAYER_ENTITY_ID);
cmpModifiersManager.AddModifier("Test_A", "Test_A_2", [{ "affects": ["Unit"], "add": 3 }], PLAYER_ENTITY_ID);


TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_A", 5, PLAYER_ENTITY_ID), 5);
cmpModifiersManager.AddModifier("Test_A", "Test_A_Player", [{ "affects": ["Player"], "add": 3 }], PLAYER_ENTITY_ID);
TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_A", 5, PLAYER_ENTITY_ID), 8);

TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_A", 5, 5), 15);
TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_A", 5, 6), 10);
SerializationCycle();
TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_A", 5, 5), 15);
TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_A", 5, 6), 10);
TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_A", 5, 7), 8);
TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_A", 5, 8), 18);

TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_B", 5, 8), 5);

cmpModifiersManager.RemoveAllModifiers("Test_A_0", PLAYER_ENTITY_ID);

TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_A", 5, 5), 5);

cmpModifiersManager.AddModifiers("Test_A_0", {
	"Test_A": [{ "affects": ["Structure"], "add": 10 }],
	"Test_B": [{ "affects": ["Structure"], "add": 8 }],
}, PLAYER_ENTITY_ID);

TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_A", 5, 5), 15);
TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_B", 5, 8), 13);


// Add two local modifications, only the first should stick.
cmpModifiersManager.AddModifier("Test_C", "Test_C_0", [{ "affects": ["Structure"], "add": 10 }], STRUCTURE_ENTITY_ID);
cmpModifiersManager.AddModifier("Test_C", "Test_C_invalid", [{ "affects": ["Unit"], "add": 5 }], STRUCTURE_ENTITY_ID);

SerializationCycle();

TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_C", 5, STRUCTURE_ENTITY_ID), 15);

// test that local modifications are indeed applied after global managers
cmpModifiersManager.AddModifier("Test_C", "Test_C_player", [{ "affects": ["Structure"], "replace": 2 }], PLAYER_ENTITY_ID);

TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_C", 5, STRUCTURE_ENTITY_ID), 12);
TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_C", 2, STRUCTURE_ENTITY_ID), 12);

SerializationCycle();

// test removal
cmpModifiersManager.RemoveModifier("Test_C", "Test_C_player", PLAYER_ENTITY_ID);
TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_C", 5, STRUCTURE_ENTITY_ID), 15);

// check that things still work properly if we change global modifications
cmpModifiersManager.AddModifier("Test_C", "Test_C_player", [{ "affects": ["Structure"], "add": 12 }], PLAYER_ENTITY_ID);
TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_C", 5, STRUCTURE_ENTITY_ID), 27);

TS_ASSERT(cmpModifiersManager.HasAnyModifier("Test_C_player", PLAYER_ENTITY_ID));
TS_ASSERT(cmpModifiersManager.HasModifier("Test_C", "Test_C_player", PLAYER_ENTITY_ID));

SerializationCycle();

TS_ASSERT(cmpModifiersManager.HasModifier("Test_C", "Test_C_player", PLAYER_ENTITY_ID));
TS_ASSERT(!cmpModifiersManager.HasModifier("Test_C", "Test_C_player", STRUCTURE_ENTITY_ID));


// Regression test for a caching issue
cmpModifiersManager.AddModifier("Test_E", "Test_E_player", [{ "affects": ["Structure"], "add": 1 }], PLAYER_ENTITY_ID);
TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_E", 3, STRUCTURE_ENTITY_ID), 4);
cmpModifiersManager.AddModifier("Test_E", "Test_E_1", [{ "affects": ["Structure"], "add": 1 }], STRUCTURE_ENTITY_ID);
TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_E", 4, STRUCTURE_ENTITY_ID), 6);
TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_E", 5, STRUCTURE_ENTITY_ID), 7);


// Test that entities keep local modifications but not global ones when changing owner.
AddMock(SYSTEM_ENTITY, IID_PlayerManager, {
	"GetPlayerByID": (a) => a == PLAYER_ID_FOR_TEST ? PLAYER_ENTITY_ID : PLAYER_ENTITY_ID + 1
});

AddMock(PLAYER_ENTITY_ID + 1, IID_Player, {
	"GetPlayerID": () => PLAYER_ID_FOR_TEST + 1
});

cmpModifiersManager = ConstructComponent(SYSTEM_ENTITY, "ModifiersManager", {});
cmpModifiersManager.Init();

cmpModifiersManager.AddModifier("Test_D", "Test_D_0", [{ "affects": ["Structure"], "add": 10 }], PLAYER_ENTITY_ID);
cmpModifiersManager.AddModifier("Test_D", "Test_D_1", [{ "affects": ["Structure"], "add": 1 }], PLAYER_ENTITY_ID + 1);
cmpModifiersManager.AddModifier("Test_D", "Test_D_2", [{ "affects": ["Structure"], "add": 5 }], STRUCTURE_ENTITY_ID);

cmpModifiersManager.OnGlobalPlayerEntityChanged({ "player": PLAYER_ID_FOR_TEST, "from": -1, "to": PLAYER_ENTITY_ID });
cmpModifiersManager.OnGlobalPlayerEntityChanged({ "player": PLAYER_ID_FOR_TEST + 1, "from": -1, "to": PLAYER_ENTITY_ID + 1 });

TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_D", 10, 5), 25);
cmpModifiersManager.OnGlobalOwnershipChanged({ "entity": 5, "from": PLAYER_ID_FOR_TEST, "to": PLAYER_ID_FOR_TEST + 1 });
AddMock(5, IID_Ownership, {
	"GetOwner": () => PLAYER_ID_FOR_TEST + 1
});
TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Test_D", 10, 5), 16);

// Test: Entity changes owner from player 2 (HP modifier) to player 3 (Vision modifier)
(function Test_OwnerChange_ModifierSwitch() {
	const PLAYER2_ID = 2;
	const PLAYER3_ID = 3;
	const PLAYER2_ENTITY = 20;
	const PLAYER3_ENTITY = 21;
	const TEST_ENTITY = 30;

	const baseHp = 100;
	const baseVision = 20;

	// Set up mocks for both players
	AddMock(SYSTEM_ENTITY, IID_PlayerManager, {
		"GetPlayerByID": (a) => a === PLAYER2_ID ? PLAYER2_ENTITY : PLAYER3_ENTITY
	});
	AddMock(PLAYER2_ENTITY, IID_Player, {
		"GetPlayerID": () => PLAYER2_ID
	});
	AddMock(PLAYER3_ENTITY, IID_Player, {
		"GetPlayerID": () => PLAYER3_ID
	});
	AddMock(TEST_ENTITY, IID_Ownership, {
		"GetOwner": () => PLAYER2_ID
	});
	AddMock(TEST_ENTITY, IID_Identity, {
		"GetClassesList": () => "Unit"
	});
	// These components cache the values, so we need to mock the message passing.
	let cachedHp = baseHp;
	AddMock(TEST_ENTITY, IID_Health, {
		"GetHitPoints": () => cachedHp,
	});
	let cachedVision = baseVision;
	AddMock(TEST_ENTITY, IID_Vision, {
		"GetRange": () => cachedVision
	});
	const oldPostMessage = Engine.PostMessage;
	const oldBroadcastMessage = Engine.BroadcastMessage;
	Engine.PostMessage = function(ent, iid, message)
	{
		if (message.component === "HP")
			cachedHp = ApplyValueModificationsToEntity("HP", baseHp, TEST_ENTITY);
		else if (message.component === "Vision")
			cachedVision = ApplyValueModificationsToEntity("Vision", baseVision, TEST_ENTITY);
		else
			throw new Error("Unexpected component: " + message.component);
	};
	Engine.BroadcastMessage = function(iid, message)
	{
		if (message.component === "HP")
			cachedHp = ApplyValueModificationsToEntity("HP", baseHp, TEST_ENTITY);
		else if (message.component === "Vision")
			cachedVision = ApplyValueModificationsToEntity("Vision", baseVision, TEST_ENTITY);
		else
			throw new Error("Unexpected component: " + message.component);
	};
	// Initialize ModifiersManager
	const cmp = ConstructComponent(SYSTEM_ENTITY, "ModifiersManager", {});
	cmp.Init();

	cmp.OnGlobalPlayerEntityChanged({ "player": PLAYER2_ID, "from": INVALID_PLAYER, "to": PLAYER2_ENTITY });
	cmp.OnGlobalPlayerEntityChanged({ "player": PLAYER3_ID, "from": INVALID_PLAYER, "to": PLAYER3_ENTITY });

	// Player 2 gets HP modifier
	cmp.AddModifier("HP", "HP_mod", [{ "affects": ["Unit"], "add": 50 }], PLAYER2_ENTITY);
	// Player 3 gets Vision modifier
	cmp.AddModifier("Vision", "Vision_mod", [{ "affects": ["Unit"], "add": 10 }], PLAYER3_ENTITY);

	// Should have HP modified, not Vision
	TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("HP", baseHp, TEST_ENTITY), 150);
	TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Vision", baseVision, TEST_ENTITY), 20);
	TS_ASSERT_EQUALS(Engine.QueryInterface(TEST_ENTITY, IID_Health).GetHitPoints(), 150);
	TS_ASSERT_EQUALS(Engine.QueryInterface(TEST_ENTITY, IID_Vision).GetRange(), 20);

	// Change owner to player 3
	AddMock(TEST_ENTITY, IID_Ownership, {
		"GetOwner": () => PLAYER3_ID
	});
	cmp.OnGlobalOwnershipChanged({ "entity": TEST_ENTITY, "from": PLAYER2_ID, "to": PLAYER3_ID });

	// Now should have Vision modified, not HP
	TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("HP", baseHp, TEST_ENTITY), 100);
	TS_ASSERT_EQUALS(ApplyValueModificationsToEntity("Vision", baseVision, TEST_ENTITY), 30);
	TS_ASSERT_EQUALS(Engine.QueryInterface(TEST_ENTITY, IID_Health).GetHitPoints(), 100);
	TS_ASSERT_EQUALS(Engine.QueryInterface(TEST_ENTITY, IID_Vision).GetRange(), 30);

	// Cleanup
	Engine.PostMessage = oldPostMessage;
	Engine.BroadcastMessage = oldBroadcastMessage;
})();
