function normalize(v) {
  const len = Math.hypot(v[0], v[1]);
  return len > 0 ? [v[0] / len, v[1] / len] : [1, 0];
}

function addPolar(anchor, distance, angle) {
  return [anchor[0] + Math.cos(angle) * distance, anchor[1] + Math.sin(angle) * distance];
}

function requirePosition(value, label) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite))
    throw new Error(`${label} must be an explicit [x,z] position`);
  return value;
}

function orderedAngles(baseAngle, count = 16) {
  const result = [];
  const step = 2 * Math.PI / count;
  result.push(baseAngle);
  for (let i = 1; i <= Math.floor(count / 2); ++i) {
    result.push(baseAngle + i * step);
    if (i !== count / 2)
      result.push(baseAngle - i * step);
  }
  return result;
}

function generateHouseCandidates(request) {
  const anchor = requirePosition(request.anchor, "house anchor");
  const templateRadius = Number(request.templateRadius);
  const anchorRadius = Number(request.anchorRadius || 0);
  if (!Number.isFinite(templateRadius) || templateRadius <= 0)
    throw new Error("house templateRadius is required");
  const borderGap = Number.isFinite(request.maxBorderGap) ? request.maxBorderGap : 5;
  const minDist = anchorRadius + templateRadius + 0.5;
  const maxDist = anchorRadius + templateRadius + borderGap;
  let direction = [1, 0];
  if (request.avoid) {
    const avoid = requirePosition(request.avoid, "house avoid");
    direction = normalize([anchor[0] - avoid[0], anchor[1] - avoid[1]]);
  }
  const base = Math.atan2(direction[1], direction[0]);
  const angles = orderedAngles(base, 16);
  const out = [];
  for (let d = minDist; d <= maxDist + 0.001; d += 1)
    for (const angle of angles)
      out.push(addPolar(anchor, d, angle));
  return out;
}

function generateFarmsteadCandidates(request) {
  const center = requirePosition(request.anchor, "farmstead food-center anchor");
  const toward = request.toward ? requirePosition(request.toward, "farmstead toward") : [center[0] + 1, center[1]];
  const base = Math.atan2(toward[1] - center[1], toward[0] - center[0]);
  const out = [];
  for (const dist of request.distances || [12, 15, 18, 21])
    for (const angle of orderedAngles(base, 16))
      out.push(addPolar(center, dist, angle));
  return out;
}

function generateFieldCandidates(request) {
  const anchor = requirePosition(request.anchor, "field farmstead anchor");
  const farm = request.anchorHalfExtents || { width: 5, depth: 5 };
  const field = request.templateHalfExtents || { width: 14, depth: 14 };
  const gap = Number.isFinite(request.gap) ? request.gap : 0.5;
  const x = Number(farm.width) + Number(field.width) + gap;
  const z = Number(farm.depth) + Number(field.depth) + gap;
  const raw = [
    [anchor[0] + x, anchor[1]],
    [anchor[0] - x, anchor[1]],
    [anchor[0], anchor[1] + z],
    [anchor[0], anchor[1] - z]
  ];
  if (request.diagonals) {
    raw.push(
      [anchor[0] + x, anchor[1] + z], [anchor[0] + x, anchor[1] - z],
      [anchor[0] - x, anchor[1] + z], [anchor[0] - x, anchor[1] - z]
    );
  }
  return raw;
}

function generateRingCandidates(request, defaults = [18, 22, 26, 30]) {
  const anchor = requirePosition(request.anchor, `${request.kind} anchor`);
  let base = 0;
  if (request.toward) {
    const toward = requirePosition(request.toward, `${request.kind} toward`);
    base = Math.atan2(toward[1] - anchor[1], toward[0] - anchor[0]);
  }
  const out = [];
  for (const dist of request.distances || defaults)
    for (const angle of orderedAngles(base, 16))
      out.push(addPolar(anchor, dist, angle));
  return out;
}

function generatePlacementCandidates(request) {
  if (!request || !request.kind)
    throw new Error("placement request.kind is required");
  if (Array.isArray(request.candidates))
    return request.candidates.map((pos, i) => requirePosition(pos, `candidate ${i}`));
  switch (request.kind) {
    case "house": return generateHouseCandidates(request);
    case "farmstead": return generateFarmsteadCandidates(request);
    case "field": return generateFieldCandidates(request);
    case "barracks": return generateRingCandidates(request, [18, 22, 26, 30]);
    case "storehouse": return generateRingCandidates(request, [20, 24, 28, 32]);
    default: throw new Error(`Unsupported placement kind ${request.kind}`);
  }
}

function resolveBuildingPosition(request, ports = {}) {
  const templateRadius = Number(request.templateRadius || 1);
  if (!Number.isFinite(templateRadius) || templateRadius <= 0)
    throw new Error("placement request.templateRadius must be positive");
  if (typeof ports.snapToLegalPosition !== "function")
    throw new Error("ports.snapToLegalPosition(candidate, request) is required");
  const candidates = generatePlacementCandidates(request);
  const rejected = [];
  for (let index = 0; index < candidates.length; ++index) {
    const candidate = candidates[index];
    const snapped = ports.snapToLegalPosition(candidate, request);
    if (!snapped) {
      rejected.push({ index, candidate, reason: "obstructed-or-illegal" });
      continue;
    }
    const position = Array.isArray(snapped) ? snapped : snapped.position;
    if (!position || !position.every(Number.isFinite)) {
      rejected.push({ index, candidate, reason: "invalid-snap-result" });
      continue;
    }
    if (typeof ports.isDangerous === "function" && ports.isDangerous(position, templateRadius, request)) {
      rejected.push({ index, candidate, position, reason: "dangerous" });
      continue;
    }
    if (typeof ports.extraValidation === "function" && !ports.extraValidation(position, request)) {
      rejected.push({ index, candidate, position, reason: "extra-validation" });
      continue;
    }
    return {
      kind: request.kind,
      position: [position[0], position[1]],
      angle: Number.isFinite(request.angle) ? request.angle : 3 * Math.PI / 4,
      candidateIndex: index,
      rejected
    };
  }
  return { kind: request.kind, position: undefined, candidateIndex: -1, rejected };
}

export {
  orderedAngles,
  generatePlacementCandidates,
  resolveBuildingPosition
};
