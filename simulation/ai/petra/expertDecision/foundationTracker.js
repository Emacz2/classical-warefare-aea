import { toEntities, entityPosition, squareDistance } from "simulation/ai/petra/expertDecision/petraMechanicalCollector.js";

const DEFAULT_TASK_METADATA = "expertTaskId";

function entityTaskId(ent, playerId, metadataKey) {
  return ent && typeof ent.getMetadata === "function" ? ent.getMetadata(playerId, metadataKey) : undefined;
}

function hasKind(ent, kind, classMap) {
  const className = classMap[kind] || kind[0].toUpperCase() + kind.slice(1);
  return !!(ent && typeof ent.hasClass === "function" && ent.hasClass(className));
}

function isFoundationEntity(ent) {
  return !!(ent && typeof ent.foundationProgress === "function" && ent.foundationProgress() !== undefined);
}

class FoundationTracker {
  constructor(options = {}) {
    this.playerId = Number.isFinite(options.playerId) ? options.playerId : 1;
    this.metadataKey = options.metadataKey || DEFAULT_TASK_METADATA;
    this.positionTolerance = Number.isFinite(options.positionTolerance) ? options.positionTolerance : 3;
    this.classMap = { ...(options.classMap || {}) };
    this.tasks = new Map();
  }

  register(task) {
    if (!task || !task.taskId || !task.kind)
      throw new Error("FoundationTracker.register requires taskId and kind");
    const current = this.tasks.get(task.taskId) || {};
    this.tasks.set(task.taskId, {
      ...current,
      ...task,
      state: current.state || "queued",
      everHadFoundation: !!current.everHadFoundation,
      foundationId: current.foundationId,
      completedEntityId: current.completedEntityId
    });
    return this.tasks.get(task.taskId);
  }

  get(taskId) { return this.tasks.get(taskId); }

  serialize() {
    return {
      version: 1,
      playerId: this.playerId,
      metadataKey: this.metadataKey,
      positionTolerance: this.positionTolerance,
      classMap: { ...this.classMap },
      tasks: Array.from(this.tasks.entries()).map(([taskId, task]) => ({
        ...task,
        taskId,
        position: Array.isArray(task.position) ? [...task.position] : task.position
      }))
    };
  }

  load(data = {}) {
    if (data.version !== undefined && data.version !== 1)
      throw new Error(`Unsupported FoundationTracker serialization version ${data.version}`);
    if (Number.isFinite(data.playerId))
      this.playerId = data.playerId;
    if (typeof data.metadataKey === "string" && data.metadataKey)
      this.metadataKey = data.metadataKey;
    if (Number.isFinite(data.positionTolerance))
      this.positionTolerance = data.positionTolerance;
    if (data.classMap && typeof data.classMap === "object")
      this.classMap = { ...data.classMap };
    this.tasks = new Map();
    for (const task of data.tasks || []) {
      if (!task || !task.taskId || !task.kind)
        throw new Error("Invalid serialized FoundationTracker task");
      const restored = { ...task, position: Array.isArray(task.position) ? [...task.position] : task.position };
      this.tasks.set(restored.taskId, restored);
    }
    return this;
  }

  static deserialize(data = {}) {
    return new FoundationTracker().load(data);
  }

  findMetadataMatch(entities, taskId, kind) {
    return entities.filter(ent => hasKind(ent, kind, this.classMap) &&
      entityTaskId(ent, this.playerId, this.metadataKey) === taskId);
  }

  findPositionalMatch(entities, task) {
    if (!task.position)
      return [];
    const toleranceSq = this.positionTolerance * this.positionTolerance;
    return entities.filter(ent => hasKind(ent, task.kind, this.classMap) && entityPosition(ent) &&
      squareDistance(entityPosition(ent), task.position) <= toleranceSq);
  }

  observeTask(gameState, taskId) {
    const task = this.tasks.get(taskId);
    if (!task)
      throw new Error(`Unknown construction task ${taskId}`);
    // In live 0 A.D., getOwnStructures() can include unfinished foundations because
    // foundations are still Structure-class entities.  Never treat that collection
    // as "completed" without explicitly excluding entities that report
    // foundationProgress().  IT1 proved that failing to make this distinction makes
    // a newly placed foundation look completed immediately, releases its builders,
    // and leaves the foundation untouched forever.
    const foundations = toEntities(gameState.getOwnFoundations()).filter(isFoundationEntity);
    const structures = toEntities(gameState.getOwnStructures()).filter(ent => !isFoundationEntity(ent));

    let complete = this.findMetadataMatch(structures, taskId, task.kind);
    if (!complete.length && task.foundationId !== undefined) {
      const sameId = structures.filter(ent => ent.id() === task.foundationId && hasKind(ent, task.kind, this.classMap));
      complete = sameId;
    }
    if (!complete.length && task.everHadFoundation)
      complete = this.findPositionalMatch(structures, task);
    if (complete.length > 1)
      return { ...task, state: "ambiguous", reason: "multiple completed structures match task" };
    if (complete.length === 1) {
      task.state = "completed";
      task.completedEntityId = complete[0].id();
      this.tasks.set(taskId, task);
      return { ...task };
    }

    let found = this.findMetadataMatch(foundations, taskId, task.kind);
    if (!found.length && task.foundationId !== undefined)
      found = foundations.filter(ent => ent.id() === task.foundationId && hasKind(ent, task.kind, this.classMap));
    if (found.length > 1)
      return { ...task, state: "ambiguous", reason: "multiple foundations match task" };
    if (found.length === 1) {
      task.state = "foundation";
      task.foundationId = found[0].id();
      task.position = entityPosition(found[0]) || task.position;
      task.everHadFoundation = true;
      this.tasks.set(taskId, task);
      return { ...task };
    }

    task.state = task.everHadFoundation ? "missing-after-foundation" : "awaiting-foundation";
    this.tasks.set(taskId, task);
    return { ...task };
  }

  observeAll(gameState) {
    return Array.from(this.tasks.keys()).map(taskId => this.observeTask(gameState, taskId));
  }

  executionForMaintenance(gameState, taskId, builderIds) {
    const state = this.observeTask(gameState, taskId);
    if (state.state !== "foundation" || !Number.isFinite(state.foundationId))
      throw new Error(`Task ${taskId} has no live foundation to maintain`);
    return { foundationId: state.foundationId, builderIds: [...builderIds] };
  }
}

export { DEFAULT_TASK_METADATA, FoundationTracker };
