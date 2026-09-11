Engine.LoadHelperScript("Player.js");
Engine.LoadComponentScript("interfaces/PlayerManager.js");
Engine.LoadComponentScript("interfaces/Diplomacy.js");
Engine.LoadComponentScript("interfaces/PopulationCapManager.js");
Engine.LoadComponentScript("PopulationCapManager.js");

const DEFAULT_POPCAP = 999;

const cmpPopulationCapManager = ConstructComponent(SYSTEM_ENTITY, "PopulationCapManager");
const playerData = [
	{
		"team": -1,
		"state": "active"
	},
	{
		"team": -1,
		"state": "active"
	},
	{
		"team": -1,
		"state": "active"
	},
	{
		"team": 0,
		"state": "active"
	},
	{
		"team": 1,
		"state": "active"
	},
	{
		"team": 1,
		"state": "active"
	},
	{
		"team": 1,
		"state": "active"
	},
	{
		"team": 2,
		"state": "active"
	},
	{
		"team": 2,
		"state": "active"
	}
];

const currentPopCaps = Object.keys(playerData).fill(DEFAULT_POPCAP);

AddMock(SYSTEM_ENTITY, IID_PlayerManager, {
	"GetNonGaiaPlayers": () => { return Object.keys(playerData).slice(1); },
	"GetActivePlayers": () => { return Object.keys(playerData.filter(player => player.state === "active")).slice(1); },
	"GetPlayerByID": (id) => id
});

for (const playerID in Object.keys(playerData))
{
	AddMock(playerID, IID_Player, {
		"SetMaxPopulation": (val) => { currentPopCaps[playerID] = Math.round(val); }
	});
	AddMock(playerID, IID_Diplomacy, {
		"GetTeam": () => { return playerData[playerID].team; }
	});
}

cmpPopulationCapManager.SetPopulationCap(400);
cmpPopulationCapManager.SetPopulationCapType(cmpPopulationCapManager.CAPTYPE_PLAYER_POPULATION);
TS_ASSERT_UNEVAL_EQUALS(currentPopCaps, [DEFAULT_POPCAP, 400, 400, 400, 400, 400, 400, 400, 400]);

cmpPopulationCapManager.SetPopulationCapType(cmpPopulationCapManager.CAPTYPE_TEAM_POPULATION);
TS_ASSERT_UNEVAL_EQUALS(currentPopCaps, [DEFAULT_POPCAP, 400, 400, 400, 133, 133, 133, 200, 200]);

playerData[6].team = 2;
cmpPopulationCapManager.OnTeamChanged({ "player": 6, "oldTeam": 1, "newTeam": 2 });
TS_ASSERT_UNEVAL_EQUALS(currentPopCaps, [DEFAULT_POPCAP, 400, 400, 400, 200, 200, 133, 133, 133]);

playerData[8].state = "defeated";
currentPopCaps.pop();
cmpPopulationCapManager.OnGlobalPlayerDefeated({ "playerId": 8 });
TS_ASSERT_UNEVAL_EQUALS(currentPopCaps, [DEFAULT_POPCAP, 400, 400, 400, 200, 200, 200, 200]);

cmpPopulationCapManager.SetPopulationCapType(cmpPopulationCapManager.CAPTYPE_WORLD_POPULATION);
TS_ASSERT_UNEVAL_EQUALS(currentPopCaps, [DEFAULT_POPCAP, 57, 57, 57, 57, 57, 57, 57]);

playerData[7].state = "defeated";
currentPopCaps.pop();
cmpPopulationCapManager.OnGlobalPlayerDefeated({ "playerId": 7 });
TS_ASSERT_UNEVAL_EQUALS(currentPopCaps, [DEFAULT_POPCAP, 67, 67, 67, 67, 67, 67]);
