import { PUZZLE_CONFIG } from '../config/constants.js';

/**
 * Shared 2048x2048 CPU-rasterized offscreen canvas texture atlas (`willReadFrequently: true`)
 * with page pooling across puzzle rebuilds to eliminate Skia GPU path/surface accumulation.
 */
export class PieceSpriteAtlas {
  constructor(
    atlasSize = PUZZLE_CONFIG.SPRITE_ATLAS_SIZE,
    pad = PUZZLE_CONFIG.SPRITE_ATLAS_PAD,
    reusePages = null,
  ) {
    this.atlasSize = atlasSize;
    this.pad = pad;
    this.pool = Array.isArray(reusePages) ? [...reusePages] : [];
    this.pages = [];
    this.canvases = [];
    this.patternCache = new WeakMap();
  }

  _acquirePage(minW, minH) {
    const size = Math.max(this.atlasSize, minW, minH);
    const poolIdx = this.pool.findIndex(
      (p) => p?.canvas && p.canvas.width === size && p.canvas.height === size,
    );
    let canvas;
    let ctx;
    if (poolIdx !== -1) {
      const reused = this.pool.splice(poolIdx, 1)[0];
      canvas = reused.canvas;
      ctx = reused.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size, size);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const page = { canvas, ctx, cursorX: 0, cursorY: 0, rowHeight: 0 };
    this.pages.push(page);
    this.canvases.push(canvas);
    return page;
  }

  allocate(w, h) {
    let page = this.pages[this.pages.length - 1];
    if (!page) {
      page = this._acquirePage(w, h);
    }

    if (page.cursorX + w > page.canvas.width) {
      page.cursorX = 0;
      page.cursorY += page.rowHeight + this.pad;
      page.rowHeight = 0;
    }

    if (page.cursorY + h > page.canvas.height) {
      page = this._acquirePage(w, h);
    }

    const slot = {
      canvas: page.canvas,
      ctx: page.ctx,
      sx: page.cursorX,
      sy: page.cursorY,
      sw: w,
      sh: h,
    };

    page.cursorX += w + this.pad;
    page.rowHeight = Math.max(page.rowHeight, h);
    return slot;
  }

  getBackPattern(ctx, backPatternCanvas) {
    if (!backPatternCanvas) return null;
    let pat = this.patternCache.get(ctx);
    if (!pat) {
      pat = ctx.createPattern(backPatternCanvas, 'repeat');
      if (pat) this.patternCache.set(ctx, pat);
    }
    return pat;
  }

  releaseUnusedPool() {
    for (const unused of this.pool) {
      if (unused?.canvas) {
        unused.canvas.width = 0;
        unused.canvas.height = 0;
      }
    }
    this.pool.length = 0;
  }
}

/**
 * Computes logical/physical sprite dimensions and render scale for a piece.
 * @param {object} options
 * @param {HTMLCanvasElement|null} options.sourceCanvas source image canvas (may be null)
 * @param {number} options.boardW board width
 * @param {number} options.pieceW nominal piece width
 * @param {number} options.pieceH nominal piece height
 * @param {number} options.spritePad sprite padding in board units
 * @param {number} options.totalPieces total piece count
 */
function computeSpriteMetrics({ sourceCanvas, boardW, pieceW, pieceH, spritePad, totalPieces }) {
  const logicalW = Math.ceil(pieceW + spritePad * 2);
  const logicalH = Math.ceil(pieceH + spritePad * 2);
  const logicalArea = Math.max(1, logicalW * logicalH);
  // Target ~2-3 2048x2048 pages max across front + initial flipped backs
  const targetAtlasBudgetPx2 = 2048 * 2048 * 1.65;
  const budgetScale = Math.sqrt(targetAtlasBudgetPx2 / Math.max(1, totalPieces * logicalArea));
  const rawSrcScale = (sourceCanvas ? sourceCanvas.width / Math.max(1, boardW) : 1.5) * 1.25;
  const spriteScale =
    totalPieces <= 48
      ? Math.min(2, Math.max(1.5, Math.min(2, budgetScale), Math.min(2, Math.ceil(rawSrcScale))))
      : Math.max(0.28, Math.min(2, budgetScale));
  return {
    logicalW,
    logicalH,
    spriteScale,
    physW: Math.max(8, Math.ceil(logicalW * spriteScale)),
    physH: Math.max(8, Math.ceil(logicalH * spriteScale)),
  };
}

