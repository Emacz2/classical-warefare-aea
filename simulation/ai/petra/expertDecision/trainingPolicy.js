import { mergePolicy } from "simulation/ai/petra/expertDecision/policy.js";
import { normalizeState, accountedFreePopulation } from "simulation/ai/petra/expertDecision/state.js";

function decideCivilianTraining(rawState, overrides = {}) {
  const state = normalizeState(rawState);
  const policy = mergePolicy(overrides);
  const free = accountedFreePopulation(state);
  if (state.training.pendingCivilians > 0 || state.training.pendingBatches > 0)
    return { action: "WAIT", batch: 0, reason: "an Expert civilian batch is already pending; never stack opening civilian plans" };
  const housePending = state.structures.house > 0 || state.foundations.house > 0 || state.queued.house > 0;
  if (free <= 0)
    return { action: "PAUSE", batch: 0, reason: "population cap reached/accounted" };
  if (free <= policy.houseEmergencyFreePopulation && !housePending)
    return { action: "PAUSE", batch: 0, reason: "housing emergency; do not train deeper into the block" };
  const food = state.resources.food;
  let batch = state.population.used < 24 ? 3 : food >= 450 ? 4 : food >= 150 ? 3 : food >= 100 ? 2 : 0;
  batch = Math.min(batch, free);
  if (batch <= 0)
    return { action: "WAIT", batch: 0, reason: "insufficient food or population space" };
  return { action: "TRAIN_CIVILIANS", batch, reason: "continuous civilian production within housing/resource limits" };
}

export { decideCivilianTraining };
