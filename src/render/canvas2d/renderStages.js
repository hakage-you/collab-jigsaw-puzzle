import {
  drawBoardFrame,
  drawDeskBackground,
  drawReferenceSheet,
  drawRemoteLockBadges,
  drawZoneLabels,
  resolvePlayerColor,
} from './canvasOverlayRenderer.js';

/*
 * Ordered draw stages used by CanvasRenderer.renderFrame.
 * Every stage receives one frame context `f`, built once per frame:
 * { ctx, engine, room, view, refSheet, settings, isDark, pal, rect, dpr,
 *   highlightFilter, ghostPiecesActive, draggingGroupId, hoveredPiece, lockedCache, sprites }
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
  const { ctx, engine, view, settings, isDark, pal, refSheet } = f;
  drawBoardFrame(ctx, { engine, scale: view.scale, settings, isDark, pal });
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

function drawLoosePieces(f, visibleLoose, lodConfig) {
  const outlineOf = outlineResolver(f);
  for (const p of visibleLoose) {
    drawPiece(f, { piece: p, ...outlineOf(p), lodConfig });
  }
}

/**
 * Outlines only (no sprites), for renderers that draw the pieces elsewhere (WebGL): strokes the
 * dragged, hovered and remotely held pieces in world space on `f.ctx`.
 */
export function drawOutlinesStage(f, visibleLoose) {
  const outlineOf = outlineResolver(f);
  const { ctx } = f;
  for (const piece of visibleLoose) {
    const o = outlineOf(piece);
    if (!(o.remoteLockMeta || o.isActiveGroup || o.isHoverGroup)) continue;
    ctx.save();
    const at = drawnAt(f, piece);
    ctx.translate(at.x, at.y);
    ctx.rotate((piece.rotation * Math.PI) / 2);
    if (piece.isFlipped) ctx.scale(-1, 1);
    ctx.globalAlpha = pieceAlpha(f, piece);
    strokeOutline(f, piece, o.remoteLockMeta, o.isActiveGroup);
    ctx.restore();
  }
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

/** Where a piece is drawn: its position, moved along a runaway hop while one plays. */
export function drawnAt(f, piece) {
  const o = f.motionOffsets?.get(piece.id);
  return o ? { x: piece.x + o.dx, y: piece.y + o.dy } : piece;
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

function strokeOutline(f, piece, remoteLockMeta, isActiveGroup) {
  const { ctx, pal, view } = f;
  let strokeCol = pal.secondary;
  if (remoteLockMeta) strokeCol = resolvePlayerColor(remoteLockMeta.color, pal);
  else if (isActiveGroup) strokeCol = pal.accent;
  ctx.lineWidth = (remoteLockMeta || isActiveGroup ? 4.4 : 3.6) / view.scale;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  const path = f.sprites.pathOf(piece);
  ctx.stroke(path);
  ctx.lineWidth = (remoteLockMeta ? 2.8 : 2.4) / view.scale;
  ctx.strokeStyle = strokeCol;
  ctx.stroke(path);
}

/**
 * Draws one piece in world space.
 * Options: piece, isActiveGroup, isHoverGroup, remoteLockMeta (another player's lock),
 * lodConfig (null when the LOD cache is not in use).
 */
function drawPiece(
  f,
  { piece, isActiveGroup = false, isHoverGroup = false, remoteLockMeta = null, lodConfig = null },
) {
  const sprite = resolvePieceSprite(f, piece, lodConfig);
  if (!sprite) return;
  const { ctx } = f;

  ctx.save();
  const at = drawnAt(f, piece);
  ctx.translate(at.x, at.y);
  ctx.rotate((piece.rotation * Math.PI) / 2);
  if (piece.isFlipped) {
    ctx.scale(-1, 1);
  }
  ctx.globalAlpha = pieceAlpha(f, piece);
  drawSprite(ctx, f.sprites.metrics, sprite);
  if (remoteLockMeta || isActiveGroup || isHoverGroup) {
    strokeOutline(f, piece, remoteLockMeta, isActiveGroup);
  }
  ctx.restore();
}
