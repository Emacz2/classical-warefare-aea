function uniqueFiniteIds(ids = []) {
  return [...new Set((ids || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}

function encodeFoodSite(ids = []) {
  return uniqueFiniteIds(ids).join(",");
}

function decodeFoodSite(value) {
  if (Array.isArray(value))
    return uniqueFiniteIds(value);
  if (typeof value === "number")
    return Number.isFinite(value) ? [value] : [];
  if (typeof value !== "string" || !value.trim())
    return [];
  return uniqueFiniteIds(value.split(","));
}

function overlapCount(clusterIds = [], siteIds = []) {
  if (!clusterIds.length || !siteIds.length)
    return 0;
  const site = new Set(siteIds);
  let count = 0;
  for (const id of clusterIds)
    if (site.has(id))
      ++count;
  return count;
}

function matchingFoodCluster(clusters = [], siteIds = []) {
  let best;
  let bestOverlap = 0;
  for (const cluster of clusters) {
    const overlap = overlapCount(cluster.ids || [], siteIds);
    if (overlap > bestOverlap) {
      best = cluster;
      bestOverlap = overlap;
    }
  }
  return best;
}

function effectiveGatherRate(rawRate, carryCapacity, oneWayDistance, walkSpeed) {
  rawRate = Number(rawRate);
  carryCapacity = Number(carryCapacity);
  oneWayDistance = Number(oneWayDistance);
  walkSpeed = Number(walkSpeed);
  if (!(rawRate > 0))
    return 0;
  if (!(carryCapacity > 0))
    carryCapacity = 10;
  if (!(walkSpeed > 0))
    walkSpeed = 1;
  if (!(oneWayDistance >= 0))
    oneWayDistance = 0;
  const gatherSeconds = carryCapacity / rawRate;
  const travelSeconds = 2 * oneWayDistance / walkSpeed;
  return carryCapacity / Math.max(0.001, gatherSeconds + travelSeconds);
}

function naturalRunwaySeconds(remainingNaturalFood, naturalConsumptionRate) {
  const remaining = Math.max(0, Number(remainingNaturalFood) || 0);
  const rate = Math.max(0, Number(naturalConsumptionRate) || 0);
  if (!(rate > 0))
    return remaining > 0 ? Infinity : 0;
  return remaining / rate;
}

function shouldSwitchFoodSite({ currentCluster, currentHasCapacity, currentRemaining, bestCluster, lastSwitchTime, now, minimumCommitSeconds = 20 }) {
  if (currentCluster && currentRemaining > 0 && currentHasCapacity)
    return false;
  if (!bestCluster)
    return false;
  if (currentCluster && bestCluster === currentCluster)
    return false;

  // Hysteresis prevents A->B->A churn, but it must NEVER create an idle worker.
  // If the committed cluster has no available gathering slot, switching to another
  // productive cluster is immediately allowed. The previous-site filter in the
  // controller still prevents an instant reversal.
  if (currentCluster && currentRemaining > 0 && !currentHasCapacity)
    return true;

  if (currentCluster && currentRemaining > 0 && now - lastSwitchTime < minimumCommitSeconds)
    return false;
  return true;
}

export {
  uniqueFiniteIds,
  encodeFoodSite,
  decodeFoodSite,
  overlapCount,
  matchingFoodCluster,
  effectiveGatherRate,
  naturalRunwaySeconds,
  shouldSwitchFoodSite
};
