import { mergePolicy } from "simulation/ai/petra/expertDecision/policy.js";
import { normalizeState, accountedFreePopulation } from "simulation/ai/petra/expertDecision/state.js";

function costOf(state, policy, kind) {
  return { ...(policy.costs[kind] || {}), ...(state.costs[kind] || {}) };
}

function resourceEnough(resources, cost, reservations = {}) {
  for (const type of ["food", "wood", "stone", "metal"]) {
    const need = (cost[type] || 0) + (reservations[type] || 0);
    if ((resources[type] || 0) < need)
      return false;
  }
  return true;
}

function addReservation(reservations, cost) {
  for (const type of ["food", "wood", "stone", "metal"])
    reservations[type] = (reservations[type] || 0) + (cost[type] || 0);
}

function housingDecision(state, policy) {
  const free = accountedFreePopulation(state);
  const pending = state.foundations.house + state.queued.house;
  if (pending > 0)
    return { needed: false, maintain: true, free, reason: "house task already exists" };
  if (free <= policy.houseTriggerFreePopulation)
    return { needed: true, maintain: false, free, reason: `accounted free population ${free} <= ${policy.houseTriggerFreePopulation}` };
  return { needed: false, maintain: false, free, reason: "population space healthy" };
}

function foodMode(state, policy) {
  if (state.food.primaryRemaining <= 0 || state.food.primaryRatio <= policy.farmTransitionRatio)
    return "transition";
  if (state.food.primaryRatio <= policy.farmPrepareRatio)
    return "prepare";
  return "natural";
}

function fieldDemand(state, policy) {
  const mode = foodMode(state, policy);
  if (mode === "natural")
    return { mode, desiredFields: 0, missingFields: 0, desiredFarmsteads: Math.max(1, state.structures.farmstead) };

  const projectedFarmWorkers = Math.max(
    state.food.targetFoodWorkers,
    state.food.farmWorkers + state.food.naturalFoodWorkers,
    policy.minimumTransitionFields * policy.farmersPerField
  );
  const desiredFields = Math.max(policy.minimumTransitionFields, Math.ceil(projectedFarmWorkers / policy.farmersPerField));
  const existingFields = state.structures.field + state.foundations.field + state.queued.field;
  const missingFields = Math.max(0, desiredFields - existingFields);
  const desiredFarmsteads = Math.max(1, Math.ceil(desiredFields / policy.fieldsPerFarmstead));
  return { mode, desiredFields, missingFields, desiredFarmsteads };
}

function woodWorksiteDecision(state, policy) {
  const w = state.woodsite;

  if (w.availableTargets > 0)
    return { status: "healthy", expand: false, reason: "usable local trees remain" };

  if (w.saturatedTargets > 0)
    return { status: "temporarily_saturated", expand: false, reason: "occupied trees are not exhaustion" };

  if (w.alternativeExistingWorksite)
    return { status: "switch_existing_worksite", expand: false, reason: "reuse an existing storehouse before constructing another" };

  if (w.localWoodAmount >= policy.localWoodHealthyAmount)
    return { status: "measurement_conflict", expand: false, reason: "substantial local wood remains; do not expand from one failed target search" };

  const lowEnough = w.localWoodAmount <= policy.localWoodCriticalAmount ||
    (w.localWoodAmount < policy.localWoodHealthyAmount && w.averageDropDistance > policy.targetWoodDropDistance);
  const sustained = w.lowWoodObservations >= policy.requiredLowWoodObservations;

  if (lowEnough && sustained)
    return { status: "exhausted", expand: true, reason: "worksite-level low wood is sustained and delivery quality is poor" };

  return { status: "observe", expand: false, reason: "insufficient evidence for a strategic expansion" };
}

