/**
 * Command line options for autostart
 * (keep synchronized with binaries/system/readme.txt):
 * TODO: potentially the remaining C++ options could be handled in JS too.
 *
 * -autostart="TYPEDIR/MAPNAME"    enables autostart and sets MAPNAME;
 *                                 TYPEDIR is skirmishes, scenarios, or random
 * -autostart-seed=SEED            sets randomization seed value (default 0, use -1 for random)
 * -autostart-ai=PLAYER:AI         sets the AI for PLAYER (e.g. 2:petra)
 * -autostart-aidiff=PLAYER:DIFF   sets the DIFFiculty of PLAYER's AI
 *                                 (default 3, 0: sandbox, 5: very hard)
 * -autostart-aiseed=AISEED        sets the seed used for the AI random
 *                                 generator (default 0, use -1 for random)
 * -autostart-civ=PLAYER:CIV       sets PLAYER's civilisation to CIV (skirmish and random maps only).
 *                                 Use random for a random civ.
 * -autostart-team=PLAYER:TEAM     sets the team for PLAYER (e.g. 2:2).
 * -autostart-ceasefire=NUM        sets a ceasefire duration NUM
 *                                 (default 0 minutes)
 * -autostart-victory=SCRIPTNAME   sets the victory conditions with SCRIPTNAME
 *                                 located in simulation/data/settings/victory_conditions/
 *                                 (default conquest). When the only given SCRIPTNAME is
 *                                 "endless", no victory conditions will apply.
 * -autostart-wonderduration=NUM   sets the victory duration NUM for wonder victory condition
 *                                 (default 10 minutes)
 * -autostart-relicduration=NUM    sets the victory duration NUM for relic victory condition
 *                                 (default 10 minutes)
 * -autostart-reliccount=NUM       sets the number of relics for relic victory condition
 *                                 (default 2 relics)
 * -autostart-visibility=TYPE      sets the map visibility (explored, hidden, revealed, allied, allied-explored)
 * -autostart-speed=SPEED          sets the sim rate speed (default 1, max 2 in normal mode, 20 in observer mode)
 *
 * -autostart-nonvisual            (partly handled in C++) disable any graphics and sounds
 * -autostart-disable-replay       disable saving of replays (handled in autostart*.js files)
 * -autostart-player=NUMBER        sets the playerID in non-networked games (default 1, use -1 for observer)
 *
 * Multiplayer (handled in specific autostart*.js files):
 * -autostart-playername=NAME      sets local player NAME (default 'anonymous')
 * -autostart-host                 (handled in C++) sets multiplayer host mode
 * -autostart-host-players=NUMBER  sets NUMBER of human players for multiplayer
 *                                 game (default 2)
 * -autostart-port=NUMBER          sets port NUMBER for multiplayer game
 * -autostart-client=IP            (handled in C++) sets multiplayer client to join host at
 *                                 given IP address
 *
 * Random maps only:
 * -autostart-size=TILES           sets random map size in TILES (default 192)
 * -autostart-players=NUMBER       sets NUMBER of players on random map
 *                                 (default 2)
 * -autostart-placement=PLACEMENT  sets the placement type for a random map
 * -autostart-biome=BIOME          sets the biome for a random map
 *
 * Examples:
 * 1) "Bob" will host a 2 player game on the Arcadia map:
 * -autostart="scenarios/arcadia" -autostart-host -autostart-host-players=2 -autostart-playername="Bob"
 *  "Alice" joins the match as player 2:
 * -autostart-client=127.0.0.1 -autostart-playername="Alice"
 * The players use the developer overlay to control players.
 *
 * 2) Load Alpine Lakes random map with random seed, 2 players (Athens and Britons), and player 2 is PetraBot:
 * -autostart="random/alpine_lakes" -autostart-seed=-1 -autostart-players=2 -autostart-civ=1:athen -autostart-civ=2:brit -autostart-ai=2:petra
 *
 * 3) Observe the PetraBot on a triggerscript map:
 * -autostart="random/jebel_barkal" -autostart-seed=-1 -autostart-players=2 -autostart-civ=1:athen -autostart-civ=2:brit -autostart-ai=1:petra -autostart-ai=2:petra -autostart-player=-1
 */
