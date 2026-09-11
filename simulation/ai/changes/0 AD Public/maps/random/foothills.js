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

	const oTree1 = g_Gaia.tree1;
	const oTree2 = g_Gaia.tree2;
	const oTree3 = g_Gaia.tree3;
	const oTree4 = g_Gaia.tree4;
	const oTree5 = g_Gaia.tree5;
	const oFruitBush = g_Gaia.fruitBush;
	const oMainHuntableAnimal = g_Gaia.mainHuntableAnimal;
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

	const pForest1 = [
		tForestFloor2 + TERRAIN_SEPARATOR + oTree1,
		tForestFloor2 + TERRAIN_SEPARATOR + oTree2,
		tForestFloor2
	];
	const pForest2 = [
		tForestFloor1 + TERRAIN_SEPARATOR + oTree4,
		tForestFloor1 + TERRAIN_SEPARATOR + oTree5,
		tForestFloor1
	];

	const heightLand = 3;

	globalThis.g_Map = new RandomMap(heightLand, tMainTerrain);

	const numPlayers = getNumPlayers();

	const clPlayer = g_Map.createTileClass();
	const clHill = g_Map.createTileClass();
	const clForest = g_Map.createTileClass();
	const clDirt = g_Map.createTileClass();
	const clRock = g_Map.createTileClass();
	const clMetal = g_Map.createTileClass();
	const clFood = g_Map.createTileClass();
	const clBaseResource = g_Map.createTileClass();

	const pattern = mapSettings.PlayerPlacement;

	const teamDist = {
		"circle": randFloat(0.33, 0.42),
		"river": 0.47,
		"stronghold": 0.33
	}[pattern];

	const { playerIDs, playerPosition } =
		playerPlacementByPattern(
			pattern,
			fractionToTiles(teamDist),
			fractionToTiles(0.1),
			randomAngle(),
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
			"count": 5
		}
		// No decoratives
	});
	yield 20;


	for (let m = 0; m < randIntInclusive(40, 90); ++m)
	{
		const elevRand = randIntInclusive(6, 12);
		createArea(
			new ChainPlacer(
				12,
				28,
				Math.floor(scaleByMapSize(5, 30)),
				Infinity,
				new Vector2D(fractionToTiles(randFloat(0, 1)), fractionToTiles(randFloat(0, 1))),
				0,
				[Math.floor(fractionToTiles(0.01))]),
			[
				new LayeredPainter([tHill, tMainTerrain, tCliff], [Math.floor(elevRand / 5), 40]),
				new SmoothElevationPainter(ELEVATION_SET, elevRand, randIntInclusive(18, 35)),
				new TileClassPainter(clHill)
			],
			[avoidClasses(clPlayer, 34, clHill, 8)]);
	}
	for (let m = 0; m < randIntInclusive(60, 100); ++m)
	{
		const elevRand = randIntInclusive(14, 36);
		createArea(
			new ChainPlacer(
				10,
				20,
				Math.floor(scaleByMapSize(8, 15)),
				Infinity,
				new Vector2D(fractionToTiles(randFloat(0, 1)), fractionToTiles(randFloat(0, 1))),
				0,
				[Math.floor(fractionToTiles(0.01))]),
			[
				new LayeredPainter([tCliff, tHill, tMainTerrain], [Math.floor(elevRand / 8), 40]),
				new SmoothElevationPainter(ELEVATION_SET, elevRand, randIntInclusive(18, 25)),
				new TileClassPainter(clHill)
			],
			[avoidClasses(clBaseResource, 2, clPlayer, 30), stayClasses(clHill, 1)]);
	}

	const [forestTrees, stragglerTrees] = getTreeCounts(...rBiomeTreeCount(1));
	createDefaultForests(
		[tMainTerrain, tForestFloor1, tForestFloor2, pForest1, pForest2],
		avoidClasses(clPlayer, 20, clForest, 18),
		clForest,
		forestTrees);

	yield 50;

	g_Map.log("Creating dirt patches");
	createLayeredPatches(
		[scaleByMapSize(3, 6), scaleByMapSize(5, 10), scaleByMapSize(8, 21)],
		[[tMainTerrain, tTier1Terrain], [tTier1Terrain, tTier2Terrain], [tTier2Terrain, tTier3Terrain]],
		[1, 1],
		avoidClasses(clForest, 0, clDirt, 5, clPlayer, 12),
		scaleByMapSize(15, 45),
		clDirt);

	g_Map.log("Creating grass patches");
	createPatches(
		[scaleByMapSize(2, 4), scaleByMapSize(3, 7), scaleByMapSize(5, 15)],
		tTier4Terrain,
		avoidClasses(clForest, 0, clDirt, 5, clPlayer, 12),
		scaleByMapSize(15, 45),
		clDirt);
	yield 55;

	g_Map.log("Creating metal mines");
	createBalancedMetalMines(
		oMetalSmall,
		oMetalLarge,
		clMetal,
		avoidClasses(clForest, 1, clPlayer, scaleByMapSize(20, 35))
	);

	g_Map.log("Creating stone mines");
	createBalancedStoneMines(
		oStoneSmall,
		oStoneLarge,
		clRock,
		avoidClasses(clForest, 1, clPlayer, scaleByMapSize(20, 35), clMetal, 10)
	);

	yield 65;

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
		avoidClasses(clForest, 0, clPlayer, 10));

	yield 70;

	createFood(
		[
			[new SimpleObject(oMainHuntableAnimal, 5, 7, 0, 4)],
			[new SimpleObject(oSecondaryHuntableAnimal, 2, 3, 0, 2)]
		],
		[
			3 * numPlayers,
			3 * numPlayers
		],
		avoidClasses(clForest, 0, clPlayer, 20, clMetal, 4, clRock, 4, clFood, 20),
		clFood);

	yield 75;

	createFood(
		[
			[new SimpleObject(oFruitBush, 5, 7, 0, 4)]
		],
		[
			3 * numPlayers
		],
		avoidClasses(clForest, 0, clPlayer, 20, clMetal, 4, clRock, 4, clFood, 10),
		clFood);

	yield 85;

	createStragglerTrees(
		[oTree1, oTree2, oTree4, oTree3],
		avoidClasses(clForest, 8, clPlayer, 12, clMetal, 6, clRock, 6, clFood, 1),
		clForest,
		stragglerTrees);

	placePlayersNomad(clPlayer, avoidClasses(clForest, 1, clMetal, 4, clRock, 4, clFood, 2));

	return g_Map;
}