function planEconomy(rawState, overrides = {}) {
  const policy = mergePolicy(overrides);
  const state = normalizeState(rawState);
  const actions = [];
  const reservations = { food: 0, wood: 0, stone: 0, metal: 0 };

  const housing = housingDecision(state, policy);
  const farm = fieldDemand(state, policy);
  const woodsite = woodWorksiteDecision(state, policy);

  // 1. Existing foundations are obligations, not optional projects.
  for (const kind of ["house", "farmstead", "field", "storehouse", "barracks"]) {
    if (state.foundations[kind] > 0)
      actions.push({ type: "MAINTAIN_CONSTRUCTION", kind, priority: 100, reason: "foundation exists" });
  }

  // 2. First infrastructure. These are independent opening tasks, but reserve their real costs.
  if (state.structures.farmstead + state.foundations.farmstead + state.queued.farmstead === 0) {
    const cost = costOf(state, policy, "farmstead");
    if (resourceEnough(state.resources, cost, reservations)) {
      actions.push({ type: "BUILD", kind: "farmstead", priority: 95, builderPool: ["food", "farm"], reason: "opening food dropsite missing" });
      addReservation(reservations, cost);
    }
  }
  if (state.structures.storehouse + state.foundations.storehouse + state.queued.storehouse === 0) {
    const cost = costOf(state, policy, "storehouse");
    if (resourceEnough(state.resources, cost, reservations)) {
      actions.push({ type: "BUILD", kind: "storehouse", priority: 95, builderPool: ["wood", "citizenSoldierWood"], reason: "opening wood dropsite missing" });
      addReservation(reservations, cost);
    }
  }

  // 3. Housing is a hard reservation before optional expansion/tech/military spending.
  if (housing.needed) {
    const cost = costOf(state, policy, "house");
    const canBuildHouseNow = resourceEnough(state.resources, cost, reservations);
    addReservation(reservations, cost);
    if (canBuildHouseNow)
      actions.push({ type: "BUILD", kind: "house", priority: 90, builderPool: ["wood", "citizenSoldierWood"], reason: housing.reason });
    else
      actions.push({ type: "RESERVE", kind: "house", priority: 90, cost, reason: housing.reason });

    if (housing.free <= policy.houseEmergencyFreePopulation)
      actions.push({ type: "PAUSE_POPULATION_TRAINING", priority: 89, reason: "avoid hard population block until house is secured" });
  }

  // 4. Farm transition capacity. The food workforce owns food construction.
  if (farm.mode !== "natural") {
    const currentFarmsteads = state.structures.farmstead + state.foundations.farmstead + state.queued.farmstead;
    if (currentFarmsteads < farm.desiredFarmsteads && state.foundations.farmstead + state.queued.farmstead === 0) {
      const cost = costOf(state, policy, "farmstead");
      if (resourceEnough(state.resources, cost, reservations)) {
        actions.push({ type: "BUILD", kind: "farmstead", priority: 85, builderPool: ["food", "farm"], reason: `need ${farm.desiredFarmsteads} farm hub(s) for ${farm.desiredFields} fields` });
        addReservation(reservations, cost);
      } else {
        actions.push({ type: "RESERVE", kind: "farmstead", priority: 85, cost, reason: "farm capacity requires another hub" });
        addReservation(reservations, cost);
      }
    }

    if (farm.missingFields > 0) {
      const fieldCost = costOf(state, policy, "field");
      const existingFields = state.structures.field + state.foundations.field + state.queued.field;
      const supportedFieldSlots = currentFarmsteads * policy.fieldsPerFarmstead;
      const hubHasRoom = existingFields < supportedFieldSlots;
      // One committed field at a time. Capacity planning may demand more, but construction is serialized.
      // A fifth field cannot leap ahead of the second farmstead hub that will own it.
      if (hubHasRoom && state.foundations.field + state.queued.field === 0) {
        if (resourceEnough(state.resources, fieldCost, reservations)) {
          actions.push({ type: "BUILD", kind: "field", priority: 84, builderPool: ["food", "farm"], reason: `${farm.mode} food mode needs field capacity` });
          addReservation(reservations, fieldCost);
        } else {
          actions.push({ type: "RESERVE", kind: "field", priority: 84, cost: fieldCost, reason: "field capacity is critical during food transition" });
          addReservation(reservations, fieldCost);
        }
      }
    }
  }

  // 5. Wood expansion is strategic and LOW priority. Never triggered by one worker or mere saturation.
  const totalStores = state.structures.storehouse + state.foundations.storehouse + state.queued.storehouse;
  if (totalStores >= 1 && woodsite.expand && state.foundations.storehouse + state.queued.storehouse === 0) {
    const cost = costOf(state, policy, "storehouse");
    if (resourceEnough(state.resources, cost, reservations))
      actions.push({ type: "BUILD", kind: "storehouse", role: "expansion", priority: 60, builderPool: ["wood", "citizenSoldierWood"], reason: woodsite.reason });
    else
      actions.push({ type: "DEFER", kind: "storehouse", role: "expansion", priority: 60, reason: "critical reservations consume available resources" });
  }

  // 6. First barracks only after housing + farm capacity, and only from surplus resources.
  const hasHouse = state.structures.house > 0;
  const fieldsReady = state.structures.field >= policy.minimumFieldsBeforeBarracks;
  const hasBarracksTask = state.structures.barracks + state.foundations.barracks + state.queued.barracks > 0;
  if (!hasBarracksTask && hasHouse && fieldsReady && state.population.used >= policy.firstBarracksPopulation) {
    const cost = costOf(state, policy, "barracks");
    if (resourceEnough(state.resources, cost, reservations))
      actions.push({ type: "BUILD", kind: "barracks", priority: 50, builderPool: ["wood", "citizenSoldierWood"], reason: "economic prerequisites are satisfied" });
  }

  actions.sort((a, b) => b.priority - a.priority);

  return {
    policy,
    state,
    derived: {
      accountedFreePopulation: accountedFreePopulation(state),
      foodMode: farm.mode,
      desiredFields: farm.desiredFields,
      desiredFarmsteads: farm.desiredFarmsteads,
      woodsiteStatus: woodsite.status
    },
    reservations,
    authorizedSpend: actions.filter(a => a.type === "BUILD").reduce((sum, a) => {
      const c = costOf(state, policy, a.kind);
      for (const type of ["food", "wood", "stone", "metal"])
        sum[type] += c[type] || 0;
      return sum;
    }, { food: 0, wood: 0, stone: 0, metal: 0 }),
    actions
  };
}

export {
  planEconomy,
  housingDecision,
  foodMode,
  fieldDemand,
  woodWorksiteDecision,
  resourceEnough
};
