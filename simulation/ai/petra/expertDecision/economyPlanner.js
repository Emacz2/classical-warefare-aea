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

function predictiveHouseTrigger(state, policy) {
  const buildTime = state.housing.houseBuildTime;
  const trainTime = state.housing.civilianTrainTime;
  if (!(buildTime > 0) || !(trainTime > 0))
    return policy.houseTriggerFreePopulation;

  // Use the template's full build time deliberately. Expert normally assigns several
  // builders, but placement/walk/resource-return delays can easily consume the nominal
  // multi-builder speedup. This conservative window adapts to civ-specific house speed
  // without needing AthensExpert/BritExpert/etc.
  const secondsAtRisk = buildTime + policy.housePlacementBufferSeconds;
  const populationProduced = Math.ceil(secondsAtRisk / trainTime);
  return Math.max(
    policy.houseMinimumPredictiveHeadroom,
    Math.min(policy.houseMaximumPredictiveHeadroom, populationProduced + policy.houseSafetyPopulation)
  );
}

function housingDecision(state, policy) {
  const free = accountedFreePopulation(state);
  let trigger = predictiveHouseTrigger(state, policy);
  if (state.population.max > 0 && state.population.limit >= state.population.max)
    return { needed: false, maintain: false, free, trigger, reason: `population limit ${state.population.limit} already reaches maximum ${state.population.max}` };
  const militaryExtra = state.housing.activeMilitaryTrainers * policy.houseMilitaryExtraHeadroomPerBarracks +
    (state.housing.ccSoldierActive ? policy.houseCCSoldierExtraHeadroom : 0);
  trigger = Math.min(policy.houseMaximumMilitaryHeadroom, trigger + militaryExtra);
  const pending = state.foundations.house + state.queued.house;
  if (pending > 0)
    return { needed: false, maintain: true, free, trigger, reason: "house task already exists" };

  // Once the military economy is running, surplus wood should become organized housing
  // before it becomes an idle 1k+ bank. Keep roughly one extra house of headroom while
  // wood is abundant; the same three-unit crew extends the house wall proactively.
  const surplusPrebuild = state.time >= 180 && state.structures.barracks > 0 &&
    state.resources.wood >= policy.houseSurplusPrebuildWood &&
    free <= trigger + policy.houseSurplusExtraHeadroom;
  if (surplusPrebuild)
    return { needed: true, maintain: false, free, trigger, reason: `surplus wood prebuild keeps military housing ahead (${free} free)` };

  if (free <= trigger) {
    const timing = state.housing.houseBuildTime > 0 && state.housing.civilianTrainTime > 0 ?
      ` (house ${state.housing.houseBuildTime}s, civilian ${state.housing.civilianTrainTime}s)` : "";
    return { needed: true, maintain: false, free, trigger, reason: `accounted free population ${free} <= predictive trigger ${trigger}${timing}` };
  }
  return { needed: false, maintain: false, free, trigger, reason: `population space healthy (${free} > ${trigger})` };
}

function hasWorthwhileAlternativeFood(state, policy) {
  return state.food.alternativeClusters > 0 && state.food.alternativeRemaining >= policy.minimumAlternativeNaturalFood;
}

function foodMode(state, policy) {
  const totalNatural = Math.max(0, Number(state.food.totalNaturalRemaining) ||
    (Number(state.food.primaryRemaining) || 0) + (Number(state.food.alternativeRemaining) || 0));
  const runway = Math.max(0, Number(state.food.naturalRunwaySeconds) || 0);
  const territoryRatio = Number.isFinite(state.food.territoryNaturalRatio) ? state.food.territoryNaturalRatio : 1;

  // IT14.15: cover EVERY worthwhile uncovered in-territory fruit/berry cluster before
  // spending wood on permanent farms. The Wicker branch still establishes cluster #2;
  // this rule lets the ordinary planner walk outward through cluster #3/#4 sequentially.
  if (hasWorthwhileAlternativeFood(state, policy) && !state.food.alternativeCovered)
    return "natural_expand";
  if (totalNatural <= 0)
    return "transition";

  // Natural food is the first-choice P1 economy. A short runway on the currently active
  // patch is NOT enough to trigger fields while the combined in-territory pool is still
  // above ~30%. Once the combined pool reaches the threshold, start the JIT farm transition.
  if (territoryRatio > policy.territoryNaturalFarmTransitionRatio)
    return "natural";
  if (runway <= policy.fieldTransitionLeadSeconds)
    return "transition";
  return "prepare";
}


function effectiveFieldWorkerUnits(workers, diminishing = 0.90) {
  const count = Math.max(0, Math.floor(Number(workers) || 0));
  if (!count)
    return 0;
  const ratio = Number.isFinite(Number(diminishing)) ? Math.max(0, Math.min(1, Number(diminishing))) : 0.90;
  if (ratio === 1)
    return count;
  if (ratio === 0)
    return 1;
  return (1 - Math.pow(ratio, count)) / (1 - ratio);
}

function preferredFieldCrew(state, policy) {
  const observed = Math.max(1, Math.floor(Number(state.food.preferredFarmersPerField) || Number(policy.farmersPerField) || 4));
  return Math.max(1, Math.min(Math.floor(Number(policy.farmersPerField) || 4), observed));
}

