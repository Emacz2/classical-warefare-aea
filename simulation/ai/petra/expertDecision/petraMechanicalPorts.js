import { resolvedTemplate } from "simulation/ai/petra/expertDecision/petraApiAdapter.js";

function requireFunction(value, label) {
  if (typeof value !== "function")
    throw new Error(`${label} is required by the Petra mechanical port`);
  return value;
}

function readTemplateGeometry(gameState, kind) {
  if (!gameState || typeof gameState.getTemplate !== "function" || typeof gameState.applyCiv !== "function")
    throw new Error("gameState.getTemplate/applyCiv are required to read building geometry");
  const type = resolvedTemplate(gameState, kind);
  const template = gameState.getTemplate(type);
  if (!template)
    throw new Error(`template ${type} is unavailable`);
  if (typeof template.obstructionRadius !== "function")
    throw new Error(`template ${type}.obstructionRadius() is required`);
  const obstruction = template.obstructionRadius();
  const radius = Number(obstruction && obstruction.max);
  if (!Number.isFinite(radius) || radius <= 0)
    throw new Error(`template ${type} has invalid obstruction radius`);

  let halfExtents;
  if (typeof template.get === "function" && template.get("Footprint/Square")) {
    const width = Number(template.get("Footprint/Square/@width"));
    const depth = Number(template.get("Footprint/Square/@depth"));
    if (Number.isFinite(width) && Number.isFinite(depth) && width > 0 && depth > 0)
      halfExtents = { width: width / 2, depth: depth / 2 };
  }
  return { type, template, radius, halfExtents };
}

function createPetraCollectorPorts(dependencies = {}) {
  const getLandAccess = requireFunction(dependencies.getLandAccess, "dependencies.getLandAccess");
  const isSupplyFull = requireFunction(dependencies.isSupplyFull, "dependencies.isSupplyFull");
  return {
    getLandAccess: (gameState, ent) => getLandAccess(gameState, ent),
    isSupplyFull: (gameState, ent) => isSupplyFull(gameState, ent)
  };
}

function createPetraPlacementPorts(gameState, kind, options = {}) {
  const HQ = options.HQ || gameState && gameState.ai && gameState.ai.HQ;
  if (!HQ || !HQ.territoryMap)
    throw new Error("HQ.territoryMap is required by the Petra placement port");
  const createObstructionMap = requireFunction(options.createObstructionMap, "options.createObstructionMap");
  const geometry = readTemplateGeometry(gameState, kind);
  const accessIndex = Number(options.accessIndex || 0);
  const obstructions = createObstructionMap(gameState, accessIndex, geometry.template);
  if (!obstructions || !Number.isFinite(obstructions.width) || !Number.isFinite(obstructions.cellSize))
    throw new Error("createObstructionMap must return an InfoMap-like object with width/cellSize");
  const territoryMap = HQ.territoryMap;
  if (typeof territoryMap.gamePosToMapPos !== "function" || typeof territoryMap.getNonObstructedTile !== "function")
    throw new Error("territoryMap.gamePosToMapPos/getNonObstructedTile are required by the Petra placement port");
  const radiusCells = Math.ceil(geometry.radius / obstructions.cellSize);

  return {
    geometry,
    obstructionMap: obstructions,
    radiusCells,
    snapToLegalPosition(candidate) {
      const mapPos = territoryMap.gamePosToMapPos(candidate);
      if (!Array.isArray(mapPos) || mapPos.length < 2)
        return undefined;
      const mx = Math.floor(mapPos[0]);
      const mz = Math.floor(mapPos[1]);
      if (mx < 0 || mz < 0 || mx >= territoryMap.width || mz >= territoryMap.width)
        return undefined;
      const j = mx + mz * territoryMap.width;
      const i = territoryMap.getNonObstructedTile(j, radiusCells, obstructions);
      if (!Number.isFinite(i) || i < 0)
        return undefined;
      const x = (i % obstructions.width + 0.5) * obstructions.cellSize;
      const z = (Math.floor(i / obstructions.width) + 0.5) * obstructions.cellSize;
      return [x, z];
    },
    isDangerous(position) {
      return typeof HQ.isDangerousLocation === "function" ?
        !!HQ.isDangerousLocation(gameState, position, geometry.radius) : false;
    }
  };
}

export { readTemplateGeometry, createPetraCollectorPorts, createPetraPlacementPorts };
