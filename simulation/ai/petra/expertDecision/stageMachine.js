import { mergePolicy } from "simulation/ai/petra/expertDecision/policy.js";
import { normalizeState } from "simulation/ai/petra/expertDecision/state.js";

const RANK = Object.freeze({ bootstrap: 0, growth: 1, farm_prepare: 2, farm_transition: 3, military_transition: 4, stable: 5 });

function worthwhileAlternativeFood(state, policy) {
  return state.food.alternativeClusters > 0 && state.food.alternativeRemaining >= policy.minimumAlternativeNaturalFood;
}

function decideStage(rawState, overrides = {}) {
  const state = normalizeState(rawState);
  const policy = mergePolicy(overrides);
  const current = RANK[state.stage] === undefined ? "bootstrap" : state.stage;
  const hasOpeningInfra = state.structures.farmstead > 0 && state.structures.storehouse > 0;
  if (!hasOpeningInfra)
    return { stage: "bootstrap", reason: "opening farmstead/storehouse incomplete" };

  const totalNatural = Math.max(0, state.food.totalNaturalRemaining);
  const runway = Math.max(0, state.food.naturalRunwaySeconds);
  if (worthwhileAlternativeFood(state, policy) && !state.food.alternativeCovered &&
      state.food.primaryRatio <= policy.naturalFoodExpansionRatio)
    return { stage: "farm_prepare", reason: "current natural-food cluster is at transition threshold; cover the next worthwhile in-territory site" };

  if (totalNatural > 0 && runway > policy.fieldTransitionLeadSeconds + policy.naturalFoodRunwaySafetySeconds)
    return { stage: "growth", reason: current === "bootstrap" ? "opening infrastructure complete; natural-food runway is healthy" : "natural-food runway remains healthy" };

  if (totalNatural > 0 && runway > policy.fieldTransitionLeadSeconds)
    return { stage: "farm_prepare", reason: "natural-food runway is approaching field lead time; prebuild just-in-time capacity" };

  if (totalNatural > 0)
    return { stage: "farm_transition", reason: "natural-food runway is short; permanent food capacity is now urgent" };

  if (state.structures.barracks > 0) {
    if (state.structures.field >= policy.minimumCompletedFieldsBeforeSecondBarracks && state.population.used >= 40)
      return { stage: "stable", reason: "natural food exhausted; military and permanent food engines are established" };
    return { stage: "military_transition", reason: "natural food exhausted; first barracks is active while permanent food expands" };
  }
  return { stage: "farm_transition", reason: "natural food exhausted before the first military building completed" };
}

export { RANK, decideStage };
