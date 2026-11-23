import { PUZZLE_CONFIG } from '../config/constants.js';

const isUpright = (p) => p.rotation === 0 && !p.isFlipped;

function computeSnapDistance(engine) {
  return Math.max(
    PUZZLE_CONFIG.MIN_SNAP_DISTANCE,
    Math.min(engine.pieceW, engine.pieceH) * PUZZLE_CONFIG.SNAP_DISTANCE_RATIO,
  );
}

/** Locks every piece of the group onto its target cell. */
function snapGroupToTargets(engine, group) {
  for (const p of group) {
    p.x = p.targetX;
    p.y = p.targetY;
    p.isLocked = true;
    p.zOrder = 0;
  }
  engine.stats.placedCount += group.length;
  engine.bumpLockedVersion();
  engine.bumpZVersion();
  const completed = engine.isCompleted();
  return { type: 'snap', count: group.length, completed };
}

function buildGridLookup(pieces) {
  const gridLookup = new Map();
  for (const p of pieces) {
    gridLookup.set(`${p.row},${p.col}`, p);
  }
  return gridLookup;
}

/** The four grid neighbours of a piece, in up, down, left, right order. */
function gridNeighbours(gridLookup, p) {
  return [
    gridLookup.get(`${p.row - 1},${p.col}`),
    gridLookup.get(`${p.row + 1},${p.col}`),
    gridLookup.get(`${p.row},${p.col - 1}`),
    gridLookup.get(`${p.row},${p.col + 1}`),
  ];
}

/**
 * Checks whether neighbour `n` of group piece `p` is correctly placed relative to it.
 * Returns the neighbour's group and the shift needed to align the dragged group, or null.
 */
function matchNeighbour(engine, groupId, p, n, snapDist) {
  if (!n || n.isLocked || n.groupId === groupId) return null;
  const nGroup = engine.getGroupPieces(n.groupId);
  if (!nGroup.every(isUpright)) return null;

  const expectedDx = (n.col - p.col) * engine.pieceW;
  const expectedDy = (n.row - p.row) * engine.pieceH;
  const err = Math.hypot(n.x - p.x - expectedDx, n.y - p.y - expectedDy);
  if (err > snapDist) return null;

  return {
    nGroup,
    shiftX: n.x - expectedDx - p.x,
    shiftY: n.y - expectedDy - p.y,
  };
}

/** One search pass over the group; returns the first mergeable neighbour group, or null. */
function findMergeInPass(engine, gridLookup, groupId, snapDist) {
  const currentGroup = engine.getGroupPieces(groupId);
  for (const p of currentGroup) {
    for (const n of gridNeighbours(gridLookup, p)) {
      const match = matchNeighbour(engine, groupId, p, n, snapDist);
      if (match) return { currentGroup, ...match };
    }
  }
  return null;
}

function applyMerge(groupId, { currentGroup, nGroup, shiftX, shiftY }) {
  for (const cp of currentGroup) {
    cp.x += shiftX;
    cp.y += shiftY;
  }
  for (const np of nGroup) {
    np.groupId = groupId;
  }
}

/** Repeatedly absorbs correctly placed neighbour groups. Returns the number of pieces absorbed. */
function mergeNeighbourGroups(engine, groupId, snapDist) {
  const gridLookup = buildGridLookup(engine.pieces);
  let mergedPiecesCount = 0;
  let merge = findMergeInPass(engine, gridLookup, groupId, snapDist);
  while (merge) {
    applyMerge(groupId, merge);
    mergedPiecesCount += merge.nGroup.length;
    merge = findMergeInPass(engine, gridLookup, groupId, snapDist);
  }
  return mergedPiecesCount;
}

export function resolveDropOp(engine, groupId) {
  if (groupId < 0) return { type: 'none', reason: 'fake' };
  const group = engine.getGroupPieces(groupId);
  if (group.length === 0) return { type: 'none' };
  if (group[0]?.isFake) return { type: 'none', reason: 'fake' };
  if (!group.every(isUpright)) {
    return { type: 'none', reason: 'orientation' };
  }

  const snapDist = computeSnapDistance(engine);
  const ref = group[0];
  if (Math.hypot(ref.x - ref.targetX, ref.y - ref.targetY) <= snapDist) {
    return snapGroupToTargets(engine, group);
  }

  const mergedPiecesCount = mergeNeighbourGroups(engine, groupId, snapDist);
  if (mergedPiecesCount > 0) {
    engine.bringGroupToFront(groupId);
    return {
      type: 'merge',
      mergedCount: mergedPiecesCount,
      groupSize: engine.getGroupPieces(groupId).length,
    };
  }

  return { type: 'none' };
}

export function applyPiecePatchesOp(engine, patches, { preservePositions = false } = {}) {
  if (!Array.isArray(patches) || patches.length === 0) return;
  const byId = new Map(engine.pieces.map((p) => [p.id, p]));
  for (const fp of engine.fakePieces || []) {
    byId.set(fp.id, fp);
  }
  let highestGroup = 0;
  let highestZ = engine.maxZ;
  let lockChanged = false;
  for (const sp of patches) {
    const p = byId.get(sp.id);
    if (!p) continue;
    const nextLocked = Boolean(sp.isLocked);
    if (nextLocked !== p.isLocked) lockChanged = true;
    p.isLocked = nextLocked;
    if (p.isLocked) {
      p.x = p.targetX;
      p.y = p.targetY;
    } else if (!preservePositions) {
      p.x = sp.x;
      p.y = sp.y;
    }
    p.rotation = ((sp.rotation % 4) + 4) % 4;
    p.isFlipped = Boolean(sp.isFlipped);
    p.groupId = sp.groupId;
    if (typeof sp.zOrder === 'number') {
      p.zOrder = sp.zOrder;
      highestZ = Math.max(highestZ, sp.zOrder + 1);
    }
    highestGroup = Math.max(highestGroup, sp.groupId);
  }
  engine.nextGroupId = Math.max(engine.nextGroupId, highestGroup + 1);
  engine.maxZ = Math.max(engine.maxZ, highestZ);
  engine.bumpZVersion();
  if (lockChanged) engine.bumpLockedVersion();
}

export function exportSaveDataOp(engine, settings, contributions = null) {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    puzzle: {
      seed: engine.seed,
      cols: engine.cols,
      rows: engine.rows,
      boardW: engine.boardW,
      boardH: engine.boardH,
      cutComplexity: engine.cutComplexity,
      imageWidth: engine.sourceCanvas.width,
      imageHeight: engine.sourceCanvas.height,
      imageHash: engine.imageHash,
      isSampleImage: engine.isSampleImage,
      ...(engine.isSampleImage && engine.sampleImageId
        ? { sampleImageId: engine.sampleImageId }
        : {}),
    },
    settings: structuredClone(settings),
    stats: structuredClone(engine.stats),
    ...(Array.isArray(contributions) ? { contributions: structuredClone(contributions) } : {}),
    pieces: engine.pieces.map((p) => ({
      id: p.id,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      rotation: p.rotation,
      isFlipped: p.isFlipped,
      groupId: p.groupId,
      isLocked: p.isLocked,
    })),
  };
}
