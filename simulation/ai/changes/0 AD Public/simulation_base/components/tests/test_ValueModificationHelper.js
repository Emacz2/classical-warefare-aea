Engine.LoadHelperScript("Player.js");
Engine.LoadHelperScript("ValueModification.js");
Engine.LoadComponentScript("interfaces/Player.js");
Engine.LoadComponentScript("interfaces/ModifiersManager.js");

const player = 1;
const playerEnt = 10;
const ownedEnt = 60;
const techKey = "Attack/BigAttack";
const otherKey = "Other/Key";

AddMock(SYSTEM_ENTITY, IID_ModifiersManager, {
	"ApplyModifiers": (key, val, ent) => {
		if (key != techKey)
			return val;
		if (ent == playerEnt)
			return val + 3;
		if (ent == ownedEnt)
			return val + 7;
		return val;
	}
});

AddMock(SYSTEM_ENTITY, IID_PlayerManager, {
	"GetPlayerByID": () => 10
});

AddMock(playerEnt, IID_Player, {
	"GetPlayerID": () => 1
});

AddMock(ownedEnt, IID_Ownership, {
	"GetOwner": () => 1
});

TS_ASSERT_EQUALS(ApplyValueModificationsToEntity(otherKey, 2.0, playerEnt), 2.0);

TS_ASSERT_EQUALS(ApplyValueModificationsToEntity(techKey, 2.0, playerEnt), 5.0);

TS_ASSERT_EQUALS(ApplyValueModificationsToEntity(techKey, 2.0, ownedEnt), 9.0);
