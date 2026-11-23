import { drawTexturedDesk } from '../deskTextures.js';
import {
  drawBoardFrame,
  drawDeskBackground,
  drawReferenceSheet,
  drawRemoteLockBadges,
  drawZoneLabels,
  resolvePlayerColor,
} from './canvasOverlayRenderer.js';

/** How much a held piece grows when lifted off the desk. */
const LIFT_SCALE = 1.04;
/** Lifted pieces get a drop shadow only up to this many (big groups are just scaled). */
const LIFT_SHADOW_MAX_PIECES = 64;
/** The lifted piece's shadow, in screen px. */
const LIFT_SHADOW = Object.freeze({ dx: 5, dy: 9, blur: 12, color: 'rgba(15, 23, 42, 0.34)' });

/**
 * Groups drawn lifted this frame (the one I drag, and those other players hold), each with its
 * centre to grow from; null when held pieces are not lifted.
 */
export function liftedGroups({ viewState, engine, room }) {
  if (!viewState.liftHeldPieces) return null;
  const ids = new Set();
  if (viewState.draggingGroupId !== null) ids.add(viewState.draggingGroupId);
  if (room?.isMultiplayer()) {
    for (const [groupId, owner] of room.groupLocks.entries()) {
      if (owner !== room.myPlayerId) ids.add(groupId);
    }
  }
  if (ids.size === 0) return null;
  const centres = new Map();
  for (const id of ids) {
    const group = engine.getGroupPieces(id);
    if (group.length === 0 || group[0].isLocked) continue;
    const x = group.reduce((sum, p) => sum + p.x, 0) / group.length;
    const y = group.reduce((sum, p) => sum + p.y, 0) / group.length;
    centres.set(id, { x, y });
  }
  return centres.size > 0 ? centres : null;
}

/** 1, or LIFT_SCALE when the piece's group is lifted. */
export function liftScaleOf(f, piece) {
  return f.lifted?.has(piece.groupId) ? LIFT_SCALE : 1;
}

/** The lifted pieces' shadow in screen px, or null when there is none. */
export function liftShadowFor(count) {
  return count > 0 && count <= LIFT_SHADOW_MAX_PIECES ? LIFT_SHADOW : null;
}

/*
 * Ordered draw stages used by CanvasRenderer.renderFrame.
 * Every stage receives one frame context `f`, built once per frame:
 * { ctx, engine, room, view, refSheet, settings, isDark, pal, rect, dpr,
 *   highlightFilter, ghostPiecesActive, draggingGroupId, hoveredPiece, lockedCache, sprites,
 *   lifted (liftedGroups), requestRender }
 * Cursors, snap flashes and confetti are drawn on the effects layer (effectsLayer.js).
 */

export function prepareCanvas(f) {
  const { ctx, rect, dpr } = f;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, rect.width, rect.height);
}

export function drawDeskStage(f) {
  const style = f.settings?.deskStyle;
  if (drawTexturedDesk(f.ctx, { rect: f.rect, view: f.view, style, onReady: f.requestRender })) {
    return;
  }
  drawDeskBackground(f.ctx, { rect: f.rect, view: f.view, pal: f.pal });
}

export function enterWorld(f) {
  const { ctx, rect, view } = f;
  ctx.save();
  ctx.translate(rect.width / 2, rect.height / 2);
  ctx.scale(view.scale, view.scale);
  ctx.translate(-view.x, -view.y);
}

export function leaveWorld(f) {
  f.ctx.restore();
}

export function drawBoardStage(f) {
  const { ctx, engine, view, settings, isDark, pal, refSheet, dpr } = f;
  const board = f.settings?.boardStyle;
  drawBoardFrame(ctx, {
    engine,
    scale: view.scale,
    settings,
    isDark,
    pal,
    board,
    dpr,
    requestRender: f.requestRender,
  });
  drawReferenceSheet(ctx, { settings, sourceCanvas: engine.sourceCanvas, refSheet, pal });
  drawZoneLabels(ctx, engine.zoneLabels, pal, view.scale);
}