function fieldDemand(state, policy) {
  const mode = foodMode(state, policy);
  const currentFarmsteads = state.structures.farmstead + state.foundations.farmstead + state.queued.farmstead;
  const builtFields = state.structures.field;
  const pendingFields = state.foundations.field + state.queued.field;
  const existingFields = builtFields + pendingFields;
  const completedFields = builtFields;
  const totalNatural = Math.max(0, Number(state.food.totalNaturalRemaining) || 0);
  const runway = Math.max(0, Number(state.food.naturalRunwaySeconds) || 0);
  const territoryRatio = Number.isFinite(state.food.territoryNaturalRatio) ? state.food.territoryNaturalRatio : 1;
  // IT14.42: a full berry patch is not a reason to buy farms while the combined
  // natural-food network is still healthy. Extra civilians can work wood temporarily;
  // that wood is more valuable as barracks/tech/infrastructure. Only a genuine food
  // emergency may override the natural-food hold above the normal transition ratio.
  const naturalFoodEmergency = state.resources.food < policy.naturalFoodEmergencyFieldFoodBank &&
    runway <= policy.naturalFoodEmergencyFieldRunwaySeconds;
  const naturalFirstHold = totalNatural > 0 &&
    (mode === "natural_expand" || territoryRatio > policy.territoryNaturalFarmTransitionRatio) &&
    !naturalFoodEmergency;
  const margin = Math.max(1, Number(policy.foodRateSafetyMargin) || 1.12);
  const farmerRate = state.food.averageFarmerRate > 0 ? state.food.averageFarmerRate : 0.7;
  const farmersPerField = preferredFieldCrew(state, policy);
  const diminishing = Number.isFinite(Number(state.food.fieldDiminishingReturns)) ? state.food.fieldDiminishingReturns : policy.fieldDiminishingReturns;
  const effectiveWorkersPerField = effectiveFieldWorkerUnits(farmersPerField, diminishing);
  // IT14.60: pending-field throughput uses the engine's geometric diminishing-return
  // curve instead of pretending four farmers each contribute 100% gather rate.
  const fieldIncome = Math.max(0.01, farmerRate * effectiveWorkersPerField);
  const measuredIncome = Math.max(0, Number(state.food.measuredFoodIncomeRate) || 0);
  const actualNatural = Math.max(0, Number(state.food.naturalIncomeRate) || 0);
  const actualFarm = Math.max(0, Number(state.food.farmIncomeRate) || 0);

  // Pending fields are already paid-for capacity. Do not ignore them and then queue
  // several more fields to solve a deficit those foundations are about to cover.
  const projectedPipelineIncome = measuredIncome + pendingFields * fieldIncome;
  const fieldsNeededForBurn = burn => {
    const deficit = Math.max(0, burn * margin - projectedPipelineIncome);
    return existingFields + Math.ceil(deficit / fieldIncome);
  };
  const fieldsForCC = fieldsNeededForBurn(state.food.ccFoodBurnRate);
  const fieldsForOneBarracks = fieldsNeededForBurn(state.food.oneBarracksFoodBurnRate);
  const fieldsForTwoBarracks = fieldsNeededForBurn(state.food.twoBarracksFoodBurnRate);

  const barracksPipeline = state.structures.barracks + state.foundations.barracks + state.queued.barracks;
  let desiredFields = existingFields;

  // Natural food has priority. Fields are just-in-time insurance: build only when the
  // in-territory natural-food runway is approaching field construction/startup time.
  // Barracks #1 is not gated by field count.
  if (barracksPipeline === 0) {
    if (mode === "prepare")
      desiredFields = Math.max(desiredFields, 1);
    else if (mode === "transition")
      desiredFields = Math.max(desiredFields, Math.min(policy.minimumPrebuildFields, Math.max(1, fieldsForCC)));
    desiredFields = Math.min(desiredFields, policy.minimumPrebuildFields);
  }

  if (barracksPipeline >= 1) {
    // Ramp permanent food capacity progressively. Before barracks #2 we only need to
    // sustain the CC + first barracks and reach the five-field launch floor. Do NOT
    // prebuild the entire two-barracks steady-state farm economy before building #2.
    let floor = 2;
    if (state.time >= 240) floor = 3;
    if (state.time >= 270) floor = 4;
    if (state.time >= policy.secondBarracksReserveTime) floor = policy.minimumCompletedFieldsBeforeSecondBarracks;
    if (mode === "natural" && state.time < 240)
      floor = Math.min(floor, existingFields + 1);
    desiredFields = Math.max(desiredFields, floor);

    const shortRunway = totalNatural <= 0 || runway <= policy.fieldTransitionLeadSeconds + policy.naturalFoodRunwaySafetySeconds;
    if (shortRunway || state.resources.food < policy.postOpeningFoodFloor)
      desiredFields = Math.max(desiredFields, fieldsForOneBarracks);
  }

  // Once natural food is gone, every civilian already committed to food must have a
  // productive farm slot or a near-term field foundation. This is the hard no-idle
  // capacity invariant that IT13 violated with `food-wait`.
  let capacityFields = 0;
  if (totalNatural <= 0) {
    const committedFoodWorkers = Math.max(0, state.workers.food + state.workers.farm);
    capacityFields = Math.ceil(committedFoodWorkers / Math.max(1, farmersPerField));
    desiredFields = Math.max(desiredFields, capacityFields);
  }

  if (state.structures.barracks === 1 && state.time >= policy.secondBarracksReserveTime)
    desiredFields = Math.max(desiredFields, policy.minimumCompletedFieldsBeforeSecondBarracks, fieldsForOneBarracks);

  // AFTER the second barracks exists, permanent food capacity follows the measured
  // two-barracks burn rate even if the CURRENT food bank happens to be large. A bank
  // surplus is temporary; it is not a reason to stop building the farm economy.
  if (state.structures.barracks >= 2)
    desiredFields = Math.max(desiredFields, policy.minimumCompletedFieldsBeforeSecondBarracks, fieldsForTwoBarracks);

  // Population-scaled permanent-food floor. A temporary food surplus may pause burn-rate
  // expansion, but it may never erase the long-term 6 -> 8 -> 10 -> 12 field staircase.
  let permanentFieldFloor = 0;
  if (state.population.used >= policy.fieldFloorSixPopulation) permanentFieldFloor = 6;
  if (state.population.used >= policy.fieldFloorEightPopulation) permanentFieldFloor = 8;
  if (state.population.used >= policy.fieldFloorTenPopulation) permanentFieldFloor = 10;
  if (state.population.used >= policy.fieldFloorTwelvePopulation) permanentFieldFloor = 12;

  const surplusFloor = barracksPipeline >= 1 ? policy.minimumCompletedFieldsBeforeSecondBarracks : 0;
  const foodSurplusSolved = state.time >= 240 && state.resources.food >= policy.foodSurplusPauseFarmExpansion && completedFields >= surplusFloor;

  // Resource-bank optimization may never override permanent food infrastructure or the
  // no-idle capacity invariant. Surplus food simply suppresses extra burn-rate growth.
  desiredFields = Math.max(desiredFields, capacityFields, permanentFieldFloor);

  // IT14.17: preserve IT14.15's natural-food-first opening, but never let it strand
  // civilians behind a full eight-worker patch or bank 800+ wood while food capacity
  // is the bottleneck. Those two conditions may start fields in parallel with natural food.
  if (naturalFirstHold) {
    // IT14.43 JIT farm staircase.  Keep exploiting natural food, but prepare enough
    // permanent capacity that the last berries and the first farms overlap instead of
    // leaving a 4k-wood / 0-food hole. Either runway OR depletion ratio may advance the
    // staircase because replay-derived runway can become temporarily optimistic when
    // military production pauses.
    let stagedFloor = 0;
    if (runway <= policy.naturalFoodStageTwoRunwaySeconds || territoryRatio <= policy.naturalFoodStageTwoRatio) stagedFloor = 2;
    if (runway <= policy.naturalFoodStageFourRunwaySeconds || territoryRatio <= policy.naturalFoodStageFourRatio) stagedFloor = 4;
    if (runway <= policy.naturalFoodStageSixRunwaySeconds || territoryRatio <= policy.naturalFoodStageSixRatio) stagedFloor = 6;
    if (runway <= policy.naturalFoodStageEightRunwaySeconds || territoryRatio <= policy.naturalFoodStageEightRatio) stagedFloor = 8;
    const sustainedDeliveredFoodDeficit = Number(state.food.foodInfrastructureDeficitSeconds || 0) >=
      Number(policy.foodInfrastructureEmergencySustainSeconds || 15);
    desiredFields = sustainedDeliveredFoodDeficit ?
      Math.max(desiredFields, existingFields, Math.min(stagedFloor, policy.preferredPermanentFields)) :
      Math.max(existingFields, Math.min(stagedFloor, policy.preferredPermanentFields));
  }

  // IT14.32: ten permanent fields is the normal mature target. Fields 11-12 are
  // emergency reserve capacity only when the live food bank is actually short.
  const preferredFieldCeiling = Math.max(1, Number(policy.preferredPermanentFields) || 10);
  const emergencyFieldCeiling = Math.max(preferredFieldCeiling, Number(policy.maximumPermanentFields) || 12);
  const foodShortForReserveFields = totalNatural <= 0 && completedFields >= preferredFieldCeiling &&
    state.resources.food < (Number(policy.emergencyPermanentFieldsFoodBank) || 500);
  const liveFieldCeiling = foodShortForReserveFields ? emergencyFieldCeiling : preferredFieldCeiling;
  desiredFields = Math.min(liveFieldCeiling, Math.max(0, Math.ceil(desiredFields)));
  const missingFields = Math.max(0, desiredFields - existingFields);

  // Barracks #2 launch math: five COMPLETE fields is the physical minimum. After that,
  // use actual delivered income + already-pending fields and ask whether the current
  // food bank can bridge the remaining deficit for long enough to finish the transition.
  // This replaces IT13's pathological "11-12 fields before barracks #2" gate.
  const secondTargetRate = Math.max(0, state.food.twoBarracksFoodBurnRate * margin);
  const projectedSecondRate = Math.max(0, measuredIncome + pendingFields * fieldIncome);
  const secondDeficit = Math.max(0, secondTargetRate - projectedSecondRate);
  const bridgeFood = Math.max(0, state.resources.food - (policy.secondBarracksFoodReserve || 0));
  const bridgeSeconds = secondDeficit > 0 ? bridgeFood / secondDeficit : Infinity;
  const requiredSecondFields = Math.max(
    policy.minimumCompletedFieldsBeforeSecondBarracks,
    Math.ceil(secondTargetRate / Math.max(0.01, fieldIncome))
  );
  const secondBarracksFoodReady = completedFields >= policy.minimumCompletedFieldsBeforeSecondBarracks &&
    (secondDeficit <= 0 ||
     bridgeSeconds >= (policy.secondBarracksMinimumFoodBridgeSeconds || 60) ||
     state.resources.food >= policy.foodBankBridgeForSecondBarracks);

  const naturalExpansion = mode === "natural_expand";
  const desiredFarmsteads = naturalExpansion ? Math.max(1, currentFarmsteads + 1) : Math.max(1, currentFarmsteads);
  return {
    mode,
    prebuild: mode === "prepare" || mode === "transition",
    desiredFields,
    missingFields,
    desiredFarmsteads,
    naturalExpansion,
    foodSurplusSolved,
    fieldsForCC,
    fieldsForOneBarracks,
    fieldsForTwoBarracks,
    requiredSecondFields,
    secondBarracksFoodReady,
    secondBarracksBridgeSeconds: Number.isFinite(bridgeSeconds) ? bridgeSeconds : 99999,
    secondBarracksProjectedRate: projectedSecondRate,
    farmersPerField,
    effectiveWorkersPerField,
    measuredIncome,
    actualNatural,
    actualFarm,
    totalNatural,
    territoryRatio,
    naturalFirstHold,
    runway
  };
}

