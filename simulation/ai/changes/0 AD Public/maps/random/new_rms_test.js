Engine.LoadLibrary("rmgen");
Engine.LoadLibrary("rmgen-common");

export function* generateMap()
{
	globalThis.g_Map = new RandomMap(0, "grass1_spring");

	yield 50;

	placePlayerBases({
		"PlayerPlacement": playerPlacementCircle(fractionToTiles(0.39))
	});

	placePlayersNomad(g_Map.createTileClass());

	return g_Map;
}
