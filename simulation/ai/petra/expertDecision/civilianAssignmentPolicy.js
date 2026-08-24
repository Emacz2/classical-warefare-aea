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

  if (ordinal <= 7)
    return { job: "food", reason: "civilians 1-7 belong to the opening natural-food team" };
  if (ordinal <= 24)
    return { job: "wood", reason: "civilians 8-24 are the opening wood boom" };

  const primaryFoodRemaining = Math.max(0, Number(input.primaryFoodRemaining) || 0);
  if (primaryFoodRemaining > 0)
    return { job: "food", reason: "civilian 25+ remains in the food economy while primary natural food exists" };

  const farmersPerField = Math.max(1, finiteNonNegativeInteger(input.farmersPerField, 5));
  const fields = finiteNonNegativeInteger(input.fields, 0);
  const farmWorkers = finiteNonNegativeInteger(input.farmWorkers, 0);
  const farmCapacity = Number.isFinite(Number(input.farmCapacity)) ? Math.max(0, Number(input.farmCapacity)) : fields * farmersPerField;
  if (farmWorkers < farmCapacity)
    return { job: "farm", reason: "civilian 25+ uses available farm capacity" };

  return {
    job: "food_waiting_for_capacity",
    reason: "civilian 25+ remains food-owned; insufficient farm capacity must not silently turn it into a woodcutter"
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
  serializeCivilianRoster,
  deserializeCivilianRoster
};
