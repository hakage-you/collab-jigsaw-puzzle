const MAX_LOCKED_CACHE_DIM = 2048;

/**
 * Off-screen bitmap of all locked pieces, rebuilt only when the puzzle generation or locked version changes.
 */
export class LockedBoardCache {
  constructor() {
    this.key = null;
    this.canvas = document.createElement('canvas');
    this.hasLocked = false;
    this.logicalW = 0;
    this.logicalH = 0;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  /** Draws the cached locked pieces onto ctx, faded when a highlight filter is active. */
  draw(ctx, engine, sprites, faded) {
    this.ensure(engine, sprites);
    if (!this.hasLocked) return;
    if (faded) {
      ctx.save();
      ctx.globalAlpha = 0.75;
    }
    ctx.drawImage(this.canvas, this.offsetX, this.offsetY, this.logicalW, this.logicalH);
    if (faded) {
      ctx.restore();
    }
  }

  ensure(engine, sprites) {
    const key = `${engine.puzzleGeneration}:${engine.lockedVersion}`;
    if (this.key === key) return;
    this.key = key;

    const lockedPieces = engine.pieces.filter((p) => p.isLocked);
    if (lockedPieces.length === 0) {
      this.hasLocked = false;
      this.canvas.width = 0;
      this.canvas.height = 0;
      return;
    }
    this._rebuild(engine, sprites, lockedPieces);
  }

  _rebuild(engine, sprites, lockedPieces) {
    const m = sprites.metrics;
    const pad = engine.spritePad + 8;
    const logicalW = Math.ceil(engine.boardW + pad * 2);
    const logicalH = Math.ceil(engine.boardH + pad * 2);
    const baseScale = m.spriteScale;
    const desiredScale = Math.max(0.4, baseScale);
    const maxScaleByDim = MAX_LOCKED_CACHE_DIM / Math.max(1, logicalW, logicalH);
    const scale = Math.min(desiredScale, maxScaleByDim);

    const cCanvas = this.canvas;
    const targetW = Math.min(MAX_LOCKED_CACHE_DIM, Math.max(1, Math.ceil(logicalW * scale)));
    const targetH = Math.min(MAX_LOCKED_CACHE_DIM, Math.max(1, Math.ceil(logicalH * scale)));
    if (cCanvas.width !== targetW || cCanvas.height !== targetH) {
      cCanvas.width = targetW;
      cCanvas.height = targetH;
    }
    const lCtx = cCanvas.getContext('2d', { willReadFrequently: true });
    lCtx.setTransform(1, 0, 0, 1, 0, 0);
    lCtx.clearRect(0, 0, targetW, targetH);
    lCtx.imageSmoothingEnabled = true;
    lCtx.imageSmoothingQuality = 'high';
    lCtx.setTransform(scale, 0, 0, scale, (logicalW / 2) * scale, (logicalH / 2) * scale);

    for (const p of lockedPieces) {
      const sprite = sprites.frontSprite(p);
      if (!sprite) continue;
      lCtx.drawImage(
        sprite.canvas,
        sprite.sx,
        sprite.sy,
        sprite.sw,
        sprite.sh,
        p.targetX - m.halfW,
        p.targetY - m.halfH,
        m.logicalW,
        m.logicalH,
      );
    }

    this.hasLocked = true;
    this.logicalW = logicalW;
    this.logicalH = logicalH;
    this.offsetX = -logicalW / 2;
    this.offsetY = -logicalH / 2;
  }
}