/**
 * Shared front-sprite rasterizer used by both base PieceSpriteAtlas and zoom PieceLodCache.
 */
export function drawFrontPieceToSlot(
  ctx,
  slot,
  {
    piece,
    sourceCanvas,
    boardW,
    boardH,
    pieceW,
    pieceH,
    logicalW,
    logicalH,
    renderScale,
    isLod = false,
  },
) {
  const physW = slot.sw;
  const physH = slot.sh;
  const cx = piece.spriteHalfW;
  const cy = piece.spriteHalfH;
  const minDim = Math.min(pieceW, pieceH);

  const outerWidth = isLod
    ? Math.max(0.16, Math.min(1.2, 1.2 / renderScale))
    : Math.max(0.85 / Math.max(0.28, renderScale), Math.min(1.2, Math.max(0.32, minDim * 0.04)));
  const innerWidth = isLod
    ? Math.max(0.22, Math.min(2.0, 1.8 / renderScale))
    : Math.max(1.1 / Math.max(0.28, renderScale), Math.min(2.0, Math.max(0.45, minDim * 0.06)));

  ctx.save();
  ctx.beginPath();
  ctx.rect(slot.sx, slot.sy, physW, physH);
  ctx.clip();
  ctx.translate(slot.sx, slot.sy);
  ctx.scale(renderScale, renderScale);

  const boardLeft = piece.targetX - cx + boardW / 2;
  const boardTop = piece.targetY - cy + boardH / 2;
  const visLeft = Math.max(0, boardLeft);
  const visTop = Math.max(0, boardTop);
  const visRight = Math.min(boardW, boardLeft + logicalW);
  const visBottom = Math.min(boardH, boardTop + logicalH);
  const visW = visRight - visLeft;
  const visH = visBottom - visTop;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.clip(piece.path);
  if (visW > 0 && visH > 0) {
    const srcScaleX = sourceCanvas.width / Math.max(1, boardW);
    const srcScaleY = sourceCanvas.height / Math.max(1, boardH);
    const srcX = Math.max(0, Math.min(sourceCanvas.width - 1, visLeft * srcScaleX));
    const srcY = Math.max(0, Math.min(sourceCanvas.height - 1, visTop * srcScaleY));
    const srcW = Math.min(sourceCanvas.width - srcX, Math.max(0.01, visW * srcScaleX));
    const srcH = Math.min(sourceCanvas.height - srcY, Math.max(0.01, visH * srcScaleY));
    const destX = visLeft - boardW / 2 - piece.targetX;
    const destY = visTop - boardH / 2 - piece.targetY;
    ctx.drawImage(sourceCanvas, srcX, srcY, srcW, srcH, destX, destY, visW, visH);
  }
  ctx.lineWidth = innerWidth;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.stroke(piece.path);
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineWidth = outerWidth;
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.stroke(piece.path);
  ctx.restore();

  ctx.restore();
}

/**
 * Shared back-sprite rasterizer used by both base PieceSpriteAtlas and zoom PieceLodCache.
 */
