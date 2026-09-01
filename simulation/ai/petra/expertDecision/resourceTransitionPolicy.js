function carriedAmount(carrying = []) {
  return carrying.reduce((sum, item) => sum + Math.max(0, Number(item && item.amount) || 0), 0);
}

function carriedTypes(carrying = []) {
  const out = new Set();
  for (const item of carrying) {
    if (!item || !(Number(item.amount) > 0) || !item.type)
      continue;
    out.add(String(item.type));
  }
  return out;
}

function needsDepositBeforeRetarget(carrying = [], targetGeneric) {
  const types = carriedTypes(carrying);
  if (!types.size)
    return false;
  return Array.from(types).some(type => type !== targetGeneric);
}

function pendingTransitionDecision(pendingJob, carrying = []) {
  if (!pendingJob)
    return { action: "NONE" };
  if (carriedAmount(carrying) > 0)
    return { action: "DEPOSIT_ONLY", pendingJob };
  return { action: "COMMIT_PENDING", pendingJob };
}

function jobResourceType(job) {
  if (job === "wood" || job === "citizenSoldierWood" || job === "food_overflow_wood")
    return "wood";
  if (job === "food" || job === "food_owned" || job === "farm")
    return "food";
  if (job === "stone")
    return "stone";
  if (job === "metal")
    return "metal";
  return undefined;
}

function isCrossResourceJobChange(currentJob, nextJob) {
  const current = jobResourceType(currentJob);
  const next = jobResourceType(nextJob);
  return !!(current && next && current !== next);
}

export {
  carriedAmount, carriedTypes, needsDepositBeforeRetarget, pendingTransitionDecision,
  jobResourceType, isCrossResourceJobChange
};
