import { addAnimals, addBerries, addBluffs, addDecoration, addForests, addHills, addLakes, addMetal,
	addMountains, addLayeredPatches, addPlateaus, addStone, addStragglerTrees, addValleys } from
	"maps/random/rmgen2/gaia.js";
import { addElements, allAmounts, allMixes, allSizes, createBases, playerbaseTypes, initTileClasses } from
	"maps/random/rmgen2/setup.js";

Engine.LoadLibrary("rmgen");
Engine.LoadLibrary("rmgen-common");
Engine.LoadLibrary("rmbiome");

export function* generateMap(mapSettings)
{
	setBiome(mapSettings.Biome);

	// Random elevation with a bias towards lower elevations
	let randElevation = randIntInclusive(0, 29);
	if (randElevation < 25)
		randElevation = randIntInclusive(1, 4);

	globalThis.g_Map = new RandomMap(randElevation, g_Terrains.mainTerrain);

	initTileClasses();
	createArea(
		new MapBoundsPlacer(),
		new TileClassPainter(g_TileClasses.land));

	yield 20;

	if (!mapSettings.Nomad)
	{
		createBases(
			playerPlacementByPattern(
				mapSettings.PlayerPlacement,
				fractionToTiles(randFloat(0.2, 0.35)),
				fractionToTiles(randFloat(0.08, 0.1)),
				randomAngle(),
				undefined),
			playerbaseTypes[mapSettings.PlayerPlacement].walls);
	}
	yield 40;

	const features = [
		{
			"func": addBluffs,
			"baseHeight": randElevation,
			"avoid": [
				g_TileClasses.bluff, 20,
				g_TileClasses.hill, 10,
				g_TileClasses.mountain, 20,
				g_TileClasses.plateau, 15,
				g_TileClasses.player, 30,
				g_TileClasses.valley, 5,
				g_TileClasses.water, 7
			],
			"sizes": allSizes,
			"mixes": allMixes,
			"amounts": allAmounts
		},
		{
			"func": addHills,
			"avoid": [
				g_TileClasses.bluff, 5,
				g_TileClasses.hill, 15,
				g_TileClasses.mountain, 2,
				g_TileClasses.plateau, 15,
				g_TileClasses.player, 20,
				g_TileClasses.valley, 2,
				g_TileClasses.water, 2
			],
			"sizes": allSizes,
			"mixes": allMixes,
			"amounts": allAmounts
		},
		{
			"func": addMountains,
			"avoid": [
				g_TileClasses.bluff, 20,
				g_TileClasses.mountain, 25,
				g_TileClasses.plateau, 15,
				g_TileClasses.player, 20,
				g_TileClasses.valley, 10,
				g_TileClasses.water, 15
			],
			"sizes": allSizes,
			"mixes": allMixes,
			"amounts": allAmounts
		},
		{
			"func": addPlateaus,
			"avoid": [
				g_TileClasses.bluff, 20,
				g_TileClasses.mountain, 25,
				g_TileClasses.plateau, 25,
				g_TileClasses.plateau, 25,
				g_TileClasses.player, 40,
				g_TileClasses.valley, 10,
				g_TileClasses.water, 15
			],
			"sizes": allSizes,
			"mixes": allMixes,
			"amounts": allAmounts
		}
	];

	if (randElevation < 4)
		features.push({
			"func": addLakes,
			"avoid": [
				g_TileClasses.bluff, 7,
				g_TileClasses.hill, 2,
				g_TileClasses.mountain, 15,
				g_TileClasses.plateau, 10,
				g_TileClasses.player, 20,
				g_TileClasses.valley, 10,
				g_TileClasses.water, 25
			],
			"sizes": ["small"],
			"mixes": allMixes,
			"amounts": allAmounts
		});

	if (randElevation > 20)
		features.push({
			"func": addValleys,
			"baseHeight": randElevation,
			"avoid": [
				g_TileClasses.bluff, 5,
				g_TileClasses.hill, 5,
				g_TileClasses.mountain, 25,
				g_TileClasses.plateau, 20,
				g_TileClasses.player, 40,
				g_TileClasses.valley, 15,
				g_TileClasses.water, 10
			],
			"sizes": allSizes,
			"mixes": allMixes,
			"amounts": allAmounts
		});

	addElements(shuffleArray(features));
	yield 50;

	addElements([
		{
			"func": addLayeredPatches,
			"avoid": [
				g_TileClasses.bluff, 2,
				g_TileClasses.dirt, 5,
				g_TileClasses.forest, 2,
				g_TileClasses.mountain, 2,
				g_TileClasses.plateau, 2,
				g_TileClasses.player, 12,
				g_TileClasses.water, 3
			],
			"sizes": ["normal"],
			"mixes": ["normal"],
			"amounts": ["normal"]
		},
		{
			"func": addDecoration,
			"avoid": [
				g_TileClasses.bluff, 2,
				g_TileClasses.forest, 2,
				g_TileClasses.mountain, 2,
				g_TileClasses.plateau, 2,
				g_TileClasses.player, 12,
				g_TileClasses.water, 3
			],
			"sizes": ["normal"],
			"mixes": ["normal"],
			"amounts": ["normal"]
		}
	]);
	yield 60;

	addElements(shuffleArray([
		{
			"func": addMetal,
			"avoid": [
				g_TileClasses.berries, 5,
				g_TileClasses.bluff, 5,
				g_TileClasses.forest, 3,
				g_TileClasses.mountain, 2,
				g_TileClasses.plateau, 2,
				g_TileClasses.player, 30,
				g_TileClasses.rock, 10,
				g_TileClasses.metal, 20,
				g_TileClasses.water, 3
			],
			"sizes": ["normal"],
			"mixes": ["same"],
			"amounts": allAmounts
		},
		{
			"func": addStone,
			"avoid": [
				g_TileClasses.berries, 5,
				g_TileClasses.bluff, 5,
				g_TileClasses.forest, 3,
				g_TileClasses.mountain, 2,
				g_TileClasses.plateau, 2,
				g_TileClasses.player, 30,
				g_TileClasses.rock, 20,
				g_TileClasses.metal, 10,
				g_TileClasses.water, 3
			],
			"sizes": ["normal"],
			"mixes": ["same"],
			"amounts": allAmounts
		},
		{
			"func": addForests,
			"avoid": [
				g_TileClasses.berries, 5,
				g_TileClasses.bluff, 5,
				g_TileClasses.forest, 18,
				g_TileClasses.metal, 3,
				g_TileClasses.mountain, 5,
				g_TileClasses.plateau, 5,
				g_TileClasses.player, 20,
				g_TileClasses.rock, 3,
				g_TileClasses.water, 2
			],
			"sizes": allSizes,
			"mixes": allMixes,
			"amounts": ["few", "normal", "many", "tons"]
		}
	]));
	yield 70;

	addElements(shuffleArray([
		{
			"func": addBerries,
			"avoid": [
				g_TileClasses.berries, 30,
				g_TileClasses.bluff, 5,
				g_TileClasses.forest, 5,
				g_TileClasses.metal, 10,
				g_TileClasses.mountain, 2,
				g_TileClasses.plateau, 2,
				g_TileClasses.player, 20,
				g_TileClasses.rock, 10,
				g_TileClasses.water, 3
			],
			"sizes": allSizes,
			"mixes": allMixes,
			"amounts": allAmounts
		},
		{
			"func": addAnimals,
			"avoid": [
				g_TileClasses.animals, 20,
				g_TileClasses.bluff, 5,
				g_TileClasses.forest, 2,
				g_TileClasses.metal, 2,
				g_TileClasses.mountain, 1,
				g_TileClasses.plateau, 2,
				g_TileClasses.player, 20,
				g_TileClasses.rock, 2,
				g_TileClasses.water, 3
			],
			"sizes": allSizes,
			"mixes": allMixes,
			"amounts": allAmounts
		},
		{
			"func": addStragglerTrees,
			"avoid": [
				g_TileClasses.berries, 5,
				g_TileClasses.bluff, 5,
				g_TileClasses.forest, 7,
				g_TileClasses.metal, 2,
				g_TileClasses.mountain, 1,
				g_TileClasses.plateau, 2,
				g_TileClasses.player, 12,
				g_TileClasses.rock, 2,
				g_TileClasses.water, 5
			],
			"sizes": allSizes,
			"mixes": allMixes,
			"amounts": allAmounts
		}
	]));
	yield 90;

	placePlayersNomad(
		g_TileClasses.player,
		avoidClasses(
			g_TileClasses.bluff, 4,
			g_TileClasses.water, 4,
			g_TileClasses.forest, 1,
			g_TileClasses.metal, 4,
			g_TileClasses.rock, 4,
			g_TileClasses.mountain, 4,
			g_TileClasses.plateau, 4,
			g_TileClasses.animals, 2));

	return g_Map;
}
