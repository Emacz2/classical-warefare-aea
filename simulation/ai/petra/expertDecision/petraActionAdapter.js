import { BUILDING_SPECS, resolvedTemplate, countPendingCivilianTraining } from "simulation/ai/petra/expertDecision/petraApiAdapter.js";

const PLAYER_ID_DEFAULT = 1;
const JOB_METADATA = "expertDecisionJob";
const PENDING_JOB_METADATA = "expertDecisionPendingJob";

function buildKey(action) {
  return `${action.kind}${action.role ? `:${action.role}` : ""}`;
}

function queueFor(gameState, kind) {
  const spec = BUILDING_SPECS[kind];
  const queue = spec && gameState.ai && gameState.ai.queues && gameState.ai.queues[spec.queue];
  if (!queue || typeof queue.addPlan !== "function")
    throw new Error(`Missing Petra queue ${spec ? spec.queue : "?"} for ${kind}`);
  return queue;
}

function entityById(gameState, id, label) {
  if (!Number.isFinite(Number(id)))
    throw new Error(`${label} id is required`);
  if (!gameState || typeof gameState.getEntityById !== "function")
    throw new Error("gameState.getEntityById is required");
  const ent = gameState.getEntityById(Number(id));
  if (!ent)
    throw new Error(`${label} ${id} does not exist`);
  return ent;
}

function carrying(ent) {
  if (!ent || typeof ent.resourceCarrying !== "function")
    return [];
  return ent.resourceCarrying() || [];
}

function hasCarriedResources(ent) {
  return carrying(ent).some(item => item && Number(item.amount) > 0);
}

function getJob(ent, playerId) {
  if (!ent || typeof ent.getMetadata !== "function")
    return undefined;
  return ent.getMetadata(playerId, JOB_METADATA);
}

function ensureBuilderAllowed(ent, kind, action, playerId) {
  const allowed = action.builderPool || BUILDING_SPECS[kind].allowedBuilderJobs;
  const job = getJob(ent, playerId);
  if (!allowed.includes(job))
    throw new Error(`Builder ${ent.id ? ent.id() : "?"} job ${job} is not allowed for ${kind}; allowed=${allowed.join(",")}`);
}

function safeReturnResources(ports, gameState, ent) {
  if (typeof ports.returnResources !== "function")
    throw new Error("ports.returnResources(gameState, ent) is required");
  return !!ports.returnResources(gameState, ent);
}

function constructionMetadata(action, execution, starterId) {
  return {
    ...(execution.metadata || {}),
    expertDecisionLayer: true,
    expertDecisionKind: action.kind,
    expertDecisionRole: action.role || "primary",
    expertTaskId: execution.taskId || `${action.kind}:${action.role || "primary"}`,
    expertBuilderPool: [...(action.builderPool || BUILDING_SPECS[action.kind].allowedBuilderJobs)],
    expertBuilderId: starterId
  };
}

function executeBuild(gameState, action, execution, ports, result, playerId) {
  if (!execution)
    throw new Error(`No execution data supplied for authorized BUILD ${buildKey(action)}; adapter fails closed`);
  if (!Array.isArray(execution.position) || execution.position.length !== 2 ||
      !execution.position.every(Number.isFinite))
    throw new Error(`BUILD ${buildKey(action)} requires explicit [x,z] position`);

  const starter = entityById(gameState, execution.starterId, "starter");
  ensureBuilderAllowed(starter, action.kind, action, playerId);

  if (Array.isArray(execution.builderIds))
    for (const id of execution.builderIds)
      ensureBuilderAllowed(entityById(gameState, id, "builder"), action.kind, action, playerId);

  if (hasCarriedResources(starter)) {
    if (!safeReturnResources(ports, gameState, starter))
      throw new Error(`Starter ${execution.starterId} is carrying resources but no valid return path exists`);
    // Queue the exact-position plan now. ExpertFixedConstructionPlan.canStart() will
    // hold it until this specific worker has deposited the carried resources.
    result.delayedBuilds.push({ key: buildKey(action), reason: "starter returning carried resources before exact construction starts" });
  }

  if (typeof ports.createFixedConstructionPlan !== "function")
    throw new Error("ports.createFixedConstructionPlan is required");
  const type = resolvedTemplate(gameState, action.kind);
  const metadata = constructionMetadata(action, execution, Number(execution.starterId));
  const plan = ports.createFixedConstructionPlan(
    gameState,
    type,
    metadata,
    execution.position,
    Number.isFinite(execution.angle) ? execution.angle : 3 * Math.PI / 4
  );
  if (!plan)
    throw new Error(`Fixed construction plan creation failed for ${buildKey(action)}`);
  queueFor(gameState, action.kind).addPlan(plan);
  result.queuedBuilds.push({ key: buildKey(action), queue: BUILDING_SPECS[action.kind].queue, type, starterId: Number(execution.starterId) });
}

function executeMaintenance(gameState, action, execution, ports, result, playerId) {
  if (!execution)
    throw new Error(`No execution data supplied for MAINTAIN_CONSTRUCTION ${action.kind}; adapter fails closed`);
  const foundation = entityById(gameState, execution.foundationId, "foundation");
  const builderIds = Array.isArray(execution.builderIds) ? execution.builderIds : [];
  if (!builderIds.length)
    throw new Error(`MAINTAIN_CONSTRUCTION ${action.kind} requires explicit builderIds; adapter does not select workers`);

  for (const id of builderIds) {
    const builder = entityById(gameState, id, "builder");
    ensureBuilderAllowed(builder, action.kind, action, playerId);
    if (hasCarriedResources(builder)) {
      if (!safeReturnResources(ports, gameState, builder))
        throw new Error(`Builder ${id} is carrying resources but no valid return path exists`);
      result.returningBuilders.push(Number(id));
      continue;
    }
    if (typeof builder.repair !== "function")
      throw new Error(`Builder ${id}.repair is required`);
    // Petra itself uses autocontinue=true for houses. Keep the exact call shape.
    builder.repair(foundation, action.kind === "house");
    result.maintainedBuilders.push(Number(id));
  }
}

