const ALLOWED_POOLS = Object.freeze({
  house: ["wood", "citizenSoldierWood"],
  storehouse: ["wood", "citizenSoldierWood"],
  barracks: ["wood", "citizenSoldierWood"],
  stable: ["wood", "citizenSoldierWood"],
  market: ["wood", "citizenSoldierWood"],
  forge: ["wood", "citizenSoldierWood"],
  temple: ["wood", "citizenSoldierWood"],
  arsenal: ["wood", "citizenSoldierWood"],
  gymnasium: ["wood", "citizenSoldierWood"],
  prytaneion: ["wood", "citizenSoldierWood"],
  cleruchy: ["wood", "citizenSoldierWood", "stone", "metal"],
  tower: ["wood", "citizenSoldierWood"],
  farmstead: ["food", "food_owned", "farm"],
  field: ["food", "food_owned", "farm"]
});

function desiredBuilders(kind, context = {}) {
  switch (kind) {
    case "house":
      if (context.emergency) return 4;
      return 3;
    case "field":
      // IT14.71: a planned field is a four-worker food task. The same four civilians
      // build the foundation together, then the controller permanently locks them to
      // that completed field. This avoids the one-builder delay and build->wander churn.
      return 4;
    case "farmstead":
      if (context.opening) return 4;
      return 2;
    case "storehouse":
      if (context.opening) return 4;
      return 2;
    case "barracks": return 4;
    case "stable": return 3;
    case "market": return 3;
    case "forge": return 3;
    case "temple": return 3;
    case "arsenal": return 4;
    case "gymnasium": return 4;
    case "prytaneion": return 4;
    case "cleruchy": return 6;
    case "tower": return 4;
    default: return 2;
  }
}

function constructionPriority(kind, context = {}) {
  switch (kind) {
    case "storehouse": return context.opening ? 100 : 98;
    case "house": return context.emergency ? 100 : context.urgent ? 96 : 65;
    case "field": return (Number(context.capacityDeficit) || 0) > 0 ? 94 : context.transition ? 88 : 70;
    case "farmstead": return context.opening ? 100 : 96;
    case "barracks": return context.urgent ? 99 : 93;
    case "stable": return 90;
    case "market": return 92;
    case "forge": return 90;
    case "temple": return 91;
    case "arsenal": return 97;
    case "gymnasium": return 94;
    case "prytaneion": return 96;
    case "cleruchy": return 93;
    case "tower": return context.emergency ? 100 : 94;
    default: return 50;
  }
}

function allocateBuilderBudget(tasks = [], maxBuilders = 8) {
  const cap = Math.max(1, Math.floor(Number(maxBuilders) || 8));
  const ordered = tasks.map((task, index) => ({
    ...task,
    key: String(task.key ?? index),
    wanted: Math.max(1, Math.floor(Number(task.wanted) || 1)),
    priority: Number.isFinite(Number(task.priority)) ? Number(task.priority) : constructionPriority(task.kind, task.context || {})
  })).sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
  const allocations = Object.fromEntries(ordered.map(task => [task.key, 0]));
  let remaining = cap;
  for (const task of ordered) {
    if (remaining <= 0) break;
    allocations[task.key] = 1;
    --remaining;
  }
  for (const task of ordered) {
    if (remaining <= 0) break;
    const add = Math.min(remaining, task.wanted - allocations[task.key]);
    if (add > 0) {
      allocations[task.key] += add;
      remaining -= add;
    }
  }
  return allocations;
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

export { ALLOWED_POOLS, desiredBuilders, constructionPriority, allocateBuilderBudget, updateConstructionTask };
