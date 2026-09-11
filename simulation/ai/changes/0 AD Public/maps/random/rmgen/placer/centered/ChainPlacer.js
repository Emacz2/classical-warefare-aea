/**
 * Generates a more random clump of points. It randomly creates circles around the edges of the current clump.s
 *
 * @param {number} minRadius - minimum radius of the circles.
 * @param {number} maxRadius - maximum radius of the circles.
 * @param {number} numCircles - number of circles.
 * @param {number} [failFraction] - Percentage of place attempts allowed to fail.
 * @param {Vector2D} [centerPosition]
 * @param {number} [maxDistance] - Farthest distance from the center.
 * @param {number[]} [queue] - When given, uses these radiuses for the first circles.
 */
function ChainPlacer(minRadius, maxRadius, numCircles, failFraction = 0, centerPosition = undefined, maxDistance = 0, queue = [])
{
	this.minRadius = minRadius;
	this.maxRadius = maxRadius;
	this.numCircles = numCircles;
	this.failFraction = failFraction;
	this.maxDistance = maxDistance;
	this.queue = queue.map(radius => Math.floor(radius));
	this.centerPosition = undefined;

	if (centerPosition)
		this.setCenterPosition(centerPosition);
}

ChainPlacer.prototype.setCenterPosition = function(position)
{
	this.centerPosition = deepfreeze(position.clone().round());
};

ChainPlacer.prototype.place = function(constraint)
{
	// Preliminary bounds check
	if (!g_Map.inMapBounds(this.centerPosition) || !constraint.allows(this.centerPosition))
		return undefined;

	const points = [];
	let size = g_Map.getSize();
	let failed = 0;
	let count = 0;

	// Initialization as 0, 1 means 'inside the circle', otherwise stores the offset into Edges + 2
	const gotRet = new Uint16Array(size * size);
	const at = (x, y) => x + y * size;
	--size;

	this.minRadius = Math.min(this.maxRadius, Math.max(this.minRadius, 1));

	const edges = [this.centerPosition];

	for (let i = 0; i < this.numCircles; ++i)
	{
		const chainPos = pickRandom(edges);
		const radius = this.queue.length ? this.queue.pop() : randIntInclusive(this.minRadius, this.maxRadius);
		const radius2 = Math.square(radius);

		const bbox = getPointsInBoundingBox(getBoundingBox([
			new Vector2D(Math.max(0, chainPos.x - radius), Math.max(0, chainPos.y - radius)),
			new Vector2D(Math.min(chainPos.x + radius, size), Math.min(chainPos.y + radius, size))
		]));

		for (const position of bbox)
		{
			if (position.distanceToSquared(chainPos) >= radius2)
				continue;

			++count;

			if (!g_Map.inMapBounds(position) || !constraint.allows(position))
			{
				++failed;
				continue;
			}

			const state = gotRet[at(position.x, position.y)];
			if (state == 0)
			{
				points.push(position);
				gotRet[at(position.x, position.y)] = 1;
			}
			else if (state >= 2)
			{
				edges.splice(state - 2, 1);
				gotRet[at(position.x, position.y)] = 1;

				for (let k = state - 2; k < edges.length; ++k)
					--gotRet[at(edges[k].x, edges[k].y)];
			}
		}

		for (const pos of bbox)
		{
			if (this.maxDistance &&
			    (Math.abs(this.centerPosition.x - pos.x) > this.maxDistance ||
			     Math.abs(this.centerPosition.y - pos.y) > this.maxDistance))
				continue;

			if (gotRet[at(pos.x, pos.y)] != 1)
				continue;

			if (pos.x > 0 && gotRet[at(pos.x - 1, pos.y)] == 0 ||
			    pos.y > 0 && gotRet[at(pos.x, pos.y - 1)] == 0 ||
			    pos.x < size && gotRet[at(pos.x + 1, pos.y)] == 0 ||
			    pos.y < size && gotRet[at(pos.x, pos.y + 1)] == 0)
			{
				edges.push(pos);
				gotRet[at(pos.x, pos.y)] = edges.length + 1;
			}
		}
	}

	return failed > count * this.failFraction ? undefined : points;
};
