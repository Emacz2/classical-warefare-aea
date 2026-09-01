import { buildKey } from "simulation/ai/petra/expertDecision/petraActionAdapter.js";
import { desiredBuilders } from "simulation/ai/petra/expertDecision/constructionLifecycle.js";
import { entityPosition } from "simulation/ai/petra/expertDecision/petraMechanicalCollector.js";
import { resolveBuildingPosition } from "simulation/ai/petra/expertDecision/petraPlacementResolver.js";
import { selectFoundationStarter, selectFoundationStarterCandidate, selectMaintenanceTeam, commitBuilders } from "simulation/ai/petra/expertDecision/petraBuilderResolver.js";

function mechanicalTaskId(action) {
  return `expert:${action.kind}:${action.role || "primary"}`;
}

function prepareBuild(gameState, action, request, ports, tracker, options) {
  const key = buildKey(action);
  if (!request)
    throw new Error(`Missing placement intent for authorized BUILD ${key}`);
  const resolved = resolveBuildingPosition({ ...request, kind: action.kind }, ports.placement || {});
  if (!resolved.position)
    return { key, blocked: "no-legal-position", diagnostics: resolved.rejected };
  const taskId = request.taskId || mechanicalTaskId(action);
  let starter = selectFoundationStarter(gameState, action.kind, resolved.position, action, { playerId: options.playerId, taskId });
  if (!starter)
    starter = selectFoundationStarterCandidate(gameState, action.kind, resolved.position, action, { playerId: options.playerId, taskId });
  if (!starter)
    return { key, blocked: "no-eligible-starter", diagnostics: resolved.rejected };
  tracker.register({ taskId, kind: action.kind, role: action.role || "primary", position: resolved.position });
  commitBuilders([starter], taskId, options.playerId);
  return {
    key,
    execution: {
      position: resolved.position,
      angle: resolved.angle,
      starterId: starter.id(),
      builderIds: [starter.id()],
      taskId,
      metadata: { expertTaskId: taskId }
    },
    diagnostics: resolved.rejected
  };
}

function prepareMaintenance(gameState, action, tracker, options) {
  const key = buildKey(action);
  const taskId = options.taskIds && options.taskIds[key] || mechanicalTaskId(action);
  const tracked = tracker.observeTask(gameState, taskId);
  if (tracked.state !== "foundation")
    return { key, blocked: `task-${tracked.state}` };
  const foundation = gameState.getEntityById(tracked.foundationId);
  const count = Number(action.count || action.builderCount || desiredBuilders(action.kind));
  const existingBuilderIds = options.existingBuilderIds && options.existingBuilderIds[key] || [];
  const team = selectMaintenanceTeam(gameState, action.kind, entityPosition(foundation), count, action, {
    playerId: options.playerId,
    taskId,
    existingBuilderIds
  });
  if (!team.length)
    return { key, blocked: "no-eligible-maintenance-builders" };
  commitBuilders(team, taskId, options.playerId);
  return {
    key,
    execution: tracker.executionForMaintenance(gameState, taskId, team.map(ent => ent.id()))
  };
}

function prepareMechanicalExecution(gameState, frame, inputs, ports, tracker, options = {}) {
  const playerId = Number.isFinite(options.playerId) ? options.playerId : 1;
  const execution = { builds: {}, maintenance: {}, training: inputs.training || {} };
  const blocked = [];
  const diagnostics = {};
  for (const action of frame.actions || []) {
    if (action.type === "BUILD") {
      const key = buildKey(action);
      const prepared = prepareBuild(gameState, action, inputs.placements && inputs.placements[key], ports, tracker, { playerId });
      if (prepared.execution)
        execution.builds[key] = prepared.execution;
      else
        blocked.push({ key, reason: prepared.blocked });
      diagnostics[key] = prepared.diagnostics || [];
    } else if (action.type === "MAINTAIN_CONSTRUCTION") {
      const prepared = prepareMaintenance(gameState, action, tracker, {
        playerId,
        taskIds: inputs.taskIds,
        existingBuilderIds: inputs.existingBuilderIds
      });
      if (prepared.execution)
        execution.maintenance[action.kind] = prepared.execution;
      else
        blocked.push({ key: prepared.key, reason: prepared.blocked });
    }
  }
  return { execution, blocked, diagnostics };
}

export { mechanicalTaskId, prepareMechanicalExecution };
