import { PUZZLE_CONFIG } from '../config/constants.js';

/**
 * Shared 2048x2048 CPU-rasterized offscreen canvas texture atlas (`willReadFrequently: true`)
 * with page pooling across puzzle rebuilds to eliminate Skia GPU path/surface accumulation.
 */
export class PieceSpriteAtlas {
  constructor(
    atlasSize = PUZZLE_CONFIG.SPRITE_ATLAS_SIZE,
    pad = PUZZLE_CONFIG.SPRITE_ATLAS_PAD,
    reusePages = null
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
      (p) => p?.canvas && p.canvas.width === size && p.canvas.height === size
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

  static releaseCanvases(canvases) {
    if (!Array.isArray(canvases)) return;
    for (const c of canvases) {
      if (c) {
        c.width = 0;
        c.height = 0;
      }
    }
  }
}

function computeSpriteMetrics(sourceCanvas, boardW, pieceW, pieceH, spritePad, totalPieces) {
  const logicalW = Math.ceil(pieceW + spritePad * 2);
  const logicalH = Math.ceil(pieceH + spritePad * 2);
  const rawScale = (sourceCanvas ? sourceCanvas.width / Math.max(1, boardW) : 1.5) * 1.25;
  const spriteScale =
    totalPieces >= 1500
      ? Math.min(2, Math.max(1.5, rawScale))
      : totalPieces >= 800
      ? 2
      : Math.min(3, Math.max(2, Math.ceil(rawScale)));
  return {
    logicalW,
    logicalH,
    spriteScale,
    physW: Math.ceil(logicalW * spriteScale),
    physH: Math.ceil(logicalH * spriteScale),
  };
}

/**
 * Renders high-resolution front sprite into a shared CPU PieceSpriteAtlas using 9-arg drawImage.
 */
export function renderPieceSprites(
  piece,
  sourceCanvas,
  boardW,
  boardH,
  pieceW,
  pieceH,
  spritePad,
  atlas = null,
  totalPieces = 24
) {
  const targetAtlas = atlas || new PieceSpriteAtlas();
  const { logicalW, logicalH, spriteScale, physW, physH } = computeSpriteMetrics(
    sourceCanvas,
    boardW,
    pieceW,
    pieceH,
    spritePad,
    totalPieces
  );

  piece.spriteLogicalW = logicalW;
  piece.spriteLogicalH = logicalH;
  piece.spriteScale = spriteScale;

  const cx = piece.spriteHalfW;
  const cy = piece.spriteHalfH;

  const fSlot = targetAtlas.allocate(physW, physH);
  const fCtx = fSlot.ctx;
  fCtx.save();
  fCtx.beginPath();
  fCtx.rect(fSlot.sx, fSlot.sy, physW, physH);
  fCtx.clip();
  fCtx.translate(fSlot.sx, fSlot.sy);
  fCtx.scale(spriteScale, spriteScale);

  const boardLeft = piece.targetX - cx + boardW / 2;
  const boardTop = piece.targetY - cy + boardH / 2;
  const visLeft = Math.max(0, boardLeft);
  const visTop = Math.max(0, boardTop);
  const visRight = Math.min(boardW, boardLeft + logicalW);
  const visBottom = Math.min(boardH, boardTop + logicalH);
  const visW = visRight - visLeft;
  const visH = visBottom - visTop;

  fCtx.save();
  fCtx.translate(cx, cy);
  fCtx.clip(piece.path);
  if (visW > 0 && visH > 0) {
    const srcScaleX = sourceCanvas.width / Math.max(1, boardW);
    const srcScaleY = sourceCanvas.height / Math.max(1, boardH);
    const srcX = Math.max(0, Math.min(sourceCanvas.width - 1, visLeft * srcScaleX));
    const srcY = Math.max(0, Math.min(sourceCanvas.height - 1, visTop * srcScaleY));
    const srcW = Math.min(sourceCanvas.width - srcX, Math.max(0.01, visW * srcScaleX));
    const srcH = Math.min(sourceCanvas.height - srcY, Math.max(0.01, visH * srcScaleY));
    const destX = visLeft - boardW / 2 - piece.targetX;
    const destY = visTop - boardH / 2 - piece.targetY;
    fCtx.drawImage(sourceCanvas, srcX, srcY, srcW, srcH, destX, destY, visW, visH);
  }
  fCtx.lineWidth = 2;
  fCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  fCtx.stroke(piece.path);
  fCtx.restore();

  fCtx.save();
  fCtx.translate(cx, cy);
  fCtx.lineWidth = 1.2;
  fCtx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
  fCtx.stroke(piece.path);
  fCtx.restore();

  fCtx.restore();
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
 */
export function renderPieceBackSprite(
  piece,
  pieceW,
  pieceH,
  spritePad,
  backPatternCanvas,
  atlas
) {
  if (!piece || !atlas) return null;
  if (piece.backSprite) return piece.backSprite;

  const logicalW = piece.spriteLogicalW || Math.ceil(pieceW + spritePad * 2);
  const logicalH = piece.spriteLogicalH || Math.ceil(pieceH + spritePad * 2);
  const spriteScale = piece.spriteScale || 2;
  const physW = Math.ceil(logicalW * spriteScale);
  const physH = Math.ceil(logicalH * spriteScale);
  const cx = piece.spriteHalfW;
  const cy = piece.spriteHalfH;

  const bSlot = atlas.allocate(physW, physH);
  const bCtx = bSlot.ctx;
  bCtx.save();
  bCtx.beginPath();
  bCtx.rect(bSlot.sx, bSlot.sy, physW, physH);
  bCtx.clip();
  bCtx.translate(bSlot.sx, bSlot.sy);
  bCtx.scale(spriteScale, spriteScale);

  bCtx.save();
  bCtx.translate(cx, cy);
  bCtx.clip(piece.path);
  const pat = atlas.getBackPattern(bCtx, backPatternCanvas);
  bCtx.fillStyle = pat || '#334155';
  bCtx.fillRect(-cx, -cy, logicalW, logicalH);

  if (Math.min(pieceW, pieceH) >= 24) {
    bCtx.save();
    bCtx.scale(-1, 1);
    bCtx.fillStyle = 'rgba(148, 163, 184, 0.28)';
    bCtx.font = `bold ${Math.max(12, Math.round(Math.min(pieceW, pieceH) * 0.28))}px sans-serif`;
    bCtx.textAlign = 'center';
    bCtx.textBaseline = 'middle';
    bCtx.fillText('BACK', 0, 0);
    bCtx.restore();
  }
  bCtx.restore();

  bCtx.save();
  bCtx.translate(cx, cy);
  bCtx.lineWidth = 1.6;
  bCtx.strokeStyle = 'rgba(203, 213, 225, 0.55)';
  bCtx.stroke(piece.path);
  bCtx.restore();

  bCtx.restore();
  piece.backSprite = {
    canvas: bSlot.canvas,
    sx: bSlot.sx,
    sy: bSlot.sy,
    sw: physW,
    sh: physH,
  };
  return piece.backSprite;
}
