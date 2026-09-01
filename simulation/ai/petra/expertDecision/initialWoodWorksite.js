function squareDistance(a, b) {
  const dx = a[0] - b[0];
  const dz = a[1] - b[1];
  return dx * dx + dz * dz;
}

function requirePosition(value, label) {
  if (!Array.isArray(value) || value.length < 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1]))
    throw new Error(`${label} must be an explicit [x,z] position`);
  return [value[0], value[1]];
}

function usableTrees(trees = []) {
  return trees.filter(tree => tree && Number(tree.remaining) > 0 && Array.isArray(tree.position) && tree.position.length >= 2 &&
    Number.isFinite(tree.position[0]) && Number.isFinite(tree.position[1]) && tree.valid !== false);
}

function weightedCenter(trees) {
  const total = trees.reduce((sum, tree) => sum + Number(tree.remaining || 0), 0);
  if (total <= 0)
    return undefined;
  return [
    trees.reduce((sum, tree) => sum + tree.position[0] * Number(tree.remaining || 0), 0) / total,
    trees.reduce((sum, tree) => sum + tree.position[1] * Number(tree.remaining || 0), 0) / total
  ];
}

function summarizeAt(center, trees, radius) {
  const r2 = radius * radius;
  const local = trees.filter(tree => squareDistance(center, tree.position) <= r2);
  const localWoodAmount = local.reduce((sum, tree) => sum + Number(tree.remaining || 0), 0);
  const availableTargets = local.filter(tree => !tree.saturated).length;
  const saturatedTargets = local.filter(tree => tree.saturated).length;
  const averageDropDistance = localWoodAmount > 0 ? local.reduce((sum, tree) =>
    sum + Math.sqrt(squareDistance(center, tree.position)) * Number(tree.remaining || 0), 0) / localWoodAmount : 0;
  return { local, localWoodAmount, availableTargets, saturatedTargets, averageDropDistance };
}

function selectInitialWoodWorksite(trees, anchorPosition, options = {}) {
  const anchor = requirePosition(anchorPosition, "initial woodsite anchorPosition");
  const candidates = usableTrees(trees);
  if (!candidates.length)
    return { action: "NO_INITIAL_WOODSITE", reason: "no legal wood candidates" };

  const radius = Number.isFinite(options.radius) ? options.radius : 30;
  const approachWeight = Number.isFinite(options.approachWeight) ? options.approachWeight : 1.5;
  const dropWeight = Number.isFinite(options.dropWeight) ? options.dropWeight : 8;
  const treeCountWeight = Number.isFinite(options.treeCountWeight) ? options.treeCountWeight : 12;
  const seen = new Set();
  const scored = [];

  for (const seed of candidates) {
    const neighborhood = candidates.filter(tree => squareDistance(seed.position, tree.position) <= radius * radius);
    const center = weightedCenter(neighborhood);
    if (!center)
      continue;
    const key = `${Math.round(center[0] * 10)},${Math.round(center[1] * 10)}`;
    if (seen.has(key))
      continue;
    seen.add(key);

    const summary = summarizeAt(center, candidates, radius);
    const approachDistance = Math.sqrt(squareDistance(center, anchor));
    // Remaining wood is the dominant signal. Average drop-off distance and one-time
    // opening walk are penalties. Saturated trees still count as healthy wood; they
    // are temporarily occupied, not absent.
    const score = summary.localWoodAmount + summary.local.length * treeCountWeight -
      summary.averageDropDistance * dropWeight - approachDistance * approachWeight;
    scored.push({
      position: center,
      treeIds: summary.local.map(tree => tree.id),
      localWoodAmount: summary.localWoodAmount,
      availableTargets: summary.availableTargets,
      saturatedTargets: summary.saturatedTargets,
      averageDropDistance: summary.averageDropDistance,
      approachDistance,
      score
    });
  }

  scored.sort((a, b) => b.score - a.score || b.localWoodAmount - a.localWoodAmount || a.approachDistance - b.approachDistance ||
    a.position[0] - b.position[0] || a.position[1] - b.position[1]);
  if (!scored.length)
    return { action: "NO_INITIAL_WOODSITE", reason: "wood candidates could not form a worksite" };
  return { action: "SELECT_INITIAL_WOODSITE", ...scored[0], ranked: scored };
}

function initialStorehousePlacementCandidates(selection, options = {}) {
  if (!selection || selection.action !== "SELECT_INITIAL_WOODSITE")
    throw new Error("initialStorehousePlacementCandidates requires a selected initial woodsite");
  const center = requirePosition(selection.position, "initial woodsite position");
  const distances = Array.isArray(options.distances) ? options.distances : [0, 4, 6, 8, 10, 12];
  const angleCount = Number.isFinite(options.angleCount) ? Math.max(4, Math.floor(options.angleCount)) : 16;
  const out = [];
  const seen = new Set();
  for (const distance of distances) {
    if (!Number.isFinite(distance) || distance < 0)
      continue;
    if (distance === 0) {
      out.push([...center]);
      continue;
    }
    for (let i = 0; i < angleCount; ++i) {
      const angle = 2 * Math.PI * i / angleCount;
      const candidate = [center[0] + Math.cos(angle) * distance, center[1] + Math.sin(angle) * distance];
      const key = `${candidate[0].toFixed(4)},${candidate[1].toFixed(4)}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(candidate);
      }
    }
  }
  return out;
}

function makeInitialStorehousePlacementRequest(selection, templateRadius, options = {}) {
  if (!Number.isFinite(Number(templateRadius)) || Number(templateRadius) <= 0)
    throw new Error("makeInitialStorehousePlacementRequest requires templateRadius > 0");
  return {
    kind: "storehouse",
    templateRadius: Number(templateRadius),
    candidates: initialStorehousePlacementCandidates(selection, options),
    worksiteAnchor: [...selection.position],
    selectedTreeIds: [...selection.treeIds]
  };
}

export {
  selectInitialWoodWorksite,
  initialStorehousePlacementCandidates,
  makeInitialStorehousePlacementRequest
};