function woodWorksiteDecision(state, policy) {
  const w = state.woodsite;
  const sustained = w.lowWoodObservations >= policy.requiredLowWoodObservations;
  const criticallyLow = w.localWoodAmount <= policy.localWoodCriticalAmount;
  const poorDelivery = state.workers.wood >= policy.woodExpansionWorkerThreshold &&
    w.localWoodAmount <= (policy.woodDistanceExpansionAmount || policy.localWoodHealthyAmount) &&
    w.averageDropDistance > policy.targetWoodDropDistance;
  const workforcePressure = state.workers.wood >= policy.woodExpansionWorkerThreshold &&
    w.localWoodAmount <= policy.woodExpansionAmount;
  // IT14.46: a large crew on one rich forest can justify a second dropsite even before
  // depletion. This is the human "work both faces of the same forest" pattern.
  const denseWorksite = state.workers.wood >= Math.max(16, policy.woodExpansionWorkerThreshold + 4) &&
    w.localWoodAmount >= 1800 && w.averageDropDistance > 14;
  const continuityEmergency = !!(state.flags.phaseWoodCrisis || state.flags.woodIncomeStalled);
  const proactiveHandoff = state.workers.wood >= (policy.woodProactiveHandoffWorkers || 12) &&
    w.localWoodAmount <= (policy.woodProactiveHandoffAmount || 1300) && !w.alternativeExistingWorksite;

  // IT14.58: do not wait for a large lumber camp to hit single-digit connected wood.
  // The new dropsite can be built while the old cohort finishes the current patch.
  if (proactiveHandoff)
    return { status: "prebuild_next_worksite", expand: true, reason: "large lumber crew is approaching end-of-patch; pre-build the next wood district" };

  // IT14.54: never allow a measured wood-economy failure to sit in "observe" merely
  // because the old low-wood observation counter has not caught up yet. The controller
  // only raises these flags after a real phase shortfall or delivered-wood stall.
  if (continuityEmergency && !w.alternativeExistingWorksite &&
      (criticallyLow || w.availableTargets <= 0 || poorDelivery || workforcePressure))
    return { status: state.flags.phaseWoodCrisis ? "phase_wood_recovery" : "income_stall_recovery", expand: true,
      reason: state.flags.phaseWoodCrisis ? "Town Phase is queued but wood-starved; restore a serviced forest immediately" :
        "assigned lumberjacks have stopped delivering wood; restore a serviced forest immediately" };

  if (w.alternativeExistingWorksite && (criticallyLow || poorDelivery || workforcePressure || continuityEmergency))
    return { status: "switch_existing_worksite", expand: false, reason: "reuse an existing storehouse before constructing another" };

  if (denseWorksite)
    return { status: "dense_forest_deepen", expand: true, reason: "large wood crew has enough connected forest to benefit from a second dropsite on the same patch" };

  if (workforcePressure)
    return { status: "workforce_expand", expand: true, reason: "wood workforce is large relative to remaining local wood; establish the next in-territory dropsite now" };

  if (sustained && criticallyLow)
    return { status: "depleting_expand", expand: true, reason: "local wood is critically low for several observations; prepare the next dropsite before workers idle" };

  if (sustained && poorDelivery)
    return { status: "distance_expand", expand: true, reason: "remaining local wood is low and delivery distance is persistently poor" };

  if (w.availableTargets > 0)
    return { status: criticallyLow || poorDelivery ? "depleting_observe" : "healthy", expand: false,
      reason: criticallyLow || poorDelivery ? "usable trees remain, but strategic low-wood evidence is still accumulating" : "usable local trees remain" };

  if (w.saturatedTargets > 0 && !criticallyLow)
    return { status: "temporarily_saturated", expand: false, reason: "occupied trees are not exhaustion" };

  if (w.localWoodAmount >= policy.localWoodHealthyAmount)
    return { status: "measurement_conflict", expand: false, reason: "substantial local wood remains; do not expand from one failed target search" };

  return { status: "observe", expand: false, reason: "insufficient sustained evidence for a strategic expansion" };
}

