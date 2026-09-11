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
Engine.LoadComponentScript("interfaces/Looter.js");
Engine.LoadComponentScript("interfaces/ResourceGatherer.js");
Engine.LoadComponentScript("interfaces/Trader.js");
Engine.LoadComponentScript("interfaces/ModifiersManager.js");
Engine.LoadComponentScript("interfaces/StatisticsTracker.js");
Engine.LoadComponentScript("Looter.js");
Engine.LoadComponentScript("Loot.js");
Engine.LoadHelperScript("ValueModification.js");
Engine.LoadHelperScript("Player.js");

const looter = 30;
const target = 42;
const playerEntity = 10;
const cmpLooter = ConstructComponent(looter, "Looter", {});
cmpLooter.Collect(target);

AddMock(target, IID_Loot, {
	"GetResources": () => ({ "metal": 0, "wood": 10, "stone": 0, "food": 0 })
});

cmpLooter.Collect(target);

AddMock(looter, IID_Ownership, {
	"GetOwner": () => 1
});

AddMock(SYSTEM_ENTITY, IID_PlayerManager, {
	"GetPlayerByID": () => playerEntity
});

const resourceCount = {};
AddMock(playerEntity, IID_Player, {
	"AddResources": (amounts) => {
		for (const type in amounts)
			resourceCount[type] = (resourceCount[type] ?? 0) +amounts[type];
	}
});

cmpLooter.Collect(target);

TS_ASSERT_UNEVAL_EQUALS(resourceCount, { "food": 0, "metal": 0, "stone": 0, "wood": 10 });

AddMock(playerEntity, IID_StatisticsTracker, {
	"IncreaseLootCollectedCounter": (_) => {}
});

cmpLooter.Collect(target);

TS_ASSERT_UNEVAL_EQUALS(resourceCount, { "food": 0, "metal": 0, "stone": 0, "wood": 20 });

// Integration tests

const target2 = 43;
const cmpLootNoXp = ConstructComponent(target2, "Loot", {
	"metal": 10,
	"wood": 20
});

cmpLooter.Collect(target2);

TS_ASSERT_UNEVAL_EQUALS(resourceCount, { "food": 0, "metal": 10, "stone": 0, "wood": 40 });


