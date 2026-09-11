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

	const min = new Vector2D(4, 4);
	const max = new Vector2D(10, 10);

	const center = Vector2D.average([min, max]);

	createArea(
		new RectPlacer(min, max),
		new LayeredPainter(["red", "blue"], [2]));

	TS_ASSERT_EQUALS(g_Map.getTexture(min), "red");
	TS_ASSERT_EQUALS(g_Map.getTexture(max), "red");
	TS_ASSERT_EQUALS(g_Map.getTexture(new Vector2D(-1, -1).add(max)), "red");
	TS_ASSERT_EQUALS(g_Map.getTexture(new Vector2D(-2, -2).add(max)), "blue");
	TS_ASSERT_EQUALS(g_Map.getTexture(new Vector2D(-3, -3).add(max)), "blue");
	TS_ASSERT_EQUALS(g_Map.getTexture(center), "blue");
}
