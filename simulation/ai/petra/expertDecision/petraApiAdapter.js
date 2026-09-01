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
    allowedBuilderJobs: ["food", "food_owned", "farm"]
  },
  field: {
    className: "Field",
    template: "structures/{civ}/field",
    queue: "field",
    allowedBuilderJobs: ["food", "food_owned", "farm"]
  },
  barracks: {
    className: "Barracks",
    template: "structures/{civ}/barracks",
    queue: "militaryBuilding",
    allowedBuilderJobs: ["wood", "citizenSoldierWood"]
  },
  market: {
    className: "Market",
    template: "structures/{civ}/market",
    queue: "economicBuilding",
    allowedBuilderJobs: ["wood", "citizenSoldierWood"]
  },
  forge: {
    className: "Forge",
    template: "structures/{civ}/forge",
    queue: "militaryBuilding",
    allowedBuilderJobs: ["wood", "citizenSoldierWood"]
  },
  temple: {
    className: "Temple",
    template: "structures/{civ}/temple",
    queue: "economicBuilding",
    allowedBuilderJobs: ["wood", "citizenSoldierWood"]
  },
  tower: {
    className: "Tower",
    template: "structures/{civ}/sentry_tower",
    queue: "defenseBuilding",
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
  if (kind === "temple") {
    const generic = gameState.applyCiv("structures/{civ}/temple");
    const vesta = gameState.applyCiv("structures/{civ}/temple_vesta");
    const genericTemplate = gameState.getTemplate && gameState.getTemplate(generic);
    const vestaTemplate = gameState.getTemplate && gameState.getTemplate(vesta);
    const canBuild = gameState.ai && gameState.ai.HQ && typeof gameState.ai.HQ.canBuild === "function" ?
      type => gameState.ai.HQ.canBuild(gameState, type) :
      type => !!(gameState.getTemplate && gameState.getTemplate(type));
    if (vestaTemplate && canBuild(vesta))
      return vesta;
    if (genericTemplate && canBuild(generic))
      return generic;
    // Cost/count observation must remain safe before the temple's phase unlock.
    if (genericTemplate)
      return generic;
    if (vestaTemplate)
      return vesta;
    return generic;
  }
  if (kind === "tower") {
    const sentry = gameState.applyCiv("structures/{civ}/sentry_tower");
    const defense = gameState.applyCiv("structures/{civ}/defense_tower");
    const phase = typeof gameState.currentPhase === "function" ? gameState.currentPhase() : 1;
    const canBuild = gameState.ai && gameState.ai.HQ && typeof gameState.ai.HQ.canBuild === "function" ?
      type => gameState.ai.HQ.canBuild(gameState, type) :
      type => !!(gameState.getTemplate && gameState.getTemplate(type));
    if (phase >= 2 && canBuild(defense))
      return defense;
    if (canBuild(sentry))
      return sentry;
    return phase >= 2 ? defense : sentry;
  }
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
  // Temple support is optional across civs; do not break the whole Expert observer for
  // a civ that lacks a normal temple template. The planner is gated by templeBuildable.
  if ((!template || typeof template.cost !== "function") && kind === "temple")
    return {};
  if (!template || typeof template.cost !== "function")
    throw new Error(`Missing template/cost() for ${kind}`);
  return cloneResources(template.cost());
}

function templateNumber(template, path, fallback = 0) {
  if (!template)
    return fallback;
  if (typeof template.get === "function") {
    const value = Number(template.get(path));
    if (Number.isFinite(value))
      return value;
  }
  return fallback;
}

function housingMetrics(gameState, context = {}) {
  const houseTemplate = gameState.getTemplate(resolvedTemplate(gameState, "house"));
  const live = context.housing || {};
  const houseBuildTime = Number.isFinite(Number(live.houseBuildTime)) ? Number(live.houseBuildTime) :
    templateNumber(houseTemplate, "Cost/BuildTime", 0);
  const housePopulationBonus = Number.isFinite(Number(live.housePopulationBonus)) ? Number(live.housePopulationBonus) :
    (houseTemplate && typeof houseTemplate.getPopulationBonus === "function" ? Number(houseTemplate.getPopulationBonus()) || 0 : 0);
  const civilianTrainTime = Number.isFinite(Number(live.civilianTrainTime)) ? Number(live.civilianTrainTime) : 0;
  const activeMilitaryTrainers = Number.isFinite(Number(live.activeMilitaryTrainers)) ? Math.max(0, Number(live.activeMilitaryTrainers)) : 0;
  const ccSoldierActive = !!live.ccSoldierActive;
  return { houseBuildTime, housePopulationBonus, civilianTrainTime, activeMilitaryTrainers, ccSoldierActive };
}

