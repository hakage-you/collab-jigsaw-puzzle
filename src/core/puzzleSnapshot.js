import { PUZZLE_CONFIG } from '../config/constants.js';

export function resolveDropOp(engine, groupId) {
  const group = engine.getGroupPieces(groupId);
  if (group.length === 0) return { type: 'none' };

  const allUpright = group.every((p) => p.rotation === 0 && !p.isFlipped);
  if (!allUpright) {
    return { type: 'none', reason: 'orientation' };
  }

  const snapDist = Math.max(
    PUZZLE_CONFIG.MIN_SNAP_DISTANCE,
    Math.min(engine.pieceW, engine.pieceH) * PUZZLE_CONFIG.SNAP_DISTANCE_RATIO
  );

  const ref = group[0];
  if (Math.hypot(ref.x - ref.targetX, ref.y - ref.targetY) <= snapDist) {
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

  let mergedPiecesCount = 0;
  let keepChecking = true;
  const gridLookup = new Map();
  for (const p of engine.pieces) {
    gridLookup.set(`${p.row},${p.col}`, p);
  }

  while (keepChecking) {
    keepChecking = false;
    const currentGroup = engine.getGroupPieces(groupId);

    for (const p of currentGroup) {
      const neighbors = [
        gridLookup.get(`${p.row - 1},${p.col}`),
        gridLookup.get(`${p.row + 1},${p.col}`),
        gridLookup.get(`${p.row},${p.col - 1}`),
        gridLookup.get(`${p.row},${p.col + 1}`),
      ];

      for (const n of neighbors) {
        if (!n || n.isLocked || n.groupId === groupId) continue;
        const nGroup = engine.getGroupPieces(n.groupId);
        const nUpright = nGroup.every((np) => np.rotation === 0 && !np.isFlipped);
        if (!nUpright) continue;

        const expectedDx = (n.col - p.col) * engine.pieceW;
        const expectedDy = (n.row - p.row) * engine.pieceH;
        const err = Math.hypot(n.x - p.x - expectedDx, n.y - p.y - expectedDy);

        if (err <= snapDist) {
          const shiftX = n.x - expectedDx - p.x;
          const shiftY = n.y - expectedDy - p.y;
          for (const cp of currentGroup) {
            cp.x += shiftX;
            cp.y += shiftY;
          }
          for (const np of nGroup) {
            np.groupId = groupId;
          }
          mergedPiecesCount += nGroup.length;
          keepChecking = true;
          break;
        }
      }
      if (keepChecking) break;
    }
  }

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

export function applyPiecePatchesOp(engine, patches) {
  if (!Array.isArray(patches) || patches.length === 0) return;
  const byId = new Map(engine.pieces.map((p) => [p.id, p]));
  let highestGroup = 0;
  let highestZ = engine.maxZ;
  let lockChanged = false;
  for (const sp of patches) {
    const p = byId.get(sp.id);
    if (!p) continue;
    const nextLocked = !!sp.isLocked;
    if (nextLocked !== p.isLocked) lockChanged = true;
    p.isLocked = nextLocked;
    p.x = p.isLocked ? p.targetX : sp.x;
    p.y = p.isLocked ? p.targetY : sp.y;
    p.rotation = ((sp.rotation % 4) + 4) % 4;
    p.isFlipped = !!sp.isFlipped;
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

export function exportSaveDataOp(engine, settings) {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    puzzle: {
      seed: engine.seed,
      cols: engine.cols,
      rows: engine.rows,
      cutComplexity: engine.cutComplexity,
      imageWidth: engine.sourceCanvas.width,
      imageHeight: engine.sourceCanvas.height,
      imageHash: engine.imageHash,
      isSampleImage: engine.isSampleImage,
    },
    settings: structuredClone(settings),
    stats: structuredClone(engine.stats),
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
