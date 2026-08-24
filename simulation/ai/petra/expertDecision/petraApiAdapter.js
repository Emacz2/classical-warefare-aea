const BUILDING_SPECS = Object.freeze({
  house: {
    className: "House",
    template: "structures/{civ}/house",
    queue: "house",
    allowedBuilderJobs: ["wood", "citizenSoldierWood"]
  },
  storehouse: {
    className: "Storehouse",
    template: "structures/{civ}/storehouse",
    queue: "dropsites",
    allowedBuilderJobs: ["wood", "citizenSoldierWood"]
  },
  farmstead: {
    className: "Farmstead",
    template: "structures/{civ}/farmstead",
    queue: "dropsites",
    allowedBuilderJobs: ["food", "farm"]
  },
  field: {
    className: "Field",
    template: "structures/{civ}/field",
    queue: "field",
    allowedBuilderJobs: ["food", "farm"]
  },
  barracks: {
    className: "Barracks",
    template: "structures/{civ}/barracks",
    queue: "militaryBuilding",
    allowedBuilderJobs: ["wood", "citizenSoldierWood"]
  }
});

function requireMethod(object, name, label) {
  if (!object || typeof object[name] !== "function")
    throw new Error(`${label}.${name} is required by the Petra adapter`);
  return object[name].bind(object);
}

function finite(value, label) {
  if (!Number.isFinite(value))
    throw new Error(`${label} must be a finite number`);
  return value;
}

function cloneResources(resources = {}) {
  return {
    food: Number(resources.food || 0),
    wood: Number(resources.wood || 0),
    stone: Number(resources.stone || 0),
    metal: Number(resources.metal || 0)
  };
}

function collectionLength(collection) {
  if (!collection)
    return 0;
  if (Number.isFinite(collection.length))
    return collection.length;
  if (typeof collection.toEntityArray === "function")
    return collection.toEntityArray().length;
  if (typeof collection.values === "function")
    return Array.from(collection.values()).length;
  throw new Error("Unsupported Petra entity collection shape");
}

function countByClass(collection, className, byClass) {
  if (!collection)
    return 0;
  if (typeof collection.filter !== "function")
    throw new Error("Petra entity collection.filter is required");
  return collectionLength(collection.filter(byClass(className)));
}

function resolvedTemplate(gameState, kind) {
  const spec = BUILDING_SPECS[kind];
  if (!spec)
    throw new Error(`Unknown building kind: ${kind}`);
  return gameState.applyCiv(spec.template);
}

function countQueued(gameState, kind) {
  const spec = BUILDING_SPECS[kind];
  const queues = gameState && gameState.ai && gameState.ai.queues;
  const queue = queues && queues[spec.queue];
  if (!queue || !Array.isArray(queue.plans))
    return 0;
  const type = resolvedTemplate(gameState, kind);
  return queue.plans.reduce((count, plan) => count + (plan && plan.type === type ? 1 : 0), 0);
}

function countPendingCivilianTraining(gameState, context = {}) {
  if (context.training && Number.isFinite(Number(context.training.pendingCivilians))) {
    return {
      pendingCivilians: Math.max(0, Number(context.training.pendingCivilians)),
      pendingBatches: Number.isFinite(Number(context.training.pendingBatches)) ? Math.max(0, Number(context.training.pendingBatches)) : (Number(context.training.pendingCivilians) > 0 ? 1 : 0)
    };
  }
  const queue = gameState && gameState.ai && gameState.ai.queues && gameState.ai.queues.villager;
  if (!queue || !Array.isArray(queue.plans))
    return { pendingCivilians: 0, pendingBatches: 0 };
  let pendingCivilians = 0;
  let pendingBatches = 0;
  for (const plan of queue.plans) {
    if (!plan)
      continue;
    const metadata = plan.metadata || {};
    const marked = metadata.expertDecisionTraining === "civilian" || metadata.expertDecisionCivilian === true;
    const templateMatch = context.civilianTemplate && plan.type === gameState.applyCiv(context.civilianTemplate);
    if (!marked && !templateMatch)
      continue;
    const number = Number(plan.number ?? plan.count ?? 0);
    if (Number.isFinite(number) && number > 0)
      pendingCivilians += number;
    ++pendingBatches;
  }
  return { pendingCivilians, pendingBatches };
}

