Resources = {
	"GetCodes": () => ["food", "metal", "stone", "wood"],
	"GetTradableCodes": () => ["food", "metal", "stone", "wood"],
	"GetBarterableCodes": () => ["food", "metal", "stone", "wood"],
	"GetResource": () => ({}),
	"BuildSchema": (type) => {
		let schema = "";
		for (const res of Resources.GetCodes())
			schema +=
				"<optional>" +
					"<element name='" + res + "'>" +
						"<ref name='" + type + "'/>" +
					"</element>" +
				"</optional>";
		return "<interleave>" + schema + "</interleave>";
	}
};

Engine.LoadComponentScript("interfaces/Loot.js");
Engine.LoadComponentScript("Loot.js");
Engine.LoadHelperScript("ValueModification.js");
Engine.LoadComponentScript("interfaces/ModifiersManager.js");

let applyModifierOverride = (key, val, ent) => {
	return val;
};

AddMock(SYSTEM_ENTITY, IID_ModifiersManager, {
	"ApplyModifiers": (key, val, ent) => {
		return applyModifierOverride(key, val, ent);
	}
});

const cmpLoot = ConstructComponent(30, "Loot", {
	"xp": 35,
	"metal": 10
});

TS_ASSERT_EQUALS(cmpLoot.GetResources().xp, undefined);
TS_ASSERT_EQUALS(cmpLoot.GetResources().metal, 10);
TS_ASSERT_EQUALS(cmpLoot.GetResources().wood, 0);
TS_ASSERT_UNEVAL_EQUALS(cmpLoot.GetResources(), { "food": 0, "metal": 10, "stone": 0, "wood": 0 });
TS_ASSERT_EQUALS(cmpLoot.GetXp(), 35);

const cmpLootNoXp = ConstructComponent(30, "Loot", {
	"metal": 10,
	"wood": 20
});

TS_ASSERT_EQUALS(cmpLootNoXp.GetResources().xp, undefined);
TS_ASSERT_EQUALS(cmpLootNoXp.GetResources().metal, 10);
TS_ASSERT_EQUALS(cmpLootNoXp.GetResources().wood, 20);
TS_ASSERT_EQUALS(cmpLootNoXp.GetResources().stone, 0);
TS_ASSERT_UNEVAL_EQUALS(cmpLootNoXp.GetResources(), { "food": 0, "metal": 10, "stone": 0, "wood": 20 });
TS_ASSERT_EQUALS(cmpLootNoXp.GetXp(), 0);

applyModifierOverride = (key, val, ent) => {
	return key == "Loot/xp" ? 100 : val;
};

TS_ASSERT_EQUALS(cmpLootNoXp.GetXp(), 100);

applyModifierOverride = (key, val, ent) => {
	return key == "Loot/wood" ? 100 : val;
};

TS_ASSERT_EQUALS(cmpLootNoXp.GetResources().wood, 100);
