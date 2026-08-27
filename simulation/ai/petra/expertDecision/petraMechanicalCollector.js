function squareDistance(a, b) {
  const dx = a[0] - b[0];
  const dz = a[1] - b[1];
  return dx * dx + dz * dz;
}

function distance(a, b) {
  return Math.sqrt(squareDistance(a, b));
}

function toEntities(collection) {
  if (!collection)
    return [];
  if (typeof collection.toEntityArray === "function")
    return collection.toEntityArray();
  if (typeof collection.values === "function")
    return Array.from(collection.values());
  if (Array.isArray(collection))
    return [...collection];
  throw new Error("Unsupported Petra entity collection shape");
}

function requireFunction(value, label) {
  if (typeof value !== "function")
    throw new Error(`${label} is required by the mechanical collector`);
  return value;
}

function entityPosition(ent) {
  if (!ent || typeof ent.position !== "function")
    return undefined;
  const pos = ent.position();
  return Array.isArray(pos) && pos.length >= 2 && pos.every(Number.isFinite) ? [pos[0], pos[1]] : undefined;
}

function resourceAmount(ent) {
  if (!ent || typeof ent.resourceSupplyAmount !== "function")
    return 0;
  const value = Number(ent.resourceSupplyAmount());
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function resourceGeneric(ent) {
  if (!ent || typeof ent.resourceSupplyType !== "function")
    return undefined;
  const type = ent.resourceSupplyType();
  return type && type.generic;
}

function hasClass(ent, name) {
  if (!ent)
    return false;
  if (typeof ent.hasClass === "function")
    return !!ent.hasClass(name);
  if (typeof ent.hasClasses === "function")
    return !!ent.hasClasses([name]);
  return false;
}

function ownerAt(context, position) {
  const map = context.territoryMap || context.HQ && context.HQ.territoryMap;
  if (!map || typeof map.getOwner !== "function")
    throw new Error("territoryMap.getOwner(position) is required by the mechanical collector");
  return map.getOwner(position);
}

function allowedWoodTerritory(gameState, owner, playerId, context = {}) {
  // Expert opening civilians stay inside their own territory. Neutral/allied wood is
  // an explicit opt-in only; the live opening controller does not enable it.
  if (owner === playerId)
    return true;
  if (owner === 0 && context.allowNeutralWood === true)
    return true;
  return !!(context.allowAlliedWood === true && gameState &&
    typeof gameState.isPlayerMutualAlly === "function" && gameState.isPlayerMutualAlly(owner));
}

function collectFoodCandidates(gameState, context) {
  if (!gameState || typeof gameState.getResourceSupplies !== "function")
    throw new Error("gameState.getResourceSupplies(resource) is required by the mechanical collector");
  const getLandAccess = requireFunction(context.getLandAccess, "context.getLandAccess(gameState, ent)");
  const accessIndex = Number(context.accessIndex);
  const playerId = Number.isFinite(context.playerId) ? context.playerId : 1;
  const candidates = [];

  for (const ent of toEntities(gameState.getResourceSupplies("food"))) {
    const pos = entityPosition(ent);
    if (!pos || resourceAmount(ent) <= 0 || resourceGeneric(ent) !== "food")
      continue;
    if (hasClass(ent, "Animal") || hasClass(ent, "Field"))
      continue;
    if (Number.isFinite(accessIndex) && getLandAccess(gameState, ent) !== accessIndex)
      continue;
    if (ownerAt(context, pos) !== playerId)
      continue;
    candidates.push(ent);
  }
  return candidates;
}

function selectConnectedCluster(candidates, anchorPosition, linkDistance = 24) {
  if (!Array.isArray(anchorPosition) || anchorPosition.length !== 2 || !anchorPosition.every(Number.isFinite))
    throw new Error("anchorPosition [x,z] is required for primary-food collection");
  if (!candidates.length)
    return [];

  const ordered = [...candidates].sort((a, b) => {
    const da = squareDistance(entityPosition(a), anchorPosition);
    const db = squareDistance(entityPosition(b), anchorPosition);
    return da - db || a.id() - b.id();
  });
  const byId = new Map(ordered.map(ent => [ent.id(), ent]));
  const selected = new Set([ordered[0].id()]);
  const linkSq = linkDistance * linkDistance;
  let changed = true;
  while (changed) {
    changed = false;
    for (const ent of ordered) {
      if (selected.has(ent.id()))
        continue;
      const pos = entityPosition(ent);
      for (const id of selected) {
        const other = byId.get(id);
        if (other && squareDistance(pos, entityPosition(other)) <= linkSq) {
          selected.add(ent.id());
          changed = true;
          break;
        }
      }
    }
  }
  return ordered.filter(ent => selected.has(ent.id()));
}

function summarizeFoodCluster(entities, anchorPosition = undefined) {
  const ids = [];
  let remaining = 0, x = 0, z = 0, positioned = 0;
  for (const ent of entities || []) {
    const amount = resourceAmount(ent);
    const pos = entityPosition(ent);
    if (!pos || amount <= 0)
      continue;
    ids.push(ent.id());
    remaining += amount;
    x += pos[0];
    z += pos[1];
    ++positioned;
  }
  const center = positioned ? [x / positioned, z / positioned] : undefined;
  return {
    ids,
    remaining,
    initialAmount: remaining,
    center,
    anchorDistance: center && anchorPosition ? distance(center, anchorPosition) : 0
  };
}

function collectFoodClusters(gameState, context) {
  const candidates = collectFoodCandidates(gameState, context);
  const linkDistance = Number.isFinite(context.linkDistance) ? context.linkDistance : 24;
  const linkSq = linkDistance * linkDistance;
  const unvisited = new Map(candidates.map(ent => [ent.id(), ent]));
  const clusters = [];

  while (unvisited.size) {
    const first = unvisited.values().next().value;
    const queue = [first];
    const component = [];
    unvisited.delete(first.id());
    while (queue.length) {
      const ent = queue.pop();
      component.push(ent);
      const pos = entityPosition(ent);
      for (const [id, other] of Array.from(unvisited.entries())) {
        if (squareDistance(pos, entityPosition(other)) > linkSq)
          continue;
        unvisited.delete(id);
        queue.push(other);
      }
    }
    const summary = summarizeFoodCluster(component, context.anchorPosition);
    if (summary.ids.length)
      clusters.push(summary);
  }

  clusters.sort((a, b) => a.anchorDistance - b.anchorDistance || b.remaining - a.remaining || a.ids[0] - b.ids[0]);
  return clusters;
}

class PrimaryFoodClusterTracker {
  constructor(seed = {}) {
    this.ids = Array.isArray(seed.ids) ? [...seed.ids] : [];
    this.initialAmount = Number(seed.initialAmount) || 0;
    this.captured = this.ids.length > 0 && this.initialAmount > 0;
  }

  capture(gameState, context) {
    const candidates = collectFoodCandidates(gameState, context);
    const selected = selectConnectedCluster(candidates, context.anchorPosition, context.linkDistance || 24);
    this.ids = selected.map(ent => ent.id());
    this.initialAmount = selected.reduce((sum, ent) => sum + resourceAmount(ent), 0);
    this.captured = this.ids.length > 0 && this.initialAmount > 0;
    return this.observe(gameState);
  }

  retarget(cluster) {
    const ids = cluster && Array.isArray(cluster.ids) ? cluster.ids.filter(Number.isFinite) : [];
    const amount = Number(cluster && (cluster.remaining ?? cluster.initialAmount));
    this.ids = [...ids];
    this.initialAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    this.captured = this.ids.length > 0 && this.initialAmount > 0;
    return this.captured;
  }

  observe(gameState, context = undefined) {
    if (!this.captured) {
      if (!context)
        return { ids: [], initialAmount: 0, remaining: 0, ratio: 0, center: undefined };
      return this.capture(gameState, context);
    }

    let remaining = 0;
    let x = 0;
    let z = 0;
    let positioned = 0;
    for (const id of this.ids) {
      const ent = gameState.getEntityById(id);
      if (!ent)
        continue;
      remaining += resourceAmount(ent);
      const pos = entityPosition(ent);
      if (pos) {
        x += pos[0];
        z += pos[1];
        ++positioned;
      }
    }
    return {
      ids: [...this.ids],
      initialAmount: this.initialAmount,
      remaining,
      ratio: this.initialAmount > 0 ? remaining / this.initialAmount : 0,
      center: positioned ? [x / positioned, z / positioned] : undefined
    };
  }
}

function collectInitialWoodCandidates(gameState, context) {
  if (!gameState || typeof gameState.getResourceSupplies !== "function")
    throw new Error("gameState.getResourceSupplies(resource) is required by the mechanical collector");
  const getLandAccess = requireFunction(context.getLandAccess, "context.getLandAccess(gameState, ent)");
  const isSupplyFull = requireFunction(context.isSupplyFull, "context.isSupplyFull(gameState, ent)");
  const anchorPosition = Array.isArray(context.anchorPosition) ? context.anchorPosition : undefined;
  if (!anchorPosition || anchorPosition.length < 2 || !anchorPosition.every(Number.isFinite))
    throw new Error("anchorPosition [x,z] is required for initial woodsite collection");
  const accessIndex = Number(context.accessIndex);
  const playerId = Number.isFinite(context.playerId) ? context.playerId : 1;
  const searchRadius = Number.isFinite(context.searchRadius) ? context.searchRadius : 90;
  const searchSq = searchRadius * searchRadius;
  const trees = [];

  for (const ent of toEntities(gameState.getResourceSupplies("wood"))) {
    const pos = entityPosition(ent);
    const remaining = resourceAmount(ent);
    if (!pos || remaining <= 0 || resourceGeneric(ent) !== "wood")
      continue;
    if (Number.isFinite(accessIndex) && getLandAccess(gameState, ent) !== accessIndex)
      continue;
    if (!allowedWoodTerritory(gameState, ownerAt(context, pos), playerId, context))
      continue;
    const anchorSq = squareDistance(pos, anchorPosition);
    if (anchorSq > searchSq)
      continue;
    trees.push({
      id: ent.id(),
      remaining,
      saturated: !!isSupplyFull(gameState, ent),
      position: pos,
      anchorDistance: Math.sqrt(anchorSq)
    });
  }
  trees.sort((a, b) => a.anchorDistance - b.anchorDistance || a.id - b.id);
  return trees;
}

function collectWoodTrees(gameState, context) {
  if (!gameState || typeof gameState.getResourceSupplies !== "function")
    throw new Error("gameState.getResourceSupplies(resource) is required by the mechanical collector");
  const getLandAccess = requireFunction(context.getLandAccess, "context.getLandAccess(gameState, ent)");
  const isSupplyFull = requireFunction(context.isSupplyFull, "context.isSupplyFull(gameState, ent)");
  const worksitePosition = Array.isArray(context.worksitePosition) ? context.worksitePosition :
    entityPosition(context.worksite);
  if (!worksitePosition)
    throw new Error("worksite/worksitePosition is required for woodsite collection");
  const accessIndex = Number(context.accessIndex);
  const playerId = Number.isFinite(context.playerId) ? context.playerId : 1;
  const radius = Number.isFinite(context.radius) ? context.radius : 30;
  const radiusSq = radius * radius;
  const trees = [];

  for (const ent of toEntities(gameState.getResourceSupplies("wood"))) {
    const pos = entityPosition(ent);
    const remaining = resourceAmount(ent);
    if (!pos || remaining <= 0 || resourceGeneric(ent) !== "wood")
      continue;
    if (Number.isFinite(accessIndex) && getLandAccess(gameState, ent) !== accessIndex)
      continue;
    if (!allowedWoodTerritory(gameState, ownerAt(context, pos), playerId, context))
      continue;
    const dropSq = squareDistance(pos, worksitePosition);
    if (dropSq > radiusSq)
      continue;
    trees.push({
      id: ent.id(),
      remaining,
      dropDistance: Math.sqrt(dropSq),
      saturated: !!isSupplyFull(gameState, ent),
      position: pos
    });
  }

  trees.sort((a, b) => a.dropDistance - b.dropDistance || a.id - b.id);
  return trees;
}

function summarizeWoodTrees(trees) {
  const localWoodAmount = trees.reduce((sum, tree) => sum + tree.remaining, 0);
  const availableTargets = trees.filter(tree => !tree.saturated).length;
  const saturatedTargets = trees.filter(tree => tree.saturated).length;
  const averageDropDistance = localWoodAmount > 0 ?
    trees.reduce((sum, tree) => sum + tree.dropDistance * tree.remaining, 0) / localWoodAmount : 0;
  return { localWoodAmount, availableTargets, saturatedTargets, averageDropDistance };
}

function collectWoodWorksite(gameState, context) {
  const trees = collectWoodTrees(gameState, context);
  return { trees, ...summarizeWoodTrees(trees) };
}

function collectWorkerMetrics(gameState, options = {}) {
  if (!gameState || typeof gameState.getOwnUnits !== "function")
    throw new Error("gameState.getOwnUnits() is required by the mechanical collector");
  const playerId = Number.isFinite(options.playerId) ? options.playerId : 1;
  const jobKey = options.jobKey || "expertDecisionJob";
  const taskKey = options.taskKey || "expertDecisionTaskId";
  const out = { food: 0, farm: 0, wood: 0, stone: 0, metal: 0, builders: 0, idle: 0, civilians: 0, woodCivilians: 0, foodOwnedCivilians: 0, overflowWood: 0 };
  for (const ent of toEntities(gameState.getOwnUnits())) {
    if (!ent || typeof ent.getMetadata !== "function")
      continue;
    const civilian = typeof ent.hasClass === "function" && ent.hasClass("Civilian") && !ent.hasClass("CitizenSoldier") && !ent.hasClass("Cavalry");
    if (civilian)
      ++out.civilians;
    const job = ent.getMetadata(playerId, jobKey);
    const gatherType = ent.getMetadata(playerId, "gather-type");
    if (job === "food") {
      ++out.food;
      if (gatherType === "wood") ++out.overflowWood;
    }
    else if (job === "farm") {
      ++out.farm;
      if (gatherType === "wood") ++out.overflowWood;
      if (civilian) ++out.foodOwnedCivilians;
    }
    else if (job === "food_owned") {
      ++out.food;
      if (gatherType === "wood") ++out.overflowWood;
      if (civilian) ++out.foodOwnedCivilians;
    }
    else if (job === "food_overflow_wood") {
      // Backward-compatible save metadata from IT5. New assignments use food_owned.
      ++out.wood;
      ++out.overflowWood;
      if (civilian) ++out.foodOwnedCivilians;
    }
    else if (job === "wood" || job === "citizenSoldierWood") {
      ++out.wood;
      if (civilian && job === "wood") ++out.woodCivilians;
    }
    else if (job === "stone")
      ++out.stone;
    else if (job === "metal")
      ++out.metal;
    if (ent.getMetadata(playerId, taskKey) !== undefined)
      ++out.builders;
    if (typeof ent.isIdle === "function" && ent.isIdle())
      ++out.idle;
  }
  return out;
}

function makeDecisionContext(gameState, state, options) {
  if (!state || !state.foodTracker)
    throw new Error("state.foodTracker is required");
  const food = state.foodTracker.observe(gameState, options.foodCapture);
  const woodsite = collectWoodWorksite(gameState, options.woodsite);
  const workers = collectWorkerMetrics(gameState, options.workers);
  const targetFoodWorkers = Number(options.targetFoodWorkers);
  return {
    filters: options.filters,
    food: {
      primaryRatio: food.ratio,
      primaryRemaining: food.remaining,
      targetFoodWorkers: Number.isFinite(targetFoodWorkers) ? targetFoodWorkers : workers.food + workers.farm,
      naturalFoodWorkers: workers.food,
      farmWorkers: workers.farm
    },
    woodsite: {
      ...summarizeWoodTrees(woodsite.trees),
      lowWoodObservations: 0,
      alternativeExistingWorksite: !!options.alternativeExistingWorksite
    },
    workers,
    collector: { primaryFoodIds: food.ids, woodTreeIds: woodsite.trees.map(tree => tree.id) }
  };
}

export {
  squareDistance,
  distance,
  toEntities,
  entityPosition,
  resourceAmount,
  collectFoodCandidates,
  selectConnectedCluster,
  summarizeFoodCluster,
  collectFoodClusters,
  PrimaryFoodClusterTracker,
  collectInitialWoodCandidates,
  collectWoodTrees,
  summarizeWoodTrees,
  collectWoodWorksite,
  collectWorkerMetrics,
  makeDecisionContext
};
