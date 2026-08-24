function sq(v) { return v * v; }

function analyzeWoodWorksite(trees, radius = 30) {
  const local = (trees || []).filter(t => t && t.remaining > 0 && t.dropDistance <= radius);
  const localWoodAmount = local.reduce((sum, t) => sum + t.remaining, 0);
  const availableTargets = local.filter(t => !t.saturated).length;
  const saturatedTargets = local.filter(t => t.saturated).length;
  const totalRemaining = local.reduce((sum, t) => sum + t.remaining, 0);
  const averageDropDistance = totalRemaining > 0 ?
    local.reduce((sum, t) => sum + t.dropDistance * t.remaining, 0) / totalRemaining : 0;
  return { localWoodAmount, availableTargets, saturatedTargets, averageDropDistance };
}

function chooseWoodTarget(worker, trees, options = {}) {
  const radius = options.radius || 30;
  const dropWeight = options.dropWeight || 10;
  if (worker && worker.currentTreeId !== undefined) {
    const current = (trees || []).find(t => t.id === worker.currentTreeId);
    if (current && current.remaining > 0 && current.valid !== false)
      return { action: "KEEP_CURRENT_TREE", targetId: current.id, reason: "task commitment" };
  }
  let best;
  let bestScore = Infinity;
  for (const tree of trees || []) {
    if (!tree || tree.remaining <= 0 || tree.valid === false || tree.saturated || tree.dropDistance > radius)
      continue;
    const workerDistance = Number.isFinite(tree.workerDistance) ? tree.workerDistance : 0;
    const score = sq(tree.dropDistance) * dropWeight + sq(workerDistance);
    if (score < bestScore) {
      bestScore = score;
      best = tree;
    }
  }
  if (best)
    return { action: "TAKE_LOCAL_TREE", targetId: best.id, score: bestScore, reason: "drop distance dominates one-time approach distance" };
  const metrics = analyzeWoodWorksite(trees, radius);
  if (metrics.saturatedTargets > 0)
    return { action: "WAIT_AT_WORKSITE", reason: "local trees are occupied, not exhausted", metrics };
  return { action: "REPORT_NO_LOCAL_TARGET", reason: "no currently usable local tree", metrics };
}

function updateLowWoodEvidence(previousCount, metrics, policy) {
  const low = metrics.localWoodAmount <= policy.localWoodCriticalAmount ||
    (metrics.localWoodAmount < policy.localWoodHealthyAmount && metrics.averageDropDistance > policy.targetWoodDropDistance);
  if (!low || metrics.availableTargets > 0 || metrics.saturatedTargets > 0)
    return 0;
  return Math.max(0, previousCount || 0) + 1;
}

export { analyzeWoodWorksite, chooseWoodTarget, updateLowWoodEvidence };
