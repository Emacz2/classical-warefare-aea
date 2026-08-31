import { BUILDING_SPECS } from "simulation/ai/petra/expertDecision/petraApiAdapter.js";
import { squareDistance, toEntities, entityPosition } from "simulation/ai/petra/expertDecision/petraMechanicalCollector.js";

const JOB_KEY = "expertDecisionJob";
const TASK_KEY = "expertDecisionTaskId";

function carryingAmount(ent) {
  if (!ent || typeof ent.resourceCarrying !== "function")
    return 0;
  return (ent.resourceCarrying() || []).reduce((sum, item) => sum + Math.max(0, Number(item && item.amount) || 0), 0);
}

function workerUnavailable(ent, playerId) {
  if (!ent || typeof ent.getMetadata !== "function")
    return true;
  if (ent.getMetadata(playerId, "transport") !== undefined || ent.getMetadata(playerId, "PartOfArmy") ||
      ent.getMetadata(playerId, "expertDefenseMobilized") !== undefined ||
      ent.getMetadata(playerId, "expertCivilianEvacuating") !== undefined)
    return true;
  const plan = ent.getMetadata(playerId, "plan");
  if (plan !== undefined && plan !== -1)
    return true;
  const state = typeof ent.unitAIState === "function" ? ent.unitAIState() : "";
  return !!(state && state.includes(".COMBAT."));
}

function eligibleBuilder(ent, request) {
  const playerId = request.playerId || 1;
  const pos = entityPosition(ent);
  if (!pos || typeof ent.isBuilder !== "function" || !ent.isBuilder())
    return false;
  if (workerUnavailable(ent, playerId))
    return false;
  const job = ent.getMetadata(playerId, request.jobKey || JOB_KEY);
  if (!request.allowedJobs.includes(job))
    return false;
  const existingTask = ent.getMetadata(playerId, request.taskKey || TASK_KEY);
  if (existingTask !== undefined && existingTask !== request.taskId)
    return false;
  if (request.requireEmptyHands && carryingAmount(ent) > 0)
    return false;
  return true;
}

function builderScore(ent, request) {
  const pos = entityPosition(ent);
  let score = request.targetPosition ? squareDistance(pos, request.targetPosition) : 0;
  if (request.preferCitizenSoldiers && typeof ent.hasClass === "function" && ent.hasClass("CitizenSoldier"))
    score -= 400;
  // Storehouse builders return to wood immediately afterward. When gather/build rates
  // are equal, prefer the faster ranged citizen-soldier so the walk/deposit/return cycle
  // is marginally shorter while hoplites keep chopping.
  if (request.preferRangedCitizenSoldiers && typeof ent.hasClass === "function" &&
      ent.hasClass("CitizenSoldier") && (ent.hasClass("Ranged") || ent.hasClass("Javelineer")))
    score -= 100;
  if (request.existingBuilderIds && request.existingBuilderIds.includes(ent.id()))
    score -= 1e9;
  return score;
}

function selectBuilders(gameState, request) {
  if (!gameState || typeof gameState.getOwnUnits !== "function")
    throw new Error("gameState.getOwnUnits() is required by the builder resolver");
  if (!Array.isArray(request.allowedJobs) || !request.allowedJobs.length)
    throw new Error("builder resolver requires allowedJobs");
  if (!Number.isInteger(request.count) || request.count < 1)
    throw new Error("builder resolver requires positive integer count");
  const required = Array.isArray(request.requiredBuilderIds) && request.requiredBuilderIds.length ?
    new Set(request.requiredBuilderIds.map(Number).filter(Number.isFinite)) : undefined;
  const candidates = toEntities(gameState.getOwnUnits()).filter(ent =>
    (!required || required.has(ent.id())) && eligibleBuilder(ent, request));
  candidates.sort((a, b) => builderScore(a, request) - builderScore(b, request) || a.id() - b.id());
  return candidates.slice(0, request.count);
}

function allowedJobsFor(kind, action = {}) {
  if (Array.isArray(action.builderPool) && action.builderPool.length)
    return [...action.builderPool];
  const spec = BUILDING_SPECS[kind];
  if (!spec)
    throw new Error(`unknown building kind ${kind}`);
  return [...spec.allowedBuilderJobs];
}

function selectFoundationStarter(gameState, kind, targetPosition, action = {}, options = {}) {
  const allowedJobs = allowedJobsFor(kind, action);
  const selected = selectBuilders(gameState, {
    allowedJobs,
    count: 1,
    targetPosition,
    playerId: options.playerId || 1,
    taskId: options.taskId,
    requireEmptyHands: true,
    preferCitizenSoldiers: allowedJobs.includes("citizenSoldierWood"),
    preferRangedCitizenSoldiers: kind === "storehouse",
    requiredBuilderIds: action.requiredBuilderIds
  });
  return selected[0];
}


function selectFoundationStarterCandidate(gameState, kind, targetPosition, action = {}, options = {}) {
  const allowedJobs = allowedJobsFor(kind, action);
  const selected = selectBuilders(gameState, {
    allowedJobs,
    count: 1,
    targetPosition,
    playerId: options.playerId || 1,
    taskId: options.taskId,
    requireEmptyHands: false,
    preferCitizenSoldiers: allowedJobs.includes("citizenSoldierWood"),
    preferRangedCitizenSoldiers: kind === "storehouse",
    requiredBuilderIds: action.requiredBuilderIds
  });
  return selected[0];
}
function selectMaintenanceTeam(gameState, kind, targetPosition, count, action = {}, options = {}) {
  return selectBuilders(gameState, {
    allowedJobs: allowedJobsFor(kind, action),
    count,
    targetPosition,
    playerId: options.playerId || 1,
    taskId: options.taskId,
    existingBuilderIds: options.existingBuilderIds || [],
    requireEmptyHands: false,
    preferCitizenSoldiers: kind === "house" || kind === "storehouse" || kind === "barracks" || kind === "market",
    preferRangedCitizenSoldiers: kind === "storehouse",
    requiredBuilderIds: action.requiredBuilderIds
  });
}

function commitBuilders(builders, taskId, playerId = 1) {
  if (!taskId)
    throw new Error("taskId is required to commit builders");
  for (const ent of builders) {
    if (!ent || typeof ent.setMetadata !== "function")
      throw new Error("builder.setMetadata is required");
    ent.setMetadata(playerId, TASK_KEY, taskId);
  }
}

function releaseBuilders(builders, taskId, playerId = 1) {
  for (const ent of builders) {
    if (!ent || typeof ent.getMetadata !== "function" || typeof ent.setMetadata !== "function")
      continue;
    if (ent.getMetadata(playerId, TASK_KEY) === taskId)
      ent.setMetadata(playerId, TASK_KEY, undefined);
  }
}

export {
  JOB_KEY,
  TASK_KEY,
  carryingAmount,
  workerUnavailable,
  eligibleBuilder,
  selectBuilders,
  allowedJobsFor,
  selectFoundationStarter,
  selectFoundationStarterCandidate,
  selectMaintenanceTeam,
  commitBuilders,
  releaseBuilders
};