function parseCmdLineArgs(settings, cmdLineArgs)
{
	// eslint-disable-next-line dot-notation
	const mapType = cmdLineArgs['autostart'].substring(0, cmdLineArgs['autostart'].indexOf('/'));
	switch (mapType)
	{
	case "random":
		settings.map.setType("random");
		break;
	case "scenarios":
		settings.map.setType("scenario");
		break;
	case "skirmishes":
		settings.map.setType("skirmish");
		break;
	default:
		throw new Error(`Unknown map type ${mapType}`);
	}
	// eslint-disable-next-line dot-notation
	settings.map.selectMap("maps/" + cmdLineArgs['autostart']);

	if ('autostart-visibility' in cmdLineArgs)
	{
		switch (cmdLineArgs['autostart-visibility'])
		{
		case 'revealed':
			settings.mapExploration.setAllied(true);
			settings.mapExploration.setExplored(true);
			settings.mapExploration.setRevealed(true);
			break;
		case 'explored':
			settings.mapExploration.setAllied(false);
			settings.mapExploration.setExplored(true);
			settings.mapExploration.setRevealed(false);
			break;
		case 'hidden':
			settings.mapExploration.setAllied(false);
			settings.mapExploration.setExplored(false);
			settings.mapExploration.setRevealed(false);
			break;
		case 'allied':
			settings.mapExploration.setAllied(true);
			settings.mapExploration.setExplored(false);
			settings.mapExploration.setRevealed(false);
			break;
		case 'allied-explored':
			settings.mapExploration.setAllied(true);
			settings.mapExploration.setExplored(true);
			settings.mapExploration.setRevealed(false);
			break;
		default:
			warn("Unknown argument for option 'autostart-visibility': " + cmdLineArgs['autostart-visibility']);
		}
	}

	// Handle options specific to random maps
	if (mapType === "random")
	{
		settings.mapSize.setSize(+(cmdLineArgs['autostart-size'] ?? 192));
		settings.biome.setBiome(cmdLineArgs['autostart-biome'] || "random");
		settings.playerPlacement.setValue(cmdLineArgs['autostart-placement']);

		// If not specified, random maps are generated for 2 players
		if (cmdLineArgs['autostart-players'])
			settings.playerCount.setNb(+cmdLineArgs['autostart-players']);
	}

	const getPlayer = (key, i) => {
		if (!(('autostart-' + key) in cmdLineArgs))
			return undefined;
		var value = cmdLineArgs['autostart-' + key];
		if (!Array.isArray(value))
			value = [value];
		// TODO: support more than 8 players
		return value.find(x => x[0] == i)?.substring(2);
	};

	for (let i = 1; i <= settings.playerCount.nbPlayers; ++i)
	{
		const civ = getPlayer("civ", i);
		if (civ)
			settings.playerCiv.setValue(i - 1, civ);

		const team = +getPlayer("team", i);
		if (team)
			settings.playerTeam.setValue(i - 1, team - 1);

		const ai = getPlayer("ai", i);
		if (ai)
			settings.playerAI.set(i - 1, {
				"bot": ai,
				"difficulty": +(getPlayer("aidiff", i) ?? 3),
				"behavior": getPlayer("aibehavior", i) ?? "balanced",
			});
	}

	// Seeds default to random so we only need to set specific values.
	if (cmdLineArgs['autostart-seed'] != -1)
		settings.seeds.seed = +(cmdLineArgs['autostart-seed'] ?? 0);

	if (cmdLineArgs['autostart-aiseed'] != -1)
		settings.seeds.AIseed = +(cmdLineArgs['autostart-aiseed'] ?? 0);

	if (cmdLineArgs['autostart-speed'])
		settings.gameSpeed.setSpeed(+(cmdLineArgs['autostart-speed'] ?? 1));

	if (cmdLineArgs['autostart-ceasefire'])
		settings.ceasefire.setValue(+(cmdLineArgs['autostart-ceasefire'] ?? 0));

	if ('autostart-nonvisual' in cmdLineArgs && cmdLineArgs['autostart-nonvisual'] !== "false")
		settings.triggerScripts.customScripts.add("scripts/NonVisualTrigger.js");

	const victoryConditions = cmdLineArgs["autostart-victory"];
	if (Array.isArray(victoryConditions))
		settings.victoryConditions.fromList(victoryConditions);
	else if (victoryConditions === "endless")
		settings.victoryConditions.setEnabled("conquest", false);
	else if (victoryConditions)
		// Enable only the specific condition chosen
		settings.victoryConditions.fromList([victoryConditions]);

	settings.wonder.setDuration(+(cmdLineArgs['autostart-wonderduration'] ?? 10));
	settings.relic.setDuration(+(cmdLineArgs['autostart-relicduration'] ?? 10));
	settings.relic.setCount(+(cmdLineArgs['autostart-reliccount'] ?? 2));

	return settings;
}
