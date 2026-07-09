import * as difficulty from "simulation/ai/petra/difficultyLevel.js";
import { SquareVectorDistance } from "simulation/ai/common-api/utils.js";

/**
 * ExpertFoodClusterManager v0.3.7
 *
 * Owns natural-food clusters so Expert finishes the local berries/apples before
 * walking to a farther source.  Petra normally chooses individual supplies; Expert
 * chooses a cluster and keeps civilians there until that cluster is exhausted.
 */
export function ExpertFoodClusterManager(HQ, constants)
{
	this.HQ = HQ;
	this.Constants = constants;
	this.clusterRadius = 18;
	this.serveRadius = 16;
}

ExpertFoodClusterManager.prototype.isActive = function(gameState)
{
	return this.HQ.Config.difficulty >= difficulty.EXPERT &&
		this.HQ.isExpertOpeningPhaseActive &&
		this.HQ.isExpertOpeningPhaseActive(gameState);
};

ExpertFoodClusterManager.prototype.update = function(gameState)
{
	if (!this.isActive(gameState))
		return;
	this.clusters = this.buildClusters(gameState);
};

ExpertFoodClusterManager.prototype.buildClusters = function(gameState)
{
	const clusters = [];
	const radiusSq = this.clusterRadius * this.clusterRadius;
	const supplies = gameState.getResourceSupplies("food");
	if (!supplies || !supplies.length)
		return clusters;

	for (const supply of supplies.values())
	{
		if (!supply || !supply.position() || supply.hasClasses(["Animal", "Field"]))
			continue;
		if (this.HQ.territoryMap.getOwner(supply.position()) != PlayerID)
			continue;
		const type = supply.resourceSupplyType();
		if (!type || type.generic != "food")
			continue;

		let cluster;
		for (const c of clusters)
			if (SquareVectorDistance(c.center, supply.position()) <= radiusSq)
			{
				cluster = c;
				break;
			}
		if (!cluster)
		{
			cluster = { "center": supply.position().slice(), "supplies": [], "amount": 0, "max": 0 };
			clusters.push(cluster);
		}
		cluster.supplies.push(supply);
		cluster.amount += supply.resourceSupplyAmount ? Math.max(0, supply.resourceSupplyAmount()) : 0;
		cluster.max += supply.resourceSupplyMax ? Math.max(0, supply.resourceSupplyMax()) : 0;
	}
	return clusters;
};

ExpertFoodClusterManager.prototype.getClusters = function(gameState)
{
	if (!this.clusters)
		this.clusters = this.buildClusters(gameState);
	return this.clusters;
};

ExpertFoodClusterManager.prototype.findClusterForSupply = function(gameState, supply)
{
	if (!supply || !supply.position())
		return undefined;
	for (const cluster of this.getClusters(gameState))
		for (const s of cluster.supplies)
			if (s.id && supply.id && s.id() == supply.id())
				return cluster;
	return undefined;
};

ExpertFoodClusterManager.prototype.findBestSupplyInCluster = function(gameState, cluster, ent)
{
	if (!cluster)
		return undefined;
	let best;
	let bestDist = Math.min();
	const pos = ent && ent.position ? ent.position() : cluster.center;
	for (const supply of cluster.supplies)
	{
		if (!supply.position() || supply.resourceSupplyAmount && supply.resourceSupplyAmount() <= 0)
			continue;
		if (this.HQ.expertFoodManager)
		{
			const cap = this.HQ.expertFoodManager.getNaturalFoodClusterLimit(supply);
			if (this.HQ.expertFoodManager.countClusterWorkers(gameState, supply, 14) >= cap)
				continue;
		}
		const dist = pos ? SquareVectorDistance(pos, supply.position()) : 0;
		if (dist > bestDist)
			continue;
		best = supply;
		bestDist = dist;
	}
	return best;
};

ExpertFoodClusterManager.prototype.findBestServedClusterSupply = function(gameState, base, ent)
{
	const currentSupplyId = ent && ent.getMetadata ?
		(ent.getMetadata(PlayerID, "expertFoodLockedSupply") || ent.getMetadata(PlayerID, "supply")) : undefined;
	const currentSupply = currentSupplyId ? gameState.getEntityById(currentSupplyId) : undefined;
	const currentCluster = currentSupply ? this.findClusterForSupply(gameState, currentSupply) : undefined;
	const local = this.findBestSupplyInCluster(gameState, currentCluster, ent);
	if (local)
		return local;

	let best;
	let bestDist = Math.min();
	const reference = ent && ent.position ? ent.position() :
		(this.HQ.expertOpeningFoodPos || base.anchor.position());
	for (const cluster of this.getClusters(gameState))
	{
		if (!cluster.amount || cluster.amount <= 0)
			continue;
		const nearestDropsite = this.HQ.getNearestExpertFoodDropsiteDistance(gameState, base, cluster.center);
		const nearOpeningPatch = this.HQ.expertOpeningFoodPos &&
			SquareVectorDistance(this.HQ.expertOpeningFoodPos, cluster.center) <= 26 * 26;
		if (!nearOpeningPatch && (nearestDropsite === undefined || nearestDropsite > this.serveRadius * this.serveRadius))
			continue;
		const supply = this.findBestSupplyInCluster(gameState, cluster, ent);
		if (!supply)
			continue;
		const dist = reference ? SquareVectorDistance(reference, supply.position()) : 0;
		if (dist > bestDist)
			continue;
		best = supply;
		bestDist = dist;
	}
	return best;
};

ExpertFoodClusterManager.prototype.totalOwnedNaturalFood = function(gameState)
{
	let total = 0;
	for (const cluster of this.getClusters(gameState))
		total += cluster.amount || 0;
	return total;
};
