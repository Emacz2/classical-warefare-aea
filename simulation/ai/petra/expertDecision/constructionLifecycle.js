const ALLOWED_POOLS = Object.freeze({
  house: ["wood", "citizenSoldierWood"],
  storehouse: ["wood", "citizenSoldierWood"],
  barracks: ["wood", "citizenSoldierWood"],
  farmstead: ["food", "farm"],
  field: ["food", "farm"]
});

function desiredBuilders(kind) {
  switch (kind) {
    case "house": return 3;
    case "field": return 3;
    case "farmstead": return 4;
    case "storehouse": return 4;
    case "barracks": return 4;
    default: return 2;
  }
}

function updateConstructionTask(task, observation) {
  const kind = task.kind;
  const wanted = task.desiredBuilders || desiredBuilders(kind);
  const allowedJobs = task.allowedJobs || ALLOWED_POOLS[kind] || [];
  if (observation.completed)
    return { state: "completed", actions: [{ type: "RETURN_BUILDERS", builderIds: observation.builderIds || [] }], allowedJobs, desiredBuilders: wanted };
  if (!observation.foundationExists) {
    if (task.state === "planned")
      return { state: "planned", actions: [{ type: "WAIT_FOR_FOUNDATION" }], allowedJobs, desiredBuilders: wanted };
    return { state: "retry", actions: [{ type: "RETRY_PLACEMENT" }], allowedJobs, desiredBuilders: wanted };
  }
  const committed = observation.committedBuilders || 0;
  const missing = Math.max(0, wanted - committed);
  const actions = missing > 0 ?
    [{ type: "ASSIGN_BUILDERS", count: missing, allowedJobs }] :
    [{ type: "KEEP_BUILDERS_COMMITTED", count: wanted }];
  return { state: "foundation", actions, allowedJobs, desiredBuilders: wanted };
}

export { ALLOWED_POOLS, desiredBuilders, updateConstructionTask };
