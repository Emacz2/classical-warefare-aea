const FOOD_CONSTRUCTION = new Set(["field", "farmstead"]);
const WOOD_CONSTRUCTION = new Set(["house", "storehouse", "barracks"]);

function canBorrowForConstruction(workerJob, buildingKind) {
  if (FOOD_CONSTRUCTION.has(buildingKind))
    return workerJob === "food" || workerJob === "farm";
  if (WOOD_CONSTRUCTION.has(buildingKind))
    return workerJob === "wood" || workerJob === "citizenSoldierWood";
  return false;
}

function planJobChange(worker, nextJob) {
  const carrying = worker && worker.carrying;
  if (carrying && carrying.amount > 0) {
    return {
      action: "RETURN_RESOURCES",
      then: "CHANGE_JOB",
      nextJob,
      reason: `carrying ${carrying.amount} ${carrying.type}; deposit before reassignment`
    };
  }
  return { action: "CHANGE_JOB", nextJob, reason: "no carried resources to protect" };
}

function decideWoodWorkerTarget(observation) {
  if (observation.currentTreeValid)
    return { action: "KEEP_CURRENT_TREE", strategicExpansionRequest: false, reason: "task commitment" };
  if (observation.availableLocalTargets > 0)
    return { action: "TAKE_LOCAL_TREE", strategicExpansionRequest: false, reason: "same worksite has usable wood" };
  if (observation.saturatedLocalTargets > 0)
    return { action: "WAIT_AT_WORKSITE", strategicExpansionRequest: false, reason: "targets are occupied, not exhausted" };
  return {
    action: "REPORT_NO_LOCAL_TARGET",
    strategicExpansionRequest: false,
    reason: "worker reports a local condition; only the strategic planner may authorize expansion"
  };
}

export { canBorrowForConstruction, planJobChange, decideWoodWorkerTarget };
