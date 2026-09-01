function finiteNonNegativeInteger(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function cloneAssignments(assignments = {}) {
  const out = {};
  for (const [id, ordinal] of Object.entries(assignments || {})) {
    const n = finiteNonNegativeInteger(ordinal, 0);
    if (n > 0)
      out[String(id)] = n;
  }
  return out;
}

function createCivilianRoster(seed = {}) {
  const assignments = cloneAssignments(seed.assignments);
  const highestAssigned = Object.values(assignments).reduce((max, ordinal) => Math.max(max, ordinal), 0);
  return {
    nextOrdinal: Math.max(finiteNonNegativeInteger(seed.nextOrdinal, 0), highestAssigned),
    assignments
  };
}

function allocateCivilianOrdinal(rawRoster, civilianId) {
  if (civilianId === undefined || civilianId === null)
    throw new Error("allocateCivilianOrdinal requires civilianId");
  const roster = createCivilianRoster(rawRoster);
  const key = String(civilianId);
  if (roster.assignments[key])
    return { roster, ordinal: roster.assignments[key], allocated: false };

  const ordinal = roster.nextOrdinal + 1;
  roster.nextOrdinal = ordinal;
  roster.assignments[key] = ordinal;
  return { roster, ordinal, allocated: true };
}

function reconcileCivilianRoster(rawRoster, civilianIds = [], explicitOrdinals = {}) {
  let roster = createCivilianRoster(rawRoster);
  const results = [];
  const ids = [...civilianIds].map(id => String(id)).sort((a, b) => {
    const na = Number(a), nb = Number(b);
    return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.localeCompare(b);
  });

  // Explicit ordinals (typically persistent entity metadata restored from a save)
  // always win and advance the monotonic counter. We never renumber survivors.
  for (const id of ids) {
    const explicit = finiteNonNegativeInteger(explicitOrdinals[id], 0);
    if (explicit > 0) {
      roster.assignments[id] = explicit;
      roster.nextOrdinal = Math.max(roster.nextOrdinal, explicit);
      results.push({ id, ordinal: explicit, allocated: false, source: "explicit" });
      continue;
    }
    const result = allocateCivilianOrdinal(roster, id);
    roster = result.roster;
    results.push({ id, ordinal: result.ordinal, allocated: result.allocated, source: result.allocated ? "allocated" : "roster" });
  }
  return { roster, civilians: results };
}

function decideCivilianJob(input = {}) {
  const ordinal = finiteNonNegativeInteger(input.ordinal, 0);
  if (ordinal <= 0)
    throw new Error("decideCivilianJob requires ordinal >= 1");

  const startingFood = Math.max(1, finiteNonNegativeInteger(input.startingNaturalFoodCivilians, 4));
  const firstWood = Math.max(1, finiteNonNegativeInteger(input.firstTrainedWoodCivilians, 3));
  const secondFood = Math.max(1, finiteNonNegativeInteger(input.secondTrainedFoodCivilians, 3));
  const targetWood = Math.max(firstWood, finiteNonNegativeInteger(input.targetWoodCivilians, 20));

  const firstWoodEnd = startingFood + firstWood;
  const secondFoodEnd = firstWoodEnd + secondFood;
  const remainingWood = Math.max(0, targetWood - firstWood);
  const woodEnd = secondFoodEnd + remainingWood;

  if (ordinal <= startingFood)
    return { job: "food", reason: `starting civilians 1-${startingFood} stay on natural food` };
  if (ordinal <= firstWoodEnd)
    return { job: "wood", reason: `first trained batch (${startingFood + 1}-${firstWoodEnd}) goes to wood` };
  if (ordinal <= secondFoodEnd)
    return { job: "food", reason: `second trained batch (${firstWoodEnd + 1}-${secondFoodEnd}) reinforces food` };
  if (ordinal <= woodEnd)
    return { job: "wood", reason: `subsequent civilians finish the ${targetWood}-civilian wood workforce` };

  // Once the 20-civilian wood workforce is filled, every NEW civilian is food-owned.
  // Completed farm slots are preferred; safe natural food remains a temporary bridge.
  const farmersPerField = Math.max(1, finiteNonNegativeInteger(input.farmersPerField, 5));
  const fields = finiteNonNegativeInteger(input.fields, 0);
  const farmWorkers = finiteNonNegativeInteger(input.farmWorkers, 0);
  const farmCapacity = Number.isFinite(Number(input.farmCapacity)) ? Math.max(0, Number(input.farmCapacity)) : fields * farmersPerField;
  if (farmWorkers < farmCapacity)
    return { job: "farm", reason: `civilian ${woodEnd + 1}+ takes completed farm capacity first` };

  return {
    job: "food_owned",
    reason: `civilian ${woodEnd + 1}+ remains food-owned while permanent farm capacity catches up`
  };
}

function decidePostOpeningCivilianJob(input = {}) {
  const food = Math.max(0, Number(input.food) || 0);
  const wood = Math.max(0, Number(input.wood) || 0);
  const civilians = finiteNonNegativeInteger(input.civilians, 0);
  const woodCivilians = finiteNonNegativeInteger(input.woodCivilians, 0);
  const foodWorkers = finiteNonNegativeInteger(input.foodWorkers, 0);
  const stoneWorkers = finiteNonNegativeInteger(input.stoneWorkers, 0);
  const metalWorkers = finiteNonNegativeInteger(input.metalWorkers, 0);
  const fields = finiteNonNegativeInteger(input.fields, 0);
  const farmWorkers = finiteNonNegativeInteger(input.farmWorkers, 0);
  const farmersPerField = Math.max(1, finiteNonNegativeInteger(input.farmersPerField, 3));
  const farmCapacity = Math.max(0, fields * farmersPerField);
  const requiredFoodWorkers = Math.max(0, finiteNonNegativeInteger(input.requiredFoodWorkers, 10));
  const naturalFoodAvailable = !!input.naturalFoodAvailable;

  const foodFloor = Math.max(0, Number(input.postOpeningFoodFloor) || 300);
  const miningStart = Math.max(0, finiteNonNegativeInteger(input.miningStartCivilians, 45));
  const miningMinimumFields = Math.max(0, finiteNonNegativeInteger(input.miningMinimumCompletedFields, 6));
  const miningWoodFloor = Math.max(0, Number(input.miningWoodFloor) || 300);
  const stoneTarget = Math.max(0, finiteNonNegativeInteger(input.miningTargetStoneWorkers, 6));
  const metalTarget = Math.max(0, finiteNonNegativeInteger(input.miningTargetMetalWorkers, 6));

  // IT14.20 contract: ordinary civilians own food after the opening 20-civilian
  // wood tranche. Citizen-soldiers carry later wood growth. A food-owned civilian
  // may TEMPORARILY chop wood when no completed food slot exists, but its permanent
  // job remains food_owned so the next field immediately pulls it back.
  if (woodCivilians < 20)
    return { job: "wood", reason: "restore the 20-civilian opening wood workforce" };

  if (foodWorkers < requiredFoodWorkers) {
    if (naturalFoodAvailable)
      return { job: "food_owned", reason: `food workforce ${foodWorkers}/${requiredFoodWorkers}; exploit remaining natural food` };
    if (farmWorkers < farmCapacity)
      return { job: "farm", reason: `food workforce ${foodWorkers}/${requiredFoodWorkers}; take completed farm capacity` };
    return { job: "food_owned", reason: `food workforce ${foodWorkers}/${requiredFoodWorkers}; wait productively for permanent food capacity` };
  }

  // Generic mining still opens only after six completed fields. Once that durable
  // food base exists, NEW civilians may establish metal first and then a small stone
  // reserve. Wood remains the citizen-soldier responsibility rather than exceeding
  // the 20 permanent civilian woodcutters.
  if (fields >= miningMinimumFields && civilians >= miningStart && wood >= miningWoodFloor && food >= foodFloor) {
    if (metalWorkers < metalTarget)
      return { job: "metal", reason: `six-field food base is online; establish metal reserve (${metalWorkers}/${metalTarget})` };
    if (stoneWorkers < stoneTarget)
      return { job: "stone", reason: `metal reserve established; begin limited stone reserve (${stoneWorkers}/${stoneTarget})` };
  }

  if (farmWorkers < farmCapacity)
    return { job: "farm", reason: "post-20 civilian takes completed permanent-food capacity" };
  return {
    job: "food_owned",
    reason: naturalFoodAvailable ?
      "post-20 civilian remains food-owned on natural food" :
      "post-20 civilian remains food-owned while fields catch up"
  };
}

function resourceBalanceDirective(input = {}) {
  const banks = {
    food: Math.max(0, Number(input.food) || 0),
    wood: Math.max(0, Number(input.wood) || 0),
    stone: Math.max(0, Number(input.stone) || 0),
    metal: Math.max(0, Number(input.metal) || 0)
  };
  const weights = {
    food: Math.max(0.01, Number(input.weights && input.weights.food) || 1),
    wood: Math.max(0.01, Number(input.weights && input.weights.wood) || 1),
    stone: Math.max(0.01, Number(input.weights && input.weights.stone) || 1),
    metal: Math.max(0.01, Number(input.weights && input.weights.metal) || 1)
  };
  const activation = Math.max(0, Number(input.activationBank) || 1000);
  const ratioFloor = Math.max(1, Number(input.ratioFloor) || 250);
  const newWorkerRatio = Math.max(1, Number(input.newWorkerRatio) || 2);
  const strongRatio = Math.max(newWorkerRatio, Number(input.strongRatio) || 3);
  const foodPriorityBank = Math.max(0, Number(input.foodPriorityBank) || 700);

  const ranked = Object.entries(banks).map(([type, amount]) => ({
    type, amount, weight: weights[type], normalized: amount / weights[type]
  })).sort((a, b) => b.normalized - a.normalized || a.type.localeCompare(b.type));
  const surplus = ranked[0];
  if (!surplus || surplus.amount < activation)
    return { active: false, banks, weights };

  const allowedTargets = new Set(Array.isArray(input.allowedTargets) && input.allowedTargets.length ?
    input.allowedTargets : ["food", "wood", "stone", "metal"]);
  let target;
  if (surplus.type !== "food" && allowedTargets.has("food") && banks.food < foodPriorityBank)
    target = { type: "food", amount: banks.food, weight: weights.food, normalized: banks.food / weights.food };
  else
    target = ranked.filter(item => item.type !== surplus.type && allowedTargets.has(item.type))
      .sort((a, b) => a.normalized - b.normalized || a.type.localeCompare(b.type))[0];
  if (!target)
    return { active: false, banks, weights };

  const ratio = surplus.normalized / Math.max(ratioFloor, target.normalized);
  if (ratio < newWorkerRatio)
    return { active: false, banks, weights, surplus: surplus.type, target: target.type, ratio };

  return {
    active: true,
    strong: ratio >= strongRatio,
    banks,
    weights,
    surplus: surplus.type,
    target: target.type,
    ratio
  };
}


function foodWoodFeedbackDirective(input = {}) {
  const time = Math.max(0, Number(input.time) || 0);
  const food = Math.max(0, Number(input.food) || 0);
  const wood = Math.max(0, Number(input.wood) || 0);
  const foodIncomeRate = Math.max(0, Number(input.foodIncomeRate) || 0);
  const foodBurnRate = Math.max(0, Number(input.foodBurnRate) || 0);
  const foodSlots = Math.max(0, finiteNonNegativeInteger(input.foodSlots, 0));
  const fieldFoundations = Math.max(0, finiteNonNegativeInteger(input.fieldFoundations, 0));
  const fields = Math.max(0, finiteNonNegativeInteger(input.fields, 0));
  const overflowWood = Math.max(0, finiteNonNegativeInteger(input.overflowWood, 0));
  const woodCivilians = Math.max(0, finiteNonNegativeInteger(input.woodCivilians, 0));

  const startTime = Math.max(0, Number(input.startTime) || 180);
  const recoveryFoodBank = Math.max(0, Number(input.recoveryFoodBank) || 500);
  const recoveryWoodBank = Math.max(0, Number(input.recoveryWoodBank) || 450);
  const recoveryWoodFoodRatio = Math.max(1, Number(input.recoveryWoodFoodRatio) || 1.5);
  const recoveryRateRatio = Math.max(0.1, Number(input.recoveryRateRatio) || 1.05);
  const strongWoodFoodRatio = Math.max(recoveryWoodFoodRatio, Number(input.strongWoodFoodRatio) || 2.25);
  const minimumCivilianWood = Math.max(0, finiteNonNegativeInteger(input.minimumCivilianWood, 12));
  const maxReassign = Math.max(0, finiteNonNegativeInteger(input.maxReassign, 2));

  const releaseFields = Math.max(0, finiteNonNegativeInteger(input.releaseFields, 7));
  const releaseFoodBank = Math.max(0, Number(input.releaseFoodBank) || 900);
  const releaseRateRatio = Math.max(1, Number(input.releaseRateRatio) || 1.30);
  const releaseFoodWoodRatio = Math.max(1, Number(input.releaseFoodWoodRatio) || 1.75);
  const releaseWoodBankCeiling = Math.max(0, Number(input.releaseWoodBankCeiling) || 550);

  const bankRatio = wood / Math.max(150, food);
  const rateRatio = foodBurnRate > 0 ? foodIncomeRate / foodBurnRate : 999;

  const bankRecovery = food < recoveryFoodBank && wood >= recoveryWoodBank && bankRatio >= recoveryWoodFoodRatio;
  const rateRecovery = foodBurnRate > 0 && rateRatio < recoveryRateRatio && food < recoveryFoodBank + 200 && wood > food;
  // Overflow capacity only signals food recovery while the food bank is actually
  // under pressure.  In IT14.34 a mature 10-field economy with 3k food / 100 wood
  // still reported food_recovery solely because several food-owned workers were
  // overflowing.  That suppressed the farmer->wood emergency valve forever.
  const capacityRecovery = overflowWood >= 4 &&
    food < recoveryFoodBank + 300 &&
    (foodBurnRate <= 0 || rateRatio < Math.max(recoveryRateRatio, 1.15));
  const recovery = time >= startTime && (bankRecovery || rateRecovery || capacityRecovery);

  const strongRecovery = recovery && (
    bankRatio >= strongWoodFoodRatio ||
    (foodBurnRate > 0 && rateRatio < 0.90 && food < recoveryFoodBank) ||
    (food < 300 && wood >= 600) ||
    overflowWood >= 8
  );

  const nearTermFoodCapacity = foodSlots > 0 || fieldFoundations > 0;
  const availableWoodCivilians = Math.max(0, woodCivilians - minimumCivilianWood);
  // Overflow by itself means "build food capacity", not "steal from wood". The IT14.18
  // benchmark had useful food overflow while wood was nearly empty; peeling lumberjacks
  // there would regress a strong opening. Existing wood civilians only move when the
  // wood bank is itself healthy and genuinely ahead of food.
  const woodCanFundRecovery = wood >= recoveryWoodBank && wood > food;
  const reassignCount = recovery && nearTermFoodCapacity && woodCanFundRecovery ?
    Math.min(availableWoodCivilians, strongRecovery ? maxReassign : Math.min(1, maxReassign)) : 0;

  const woodRelease = time >= startTime && !recovery &&
    fields >= releaseFields && food >= releaseFoodBank &&
    rateRatio >= releaseRateRatio &&
    (wood <= releaseWoodBankCeiling || food >= Math.max(1, wood) * releaseFoodWoodRatio);

  return {
    mode: woodRelease ? "wood_release" : recovery ? "food_recovery" : "balanced",
    food,
    wood,
    bankRatio,
    foodIncomeRate,
    foodBurnRate,
    rateRatio,
    foodSlots,
    fieldFoundations,
    fields,
    overflowWood,
    woodCivilians,
    recovery,
    strongRecovery,
    reassignCount,
    allowNewCivilianWood: woodRelease
  };
}

function serializeCivilianRoster(roster) {
  return createCivilianRoster(roster);
}

function deserializeCivilianRoster(data) {
  return createCivilianRoster(data);
}

export {
  createCivilianRoster,
  allocateCivilianOrdinal,
  reconcileCivilianRoster,
  decideCivilianJob,
  decidePostOpeningCivilianJob,
  resourceBalanceDirective,
  foodWoodFeedbackDirective,
  serializeCivilianRoster,
  deserializeCivilianRoster
};
