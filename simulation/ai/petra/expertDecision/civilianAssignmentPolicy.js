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
  serializeCivilianRoster,
  deserializeCivilianRoster
};
