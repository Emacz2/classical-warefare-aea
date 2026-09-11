Engine.LoadLibrary("rmgen");
Engine.LoadLibrary("rmgen-common");
Engine.LoadLibrary("rmbiome");

export function* generateMap(mapSettings)
{
	setBiome(mapSettings.Biome);

	const tMainTerrain = g_Terrains.mainTerrain;
	const tForestFloor1 = g_Terrains.forestFloor1;
	const tForestFloor2 = g_Terrains.forestFloor2;
	const tCliff = g_Terrains.cliff;
	const tTier1Terrain = g_Terrains.tier1Terrain;
	const tTier2Terrain = g_Terrains.tier2Terrain;
	const tTier3Terrain = g_Terrains.tier3Terrain;
	const tHill = g_Terrains.hill;
	const tRoad = g_Terrains.road;
	const tRoadWild = g_Terrains.roadWild;
	const tTier4Terrain = g_Terrains.tier4Terrain;
	const tShore = g_Terrains.shore;
	const tWater = g_Terrains.water;

	const oTree1 = g_Gaia.tree1;
	const oTree2 = g_Gaia.tree2;
	const oTree3 = g_Gaia.tree3;
	const oTree4 = g_Gaia.tree4;
	const oTree5 = g_Gaia.tree5;
	const oFruitBush = g_Gaia.fruitBush;
	const oMainHuntableAnimal = g_Gaia.mainHuntableAnimal;
	const oFish = g_Gaia.fish;
	const oSecondaryHuntableAnimal = g_Gaia.secondaryHuntableAnimal;
	const oStoneLarge = g_Gaia.stoneLarge;
	const oStoneSmall = g_Gaia.stoneSmall;
	const oMetalLarge = g_Gaia.metalLarge;
	const oMetalSmall = g_Gaia.metalSmall;

	const aGrass = g_Decoratives.grass;
	const aGrassShort = g_Decoratives.grassShort;
	const aRockLarge = g_Decoratives.rockLarge;
	const aRockMedium = g_Decoratives.rockMedium;
	const aBushMedium = g_Decoratives.bushMedium;
	const aBushSmall = g_Decoratives.bushSmall;

	const pForest1 = [tForestFloor2 + TERRAIN_SEPARATOR + oTree1, tForestFloor2 + TERRAIN_SEPARATOR + oTree2, tForestFloor2];
	const pForest2 = [tForestFloor1 + TERRAIN_SEPARATOR + oTree4, tForestFloor1 + TERRAIN_SEPARATOR + oTree5, tForestFloor1];

	const heightSeaGround = -5;
	const heightLand = 3;

	globalThis.g_Map = new RandomMap(heightSeaGround, tWater);
	const mapBounds = g_Map.getBounds();

	const numPlayers = getNumPlayers();
	const mapSize = g_Map.getSize();
	const mapCenter = g_Map.getCenter();

	const clPlayer = g_Map.createTileClass();
	const clHill = g_Map.createTileClass();
	const clForest = g_Map.createTileClass();
	const clDirt = g_Map.createTileClass();
	const clRock = g_Map.createTileClass();
	const clMetal = g_Map.createTileClass();
	const clFood = g_Map.createTileClass();
	const clBaseResource = g_Map.createTileClass();
	const clLand = g_Map.createTileClass();
	const clMountain = g_Map.createTileClass();
	const clNotMountain = g_Map.createTileClass();
	const plateauPosition = fractionToTiles(0.85);

	const pattern = g_MapSettings.PlayerPlacement;
	const teams = getTeamsArray();
	let startAngle = 0;
	if ((pattern === "stronghold") || (pattern === "river"))
	{
		if (teams.length != 2)
		{
			throw new Error("Too many teams for " + pattern + ", use circle or make two teams.");
		}
		startAngle = 1.600;
	}
	if ((pattern === "circle"))
	{
		startAngle = 2.600;
	}

	const continentPosition = Vector2D.add(mapCenter, new Vector2D(0, fractionToTiles(0.10)).rotate(startAngle)).round();

	g_Map.log("Creating continent");
	createArea(
		new ClumpPlacer(diskArea(fractionToTiles(0.50)), 0.98, 0.15, Infinity, continentPosition),
		[
			new LayeredPainter([tWater, tShore, tMainTerrain], [4, 2]),
			new SmoothElevationPainter(ELEVATION_SET, heightLand, 4),
			new TileClassPainter(clLand)
		]);

	paintTerrainBasedOnHeight(3, 4, 3, tMainTerrain);
	paintTerrainBasedOnHeight(1, 3, 0, tShore);
	paintTerrainBasedOnHeight(-8, 1, 2, tWater);
	const playerAngle = (pattern == "circle") ? 2.435721 + 3.461476 / (2 ** (getNumPlayers() / 1.376771)) : startAngle;
	// equation: curve fit angle vs player number. 2.500 works for 4v4, 2.600 works for 3v3, 2.900 works for 2v2, 3.700 works for 1v1

	const teamDist = {
		"circle": 0.30,
		"river": 0.35,
		"stronghold": 0.30
	}[pattern];

	const playerDist = {
		"circle": 0.13,
		"river": 0.8,
		"stronghold": 0.11
	}[pattern];

	const { playerIDs, playerPosition } =
		playerPlacementByPattern(
			pattern,
			fractionToTiles(teamDist),
			fractionToTiles(playerDist),
			playerAngle,
			undefined);

	placePlayerBases({
		"PlayerPlacement": [playerIDs, playerPosition],
		"PlayerTileClass": clPlayer,
		"BaseResourceClass": clBaseResource,
		"CityPatch": {
			"outerTerrain": tRoadWild,
			"innerTerrain": tRoad
		},
		"StartingAnimal": {
		},
		"Berries": {
			"template": oFruitBush
		},
		"Mines": {
			"types": [
				{ "template": oMetalLarge },
				{ "template": oStoneLarge }
			]
		},
		"Trees": {
			"template": oTree1,
			"count": 2
		},
		"Decoratives": {
			"template": aGrassShort
		}
	});

	yield 30;

	for (let m = 0; m < randIntInclusive(20, 34); ++m)
	{
		const elevRand = randIntInclusive(4, 12);
		createArea(
			new ChainPlacer(
				7,
				15,
				Math.floor(scaleByMapSize(15, 20)),
				Infinity,
				new Vector2D(fractionToTiles(randFloat(0, 1)), fractionToTiles(randFloat(0, 1))),
				0,
				[Math.floor(fractionToTiles(0.01))]),
			[
				new LayeredPainter([tHill, tMainTerrain], [Math.floor(elevRand / 3), 40]),
				new SmoothElevationPainter(ELEVATION_SET, elevRand, Math.floor(elevRand / 3)),
				new TileClassPainter(clHill)
			],
			[avoidClasses(clPlayer, 16), stayClasses(clLand, 28)]);
	}

	const nonMountainPosition = Vector2D.add(mapCenter, new Vector2D(0, fractionToTiles(0.10)).rotate(startAngle).rotate(Math.PI)).round();
	createArea(
		new ClumpPlacer(diskArea(fractionToTiles(0.48)), 0.98, 0.15, Infinity, nonMountainPosition),
		[
			new TileClassPainter(clNotMountain)
		]);

	g_Map.log("Creating Plateau");
	for (let m = 0; m < randIntInclusive(120, 240); ++m)
	{
		const elevRand = randIntInclusive(18, 22);
		createArea(
			new ChainPlacer(
				24,
				28,
				Math.floor(scaleByMapSize(5, 30)),
				Infinity,
				new Vector2D(fractionToTiles(randFloat(0, 1)), fractionToTiles(randFloat(0, 1))),
				0,
				[Math.floor(fractionToTiles(0.01))]),
			[
				new LayeredPainter([tHill, tMainTerrain, tCliff], [Math.floor(elevRand / 3), 40]),
				new SmoothElevationPainter(ELEVATION_SET, elevRand, randIntInclusive(18, 30)),
				new TileClassPainter(clMountain)
			],
			[avoidClasses(clNotMountain, 2, clMountain, 3)]);
	}
	for (let m = 0; m < randIntInclusive(100, 180); ++m)
	{
		const elevRand = randIntInclusive(24, 38);
		createArea(
			new ChainPlacer(
				6,
				18,
				Math.floor(scaleByMapSize(8, 15)),
				Infinity,
				new Vector2D(fractionToTiles(randFloat(0, 1)), fractionToTiles(randFloat(0, 1))),
				0,
				[Math.floor(fractionToTiles(0.01))]),
			[
				new LayeredPainter([tCliff, tHill, tMainTerrain], [Math.floor(elevRand / 3), 40]),
				new SmoothElevationPainter(ELEVATION_SET, elevRand, randIntInclusive(30, 40)),
				new TileClassPainter(clMountain)
			],
			[avoidClasses(clBaseResource, 2), stayClasses(clMountain, 2)]);
	}

	createBumps([avoidClasses(clPlayer, 10), stayClasses(clLand, 5)]);

	const [forestTrees, stragglerTrees] = getTreeCounts(...rBiomeTreeCount(1));
	createDefaultForests(
		[tMainTerrain, tForestFloor1, tForestFloor2, pForest1, pForest2],
		[avoidClasses(clPlayer, 20, clForest, 17, clMountain, 8, clBaseResource, 2), stayClasses(clLand, 4)],
		clForest,
		forestTrees);

	yield 50;

	g_Map.log("Creating dirt patches");
	createLayeredPatches(
		[scaleByMapSize(3, 6), scaleByMapSize(5, 10), scaleByMapSize(8, 21)],
		[[tMainTerrain, tTier1Terrain], [tTier1Terrain, tTier2Terrain], [tTier2Terrain, tTier3Terrain]],
		[1, 1],
		[avoidClasses(clForest, 0, clDirt, 5, clPlayer, 12), stayClasses(clLand, 5)],
		scaleByMapSize(15, 45),
		clDirt);

	g_Map.log("Creating grass patches");
	createPatches(
		[scaleByMapSize(2, 4), scaleByMapSize(3, 7), scaleByMapSize(5, 15)],
		tTier4Terrain,
		[avoidClasses(clForest, 0, clDirt, 5, clPlayer, 12), stayClasses(clLand, 5)],
		scaleByMapSize(15, 45),
		clDirt);
	yield 55;

	g_Map.log("Creating plentiful mountain metal mines");
	createBalancedMetalMines(
		oMetalSmall,
		oMetalLarge,
		clMetal,
		[stayClasses(clMountain, 4), avoidClasses(clForest, 1, clPlayer, 4, clMetal, 6, clRock, 6)]
	);

	g_Map.log("Creating plentiful mountain stone mines");
	createBalancedStoneMines(
		oStoneSmall,
		oStoneLarge,
		clRock,
		[stayClasses(clMountain, 4), avoidClasses(clForest, 1, clPlayer, 4, clMetal, 6, clRock, 6)]
	);

	g_Map.log("Creating sparse hills stone mines");
	createBalancedStoneMines(
		oStoneSmall,
		oStoneSmall,
		clRock,
		[stayClasses(clLand, 8), avoidClasses(clForest, 1, clPlayer, 16, clMountain, 8, clRock, 10)]
	);

	g_Map.log("Creating sparse hills metal mines");
	createBalancedStoneMines(
		oMetalSmall,
		oMetalSmall,
		clMetal,
		[stayClasses(clLand, 8), avoidClasses(clForest, 1, clPlayer, 16, clMountain, 8, clMetal, 10, clRock, 10)]
	);

	yield 60;

	// create decoration
	let planetm = 1;

	if (currentBiome() == "generic/india")
		planetm = 8;

	createDecoration(
		[
			[new SimpleObject(aRockMedium, 1, 3, 0, 1)],
			[new SimpleObject(aRockLarge, 1, 2, 0, 1), new SimpleObject(aRockMedium, 1, 3, 0, 2)],
			[new SimpleObject(aGrassShort, 1, 2, 0, 1)],
			[new SimpleObject(aGrass, 2, 4, 0, 1.8), new SimpleObject(aGrassShort, 3, 6, 1.2, 2.5)],
			[new SimpleObject(aBushMedium, 1, 2, 0, 2), new SimpleObject(aBushSmall, 2, 4, 0, 2)]
		],
		[
			scaleByMapAreaAbsolute(16),
			scaleByMapAreaAbsolute(8),
			planetm * scaleByMapAreaAbsolute(13),
			planetm * scaleByMapAreaAbsolute(13),
			planetm * scaleByMapAreaAbsolute(13)
		],
		[avoidClasses(clForest, 0, clPlayer, 0), stayClasses(clLand, 5)]);

	yield 70;

	createFood(
		[
			[new SimpleObject(oMainHuntableAnimal, 5, 7, 0, 4)],
			[new SimpleObject(oSecondaryHuntableAnimal, 2, 3, 0, 2)]
		],
		[
			4 * numPlayers,
			4 * numPlayers
		],
		[avoidClasses(clForest, 0, clPlayer, 20, clFood, 20, clMountain, 4), stayClasses(clLand, 5)],
		clFood);

	createFood(
		[
			[new SimpleObject(oFruitBush, 5, 7, 0, 4)]
		],
		[
			5 * numPlayers
		],
		[avoidClasses(clForest, 0, clPlayer, 20, clFood, 10, clMountain, 2), stayClasses(clLand, 5)],
		clFood);

	createFood(
		[
			[new SimpleObject(oFish, 2, 3, 0, 2)]
		],
		[
			70 * numPlayers
		],
		avoidClasses(clLand, 2, clFood, 7),
		clFood);

	yield 85;

	createStragglerTrees(
		[oTree1, oTree2, oTree4, oTree3],
		[avoidClasses(clForest, 7, clPlayer, 9, clMetal, 6, clRock, 6), stayClasses(clLand, 7)],
		clForest,
		stragglerTrees);

	placePlayersNomad(
		clPlayer,
		[stayClasses(clLand, 4), avoidClasses(clForest, 1, clMetal, 4, clRock, 4, clFood, 2, clMountain, 8)]);

	setWaterWaviness(1.0);
	setWaterType("ocean");

	return g_Map;
}
