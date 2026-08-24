function n(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function bool(value) {
  return !!value;
}

function normalizeState(input = {}) {
  const structures = input.structures || {};
  const foundations = input.foundations || {};
  const queued = input.queued || {};
  const resources = input.resources || {};
  const woodsite = input.woodsite || {};
  const food = input.food || {};
  const workers = input.workers || {};
  const training = input.training || {};

  return {
    time: n(input.time),
    stage: input.stage || "bootstrap",
    population: {
      used: n(input.population && input.population.used),
      limit: n(input.population && input.population.limit, 30),
      queued: n(input.population && input.population.queued)
    },
    training: {
      pendingCivilians: n(training.pendingCivilians),
      pendingBatches: n(training.pendingBatches)
    },
    resources: {
      food: n(resources.food),
      wood: n(resources.wood),
      stone: n(resources.stone),
      metal: n(resources.metal)
    },
    structures: {
      house: n(structures.house),
      storehouse: n(structures.storehouse),
      farmstead: n(structures.farmstead),
      field: n(structures.field),
      barracks: n(structures.barracks)
    },
    foundations: {
      house: n(foundations.house),
      storehouse: n(foundations.storehouse),
      farmstead: n(foundations.farmstead),
      field: n(foundations.field),
      barracks: n(foundations.barracks)
    },
    queued: {
      house: n(queued.house),
      storehouse: n(queued.storehouse),
      farmstead: n(queued.farmstead),
      field: n(queued.field),
      barracks: n(queued.barracks)
    },
    food: {
      primaryRatio: Number.isFinite(food.primaryRatio) ? food.primaryRatio : 1,
      primaryRemaining: n(food.primaryRemaining),
      targetFoodWorkers: n(food.targetFoodWorkers, 7),
      naturalFoodWorkers: n(food.naturalFoodWorkers),
      farmWorkers: n(food.farmWorkers)
    },
    woodsite: {
      localWoodAmount: n(woodsite.localWoodAmount),
      availableTargets: n(woodsite.availableTargets),
      saturatedTargets: n(woodsite.saturatedTargets),
      averageDropDistance: n(woodsite.averageDropDistance),
      lowWoodObservations: n(woodsite.lowWoodObservations),
      alternativeExistingWorksite: bool(woodsite.alternativeExistingWorksite)
    },
    workers: {
      food: n(workers.food),
      farm: n(workers.farm),
      wood: n(workers.wood),
      builders: n(workers.builders),
      idle: n(workers.idle)
    },
    costs: input.costs || {},
    flags: { ...(input.flags || {}) }
  };
}

function accountedFreePopulation(state) {
  return state.population.limit - state.population.used - state.population.queued;
}

export { normalizeState, accountedFreePopulation };
