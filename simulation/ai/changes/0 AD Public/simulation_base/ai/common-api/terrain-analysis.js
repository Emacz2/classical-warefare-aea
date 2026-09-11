import { InfoMap } from "simulation/ai/common-api/map-module.js";
import { copyPrototype } from "simulation/ai/common-api/shared.js";

/**
 * TerrainAnalysis, inheriting from the Map Component.
 *
 * This creates a suitable passability map.
 * This is part of the Shared Script, and thus should only be used for things that are non-player specific.
 * This.map is a map of the world, where particular stuffs are pointed with a value
 * For example, impassable land is 0, water is 200, areas near tree (ie forest grounds) are 41…
 * This is intended for use with 8 bit maps for reduced memory usage.
 * Upgraded from QuantumState's original TerrainAnalysis for qBot.
 */
export function TerrainAnalysis()
{
}

copyPrototype(TerrainAnalysis, InfoMap);

TerrainAnalysis.prototype.IMPASSABLE = 0;
/**
* non-passable by land units
*/
TerrainAnalysis.prototype.DEEP_WATER = 200;
/**
* passable by land units and water units
*/
TerrainAnalysis.prototype.SHALLOW_WATER = 201;
/**
* passable by land units
*/
TerrainAnalysis.prototype.LAND = 255;

TerrainAnalysis.prototype.init = function(sharedScript, rawState)
{
	const passabilityMap = rawState.passabilityMap;
	this.width = passabilityMap.width;
	this.height = passabilityMap.height;
	this.cellSize = passabilityMap.cellSize;

	const obstructionMaskLand = rawState.passabilityClasses["default-terrain-only"];
	const obstructionMaskWater = rawState.passabilityClasses["ship-terrain-only"];

	const obstructionTiles = new Uint8Array(passabilityMap.data.length);


	for (let i = 0; i < passabilityMap.data.length; ++i)
	{
		obstructionTiles[i] = (passabilityMap.data[i] & obstructionMaskLand) ? this.IMPASSABLE : this.LAND;

		if (!(passabilityMap.data[i] & obstructionMaskWater) && obstructionTiles[i] === this.IMPASSABLE)
			obstructionTiles[i] = this.DEEP_WATER;
		else if (!(passabilityMap.data[i] & obstructionMaskWater) && obstructionTiles[i] === this.LAND)
			obstructionTiles[i] = this.SHALLOW_WATER;
	}

	this.InfoMap(rawState, "passability", obstructionTiles);
};

/**
 * Accessibility inherits from TerrainAnalysis
 *
 * This can easily and efficiently determine if any two points are connected.
 * it can also determine if any point is "probably" reachable, assuming the unit can get close enough
 * for optimizations it's called after the TerrainAnalyser has finished initializing his map
 * so this can use the land regions already.
 */
export function Accessibility()
{
}

copyPrototype(Accessibility, TerrainAnalysis);

Accessibility.prototype.init = function(rawState, terrainAnalyser)
{
	this.InfoMap(rawState, "passability", terrainAnalyser.map);
	this.landPassMap = new Uint16Array(terrainAnalyser.length);
	this.navalPassMap = new Uint16Array(terrainAnalyser.length);

	this.maxRegions = 65535;
	this.regionSize = [];
	this.regionType = []; // "inaccessible", "land" or "water";
	// ID of the region associated with an array of region IDs.
	this.regionLinks = [];

	// initialized to 0, it's more optimized to start at 1 (I'm checking that if it's not 0, then it's already aprt of a region, don't touch);
	// However I actually store all unpassable as region 1 (because if I don't, on some maps the toal nb of region is over 256, and it crashes as the mapis 8bit.)
	// So start at 2.
	this.regionID = 2;

	for (let i = 0; i < this.landPassMap.length; ++i)
	{
		if (this.map[i] !== this.IMPASSABLE)
		{	// any non-painted, non-inacessible area.
			if (this.landPassMap[i] == 0 && this.floodFill(i, this.regionID, false))
				this.regionType[this.regionID++] = "land";
			if (this.navalPassMap[i] == 0 && this.floodFill(i, this.regionID, true))
				this.regionType[this.regionID++] = "water";
		}
		else if (this.landPassMap[i] == 0)
		{	// any non-painted, inacessible area.
			this.floodFill(i, 1, false);
			this.floodFill(i, 1, true);
		}
	}

	// calculating region links. Regions only touching diagonaly are not linked.
	// since we're checking all of them, we'll check from the top left to the bottom right
	const w = this.width;
	for (let x = 0; x < this.width-1; ++x)
	{
		for (let y = 0; y < this.height-1; ++y)
		{
			// checking right.
			const thisLID = this.landPassMap[x+y*w];
			const thisNID = this.navalPassMap[x+y*w];
			const rightLID = this.landPassMap[x+1+y*w];
			const rightNID = this.navalPassMap[x+1+y*w];
			const bottomLID = this.landPassMap[x+y*w+w];
			const bottomNID = this.navalPassMap[x+y*w+w];
			if (thisLID > 1)
			{
				if (rightNID > 1)
					if (this.regionLinks[thisLID].indexOf(rightNID) === -1)
						this.regionLinks[thisLID].push(rightNID);
				if (bottomNID > 1)
					if (this.regionLinks[thisLID].indexOf(bottomNID) === -1)
						this.regionLinks[thisLID].push(bottomNID);
			}
			if (thisNID > 1)
			{
				if (rightLID > 1)
					if (this.regionLinks[thisNID].indexOf(rightLID) === -1)
						this.regionLinks[thisNID].push(rightLID);
				if (bottomLID > 1)
					if (this.regionLinks[thisNID].indexOf(bottomLID) === -1)
						this.regionLinks[thisNID].push(bottomLID);
				if (thisLID > 1)
					if (this.regionLinks[thisNID].indexOf(thisLID) === -1)
						this.regionLinks[thisNID].push(thisLID);
			}
		}
	}

	// Engine.DumpImage("LandPassMap.png", this.landPassMap, this.width, this.height, 255);
	// Engine.DumpImage("NavalPassMap.png", this.navalPassMap, this.width, this.height, 255);
};

