Engine.LoadComponentScript("interfaces/Timer.js");
Engine.LoadComponentScript("interfaces/StatisticsTracker.js");
Engine.LoadComponentScript("StatisticsTracker.js");

AddMock(SYSTEM_ENTITY, IID_Timer, {
	"SetInterval": () => true
});

Resources = {
	"GetCodes": () => ["food", "metal", "stone", "wood"]
};

const cmpStatisticsTracker = ConstructComponent(SYSTEM_ENTITY, "StatisticsTracker", {
	"UnitClasses": { "_string": "Infantry FishingBoat" },
	"StructureClasses": { "_string": "House Wonder" }
});

const fromData = {
	"successfulBribes": 3,
	"unitsTrained": {
		"Infantry": 5,
		"Worker": 7
	}
};

const toData = {
	"successfulBribes": [11, 13, 17],
	"unitsTrained": {
		"Infantry": [19, 23],
		"Worker": [29]
	}
};

// This function pushes without testing for Identity classes
cmpStatisticsTracker.PushValue(fromData, toData);
TS_ASSERT_UNEVAL_EQUALS(toData, {
	"successfulBribes": [11, 13, 17, 3],
	"unitsTrained": {
		"Infantry": [19, 23, 5],
		"Worker": [29, 7]
	}
});