function inBox(p, b) {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

/** Returns the locked and loose pieces inside the visible world rectangle plus padding. */
export function collectVisiblePieces(f) {
  const { engine, view, rect } = f;
  const halfVisW = rect.width / (2 * view.scale);
  const halfVisH = rect.height / (2 * view.scale);
  const cullPad = Math.max(engine.pieceW, engine.pieceH) + engine.spritePad + 16;
  const box = {
    minX: view.x - halfVisW - cullPad,
    maxX: view.x + halfVisW + cullPad,
    minY: view.y - halfVisH - cullPad,
    maxY: view.y + halfVisH + cullPad,
  };
  const visibleLocked = engine.pieces.filter((p) => p.isLocked && inBox(p, box));
  const visibleLoose = engine.getSortedLoosePieces().filter((p) => inBox(p, box));
  return { visibleLocked, visibleLoose };
}

/** Zoom-sprite (LOD) settings for this frame, or null when base sprites are sharp enough. */
export function resolveLodConfig(f, visibleCount) {
  const { sprites } = f;
  return sprites.lodCache.resolveLodConfig(
    f.view.scale * f.dpr,
    f.engine,
    visibleCount,
    sprites.metrics,
  );
}

/**
 * Which outline a loose piece gets: dragged by me (active), under the pointer (hover) or held
 * by another player (remoteLockMeta). Returns a function so the per-frame lookups happen once.
 */
function outlineResolver(f) {
  const { room, draggingGroupId, hoveredPiece } = f;
  const hoverGroupId = hoveredPiece ? hoveredPiece.groupId : null;
  const isMulti = Boolean(room?.isMultiplayer());
  return (p) => {
    const lockOwner = isMulti ? room.groupLocks.get(p.groupId) : null;
    const remoteLockMeta =
      lockOwner && lockOwner !== room.myPlayerId ? room.getPlayerMeta(lockOwner) : null;
    const isActiveGroup = draggingGroupId !== null && p.groupId === draggingGroupId;
    const isHoverGroup =
      !isActiveGroup && !remoteLockMeta && hoverGroupId !== null && p.groupId === hoverGroupId;
    return { isActiveGroup, isHoverGroup, remoteLockMeta };
  };
}

/** Loose pieces; their outlines go on the effects layer (drawOutlinesStage). */
function drawLoosePieces(f, visibleLoose, lodConfig) {
  const lifted = [];
  for (const p of visibleLoose) {
    if (f.lifted?.has(p.groupId)) lifted.push(p);
    else drawPiece(f, { piece: p, lodConfig });
  }
  // Lifted pieces go on top: first their shadows (each drawn with its piece, so pieces of the
  // same group are drawn again over any shadow that fell on them), then the pieces.
  const shadow = liftShadowFor(lifted.length);
  if (shadow) for (const p of lifted) drawPiece(f, { piece: p, lodConfig, shadow });
  for (const p of lifted) drawPiece(f, { piece: p, lodConfig });
}

/** Moves the context to a piece: its drawn position, turn, mirror and lift. */
function enterPiece(f, piece) {
  const { ctx } = f;
  const at = drawnAt(f, piece);
  ctx.translate(at.x, at.y);
  ctx.rotate((piece.rotation * Math.PI) / 2);
  if (piece.isFlipped) ctx.scale(-1, 1);
  const lift = liftScaleOf(f, piece);
  if (lift !== 1) ctx.scale(lift, lift);
}

/** Outlines with a glow up to this many pieces (a big group gets the line only). */
const OUTLINE_GLOW_MAX_PIECES = 64;

function outlineColor(f, o) {
  if (o.remoteLockMeta) return resolvePlayerColor(o.remoteLockMeta.color, f.pal);
  return o.isActiveGroup ? f.pal.accent : f.pal.secondary;
}

/**
 * Outlines of the dragged, hovered and remotely held pieces, on the effects layer (with either
 * renderer), drawn outside the pieces only: each outlined piece is stroked (with a soft glow), then
 * every outlined piece's shape is cut out of the layer. The line hugs the outer edge without
 * covering the picture, and no line runs across the joins inside a group. Needs a layer of its
 * own above the pieces (the effects layer), since the cut erases whatever is under it there.
 */
export function drawOutlinesStage(f, visibleLoose) {
  const resolve = outlineResolver(f);
  const marked = [];
  for (const piece of visibleLoose) {
    const o = resolve(piece);
    if (o.remoteLockMeta || o.isActiveGroup || o.isHoverGroup) marked.push({ piece, o });
  }
  if (marked.length === 0) return;
  const { ctx, view, dpr } = f;
  const glow = marked.length <= OUTLINE_GLOW_MAX_PIECES;
  ctx.save();
  ctx.lineJoin = 'round';
  for (const { piece, o } of marked) {
    const color = outlineColor(f, o);
    ctx.save();
    enterPiece(f, piece);
    ctx.globalAlpha = pieceAlpha(f, piece);
    ctx.strokeStyle = color;
    // Half of the line is cut away below: 3 px stay outside a held piece, 2.5 px when hovered.
    ctx.lineWidth = (o.isHoverGroup ? 5 : 6) / view.scale;
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 7 * dpr;
    }
    ctx.stroke(f.sprites.pathOf(piece));
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  for (const { piece } of marked) {
    ctx.save();
    enterPiece(f, piece);
    ctx.fill(f.sprites.pathOf(piece));
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Draws locked then loose pieces. Returns the LOD config used this frame
 * (null when the LOD cache is not in use).
 */
export function drawPieceStage(f, { visibleLocked, visibleLoose }) {
  const lodConfig = resolveLodConfig(f, visibleLocked.length + visibleLoose.length);
  if (lodConfig) {
    f.sprites.lodCache.beginFrame(f.engine.puzzleGeneration, lodConfig.bucket, lodConfig.slotStep);
    for (const p of visibleLocked) {
      drawPiece(f, { piece: p, lodConfig });
    }
  } else {
    f.lockedCache.draw(f.ctx, f.engine, f.sprites, f.highlightFilter !== 'all');
  }
  drawLoosePieces(f, visibleLoose, lodConfig);
  return lodConfig;
}

export function drawLockBadgeStage(f) {
  drawRemoteLockBadges(f.ctx, { room: f.room, engine: f.engine, scale: f.view.scale, pal: f.pal });
}

/**
 * Where a piece is drawn: its position, moved along a runaway hop while one plays, and spread
 * from its group's centre while the group is lifted (so the group grows as one).
 */
export function drawnAt(f, piece) {
  const o = f.motionOffsets?.get(piece.id);
  const at = o ? { x: piece.x + o.dx, y: piece.y + o.dy } : piece;
  const c = f.lifted?.get(piece.groupId);
  if (!c) return at;
  return { x: c.x + (at.x - c.x) * LIFT_SCALE, y: c.y + (at.y - c.y) * LIFT_SCALE };
}

/** Opacity of a piece under the highlight filter and the ghost interference. */
export function pieceAlpha(f, piece) {
  let alpha = 1;
  if (f.highlightFilter !== 'all') {
    if (piece.isLocked) alpha = 0.75;
    else if (f.highlightFilter === 'edges') alpha = piece.isEdge ? 1 : 0.16;
    else if (f.highlightFilter.startsWith('color:')) {
      const bucket = f.highlightFilter.slice(6);
      alpha = piece.colorInfo.bucket === bucket ? 1 : 0.16;
    }
  }
  if (f.ghostPiecesActive && !piece.isLocked) {
    alpha *= 0.1;
  }
  return alpha;
}

/** The sprite to draw for a piece: a zoom sprite when available, else its front or back. */
export function resolvePieceSprite(f, piece, lodConfig) {
  const { sprites, engine } = f;
  if (lodConfig) {
    const lodSprite = sprites.lodCache.getOrRender(piece, {
      isFlipped: piece.isFlipped,
      lodScale: lodConfig.lodScale,
      engine,
      store: sprites,
    });
    if (lodSprite) return lodSprite;
  }
  return piece.isFlipped ? sprites.backSprite(piece) : sprites.frontSprite(piece);
}

/** Draws a sprite at the puzzle-wide logical sprite size, centred on the piece. */
function drawSprite(ctx, metrics, sprite) {
  ctx.drawImage(
    sprite.canvas,
    sprite.sx,
    sprite.sy,
    sprite.sw,
    sprite.sh,
    -metrics.halfW,
    -metrics.halfH,
    metrics.logicalW,
    metrics.logicalH,
  );
}

/**
 * Draws one piece in world space. `lodConfig` is null when the LOD cache is not in use;
 * `shadow` draws it with a drop shadow (a lifted piece's first pass).
 */
function drawPiece(f, { piece, lodConfig = null, shadow = null }) {
  const sprite = resolvePieceSprite(f, piece, lodConfig);
  if (!sprite) return;
  const { ctx } = f;

  ctx.save();
  enterPiece(f, piece);
  ctx.globalAlpha = pieceAlpha(f, piece);
  if (shadow) {
    // Shadow sizes are in device pixels: the canvas transform does not apply to them.
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur * f.dpr;
    ctx.shadowOffsetX = shadow.dx * f.dpr;
    ctx.shadowOffsetY = shadow.dy * f.dpr;
  }
  drawSprite(ctx, f.sprites.metrics, sprite);
  ctx.restore();
}
