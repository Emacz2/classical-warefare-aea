import { mergePolicy } from "simulation/ai/petra/expertDecision/policy.js";
import { normalizeState } from "simulation/ai/petra/expertDecision/state.js";
import { analyzeWoodWorksite, updateLowWoodEvidence } from "simulation/ai/petra/expertDecision/woodWorksite.js";
import { planEconomy } from "simulation/ai/petra/expertDecision/economyPlanner.js";
import { decideStage } from "simulation/ai/petra/expertDecision/stageMachine.js";
import { decideCivilianTraining } from "simulation/ai/petra/expertDecision/trainingPolicy.js";

function createMemory(seed = {}) {
  return {
    stage: seed.stage || "bootstrap",
    lowWoodObservations: Number.isFinite(seed.lowWoodObservations) ? seed.lowWoodObservations : 0,
    activeConstruction: { ...(seed.activeConstruction || {}) },
    lastDecisionTime: Number.isFinite(seed.lastDecisionTime) ? seed.lastDecisionTime : -1
  };
}

function deriveWoodsite(observation, memory, policy) {
  // The decision layer owns exhaustion evidence in its own memory. The Petra
  // adapter supplies current worksite facts only; it must not be responsible
  // for incrementing a strategic counter. This keeps raw-tree and aggregate
  // observation paths behaviorally identical.
  if (!observation.woodTrees) {
    const metrics = { ...(observation.woodsite || {}) };
    return {
      ...metrics,
      lowWoodObservations: updateLowWoodEvidence(memory.lowWoodObservations, metrics, policy)
    };
  }

  const metrics = analyzeWoodWorksite(observation.woodTrees, policy.woodWorksiteRadius);
  const lowWoodObservations = updateLowWoodEvidence(memory.lowWoodObservations, metrics, policy);
  return {
    ...metrics,
    lowWoodObservations,
    alternativeExistingWorksite: !!observation.alternativeExistingWorksite
  };
}

function stepDecision(previousMemory, rawObservation, overrides = {}) {
  const policy = mergePolicy(overrides);
  const memory = createMemory(previousMemory);
  const observation = { ...rawObservation };
  observation.stage = memory.stage;
  observation.woodsite = deriveWoodsite(observation, memory, policy);

  const state = normalizeState(observation);
  const training = decideCivilianTraining(state, policy);
  // Housing must see the population that this same decision tick is about to queue.
  // Otherwise a batch can consume the safety margin and the house is not requested
  // until the following tick. The decision layer treats planned training as accounted
  // population for strategic spending, without mutating the engine observation.
  const economyState = training.action === "TRAIN_CIVILIANS" ? {
    ...state,
    population: { ...state.population, queued: state.population.queued + training.batch }
  } : state;
  const economy = planEconomy(economyState, policy);
  const stageDecision = decideStage({ ...state, stage: memory.stage }, policy);

  const nextMemory = {
    ...memory,
    stage: stageDecision.stage,
    lowWoodObservations: state.woodsite.lowWoodObservations,
    lastDecisionTime: state.time
  };

  return {
    policy,
    state,
    memory: nextMemory,
    stage: stageDecision,
    training,
    economy,
    actions: economy.actions
  };
}

function runSequence(sequence, overrides = {}, seedMemory = {}) {
  let memory = createMemory(seedMemory);
  const frames = [];
  for (const observation of sequence) {
    const frame = stepDecision(memory, observation, overrides);
    frames.push(frame);
    memory = frame.memory;
  }
  return { memory, frames };
}

export { createMemory, stepDecision, runSequence };
