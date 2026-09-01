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
  const housing = input.housing || {};

  return {
    time: n(input.time),
    phase: Math.max(1, n(input.phase, 1)),
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
    housing: {
      houseBuildTime: n(housing.houseBuildTime),
      housePopulationBonus: n(housing.housePopulationBonus),
      civilianTrainTime: n(housing.civilianTrainTime),
      activeMilitaryTrainers: n(housing.activeMilitaryTrainers),
      ccSoldierActive: bool(housing.ccSoldierActive)
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
      barracks: n(structures.barracks),
      market: n(structures.market),
      forge: n(structures.forge)
    },
    foundations: {
      house: n(foundations.house),
      storehouse: n(foundations.storehouse),
      farmstead: n(foundations.farmstead),
      field: n(foundations.field),
      barracks: n(foundations.barracks),
      market: n(foundations.market),
      forge: n(foundations.forge)
    },
    queued: {
      house: n(queued.house),
      storehouse: n(queued.storehouse),
      farmstead: n(queued.farmstead),
      field: n(queued.field),
      barracks: n(queued.barracks),
      market: n(queued.market),
      forge: n(queued.forge)
    },
    food: {
      primaryRatio: Number.isFinite(food.primaryRatio) ? food.primaryRatio : 1,
      primaryRemaining: n(food.primaryRemaining),
      targetFoodWorkers: n(food.targetFoodWorkers, 7),
      naturalFoodWorkers: n(food.naturalFoodWorkers),
      farmWorkers: n(food.farmWorkers),
      alternativeRemaining: n(food.alternativeRemaining),
      alternativeClusters: n(food.alternativeClusters),
      alternativeCovered: bool(food.alternativeCovered),
      fieldCapacityKnown: bool(food.fieldCapacityKnown),
      supportedFieldSlots: n(food.supportedFieldSlots),
      openFieldSlots: n(food.openFieldSlots),
      maxSaturatedHubFields: n(food.maxSaturatedHubFields),
      naturalIncomeRate: n(food.naturalIncomeRate),
      farmIncomeRate: n(food.farmIncomeRate),
      measuredFoodIncomeRate: n(food.measuredFoodIncomeRate),
      measuredFoodIncomeAvailable: bool(food.measuredFoodIncomeAvailable),
      totalNaturalRemaining: n(food.totalNaturalRemaining),
      territoryNaturalDiscovered: n(food.territoryNaturalDiscovered),
      territoryNaturalRatio: Number.isFinite(food.territoryNaturalRatio) ? Math.max(0, Math.min(1, food.territoryNaturalRatio)) : 1,
      immediateFoodSlots: n(food.immediateFoodSlots),
      naturalRunwaySeconds: n(food.naturalRunwaySeconds),
      averageFarmerRate: n(food.averageFarmerRate),
      ccFoodBurnRate: n(food.ccFoodBurnRate),
      oneBarracksFoodBurnRate: n(food.oneBarracksFoodBurnRate),
      twoBarracksFoodBurnRate: n(food.twoBarracksFoodBurnRate)
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
      stone: n(workers.stone),
      metal: n(workers.metal),
      builders: n(workers.builders),
      idle: n(workers.idle),
      civilians: n(workers.civilians),
      woodCivilians: n(workers.woodCivilians),
      foodOwnedCivilians: n(workers.foodOwnedCivilians),
      overflowWood: n(workers.overflowWood)
    },
    costs: input.costs || {},
    flags: { ...(input.flags || {}) }
  };
}

function accountedFreePopulation(state) {
  return state.population.limit - state.population.used - state.population.queued;
}

export { normalizeState, accountedFreePopulation };
