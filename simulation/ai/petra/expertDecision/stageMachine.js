import { mergePolicy } from "simulation/ai/petra/expertDecision/policy.js";
import { normalizeState } from "simulation/ai/petra/expertDecision/state.js";

const RANK = Object.freeze({ bootstrap: 0, growth: 1, farm_prepare: 2, farm_transition: 3, military_transition: 4, stable: 5 });

function decideStage(rawState, overrides = {}) {
  const state = normalizeState(rawState);
  const policy = mergePolicy(overrides);
  const current = RANK[state.stage] === undefined ? "bootstrap" : state.stage;
  const hasOpeningInfra = state.structures.farmstead > 0 && state.structures.storehouse > 0;
  const ratio = state.food.primaryRatio;
  if (!hasOpeningInfra)
    return { stage: "bootstrap", reason: "opening farmstead/storehouse incomplete" };
  if (ratio <= policy.farmTransitionRatio || state.food.primaryRemaining <= 0) {
    if (state.structures.field >= policy.minimumFieldsBeforeBarracks && state.structures.house > 0) {
      if (state.structures.barracks > 0 && state.structures.field >= 3 && state.population.used >= 40)
        return { stage: "stable", reason: "farm economy, housing and military production are established" };
      return { stage: "military_transition", reason: "farm capacity and housing are established" };
    }
    return { stage: "farm_transition", reason: "primary natural food reached hard transition threshold" };
  }
  if (ratio <= policy.farmPrepareRatio)
    return { stage: "farm_prepare", reason: "prepare farm capacity before natural food is exhausted" };
  return { stage: "growth", reason: current === "bootstrap" ? "opening infrastructure complete" : "natural-food growth continues" };
}

export { RANK, decideStage };