function efficientBuilderIntent(action, state, policy) {
  if (!action || action.type !== "BUILD") return action;
  if (!["house", "barracks", "market", "forge", "temple", "arsenal", "tower"].includes(action.kind)) return action;

  const food = Math.max(0, Number(state.resources.food) || 0);
  const wood = Math.max(0, Number(state.resources.wood) || 0);
  const stone = Math.max(0, Number(state.resources.stone) || 0);
  const metal = Math.max(0, Number(state.resources.metal) || 0);
  const bank = { food, wood, stone, metal };
  const floor = Math.max(200, Math.min(food || 999999, wood || 999999, stone || 999999, metal || 999999));
  const ratio = Math.max(1.1, Number(policy.lopsidedConstructionResourceRatio) || 2.25);
  const rich = Object.entries(bank).filter(([, value]) => value >= policy.surplusConstructionResourceBank && value >= floor * ratio)
    .sort((a, b) => b[1] - a[1]);
  const woodSurplus = wood >= policy.surplusConstructionResourceBank;
  const severeWood = wood >= policy.severeConstructionResourceBank;
  const jobPriority = {};
  if (rich.length) {
    const resource = rich[0][0];
    if (resource === "wood") { jobPriority.citizenSoldierWood = 8; jobPriority.wood = 7; jobPriority.food_overflow_wood = 6; }
    else if (resource === "food") { jobPriority.farm = 8; jobPriority.food_owned = 7; jobPriority.food = 6; }
    else jobPriority[resource] = 8;
  }

  let builderPool = action.builderPool ? [...action.builderPool] : ["wood", "citizenSoldierWood"];
  let builderCount = Number(action.builderCount) || undefined;
  let preferFarmDistrictHouse = false;

  if (action.kind === "barracks") {
    const first = !action.role && state.structures.barracks + state.foundations.barracks + state.queued.barracks === 0;
    if (first) {
      // User contract: all four opening citizen-soldiers throw up Barracks #1 together.
      builderPool = ["citizenSoldierWood"];
      builderCount = policy.firstBarracksBuilders;
      jobPriority.citizenSoldierWood = 20;
    } else {
      builderPool = ["citizenSoldierWood", "wood", "food_overflow_wood", "farm", "food_owned", "food", "stone", "metal"];
      builderCount = woodSurplus ? policy.surplusBarracksBuilders : policy.normalBarracksBuilders;
      jobPriority.citizenSoldierWood = Math.max(jobPriority.citizenSoldierWood || 0, woodSurplus ? 12 : 8);
      jobPriority.wood = Math.max(jobPriority.wood || 0, woodSurplus ? 10 : 6);
    }
  } else if (action.kind === "house") {
    builderPool = ["farm", "food_owned", "food", "citizenSoldierWood", "wood", "food_overflow_wood", "stone", "metal"];
    builderCount = severeWood ? policy.emergencyHouseBuilders : woodSurplus ? policy.surplusHouseBuilders : policy.normalHouseBuilders;
    // Once fields exist, nearby farmers are ideal house builders: short walk, build,
    // return to the same field. A food-heavy bank strengthens that preference.
    preferFarmDistrictHouse = state.structures.field > 0 && state.workers.farm >= 3;
    if (preferFarmDistrictHouse) {
      jobPriority.farm = Math.max(jobPriority.farm || 0, food >= wood ? 10 : 5);
      jobPriority.food_owned = Math.max(jobPriority.food_owned || 0, food >= wood ? 8 : 4);
    }
    if (woodSurplus) {
      jobPriority.citizenSoldierWood = Math.max(jobPriority.citizenSoldierWood || 0, 9);
      jobPriority.wood = Math.max(jobPriority.wood || 0, 8);
    }
  } else {
    builderPool = ["citizenSoldierWood", "wood", "food_overflow_wood", "farm", "food_owned", "food", "stone", "metal"];
    builderCount = woodSurplus ? policy.surplusStrategicBuilders : policy.normalStrategicBuilders;
    if (woodSurplus) {
      jobPriority.citizenSoldierWood = Math.max(jobPriority.citizenSoldierWood || 0, 9);
      jobPriority.wood = Math.max(jobPriority.wood || 0, 8);
    }
  }

  return { ...action, builderPool, builderCount, builderJobPriority: jobPriority, preferFarmDistrictHouse };
}

