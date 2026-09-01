import { mergePolicy } from "simulation/ai/petra/expertDecision/policy.js";
import { normalizeState, accountedFreePopulation } from "simulation/ai/petra/expertDecision/state.js";

function decideCivilianTraining(rawState, overrides = {}) {
  const state = normalizeState(rawState);
  const policy = mergePolicy(overrides);
  const free = accountedFreePopulation(state);
  const cap = Math.max(1, Number(policy.civilianCap) || 70);
  const civilianRoom = Math.max(0, cap - state.workers.civilians - state.training.pendingCivilians);
  if (civilianRoom <= 0)
    return { action: "STOP_CIVILIANS", batch: 0, reason: `civilian cap ${cap} reached; CC is released for soldiers` };
  if (state.training.pendingCivilians > 0 || state.training.pendingBatches > 0)
    return { action: "WAIT", batch: 0, reason: "an Expert civilian batch is already pending; never stack opening civilian plans" };
  const housePending = state.foundations.house > 0 || state.queued.house > 0;
  if (free <= 0)
    return { action: "PAUSE", batch: 0, reason: "population cap reached/accounted" };
  if (free <= policy.houseEmergencyFreePopulation && !housePending)
    return { action: "PAUSE", batch: 0, reason: "housing emergency; do not train deeper into the block" };
  const food = state.resources.food;
  let batch = state.population.used < 24 ? 3 : food >= 450 ? 4 : food >= 150 ? 3 : food >= 100 ? 2 : food >= 50 ? 1 : 0;
  batch = Math.min(batch, free, civilianRoom);
  if (batch <= 0)
    return { action: "WAIT", batch: 0, reason: "insufficient food or population space" };
  return { action: "TRAIN_CIVILIANS", batch, reason: "continuous civilian production within housing/resource limits" };
}

export { decideCivilianTraining };
