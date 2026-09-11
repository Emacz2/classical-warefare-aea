export function aiWarn(output)
{
	if (typeof output === "string")
		warn("PlayerID " + PlayerID + " |   " + output);
	else
		warn("PlayerID " + PlayerID + " |   " + uneval(output));
}

/**
 * Useful for simulating consecutive AI matches.
 */
export function exit(exitStatus)
{
	Engine.Exit(exitStatus);
}

export function VectorDistance(a, b)
{
	return Math.euclidDistance2D(a[0], a[1], b[0], b[1]);
}

export function SquareVectorDistance(a, b)
{
	return Math.euclidDistance2DSquared(a[0], a[1], b[0], b[1]);
}

/** Utility functions for conversions of maps of different sizes */

/**
 * Returns the index of map2 with max content from indices contained inside the cell i of map1
 * map1.cellSize must be a multiple of map2.cellSize
 */
function getMaxMapIndex(i, map1, map2)
{
	const ratio = map1.cellSize / map2.cellSize;
	const ix = (i % map1.width) * ratio;
	const iy = Math.floor(i / map1.width) * ratio;
	let index;
	for (let kx = 0; kx < ratio; ++kx)
		for (let ky = 0; ky < ratio; ++ky)
			if (!index || map2.map[ix+kx+(iy+ky)*map2.width] > map2.map[index])
				index = ix+kx+(iy+ky)*map2.width;
	return index;
}

/**
 * Returns the list of indices of map2 contained inside the cell i of map1
 * map1.cellSize must be a multiple of map2.cellSize
 */
export function getMapIndices(i, map1, map2)
{
	const ratio = map1.cellSize / map2.cellSize;	// TODO check that this is integer >= 1 ?
	const ix = (i % map1.width) * ratio;
	const iy = Math.floor(i / map1.width) * ratio;
	const ret = [];
	for (let kx = 0; kx < ratio; ++kx)
		for (let ky = 0; ky < ratio; ++ky)
			ret.push(ix+kx+(iy+ky)*map2.width);
	return ret;
}

/**
 * Returns the list of points of map2 contained inside the cell i of map1
 * map1.cellSize must be a multiple of map2.cellSize
 */
function getMapPoints(i, map1, map2)
{
	const ratio = map1.cellSize / map2.cellSize;	// TODO check that this is integer >= 1 ?
	const ix = (i % map1.width) * ratio;
	const iy = Math.floor(i / map1.width) * ratio;
	const ret = [];
	for (let kx = 0; kx < ratio; ++kx)
		for (let ky = 0; ky < ratio; ++ky)
			ret.push([ix+kx, iy+ky]);
	return ret;
}