function planEconomy(rawState, overrides = {}) {
  const policy = mergePolicy(overrides);
  const state = normalizeState(rawState);
  const actions = [];
  const reservations = { food: 0, wood: 0, stone: 0, metal: 0 };

  const housing = housingDecision(state, policy);
  const farm = fieldDemand(state, policy);
  const woodsite = woodWorksiteDecision(state, policy);
  // IT14.55: detect the impossible food-layout state directly. Natural-food dropsites
  // are not proof that the permanent farm network has usable field geometry.
  const foodCapacityDeadlock = farm.missingFields > 0 &&
    state.food.fieldCapacityKnown && state.food.openFieldSlots <= 0 &&
    state.foundations.field + state.queued.field === 0;
  // IT14.60: measured delivered food is the final authority. A sustained shortfall
  // while permanent fields are missing makes food infrastructure an emergency even
  // when the biome still reports natural food somewhere on the map.
  const foodInfrastructureEmergency = farm.missingFields > 0 &&
    Number(state.food.foodInfrastructureDeficitSeconds || 0) >= Number(policy.foodInfrastructureEmergencySustainSeconds || 15);
  const severeFoodCapacityDeadlock = foodCapacityDeadlock &&
    (state.workers.overflowWood >= policy.foodCapacityDeadlockPauseOverflow ||
     state.workers.idle >= policy.foodCapacityDeadlockPauseOverflow ||
     state.resources.food < policy.foodCapacityDeadlockFoodBank);

  // 1. Existing foundations are obligations, not optional projects.
  for (const kind of ["house", "farmstead", "field", "storehouse", "barracks", "market", "forge", "temple"]) {
    if (state.foundations[kind] > 0)
      actions.push({ type: "MAINTAIN_CONSTRUCTION", kind, priority: 100, reason: "foundation exists" });
  }

  // 2. First infrastructure. These are independent opening tasks, but reserve their real costs.
  if (state.structures.farmstead + state.foundations.farmstead + state.queued.farmstead === 0) {
    const cost = costOf(state, policy, "farmstead");
    if (resourceEnough(state.resources, cost, reservations)) {
      actions.push({ type: "BUILD", kind: "farmstead", priority: 95, builderPool: ["food", "food_owned", "farm"], reason: "opening food dropsite missing" });
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

  // 4. First barracks. Its 200 wood is reserved from ~2:15 and the building is NOT
  // gated by an arbitrary field count. If berries/fruit can sustain the opening, Expert
  // uses them; field timing is handled independently by the food-runway model.
  const hasHouse = state.structures.house > 0;
  const fieldPipeline = state.structures.field + state.foundations.field + state.queued.field;
  const hasBarracksTask = state.structures.barracks + state.foundations.barracks + state.queued.barracks > 0;
  const firstBarracksReserve = state.time >= policy.barracksReserveTime;
  const firstBarracksBuild = state.time >= policy.barracksTargetTime;
  const firstBarracksHard = state.time >= policy.barracksHardDeadline;
  if (!hasBarracksTask && hasHouse && firstBarracksReserve) {
    const cost = costOf(state, policy, "barracks");
    const canBuild = (firstBarracksBuild || firstBarracksHard) && resourceEnough(state.resources, cost, reservations);
    addReservation(reservations, cost);
    if (canBuild)
      actions.push({ type: "BUILD", kind: "barracks", priority: 99, builderPool: ["wood", "citizenSoldierWood"], reason: firstBarracksHard ? "3:00 first-barracks deadline" : "2:30 first-barracks target" });
    else
      actions.push({ type: "RESERVE", kind: "barracks", priority: 99, cost, reason: "reserve first-barracks wood before optional expansion" });
  }

  // Second barracks. IT14.4 starts the decision early enough for the BUILDING to
  // finish near 5:00, not merely begin at 5:00. The original five-completed-field
  // measured-food gate remains valid. A second early path recognizes that three fields
  // already in the pipeline plus a large safe natural-food runway can support building
  // production capacity before the permanent farm economy is fully online.
  const completedBarracks = state.structures.barracks;
  const pendingBarracks = state.foundations.barracks + state.queued.barracks;
  const secondReserveWindow = state.time >= policy.secondBarracksReserveTime;
  const secondBuildWindow = state.time >= policy.secondBarracksTargetTime;
  const secondHardWindow = state.time >= policy.secondBarracksHardDeadline;
  const naturalFoodRemaining = Math.max(0, Number(state.food.totalNaturalRemaining) || 0);
  const naturalFoodRunway = Math.max(0, Number(state.food.naturalRunwaySeconds) || 0);
  const infrastructureNaturalReady = naturalFoodRemaining >= policy.naturalFoodInfrastructureRemaining &&
    naturalFoodRunway >= policy.naturalFoodInfrastructureRunwaySeconds;
  const secondNaturalReady = naturalFoodRemaining >= policy.secondBarracksEarlyNaturalFood &&
    naturalFoodRunway >= policy.secondBarracksEarlyNaturalRunwaySeconds;
  const secondEarlyReady = secondNaturalReady ||
    (fieldPipeline >= policy.secondBarracksEarlyFieldPipeline &&
     (naturalFoodRemaining >= policy.secondBarracksEarlyNaturalFood || state.resources.food >= policy.secondBarracksEarlyFoodBank));
  // IT14.28: hard means hard. IT14.27 still let the measured-food model veto the
  // second barracks after the deadline, which delayed Athens until ~8:15 despite a
  // huge wood bank. At the hard deadline, two fields in the pipeline are enough; the
  // building should exist so production can scale as food recovers.
  const secondHardReady = secondHardWindow && fieldPipeline >= policy.secondBarracksHardFieldPipeline;
  const secondCapacityReady = farm.secondBarracksFoodReady || secondEarlyReady || secondHardReady;
  if (completedBarracks === 1 && pendingBarracks === 0 && hasHouse && secondReserveWindow && secondCapacityReady) {
    const cost = costOf(state, policy, "barracks");
    const canBuild = (secondBuildWindow || secondHardWindow) && resourceEnough(state.resources, cost, reservations);
    addReservation(reservations, cost);
    if (canBuild)
      actions.push({ type: "BUILD", kind: "barracks", role: "second", priority: 97, builderPool: ["wood", "citizenSoldierWood"], reason: `second barracks capacity-ready (fields ${state.structures.field}/${fieldPipeline} built/pipeline, natural ${Math.round(naturalFoodRemaining)}, naturalRunway ${Math.round(Number(state.food.naturalRunwaySeconds) || 0)}s, bridge ${Math.round(farm.secondBarracksBridgeSeconds)}s)` });
    else
      actions.push({ type: "RESERVE", kind: "barracks", role: "second", priority: 97, cost, reason: "reserve wood for pre-5:00 second barracks" });
  }

  const strategicBuilderPool = ["wood", "citizenSoldierWood", "food", "food_owned", "food_overflow_wood", "farm", "stone", "metal"];

  // IT14.37: the P1 temple is an ACTION, not merely a reservation that blocks Forge #1.
  // Once Barracks #2 is complete, give the economic aura a real protected build window
  // before optional expansion can consume the same 200 wood.
  const earlyTemplePipeline = state.structures.temple + state.foundations.temple + state.queued.temple;
  const p1TempleReadyNow = state.phase === 1 && state.flags.templeBuildable && completedBarracks >= 2 &&
    earlyTemplePipeline === 0 && state.population.used >= policy.p1TemplePopulation &&
    (fieldPipeline >= policy.p1TempleMinimumFieldPipeline || infrastructureNaturalReady);
  if (p1TempleReadyNow) {
    const cost = costOf(state, policy, "temple");
    const protectedCost = { ...cost, wood: (cost.wood || 0) + policy.p1TempleWoodReserve };
    const canBuild = resourceEnough(state.resources, protectedCost, reservations);
    addReservation(reservations, cost);
    if (canBuild)
      actions.push({ type: "BUILD", kind: "temple", role: "p1_resource_aura", priority: 98, builderCount: 4,
        builderPool: strategicBuilderPool, reason: "Village worker-efficiency temple after barracks 2" });
    else
      actions.push({ type: "RESERVE", kind: "temple", role: "p1_resource_aura", priority: 98, cost,
        reason: "protect P1 worker-efficiency temple before forge/expansion spending" });
  }

  // IT14.35 keeps the two-forge staging, but Village-phase City States get their
  // worker-efficiency temple first once its normal post-barracks window is open.
  // This matches the intended Barracks #2 -> Temple -> P2/Forge transition without
  // changing the second-barracks timing or blocking Forge #1 once Town is reached.
  const preForgeTemplePipeline = state.structures.temple + state.foundations.temple + state.queued.temple;
  const p1TemplePriorityPending = state.phase === 1 && state.flags.templeBuildable &&
    completedBarracks >= 2 && preForgeTemplePipeline === 0 &&
    state.population.used >= policy.p1TemplePopulation &&
    (fieldPipeline >= policy.p1TempleMinimumFieldPipeline || infrastructureNaturalReady);

  const forgePipeline = state.structures.forge + state.foundations.forge + state.queued.forge;
  const forgePending = state.foundations.forge + state.queued.forge;
  let transitionForgeTarget = 0;
  const forgeOneReady = state.structures.barracks >= 2 &&
    state.population.used >= policy.phase2Forge1Population &&
    (state.structures.field >= policy.phase2ForgeTransitionMinimumFields || infrastructureNaturalReady) &&
    (state.phase >= 2 || state.time >= policy.phase2ForgeTransitionTime) &&
    !p1TemplePriorityPending;
  if (forgeOneReady)
    transitionForgeTarget = 1;
  // IT14.64: Forge #2 is not a milestone. It only exists to open a second *usable*
  // military-research lane while Forge #1 is already doing useful work.
  const forgeTwoReady = state.phase >= 2 &&
    state.flags.forgeSecondUseful &&
    state.structures.barracks >= 2 &&
    state.population.used >= policy.phase2Forge2Population &&
    (state.structures.field >= policy.phase2ForgeSecondMinimumFields || infrastructureNaturalReady) &&
    state.resources.food >= policy.phase2ForgeSecondFoodBank;
  if (forgeTwoReady)
    transitionForgeTarget = 2;
  if (forgePipeline < transitionForgeTarget && forgePending === 0) {
    const cost = costOf(state, policy, "forge");
    const canBuild = resourceEnough(state.resources, cost, reservations);
    addReservation(reservations, cost);
    const next = forgePipeline + 1;
    const priority = next === 1 ? 96 : next === 2 ? 95 : 90;
    if (canBuild)
      actions.push({ type: "BUILD", kind: "forge", role: `transition_forge_${next}`, priority,
        builderPool: strategicBuilderPool, reason: `phase infrastructure forge ${next}/${transitionForgeTarget}` });
    else
      actions.push({ type: "RESERVE", kind: "forge", role: `transition_forge_${next}`, priority,
        cost, reason: `reserve forge ${next}/${transitionForgeTarget} before optional expansion` });
  }

  // Town-phase production ramp. P1 remains exactly two barracks. Once P2 is
  // complete, eight established fields and a modest resource bank are enough to
  // justify barracks #3; this should not wait for the full ten-field mature goal.
  const thirdBarracksReady = state.phase >= 2 && completedBarracks === 2 && pendingBarracks === 0 &&
    // Get the first market online before barracks #3 so Expert gains a dropsite,
    // barter safety valve and one Town-class structure instead of letting a difficult
    // barracks placement reserve the same wood every frame.
    (state.structures.market + state.foundations.market + state.queued.market) >= 1 &&
    state.population.used >= policy.phase2ThirdBarracksPopulation &&
    (state.structures.field >= policy.phase2ThirdBarracksMinimumFields || infrastructureNaturalReady) &&
    state.resources.food >= policy.phase2ThirdBarracksFoodBank &&
    state.resources.wood >= policy.phase2ThirdBarracksWoodBank;
  if (thirdBarracksReady) {
    const cost = costOf(state, policy, "barracks");
    if (resourceEnough(state.resources, cost, reservations)) {
      actions.push({ type: "BUILD", kind: "barracks", role: "third_p2", priority: 93, builderPool: strategicBuilderPool, reason: `Town production ramp (${state.population.used} pop, ${state.structures.field} fields)` });
      addReservation(reservations, cost);
    }
  }

  // IT14.59: City boom converts the mature bank into production throughput. The
  // fourth/fifth Barracks are impossible before P3 by construction.
  if (state.phase >= 3 && pendingBarracks === 0 && completedBarracks >= 3 && completedBarracks < 5) {
    const fourth = completedBarracks === 3;
    const popGate = fourth ? policy.cityFourthBarracksPopulation : policy.cityFifthBarracksPopulation;
    const foodGate = fourth ? policy.cityFourthBarracksFoodBank : policy.cityFifthBarracksFoodBank;
    const woodGate = fourth ? policy.cityFourthBarracksWoodBank : policy.cityFifthBarracksWoodBank;
    if (state.population.used >= popGate && state.resources.food >= foodGate && state.resources.wood >= woodGate) {
      const cost = costOf(state, policy, "barracks");
      if (resourceEnough(state.resources, cost, reservations)) {
        actions.push({ type: "BUILD", kind: "barracks", role: fourth ? "fourth_p3" : "fifth_p3",
          priority: fourth ? 94 : 92, builderPool: strategicBuilderPool,
          reason: `City all-in production ramp ${completedBarracks + 1}/5 (${state.population.used} pop)` });
        addReservation(reservations, cost);
      }
    }
  }

  // First Town market: retain the resource-dropsite behavior that worked well in
  // IT14.32.
  const marketPipeline = state.structures.market + state.foundations.market + state.queued.market;
  if (state.phase >= 2 && state.structures.barracks >= 2 && marketPipeline === 0 &&
      state.population.used >= policy.phase2MarketPopulation) {
    const cost = costOf(state, policy, "market");
    const canBuildMarket = state.resources.wood >= (cost.wood || 0) + policy.phase2MarketWoodReserve &&
      state.resources.food >= (cost.food || 0) && state.resources.stone >= (cost.stone || 0) && state.resources.metal >= (cost.metal || 0) &&
      resourceEnough(state.resources, cost, reservations);
    addReservation(reservations, cost);
    if (canBuildMarket)
      actions.push({ type: "BUILD", kind: "market", role: "town_market", priority: 94, builderPool: strategicBuilderPool, reason: "establish Town market and barter/dropsite capacity" });
    else
      actions.push({ type: "RESERVE", kind: "market", role: "town_market", priority: 94, cost, reason: "protect first Town market before optional P2 spending" });
  }

  // If the next phase still needs another Town-class structure, add a second
  // strategically placed market after the core P2 military infrastructure exists.
  // This gives Athens the useful 2-market path to City Phase without invoking Petra's
  // generic building planner or disturbing the first market placement.
  const needsTownStructure = state.phase === 2 &&
    Number(state.flags.phase3TownRequired || 0) > Number(state.flags.phase3TownCount || 0);
  if (needsTownStructure && state.flags.marketBuildable && state.structures.market === 1 &&
      state.foundations.market + state.queued.market === 0 &&
      state.structures.barracks >= 2 &&
      state.population.used >= policy.phase2SecondMarketPopulation) {
    const cost = costOf(state, policy, "market");
    const canBuildSecondMarket = state.resources.wood >= (cost.wood || 0) + policy.phase2SecondMarketWoodReserve &&
      state.resources.food >= (cost.food || 0) && state.resources.stone >= (cost.stone || 0) && state.resources.metal >= (cost.metal || 0) &&
      resourceEnough(state.resources, cost, reservations);
    addReservation(reservations, cost);
    if (canBuildSecondMarket)
      actions.push({ type: "BUILD", kind: "market", role: "phase3_town_support", priority: 91,
        builderPool: strategicBuilderPool, reason: `satisfy Town requirement ${state.flags.phase3TownCount}/${state.flags.phase3TownRequired} for P3` });
    else
      actions.push({ type: "RESERVE", kind: "market", role: "phase3_town_support", priority: 91, cost,
        reason: `reserve second Town building for P3 (${state.flags.phase3TownCount}/${state.flags.phase3TownRequired})` });
  }

  // IT14.35: temples are economic infrastructure, not a P2 luxury. They are buildable
  // in Village phase in CWA and their 75m worker aura pays back while the economy is
  // still growing. Barracks #2 remains the hard military priority; after it is complete,
  // establish one temple once a modest permanent-food pipeline exists. If the P1 window
  // was missed, retain a P2 fallback around the established worker/resource district.
  const templePending = state.structures.temple + state.foundations.temple + state.queued.temple;
  const p2TempleReady = state.phase >= 2 && state.structures.barracks >= 2 &&
    state.population.used >= policy.phase2TemplePopulation &&
    (fieldPipeline >= policy.phase2TempleMinimumFields || infrastructureNaturalReady);
  if (state.flags.templeBuildable && templePending === 0 && p2TempleReady) {
    const cost = costOf(state, policy, "temple");
    const protectedCost = { ...cost, wood: (cost.wood || 0) + (policy.phase2TempleWoodReserve || 0) };
    const canBuildTemple = resourceEnough(state.resources, protectedCost, reservations);
    addReservation(reservations, cost);
    if (canBuildTemple)
      actions.push({ type: "BUILD", kind: "temple", role: "resource_aura", priority: 97, builderCount: 4,
        builderPool: strategicBuilderPool, reason: "establish worker-efficiency temple during Town growth" });
    else
      actions.push({ type: "RESERVE", kind: "temple", role: "resource_aura", priority: 97, cost,
        reason: "protect early worker-efficiency temple from optional spending" });
  }

  // 5. Wood rollover is a hard economic continuity obligation. Once a large
  // wood workforce is outgrowing the current site, reserve/build the next dropsite
  // before optional farm expansion can spend the same wood.
  const totalStores = state.structures.storehouse + state.foundations.storehouse + state.queued.storehouse;
  const maximumWoodStores = state.phase >= 2 ? policy.maximumTownWoodStorehouses : policy.maximumVillageWoodStorehouses;
  const liveWoodServiceStores = Math.max(0, Number(state.flags.woodServiceStorehouses) || 0);
  const continuityEmergency = !!(state.flags.phaseWoodCrisis || state.flags.woodIncomeStalled);
  const underSoftWoodDistrictCap = liveWoodServiceStores < maximumWoodStores;
  // When food capacity is deadlocked and wood is already abundant, another ordinary
  // forest Storehouse is not the bottleneck. A true phase/wood-income emergency can
  // still override this brake.
  const woodExpansionBrake = foodCapacityDeadlock && !continuityEmergency &&
    state.resources.wood >= policy.foodCapacityDeadlockWoodSurplus;
  if (totalStores >= 1 && !woodExpansionBrake && (underSoftWoodDistrictCap || continuityEmergency) && woodsite.expand &&
      state.foundations.storehouse + state.queued.storehouse === 0) {
    const cost = costOf(state, policy, "storehouse");
    const canBuild = resourceEnough(state.resources, cost, reservations);
    const priority = continuityEmergency ? (Number(policy.phaseWoodRecoveryDropsiteActionPriority) || 125) : 92;
    addReservation(reservations, cost);
    if (canBuild)
      actions.push({ type: "BUILD", kind: "storehouse", role: "expansion", priority, builderPool: ["wood", "citizenSoldierWood"],
        reason: woodsite.reason + ` (live wood districts ${liveWoodServiceStores}/${maximumWoodStores})` });
    else
      actions.push({ type: "RESERVE", kind: "storehouse", role: "expansion", priority, cost,
        reason: continuityEmergency ? "wood continuity emergency: reserve the next 100 wood for a forest dropsite" :
          "reserve wood for the next worksite before optional spending" });
  }

  // 6. Natural food outranks additional farming. If another worthwhile in-territory
  // fruit/berry cluster needs a dropsite, cover it before spending the same wood on
  // extra fields. Barracks reservations above still win, so military timing is protected.
  if (farm.mode === "natural_expand") {
    const currentFarmsteads = state.structures.farmstead + state.foundations.farmstead + state.queued.farmstead;
    if (currentFarmsteads >= 1 && currentFarmsteads < farm.desiredFarmsteads && state.foundations.farmstead + state.queued.farmstead === 0) {
      const cost = costOf(state, policy, "farmstead");
      if (resourceEnough(state.resources, cost, reservations)) {
        actions.push({ type: "BUILD", kind: "farmstead", role: "natural_expansion", priority: 96, builderPool: ["food", "food_owned", "farm"], reason: "cover worthwhile in-territory natural food before expanding farms" });
        addReservation(reservations, cost);
      } else {
        actions.push({ type: "RESERVE", kind: "farmstead", role: "natural_expansion", priority: 96, cost, reason: "reserve wood for higher-throughput natural food" });
        addReservation(reservations, cost);
      }
    }
  }

  // 7. Permanent farm capacity is just-in-time. Fill legal touching slots first and only
  // create another farm hub after current slots are truly exhausted.
  if (farm.missingFields > 0 || farm.prebuild || farm.mode === "prepare" || farm.mode === "transition") {
    const currentFarmsteads = state.structures.farmstead + state.foundations.farmstead + state.queued.farmstead;
    const existingFields = state.structures.field + state.foundations.field + state.queued.field;
    const pendingFields = state.foundations.field + state.queued.field;

    const theoreticalFieldSlots = Math.max(1, currentFarmsteads) * policy.fieldsPerFarmstead;
    const supportedFieldSlots = state.food.fieldCapacityKnown ?
      Math.max(existingFields, state.food.supportedFieldSlots) : theoreticalFieldSlots;
    const openFieldSlots = state.food.fieldCapacityKnown ?
      Math.max(0, state.food.openFieldSlots) : Math.max(0, supportedFieldSlots - existingFields);

    // IT14.21 farmstead contract:
    // A) an uncovered worthwhile in-territory natural-food source may get its own dropsite
    //    through the natural_expand branch above; OR
    // B) a permanent farm hub may be added only after an existing hub is genuinely full:
    //    at least 3 completed fields around that saturated hub and no legal touching slot.
    // High field demand by itself is NEVER permission to spam another farmstead.
    const saturatedHubReady = state.food.maxSaturatedHubFields >= policy.minimumFieldsBeforeNextFarmHub;
    // FARM NON-REGRESSION LOCK (IT14.26): never deadlock merely because the first
    // permanent fields were split across two natural-food districts. If the *entire*
    // existing farm network is measured full and we already paid for four permanent
    // fields, that is enough evidence that the current farmsteads have been used before
    // buying another hub. This preserves the normal 3-fields-on-one-hub rule while
    // escaping the 2+2 saturation pattern seen in IT14.25.
    const saturatedNetworkReady = currentFarmsteads >= 2 && existingFields >= 4 && openFieldSlots <= 0;
    // IT14.40: the opening berry/fruit farmstead is deliberately placed as a dropsite,
    // not a perfect farm hub. On some maps it has exactly two legal field slots. Waiting
    // for three completed fields before permitting hub #2 creates a hard food deadlock:
    // 10 fields wanted, 2 possible, thousands of wood banked. Once natural food is
    // exhausted, two genuinely saturated fields are enough to prove the opening hub is
    // fully utilized. This exception applies only to the single opening-farmstead case.
    const constrainedOpeningHubReady = currentFarmsteads === 1 &&
      existingFields >= policy.minimumFieldsBeforeConstrainedOpeningFarmHub &&
      state.food.maxSaturatedHubFields >= policy.minimumFieldsBeforeConstrainedOpeningFarmHub &&
      openFieldSlots <= 0 &&
      Math.max(0, Number(state.food.totalNaturalRemaining) || 0) <= policy.naturalExpansionDepletionThreshold;
    // IT14.55 hard escape: if natural food is gone, fields are still missing, and the
    // measured network has zero legal slots, build a dedicated farm hub regardless of
    // how the earlier natural-food farmsteads split their first 1-3 fields. Requiring
    // field #4 before allowing the Farmstead that makes field #4 possible is a deadlock.
    const forcedCapacityHubReady = foodCapacityDeadlock;
    const permanentHubNeeded = farm.missingFields > 0 && openFieldSlots <= 0 &&
      pendingFields === 0 && (saturatedHubReady || saturatedNetworkReady || constrainedOpeningHubReady || forcedCapacityHubReady);
    const farmsteadActionAlreadyPlanned = actions.some(action => action && action.kind === "farmstead" && (action.type === "BUILD" || action.type === "RESERVE"));
    if (permanentHubNeeded && !farmsteadActionAlreadyPlanned &&
        state.foundations.farmstead + state.queued.farmstead === 0) {
      const cost = costOf(state, policy, "farmstead");
      const forcedRole = forcedCapacityHubReady;
      const constrainedRole = !forcedRole && constrainedOpeningHubReady && !saturatedHubReady && !saturatedNetworkReady;
      const role = forcedRole ? "farm_hub_deadlock" : constrainedRole ? "farm_hub_constrained" : "farm_hub";
      const reason = forcedRole ?
        `FOOD CAPACITY DEADLOCK fields=${existingFields}/${farm.desiredFields} open=0 natural=${Math.round(state.food.totalNaturalRemaining)}; force dedicated farm hub now` :
        constrainedRole ?
        `opening food hub saturated at ${state.food.maxSaturatedHubFields} fields; ${farm.missingFields} fields still missing` :
        `completed farm layout has no touching field slots; ${farm.missingFields} fields still missing`;
      if (resourceEnough(state.resources, cost, reservations)) {
        actions.push({ type: "BUILD", kind: "farmstead", role, priority: forcedRole ? 114 : 96, builderCount: forcedRole ? 6 : undefined, builderPool: ["food", "food_owned", "farm"], reason });
        addReservation(reservations, cost);
      } else {
        actions.push({ type: "RESERVE", kind: "farmstead", role, priority: forcedRole ? 114 : 96, cost, reason: forcedRole ?
          "reserve wood immediately to escape zero-slot permanent-food deadlock" : constrainedRole ?
          "reserve wood to escape saturated two-field opening food hub" :
          "reserve wood for next compact farm hub after current fields finish" });
        addReservation(reservations, cost);
      }
    }

    const parallelFieldCap = (state.phase >= 2 || state.resources.wood >= policy.fieldParallelExpansionWoodBank) &&
      farm.missingFields >= 4 ? policy.maxConcurrentFieldTasksSurplus : policy.maxConcurrentFieldTasks;
    // IT14.49: uncovered worthwhile natural food is now a sequencing veto, not merely
    // a higher-priority reservation. If the planner has selected natural_expand, spend
    // the next wood on that farmstead before starting another field. Only a genuinely
    // critical food bank may use a field as an emergency bridge while placement retries.
    const naturalExpansionFieldEmergency = farm.mode === "natural_expand" &&
      state.resources.food < policy.naturalFoodEmergencyFieldFoodBank;
    if (farm.missingFields > 0 && openFieldSlots > 0 && pendingFields < parallelFieldCap &&
        (farm.mode !== "natural_expand" || naturalExpansionFieldEmergency || foodInfrastructureEmergency)) {
      const fieldCost = costOf(state, policy, "field");
      const availableStarts = Math.max(0, parallelFieldCap - pendingFields);
      // When permanent food is materially behind (for example 6 built vs 14 wanted),
      // use several idle civilians to create capacity in parallel instead of waiting for
      // one field to finish before placing the next. Existing hubs are always filled
      // before another farmstead is considered.
      const starts = Math.min(farm.missingFields, openFieldSlots, availableStarts);
      for (let i = 0; i < starts; ++i) {
        if (!resourceEnough(state.resources, fieldCost, reservations)) {
          if (i === 0) {
            actions.push({ type: "RESERVE", kind: "field", priority: foodInfrastructureEmergency ? 113 : 95, cost: fieldCost, reason: foodInfrastructureEmergency ? "sustained delivered-food deficit: reserve emergency field capacity" : "reserve wood for just-in-time permanent food capacity" });
            addReservation(reservations, fieldCost);
          }
          break;
        }
        actions.push({ type: "BUILD", kind: "field", role: `capacity_${i+1}`, priority: foodInfrastructureEmergency ? 113 : 95, builderPool: ["food", "food_owned", "farm"], reason: foodInfrastructureEmergency ? `sustained delivered-food deficit needs field capacity (${i+1}/${starts})` : farm.prebuild ? "natural-food runway says permanent food should be prepared now" : `${farm.mode} food mode needs field capacity (${i+1}/${starts})` });
        addReservation(reservations, fieldCost);
      }
    }
  }


  // IT14.55: do not manufacture dozens of civilians into a zero-slot food network.
  // Existing workers immediately build the forced hub/fields; civilian production
  // resumes automatically as soon as legal food capacity exists again.
  if (severeFoodCapacityDeadlock)
    actions.push({ type: "PAUSE_POPULATION_TRAINING", priority: 111, reason: `food capacity deadlock: open=0 missing=${farm.missingFields} overflow=${state.workers.overflowWood} idle=${state.workers.idle}` });

  // IT14.63: Expert deliberately stops at two Forges. Their purpose is parallel
  // military research; a third Forge after the useful tech lanes are mostly exhausted
  // only consumes resources/builders without improving the timing.


  for (let i = 0; i < actions.length; ++i)
    actions[i] = efficientBuilderIntent(actions[i], state, policy);
  actions.sort((a, b) => b.priority - a.priority);

  return {
    policy,
    state,
    derived: {
      accountedFreePopulation: accountedFreePopulation(state),
      houseTriggerFreePopulation: housing.trigger,
      foodMode: farm.mode,
      desiredFields: farm.desiredFields,
      desiredFarmsteads: farm.desiredFarmsteads,
      preferredFarmersPerField: farm.farmersPerField,
      effectiveWorkersPerField: farm.effectiveWorkersPerField,
      foodInfrastructureEmergency,
      farmPrebuild: farm.prebuild,
      maxSaturatedHubFields: state.food.maxSaturatedHubFields,
      fieldsForOneBarracks: farm.fieldsForOneBarracks,
      fieldsForTwoBarracks: farm.fieldsForTwoBarracks,
      requiredSecondFields: farm.requiredSecondFields,
      secondBarracksFoodReady: farm.secondBarracksFoodReady,
      secondBarracksBridgeSeconds: farm.secondBarracksBridgeSeconds,
      secondBarracksProjectedRate: farm.secondBarracksProjectedRate,
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
  predictiveHouseTrigger,
  housingDecision,
  hasWorthwhileAlternativeFood,
  foodMode,
  fieldDemand,
  effectiveFieldWorkerUnits,
  woodWorksiteDecision,
  resourceEnough
};