function executeTraining(gameState, frame, execution, ports, result) {
  if (!frame.training || frame.training.action !== "TRAIN_CIVILIANS" || result.pausePopulationTraining)
    return;
  if (!execution || !execution.training)
    throw new Error("TRAIN_CIVILIANS requires explicit execution.training data; adapter fails closed");
  if (typeof ports.createTrainingPlan !== "function")
    throw new Error("ports.createTrainingPlan is required");
  const pending = countPendingCivilianTraining(gameState);
  if (pending.pendingCivilians > 0 || pending.pendingBatches > 0)
    throw new Error("Refusing to stack a civilian plan: an Expert civilian batch is already pending");
  const data = execution.training;
  if (!data.template || !Number.isFinite(Number(data.trainerId)))
    throw new Error("execution.training requires template and trainerId");
  entityById(gameState, data.trainerId, "trainer");
  const metadata = {
    ...(data.metadata || {}),
    trainer: Number(data.trainerId),
    expertDecisionLayer: true,
    expertDecisionTraining: "civilian",
    expertDecisionCivilian: true
  };
  const plan = ports.createTrainingPlan(gameState, data.template, metadata, frame.training.batch, frame.training.batch);
  gameState.ai.queues.villager.addPlan(plan);
  result.queuedTraining = { template: data.template, trainerId: Number(data.trainerId), batch: frame.training.batch };
}

function executeDecisionFrame(gameState, frame, execution = {}, ports = {}, options = {}) {
  if (!frame || !Array.isArray(frame.actions))
    throw new Error("Decision frame with actions[] is required");
  const playerId = Number.isFinite(options.playerId) ? options.playerId : PLAYER_ID_DEFAULT;
  const result = {
    queuedBuilds: [],
    delayedBuilds: [],
    maintainedBuilders: [],
    returningBuilders: [],
    reservations: [],
    deferred: [],
    pausePopulationTraining: false,
    queuedTraining: null,
    ignoredExecutionKeys: []
  };

  const authorizedBuildKeys = new Set();
  for (const action of frame.actions) {
    if (action.type === "BUILD") {
      const key = buildKey(action);
      authorizedBuildKeys.add(key);
      executeBuild(gameState, action, execution.builds && execution.builds[key], ports, result, playerId);
    } else if (action.type === "MAINTAIN_CONSTRUCTION") {
      executeMaintenance(gameState, action, execution.maintenance && execution.maintenance[action.kind], ports, result, playerId);
    } else if (action.type === "RESERVE") {
      result.reservations.push({ kind: action.kind, cost: { ...(action.cost || {}) } });
    } else if (action.type === "DEFER") {
      result.deferred.push({ kind: action.kind, role: action.role || "primary" });
    } else if (action.type === "PAUSE_POPULATION_TRAINING") {
      result.pausePopulationTraining = true;
    } else {
      throw new Error(`Unsupported strategic adapter action: ${action.type}`);
    }
  }

  // Supplied execution data is never authority. Record extras and ignore them.
  for (const key of Object.keys(execution.builds || {}))
    if (!authorizedBuildKeys.has(key))
      result.ignoredExecutionKeys.push(key);

  executeTraining(gameState, frame, execution, ports, result);
  return result;
}

function executeWorkerAction(gameState, workerId, action, execution = {}, ports = {}, options = {}) {
  const playerId = Number.isFinite(options.playerId) ? options.playerId : PLAYER_ID_DEFAULT;
  const worker = entityById(gameState, workerId, "worker");

  switch (action.action) {
    case "RETURN_RESOURCES": {
      if (!action.nextJob)
        throw new Error("RETURN_RESOURCES action requires nextJob");
      if (typeof worker.setMetadata !== "function")
        throw new Error("worker.setMetadata is required");
      worker.setMetadata(playerId, PENDING_JOB_METADATA, action.nextJob);
      if (!safeReturnResources(ports, gameState, worker))
        throw new Error("RETURN_RESOURCES failed; pending job is preserved and no reassignment occurs");
      return { state: "returning", pendingJob: action.nextJob };
    }
    case "CHANGE_JOB": {
      if (hasCarriedResources(worker))
        throw new Error("CHANGE_JOB refused while worker carries resources; policy must RETURN_RESOURCES first");
      if (typeof worker.setMetadata !== "function")
        throw new Error("worker.setMetadata is required");
      worker.setMetadata(playerId, JOB_METADATA, action.nextJob);
      worker.setMetadata(playerId, PENDING_JOB_METADATA, undefined);
      return { state: "changed", job: action.nextJob };
    }
    case "KEEP_CURRENT_TREE":
      return { state: "kept", commandsIssued: 0 };
    case "TAKE_LOCAL_TREE": {
      const targetId = Number(execution.targetId ?? action.targetId);
      const target = entityById(gameState, targetId, "tree target");
      if (typeof worker.gather !== "function")
        throw new Error("worker.gather is required");
      worker.gather(target);
      return { state: "gathering", targetId };
    }
    case "WAIT_AT_WORKSITE":
    case "REPORT_NO_LOCAL_TARGET":
      return { state: "waiting", commandsIssued: 0 };
    default:
      throw new Error(`Unsupported worker adapter action: ${action.action}`);
  }
}

export {
  JOB_METADATA,
  PENDING_JOB_METADATA,
  buildKey,
  executeDecisionFrame,
  executeWorkerAction
};