function observePetra(gameState, context = {}) {
  const getPopulation = requireMethod(gameState, "getPopulation", "gameState");
  const getPopulationLimit = requireMethod(gameState, "getPopulationLimit", "gameState");
  const getPopulationMax = requireMethod(gameState, "getPopulationMax", "gameState");
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
  const max = finite(getPopulationMax(), "population.max");
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
    phase: typeof gameState.currentPhase === "function" ? Math.max(1, Number(gameState.currentPhase()) || 1) : 1,
    population: { used, limit, max, queued: queuedPopulation },
    training: countPendingCivilianTraining(gameState, context),
    housing: housingMetrics(gameState, context),
    resources: cloneResources(getResources()),
    structures,
    foundations,
    queued,
    costs,
    flags: { ...(context.flags || {}) },
    food: {
      primaryRatio: finite(Number(context.food.primaryRatio), "food.primaryRatio"),
      primaryRemaining: finite(Number(context.food.primaryRemaining), "food.primaryRemaining"),
      targetFoodWorkers: finite(Number(context.food.targetFoodWorkers), "food.targetFoodWorkers"),
      naturalFoodWorkers: finite(Number(context.food.naturalFoodWorkers), "food.naturalFoodWorkers"),
      farmWorkers: finite(Number(context.food.farmWorkers), "food.farmWorkers"),
      alternativeRemaining: Number.isFinite(Number(context.food.alternativeRemaining)) ? Math.max(0, Number(context.food.alternativeRemaining)) : 0,
      alternativeClusters: Number.isFinite(Number(context.food.alternativeClusters)) ? Math.max(0, Number(context.food.alternativeClusters)) : 0,
      alternativeCovered: !!context.food.alternativeCovered,
      fieldCapacityKnown: !!context.food.fieldCapacityKnown,
      supportedFieldSlots: Number.isFinite(Number(context.food.supportedFieldSlots)) ? Math.max(0, Number(context.food.supportedFieldSlots)) : 0,
      openFieldSlots: Number.isFinite(Number(context.food.openFieldSlots)) ? Math.max(0, Number(context.food.openFieldSlots)) : 0,
      maxSaturatedHubFields: Number.isFinite(Number(context.food.maxSaturatedHubFields)) ? Math.max(0, Number(context.food.maxSaturatedHubFields)) : 0,
      naturalIncomeRate: Number.isFinite(Number(context.food.naturalIncomeRate)) ? Math.max(0, Number(context.food.naturalIncomeRate)) : 0,
      farmIncomeRate: Number.isFinite(Number(context.food.farmIncomeRate)) ? Math.max(0, Number(context.food.farmIncomeRate)) : 0,
      measuredFoodIncomeRate: Number.isFinite(Number(context.food.measuredFoodIncomeRate)) ? Math.max(0, Number(context.food.measuredFoodIncomeRate)) : 0,
      measuredFoodIncomeAvailable: !!context.food.measuredFoodIncomeAvailable,
      totalNaturalRemaining: Number.isFinite(Number(context.food.totalNaturalRemaining)) ? Math.max(0, Number(context.food.totalNaturalRemaining)) : 0,
      territoryNaturalDiscovered: Number.isFinite(Number(context.food.territoryNaturalDiscovered)) ? Math.max(0, Number(context.food.territoryNaturalDiscovered)) : 0,
      territoryNaturalRatio: Number.isFinite(Number(context.food.territoryNaturalRatio)) ? Math.max(0, Math.min(1, Number(context.food.territoryNaturalRatio))) : 1,
      immediateFoodSlots: Number.isFinite(Number(context.food.immediateFoodSlots)) ? Math.max(0, Number(context.food.immediateFoodSlots)) : 0,
      naturalRunwaySeconds: Number.isFinite(Number(context.food.naturalRunwaySeconds)) ? Math.max(0, Number(context.food.naturalRunwaySeconds)) : 0,
      averageFarmerRate: Number.isFinite(Number(context.food.averageFarmerRate)) ? Math.max(0, Number(context.food.averageFarmerRate)) : 0,
      ccFoodBurnRate: Number.isFinite(Number(context.food.ccFoodBurnRate)) ? Math.max(0, Number(context.food.ccFoodBurnRate)) : 0,
      oneBarracksFoodBurnRate: Number.isFinite(Number(context.food.oneBarracksFoodBurnRate)) ? Math.max(0, Number(context.food.oneBarracksFoodBurnRate)) : 0,
      twoBarracksFoodBurnRate: Number.isFinite(Number(context.food.twoBarracksFoodBurnRate)) ? Math.max(0, Number(context.food.twoBarracksFoodBurnRate)) : 0
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
      stone: Number.isFinite(Number(context.workers.stone)) ? Math.max(0, Number(context.workers.stone)) : 0,
      metal: Number.isFinite(Number(context.workers.metal)) ? Math.max(0, Number(context.workers.metal)) : 0,
      builders: finite(Number(context.workers.builders), "workers.builders"),
      idle: finite(Number(context.workers.idle), "workers.idle"),
      civilians: Number.isFinite(Number(context.workers.civilians)) ? Math.max(0, Number(context.workers.civilians)) : 0,
      woodCivilians: Number.isFinite(Number(context.workers.woodCivilians)) ? Math.max(0, Number(context.workers.woodCivilians)) : 0,
      foodOwnedCivilians: Number.isFinite(Number(context.workers.foodOwnedCivilians)) ? Math.max(0, Number(context.workers.foodOwnedCivilians)) : 0,
      overflowWood: Number.isFinite(Number(context.workers.overflowWood)) ? Math.max(0, Number(context.workers.overflowWood)) : 0
    }
  };
}

export { BUILDING_SPECS, observePetra, countQueued, countPendingCivilianTraining, resolvedTemplate, housingMetrics };
