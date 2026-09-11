Engine.LoadHelperScript("Player.js");
Engine.LoadComponentScript("interfaces/Timer.js");
Engine.LoadComponentScript("interfaces/Treasure.js");
Engine.LoadComponentScript("interfaces/TreasureCollector.js");
Engine.LoadComponentScript("interfaces/UnitAI.js");
Engine.LoadComponentScript("Timer.js");
Engine.LoadComponentScript("TreasureCollector.js");

AddMock(SYSTEM_ENTITY, IID_ObstructionManager, {
	"IsInTargetRange": () => true
});

const entity = 11;
const treasure = 12;
const cmpTimer = ConstructComponent(SYSTEM_ENTITY, "Timer", {});

const cmpTreasurer = ConstructComponent(entity, "TreasureCollector", {
	"MaxDistance": "2.0"
});

TS_ASSERT(!cmpTreasurer.StartCollecting(treasure));

const cmpTreasure = AddMock(treasure, IID_Treasure, {
	"Reward": (ent) => true,
	"CollectionTime": () => 1000,
	"IsAvailable": () => true
});
const spyTreasure = new Spy(cmpTreasure, "Reward");
TS_ASSERT(cmpTreasurer.StartCollecting(treasure));
cmpTimer.OnUpdate({ "turnLength": 1 });
TS_ASSERT_EQUALS(spyTreasure._called, 1);

// Test that starting to collect twice merely collects once.
spyTreasure._called = 0;
TS_ASSERT(cmpTreasurer.StartCollecting(treasure));
TS_ASSERT(cmpTreasurer.StartCollecting(treasure));
cmpTimer.OnUpdate({ "turnLength": 1 });
TS_ASSERT_EQUALS(spyTreasure._called, 1);

// Test callback is called.
const cmpUnitAI = AddMock(entity, IID_UnitAI, {
	"ProcessMessage": (type, data) => TS_ASSERT_EQUALS(type, "TargetInvalidated")
});
const spyUnitAI = new Spy(cmpUnitAI, "ProcessMessage");
TS_ASSERT(cmpTreasurer.StartCollecting(treasure, IID_UnitAI));
cmpTimer.OnUpdate({ "turnLength": 1 });
TS_ASSERT_EQUALS(spyUnitAI._called, 1);