export function drawBackPieceToSlot(
  ctx,
  slot,
  { piece, pieceW, pieceH, logicalW, logicalH, renderScale, pattern, isLod = false },
) {
  const physW = slot.sw;
  const physH = slot.sh;
  const cx = piece.spriteHalfW;
  const cy = piece.spriteHalfH;
  const minDim = Math.min(pieceW, pieceH);
  const backOuterWidth = isLod
    ? Math.max(0.18, Math.min(1.6, 1.35 / renderScale))
    : Math.max(0.95 / Math.max(0.28, renderScale), Math.min(1.6, Math.max(0.4, minDim * 0.05)));

  ctx.save();
  ctx.beginPath();
  ctx.rect(slot.sx, slot.sy, physW, physH);
  ctx.clip();
  ctx.translate(slot.sx, slot.sy);
  ctx.scale(renderScale, renderScale);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.clip(piece.path);
  ctx.fillStyle = pattern || '#334155';
  ctx.fillRect(-cx, -cy, logicalW, logicalH);

  // Render pre-mirrored BACK mark when piece appears at least ~24px on screen
  const screenDim = isLod ? minDim * renderScale : minDim;
  if (screenDim >= 24) {
    const fontPx = Math.max(10, Math.round(minDim * 0.28 * renderScale));
    ctx.save();
    ctx.scale(-1 / renderScale, 1 / renderScale);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.34)';
    ctx.font = `bold ${fontPx}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BACK', 0, 0);
    ctx.restore();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineWidth = backOuterWidth;
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.55)';
  ctx.stroke(piece.path);
  ctx.restore();

  ctx.restore();
}

/**
 * Renders high-resolution front sprite into a shared CPU PieceSpriteAtlas using 9-arg drawImage.
 * @param {object} piece piece to render (sprite fields are written onto it)
 * @param {object} options
 * @param {HTMLCanvasElement} options.sourceCanvas source image canvas
 * @param {number} options.boardW board width
 * @param {number} options.boardH board height
 * @param {number} options.pieceW nominal piece width
 * @param {number} options.pieceH nominal piece height
 * @param {number} options.spritePad sprite padding in board units
 * @param {PieceSpriteAtlas|null} [options.atlas=null] atlas to allocate into (created if omitted)
 * @param {number} [options.totalPieces=24] total piece count
 */
export function renderPieceSprites(
  piece,
  { sourceCanvas, boardW, boardH, pieceW, pieceH, spritePad, atlas = null, totalPieces = 24 },
) {
  const targetAtlas = atlas || new PieceSpriteAtlas();
  const { logicalW, logicalH, spriteScale, physW, physH } = computeSpriteMetrics({
    sourceCanvas,
    boardW,
    pieceW,
    pieceH,
    spritePad,
    totalPieces,
  });

  piece.spriteLogicalW = logicalW;
  piece.spriteLogicalH = logicalH;
  piece.spriteScale = spriteScale;

  const fSlot = targetAtlas.allocate(physW, physH);
  drawFrontPieceToSlot(fSlot.ctx, fSlot, {
    piece,
    sourceCanvas,
    boardW,
    boardH,
    pieceW,
    pieceH,
    logicalW,
    logicalH,
    renderScale: spriteScale,
    isLod: false,
  });

  piece.frontSprite = {
    canvas: fSlot.canvas,
    sx: fSlot.sx,
    sy: fSlot.sy,
    sw: physW,
    sh: physH,
  };
  piece.backSprite = null;
}

/**
 * On-demand CPU rasterizer for a flipped piece's back sprite.
 * @param {object} piece piece to render (backSprite is written onto it)
 * @param {object} options
 * @param {number} options.pieceW nominal piece width
 * @param {number} options.pieceH nominal piece height
 * @param {number} options.spritePad sprite padding in board units
 * @param {HTMLCanvasElement|null} options.backPatternCanvas back pattern source canvas
 * @param {PieceSpriteAtlas} options.atlas atlas to allocate into
 */
export function renderPieceBackSprite(
  piece,
  { pieceW, pieceH, spritePad, backPatternCanvas, atlas },
) {
  if (!piece || !atlas) return null;
  if (piece.backSprite) return piece.backSprite;

  const logicalW = piece.spriteLogicalW || Math.ceil(pieceW + spritePad * 2);
  const logicalH = piece.spriteLogicalH || Math.ceil(pieceH + spritePad * 2);
  const spriteScale = piece.spriteScale || 2;
  const physW = Math.max(8, Math.ceil(logicalW * spriteScale));
  const physH = Math.max(8, Math.ceil(logicalH * spriteScale));

  const bSlot = atlas.allocate(physW, physH);
  const pat = atlas.getBackPattern(bSlot.ctx, backPatternCanvas);
  drawBackPieceToSlot(bSlot.ctx, bSlot, {
    piece,
    pieceW,
    pieceH,
    logicalW,
    logicalH,
    renderScale: spriteScale,
    pattern: pat,
    isLod: false,
  });

  piece.backSprite = {
    canvas: bSlot.canvas,
    sx: bSlot.sx,
    sy: bSlot.sy,
    sw: physW,
    sh: physH,
  };
  return piece.backSprite;
}
