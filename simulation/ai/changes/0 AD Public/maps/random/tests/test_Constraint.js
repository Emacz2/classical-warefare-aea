Engine.GetTemplate = (path) => {
	return {
		"Identity": {
			"GenericName": null,
			"Icon": null,
			"History": null
		}
	};
};

Engine.LoadLibrary("rmgen");

export function* generateMap()
{
	g_MapSettings = { "Size": 512 };
	globalThis.g_Map = new RandomMap(0, "blackness");

	yield 50;

	const tileClass = new TileClass(g_Map.getSize());

	const addedPos = new Vector2D(5, 0);
	tileClass.add(addedPos);

	const origin = new Vector2D(0, 0);

	TS_ASSERT(!(new AvoidTileClassConstraint(tileClass, 0).allows(addedPos)));
	TS_ASSERT(new AvoidTileClassConstraint(tileClass, 0).allows(origin));
	TS_ASSERT(!(new AvoidTileClassConstraint(tileClass, 5).allows(origin)));

	TS_ASSERT(new NearTileClassConstraint(tileClass, 5).allows(origin));
	TS_ASSERT(new NearTileClassConstraint(tileClass, 20).allows(origin));
	TS_ASSERT(!(new NearTileClassConstraint(tileClass, 4).allows(origin)));
}
