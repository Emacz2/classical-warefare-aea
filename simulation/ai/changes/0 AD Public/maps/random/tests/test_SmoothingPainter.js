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

	const min = new Vector2D(5, 5);
	const center = new Vector2D(6, 6);
	const max = new Vector2D(7, 7);

	const minHeight = 20;
	const maxHeight = 25;

	yield 50;

	// Test SmoothingPainter
	{
		globalThis.g_Map = new RandomMap(0, "blackness");

		const centerHeight = g_Map.getHeight(center);

		createArea(
			new RectPlacer(min, max),
			[
				new RandomElevationPainter(minHeight, maxHeight),
				new SmoothingPainter(2, 1, 1)
			]);

		TS_ASSERT_GREATER_EQUAL(g_Map.getHeight(center), centerHeight);
		TS_ASSERT_LESS_EQUAL(g_Map.getHeight(center), minHeight);
	}
}