Accessibility.prototype.getAccessValue = function(position, onWater)
{
	const gamePos = this.gamePosToMapPos(position);
	if (onWater)
		return this.navalPassMap[gamePos[0] + this.width*gamePos[1]];
	let ret = this.landPassMap[gamePos[0] + this.width*gamePos[1]];
	if (ret === 1)
	{
		// quick spiral search.
		const indx = [ [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1]];
		for (const i of indx)
		{
			const id0 = gamePos[0] + i[0];
			const id1 = gamePos[1] + i[1];
			if (id0 < 0 || id0 >= this.width || id1 < 0 || id1 >= this.width)
				continue;
			ret = this.landPassMap[id0 + this.width*id1];
			if (ret !== 1)
				return ret;
		}
	}
	return ret;
};

Accessibility.prototype.getTrajectTo = function(start, end)
{
	const pstart = this.gamePosToMapPos(start);
	const istart = pstart[0] + pstart[1]*this.width;
	const pend = this.gamePosToMapPos(end);
	const iend = pend[0] + pend[1]*this.width;

	let onLand = true;
	if (this.landPassMap[istart] <= 1 && this.navalPassMap[istart] > 1)
		onLand = false;
	if (this.landPassMap[istart] <= 1 && this.navalPassMap[istart] <= 1)
		return false;

	let endRegion = this.landPassMap[iend];
	if (endRegion <= 1 && this.navalPassMap[iend] > 1)
		endRegion = this.navalPassMap[iend];
	else if (endRegion <= 1)
		return false;

	const startRegion = onLand ? this.landPassMap[istart] : this.navalPassMap[istart];
	return this.getTrajectToIndex(startRegion, endRegion);
};

/**
 * Return a "path" of accessibility indexes from one point to another, including the start and the end indexes
 * this can tell you what sea zone you need to have a dock on, for example.
 * assumes a land unit unless start point is over deep water.
 */
Accessibility.prototype.getTrajectToIndex = function(istart, iend)
{
	if (istart === iend)
		return [istart];

	const trajects = new Set();
	const explored = new Set();
	trajects.add([istart]);
	explored.add(istart);
	while (trajects.size)
	{
		for (const traj of trajects)
		{
			const ilast = traj[traj.length-1];
			for (const inew of this.regionLinks[ilast])
			{
				if (inew === iend)
					return traj.concat(iend);
				if (explored.has(inew))
					continue;
				trajects.add(traj.concat(inew));
				explored.add(inew);
			}
			trajects.delete(traj);
		}
	}
	return undefined;
};

Accessibility.prototype.getRegionSize = function(position, onWater)
{
	const pos = this.gamePosToMapPos(position);
	const index = pos[0] + pos[1]*this.width;
	const ID = onWater === true ? this.navalPassMap[index] : this.landPassMap[index];
	if (this.regionSize[ID] === undefined)
		return 0;
	return this.regionSize[ID];
};