function templateCost(gameState, kind) {
  const template = gameState.getTemplate(resolvedTemplate(gameState, kind));
  if (!template || typeof template.cost !== "function")
    throw new Error(`Missing template/cost() for ${kind}`);
  return cloneResources(template.cost());
}

function observePetra(gameState, context = {}) {
  const getPopulation = requireMethod(gameState, "getPopulation", "gameState");
  const getPopulationLimit = requireMethod(gameState, "getPopulationLimit", "gameState");
  const getResources = requireMethod(gameState, "getResources", "gameState");
  const getOwnStructures = requireMethod(gameState, "getOwnStructures", "gameState");
  const getOwnFoundations = requireMethod(gameState, "getOwnFoundations", "gameState");
  requireMethod(gameState, "applyCiv", "gameState");
  requireMethod(gameState, "getTemplate", "gameState");

  if (!context.filters || typeof context.filters.byClass !== "function")
    throw new Error("context.filters.byClass is required; the adapter does not invent Petra filters");
  if (!context.food)
    throw new Error("context.food aggregate metrics are required");
  if (!context.woodsite)
    throw new Error("context.woodsite aggregate metrics are required");
  if (!context.workers)
    throw new Error("context.workers aggregate metrics are required");

  const HQ = context.HQ || gameState.ai && gameState.ai.HQ;
  const used = finite(getPopulation(), "population.used");
  const limit = finite(getPopulationLimit(), "population.limit");
  let queuedPopulation = Number(context.queuedPopulation);
  if (!Number.isFinite(queuedPopulation)) {
    if (!HQ || typeof HQ.getAccountedPopulation !== "function")
      throw new Error("queued population requires context.queuedPopulation or HQ.getAccountedPopulation(gameState)");
    queuedPopulation = Math.max(0, HQ.getAccountedPopulation(gameState) - used);
  }

  const structuresCollection = getOwnStructures();
  const foundationsCollection = getOwnFoundations();
  const structures = {};
  const foundations = {};
  const queued = {};
  const costs = {};

  for (const [kind, spec] of Object.entries(BUILDING_SPECS)) {
    structures[kind] = countByClass(structuresCollection, spec.className, context.filters.byClass);
    foundations[kind] = countByClass(foundationsCollection, spec.className, context.filters.byClass);
    queued[kind] = countQueued(gameState, kind);
    costs[kind] = templateCost(gameState, kind);
  }

  return {
    time: finite(Number(context.time ?? ((gameState.ai && gameState.ai.elapsedTime) ?? 0)), "time"),
    population: { used, limit, queued: queuedPopulation },
    training: countPendingCivilianTraining(gameState, context),
    resources: cloneResources(getResources()),
    structures,
    foundations,
    queued,
    costs,
    food: {
      primaryRatio: finite(Number(context.food.primaryRatio), "food.primaryRatio"),
      primaryRemaining: finite(Number(context.food.primaryRemaining), "food.primaryRemaining"),
      targetFoodWorkers: finite(Number(context.food.targetFoodWorkers), "food.targetFoodWorkers"),
      naturalFoodWorkers: finite(Number(context.food.naturalFoodWorkers), "food.naturalFoodWorkers"),
      farmWorkers: finite(Number(context.food.farmWorkers), "food.farmWorkers")
    },
    woodsite: {
      localWoodAmount: finite(Number(context.woodsite.localWoodAmount), "woodsite.localWoodAmount"),
      availableTargets: finite(Number(context.woodsite.availableTargets), "woodsite.availableTargets"),
      saturatedTargets: finite(Number(context.woodsite.saturatedTargets), "woodsite.saturatedTargets"),
      averageDropDistance: finite(Number(context.woodsite.averageDropDistance), "woodsite.averageDropDistance"),
      lowWoodObservations: finite(Number(context.woodsite.lowWoodObservations ?? 0), "woodsite.lowWoodObservations"),
      alternativeExistingWorksite: !!context.woodsite.alternativeExistingWorksite
    },
    workers: {
      food: finite(Number(context.workers.food), "workers.food"),
      farm: finite(Number(context.workers.farm), "workers.farm"),
      wood: finite(Number(context.workers.wood), "workers.wood"),
      builders: finite(Number(context.workers.builders), "workers.builders"),
      idle: finite(Number(context.workers.idle), "workers.idle")
    }
  };
}

export { BUILDING_SPECS, observePetra, countQueued, countPendingCivilianTraining, resolvedTemplate };
