import { OJAMA_CONFIG } from '../config/constants.js';
import { getSingleLoosePieces } from './pieceSorter.js';

export function dropLockedPiecesOp(
  engine,
  count = OJAMA_CONFIG.DEFAULT_DROP_COUNT,
  allowRotation = false
) {
  const locked = engine.pieces.filter((p) => p.isLocked);
  if (locked.length === 0) return 0;

  const actual = Math.min(count, locked.length);
  const chosen = [];
  const pool = [...locked];
  for (let i = 0; i < actual; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    chosen.push(pool.splice(idx, 1)[0]);
  }

  const maxX = engine.boardW / 2 + engine.pieceW * 0.25;
  const maxY = engine.boardH / 2 + engine.pieceH * 0.25;

  chosen.forEach((p) => {
    p.isLocked = false;
    p.groupId = engine.nextGroupId++;
    p.zOrder = engine.maxZ++;
    const angle = Math.random() * Math.PI * 2;
    const dist = engine.pieceW * (0.6 + Math.random() * 1.0);
    p.x = Math.max(-maxX, Math.min(maxX, p.targetX + Math.cos(angle) * dist));
    p.y = Math.max(-maxY, Math.min(maxY, p.targetY + Math.sin(angle) * dist));
    if (allowRotation && Math.random() < 0.6) {
      p.rotation = 1 + Math.floor(Math.random() * 3);
    }
  });

  engine.completedFired = false;
  engine.stats.ojamaTotal += 1;
  engine.stats.ojamaBreakdown.drop += 1;
  engine.bumpLockedVersion();
  engine.bumpZVersion();
  return actual;
}

function buildFakePieceFromSource(src, spec, zOrder) {
  return {
    id: spec.fakeId,
    fakeId: spec.fakeId,
    sourcePieceId: src.id,
    row: src.row,
    col: src.col,
    isEdge: src.isEdge,
    targetX: src.targetX,
    targetY: src.targetY,
    x: spec.x,
    y: spec.y,
    rotation: ((spec.rotation % 4) + 4) % 4,
    isFlipped: !!spec.isFlipped,
    groupId: spec.fakeId,
    isLocked: false,
    isFake: true,
    expiresAt: spec.expiresAt,
    zOrder,
    colorInfo: src.colorInfo,
    path: src.path,
    frontSprite: src.frontSprite,
    backSprite: src.backSprite,
    spriteScale: src.spriteScale,
    spriteHalfW: src.spriteHalfW,
    spriteHalfH: src.spriteHalfH,
    spriteLogicalW: src.spriteLogicalW,
    spriteLogicalH: src.spriteLogicalH,
  };
}

export function addFakePiecesOp(
  engine,
  count = OJAMA_CONFIG.FAKE_PIECE_ADD_COUNT,
  durationSec = OJAMA_CONFIG.FAKE_PIECE_DURATION_SEC,
  allowRotation = true,
  allowFlip = true
) {
  if (engine.pieces.length === 0) return [];
  const expiresAt = Date.now() + Math.max(1, durationSec) * 1000;
  const spanW = engine.boardW + engine.pieceW * 2.4;
  const spanH = engine.boardH + engine.pieceH * 2.4;
  const added = [];

  for (let i = 0; i < count; i++) {
    const src = engine.pieces[Math.floor(Math.random() * engine.pieces.length)];
    const fakeId = -(engine.nextFakePieceSeq++);
    const fake = buildFakePieceFromSource(
      src,
      {
        fakeId,
        x: (Math.random() - 0.5) * spanW,
        y: (Math.random() - 0.5) * spanH,
        rotation: allowRotation ? Math.floor(Math.random() * 4) : 0,
        isFlipped: allowFlip ? Math.random() < 0.3 : false,
        expiresAt,
      },
      engine.maxZ++
    );
    engine.fakePieces.push(fake);
    added.push(fake);
  }

  while (engine.fakePieces.length > OJAMA_CONFIG.FAKE_PIECE_MAX_COUNT) {
    engine.fakePieces.shift();
  }

  engine.stats.ojamaTotal += 1;
  engine.stats.ojamaBreakdown.fake = (engine.stats.ojamaBreakdown.fake || 0) + 1;
  engine.bumpZVersion();
  return added;
}

export function syncFakePiecesFromSpecsOp(engine, specs) {
  if (!Array.isArray(specs)) return;
  const byId = new Map(engine.pieces.map((p) => [p.id, p]));
  const next = [];
  for (const spec of specs) {
    const src = byId.get(spec.sourcePieceId);
    if (!src) continue;
    const zOrder = typeof spec.zOrder === 'number' ? spec.zOrder : engine.maxZ++;
    engine.maxZ = Math.max(engine.maxZ, zOrder + 1);
    next.push(buildFakePieceFromSource(src, spec, zOrder));
  }
  engine.fakePieces = next;
  engine.bumpZVersion();
}

export function prankLoosePiecesOp(
  engine,
  count = OJAMA_CONFIG.PRANK_DEFAULT_COUNT,
  excludedGroupIds = null
) {
  const singles = getSingleLoosePieces(engine, excludedGroupIds);
  let targets = singles;
  if (targets.length === 0) {
    targets = engine.pieces.filter(
      (p) => !p.isLocked && (!excludedGroupIds || !excludedGroupIds.has(p.groupId))
    );
  }
  if (targets.length === 0) return 0;

  const pool = [...targets];
  const actual = Math.min(count, pool.length);
  const groupCounts = engine.getGroupCounts();

  for (let i = 0; i < actual; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const p = pool.splice(idx, 1)[0];
    const isSingle = groupCounts.get(p.groupId) === 1;
    if (isSingle && Math.random() < 0.45) {
      p.isFlipped = !p.isFlipped;
    } else {
      const delta = 1 + Math.floor(Math.random() * 3);
      const group = engine.getGroupPieces(p.groupId);
      const px = p.x;
      const py = p.y;
      for (const gp of group) {
        let dx = gp.x - px;
        let dy = gp.y - py;
        for (let step = 0; step < delta; step++) {
          const nx = -dy;
          const ny = dx;
          dx = nx;
          dy = ny;
          gp.rotation = (gp.rotation + 1) % 4;
        }
        gp.x = px + dx;
        gp.y = py + dy;
      }
    }
    engine.bringGroupToFront(p.groupId);
  }

  engine.stats.ojamaTotal += 1;
  engine.stats.ojamaBreakdown.prank += 1;
  return actual;
}
