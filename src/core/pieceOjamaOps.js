import { OJAMA_CONFIG } from '../config/constants.js';
import { getSingleLoosePieces } from './pieceSorter.js';
import { drawFrontPieceToSlot } from './pieceSpriteBuilder.js';

const FAKE_ATLAS_SIZE = 1024;
const FAKE_SLOT_COLS = 4;
const FAKE_SLOT_STEP = FAKE_ATLAS_SIZE / FAKE_SLOT_COLS; // 256px, 16 slots = 4MB fixed
const FAKE_MAX_SLOTS = FAKE_SLOT_COLS * FAKE_SLOT_COLS;

export function dropLockedPiecesOp(
  engine,
  count = OJAMA_CONFIG.DEFAULT_DROP_COUNT,
  allowRotation = false,
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
    const dist = engine.pieceW * (0.6 + Math.random());
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

function ensureFakeAtlas(engine) {
  if (!engine.fakeAtlasCanvas) {
    const c = document.createElement('canvas');
    c.width = FAKE_ATLAS_SIZE;
    c.height = FAKE_ATLAS_SIZE;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    engine.fakeAtlasCanvas = c;
    engine.fakeAtlasCtx = ctx;
  }
  return { canvas: engine.fakeAtlasCanvas, ctx: engine.fakeAtlasCtx };
}

function allocateFakeSlotIndex(engine) {
  const used = new Set((engine.fakePieces || []).map((fp) => fp._fakeSlotIdx));
  for (let i = 0; i < FAKE_MAX_SLOTS; i++) {
    if (!used.has(i)) return i;
  }
  const oldest = engine.fakePieces?.[0];
  return typeof oldest?._fakeSlotIdx === 'number' ? oldest._fakeSlotIdx : 0;
}

function pickShiftedCropCenter(engine, src) {
  const halfW = engine.boardW / 2;
  const halfH = engine.boardH / 2;
  const marginX = Math.min(halfW * 0.8, engine.pieceW * 0.55);
  const marginY = Math.min(halfH * 0.8, engine.pieceH * 0.55);
  const signX = Math.random() < 0.5 ? -1 : 1;
  const signY = Math.random() < 0.5 ? -1 : 1;
  const offX = signX * engine.pieceW * (0.35 + Math.random() * 0.85);
  const offY = signY * engine.pieceH * (0.35 + Math.random() * 0.85);
  const minX = -halfW + marginX;
  const maxX = halfW - marginX;
  const minY = -halfH + marginY;
  const maxY = halfH - marginY;
  return {
    targetX: Math.max(minX, Math.min(maxX, src.targetX + offX)),
    targetY: Math.max(minY, Math.min(maxY, src.targetY + offY)),
  };
}

function renderFakeFrontSprite(engine, piece, slotIdx) {
  if (!engine.sourceCanvas) return piece.frontSprite;
  const { canvas, ctx } = ensureFakeAtlas(engine);
  const sx = (slotIdx % FAKE_SLOT_COLS) * FAKE_SLOT_STEP;
  const sy = Math.floor(slotIdx / FAKE_SLOT_COLS) * FAKE_SLOT_STEP;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(sx, sy, FAKE_SLOT_STEP, FAKE_SLOT_STEP);

  const logicalW = piece.spriteLogicalW || Math.ceil(engine.pieceW + engine.spritePad * 2);
  const logicalH = piece.spriteLogicalH || Math.ceil(engine.pieceH + engine.spritePad * 2);
  const maxCellScale = (FAKE_SLOT_STEP - 4) / Math.max(1, logicalW, logicalH);
  const renderScale = Math.min(piece.spriteScale || 1, maxCellScale);
  const physW = Math.min(FAKE_SLOT_STEP - 2, Math.max(8, Math.ceil(logicalW * renderScale)));
  const physH = Math.min(FAKE_SLOT_STEP - 2, Math.max(8, Math.ceil(logicalH * renderScale)));
  const slot = { canvas, sx, sy, sw: physW, sh: physH };

  drawFrontPieceToSlot(ctx, slot, {
    piece,
    sourceCanvas: engine.sourceCanvas,
    boardW: engine.boardW,
    boardH: engine.boardH,
    pieceW: engine.pieceW,
    pieceH: engine.pieceH,
    logicalW,
    logicalH,
    renderScale,
    isLod: false,
  });

  piece.spriteScale = renderScale;
  return slot;
}

function buildFakePieceFromSource(engine, src, spec, zOrder, slotIdx) {
  const targetX = typeof spec.targetX === 'number' ? spec.targetX : src.targetX;
  const targetY = typeof spec.targetY === 'number' ? spec.targetY : src.targetY;
  const fake = {
    id: spec.fakeId,
    fakeId: spec.fakeId,
    sourcePieceId: src.id,
    row: src.row,
    col: src.col,
    isEdge: src.isEdge,
    targetX,
    targetY,
    x: spec.x,
    y: spec.y,
    rotation: ((spec.rotation % 4) + 4) % 4,
    isFlipped: Boolean(spec.isFlipped),
    groupId: spec.fakeId,
    isLocked: false,
    isFake: true,
    expiresAt: typeof spec.expiresAt === 'number' ? spec.expiresAt : 0,
    zOrder,
    colorInfo: src.colorInfo,
    path: src.path,
    frontSprite: src.frontSprite,
    backSprite: null,
    spriteScale: src.spriteScale,
    spriteHalfW: src.spriteHalfW,
    spriteHalfH: src.spriteHalfH,
    spriteLogicalW: src.spriteLogicalW,
    spriteLogicalH: src.spriteLogicalH,
    _fakeSlotIdx: slotIdx,
  };
  fake.frontSprite = renderFakeFrontSprite(engine, fake, slotIdx);
  return fake;
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Spawns one fake piece: a shape borrowed from a source piece, a shifted crop centre,
 * and a random scatter position. Consumes Math.random in a fixed order.
 */
function spawnFakePiece(engine, cfg) {
  const shapeSrc = pickRandom(cfg.shapePool);
  const cropSrc = pickRandom(engine.pieces);
  const { targetX, targetY } = pickShiftedCropCenter(engine, cropSrc);
  const fakeId = -engine.nextFakePieceSeq++;
  const slotIdx = allocateFakeSlotIndex(engine);
  const spec = {
    fakeId,
    targetX,
    targetY,
    x: (Math.random() - 0.5) * cfg.spanW,
    y: (Math.random() - 0.5) * cfg.spanH,
    rotation: cfg.allowRotation ? Math.floor(Math.random() * 4) : 0,
    isFlipped: cfg.allowFlip ? Math.random() < 0.3 : false,
    expiresAt: cfg.expiresAt,
  };
  return buildFakePieceFromSource(engine, shapeSrc, spec, engine.maxZ++, slotIdx);
}

export function addFakePiecesOp(
  engine,
  {
    count = OJAMA_CONFIG.FAKE_PIECE_ADD_COUNT,
    durationSec = OJAMA_CONFIG.FAKE_PIECE_DURATION_SEC,
    allowRotation = true,
    allowFlip = true,
    maxCount = OJAMA_CONFIG.FAKE_PIECE_MAX_COUNT,
  } = {},
) {
  if (engine.pieces.length === 0) return [];
  const clampedMax = Math.max(
    1,
    Math.min(FAKE_MAX_SLOTS, Number(maxCount) || OJAMA_CONFIG.FAKE_PIECE_MAX_COUNT),
  );
  const dur = Math.max(0, Number(durationSec) || 0);
  const innerPool = engine.pieces.filter((p) => !p.isEdge);
  const cfg = {
    allowRotation,
    allowFlip,
    expiresAt: dur > 0 ? Date.now() + dur * 1000 : 0,
    spanW: engine.boardW + engine.pieceW * 2.4,
    spanH: engine.boardH + engine.pieceH * 2.4,
    shapePool: innerPool.length > 0 ? innerPool : engine.pieces,
  };
  const added = [];

  for (let i = 0; i < count; i++) {
    while (engine.fakePieces.length >= clampedMax) {
      engine.fakePieces.shift();
    }
    const fake = spawnFakePiece(engine, cfg);
    engine.fakePieces.push(fake);
    added.push(fake);
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
  engine.fakePieces = [];
  for (let i = 0; i < Math.min(specs.length, FAKE_MAX_SLOTS); i++) {
    const spec = specs[i];
    const src = byId.get(spec.sourcePieceId);
    if (!src) continue;
    const zOrder = typeof spec.zOrder === 'number' ? spec.zOrder : engine.maxZ++;
    engine.maxZ = Math.max(engine.maxZ, zOrder + 1);
    const fake = buildFakePieceFromSource(engine, src, spec, zOrder, i);
    next.push(fake);
    engine.fakePieces = next;
  }
  engine.fakePieces = next;
  engine.bumpZVersion();
}

export function prankLoosePiecesOp(
  engine,
  count = OJAMA_CONFIG.PRANK_DEFAULT_COUNT,
  excludedGroupIds = null,
) {
  const singles = getSingleLoosePieces(engine, excludedGroupIds);
  let targets = singles;
  if (targets.length === 0) {
    targets = engine.pieces.filter(
      (p) => !p.isLocked && (!excludedGroupIds || !excludedGroupIds.has(p.groupId)),
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
