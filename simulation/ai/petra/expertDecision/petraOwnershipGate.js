const DEFAULT_OWNERSHIP_METADATA = "expertDecisionOwned";

function hasClass(ent, name) {
  return !!(ent && typeof ent.hasClass === "function" && ent.hasClass(name));
}

function isExpertOpeningEconomyEntity(ent, options = {}) {
  if (!ent)
    return false;
  const playerId = Number.isFinite(options.playerId) ? options.playerId : 1;
  const metadataKey = options.metadataKey || DEFAULT_OWNERSHIP_METADATA;
  if (typeof ent.getMetadata === "function" && ent.getMetadata(playerId, metadataKey) === true)
    return true;

  if (hasClass(ent, "Civilian") || hasClass(ent, "Worker") || hasClass(ent, "CitizenSoldier"))
    return true;

  // The opening pursuit/scout cavalry is part of the economy only when it can
  // actually gather food. This avoids swallowing unrelated combat cavalry.
  if (hasClass(ent, "Cavalry") && typeof ent.canGather === "function" && ent.canGather("food"))
    return true;

  return false;
}

function expertControlActive(context, gameState) {
  if (typeof context === "boolean")
    return context;
  if (!context)
    return false;
  if (typeof context.isExpertControlActive === "function")
    return !!context.isExpertControlActive(gameState);
  return !!context.expertControlActive;
}

function shouldSuppressPetraWorkerCommands(gameState, ent, context = {}) {
  if (!expertControlActive(context, gameState))
    return false;
  const eligible = typeof context.isExpertEconomyEntity === "function" ?
    !!context.isExpertEconomyEntity(ent, gameState) :
    isExpertOpeningEconomyEntity(ent, context);
  return eligible;
}

// Named entry points mirror the two Petra collision sites so the eventual live
// patch cannot accidentally gate one path and forget the other.
function suppressAssignEntityWorkerCommands(gameState, ent, context = {}) {
  return shouldSuppressPetraWorkerCommands(gameState, ent, context);
}

function suppressTrainingFinishedWorkerCommands(gameState, ent, context = {}) {
  return shouldSuppressPetraWorkerCommands(gameState, ent, context);
}

export {
  DEFAULT_OWNERSHIP_METADATA,
  isExpertOpeningEconomyEntity,
  shouldSuppressPetraWorkerCommands,
  suppressAssignEntityWorkerCommands,
  suppressTrainingFinishedWorkerCommands
};