Accessibility.prototype.getRegionSizei = function(index, onWater)
{
	if (this.regionSize[this.landPassMap[index]] === undefined && (!onWater || this.regionSize[this.navalPassMap[index]] === undefined))
		return 0;
	if (onWater && this.regionSize[this.navalPassMap[index]] > this.regionSize[this.landPassMap[index]])
		return this.regionSize[this.navalPassMap[index]];
	return this.regionSize[this.landPassMap[index]];
};

/** Implementation of a fast flood fill. Reasonably good performances for JS. */
Accessibility.prototype.floodFill = function(startIndex, value, onWater)
{
	if (value > this.maxRegions)
	{
		error("AI accessibility map: too many regions.");
		this.landPassMap[startIndex] = 1;
		this.navalPassMap[startIndex] = 1;
		return false;
	}

	if (!onWater && this.landPassMap[startIndex] != 0 || onWater && this.navalPassMap[startIndex] != 0)
		return false;	// already painted.

	let floodFor = "land";
	if (this.map[startIndex] === this.IMPASSABLE)
	{
		this.landPassMap[startIndex] = 1;
		this.navalPassMap[startIndex] = 1;
		return false;
	}

	if (onWater === true)
	{
		if (this.map[startIndex] !== this.DEEP_WATER && this.map[startIndex] !== this.SHALLOW_WATER)
		{
			this.navalPassMap[startIndex] = 1;	// impassable for naval
			return false;	// do nothing
		}
		floodFor = "water";
	}
	else if (this.map[startIndex] === this.DEEP_WATER)
	{
		this.landPassMap[startIndex] = 1;	// impassable for land
		return false;
	}

	// here we'll be able to start.
	for (let i = this.regionSize.length; i <= value; ++i)
	{
		this.regionLinks.push([]);
		this.regionSize.push(0);
		this.regionType.push("inaccessible");
	}
	const w = this.width;
	const h = this.height;

	// Get x and y from index
	const IndexArray = [startIndex];
	let newIndex;
	while (IndexArray.length)
	{
		newIndex = IndexArray.pop();

		let y = 0;
		// vertical iteration
		while (true)
		{
			--y;
			const index = newIndex + w*y;
			if (index < 0)
				break;
			if (floodFor === "land" && this.landPassMap[index] === 0 && this.map[index] !== this.IMPASSABLE && this.map[index] !== this.DEEP_WATER)
				continue;
			if (floodFor === "water" && this.navalPassMap[index] === 0 && (this.map[index] === this.DEEP_WATER || this.map[index] === this.SHALLOW_WATER))
				continue;
			break;
		} // should actually break
		++y;
		let reachLeft = false;
		let reachRight = false;
		let index;
		do
		{
			index = newIndex + w*y;

			if (floodFor === "land" && this.landPassMap[index] === 0 && this.map[index] !== this.IMPASSABLE && this.map[index] !== this.DEEP_WATER)
			{
				this.landPassMap[index] = value;
				this.regionSize[value]++;
			}
			else if (floodFor === "water" && this.navalPassMap[index] === 0 && (this.map[index] === this.DEEP_WATER || this.map[index] === this.SHALLOW_WATER))
			{
				this.navalPassMap[index] = value;
				this.regionSize[value]++;
			}
			else
				break;

			if (index%w > 0)
			{
				if (floodFor === "land" && this.landPassMap[index -1] === 0 && this.map[index -1] !== this.IMPASSABLE && this.map[index -1] !== this.DEEP_WATER)
				{
					if (!reachLeft)
					{
						IndexArray.push(index -1);
						reachLeft = true;
					}
				}
				else if (floodFor === "water" && this.navalPassMap[index -1] === 0 && (this.map[index -1] === this.DEEP_WATER || this.map[index -1] === this.SHALLOW_WATER))
				{
					if (!reachLeft)
					{
						IndexArray.push(index -1);
						reachLeft = true;
					}
				}
				else if (reachLeft)
					reachLeft = false;
			}

			if (index%w < w - 1)
			{
				if (floodFor === "land" && this.landPassMap[index +1] === 0 && this.map[index +1] !== this.IMPASSABLE && this.map[index +1] !== this.DEEP_WATER)
				{
					if (!reachRight)
					{
						IndexArray.push(index +1);
						reachRight = true;
					}
				}
				else if (floodFor === "water" && this.navalPassMap[index +1] === 0 && (this.map[index +1] === this.DEEP_WATER || this.map[index +1] === this.SHALLOW_WATER))
				{
					if (!reachRight)
					{
						IndexArray.push(index +1);
						reachRight = true;
					}
				}
				else if (reachRight)
					reachRight = false;
			}
			++y;
		} while (index/w < h-1);	// should actually break
	}
	return true;
};
