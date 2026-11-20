import { drawBackPieceToSlot, drawFrontPieceToSlot } from './pieceSpriteBuilder.js';

const LOD_ATLAS_SIZE = 2048;
const MAX_LOD_CANVASES = 2;
const LOD_BUCKETS = [0.75, 1.25, 2.0, 3.0, 4.5];
const MAX_LOD_CELL_PX = 256;
const LOD_SLOT_PAD = 4;
const DEFAULT_FRAME_BUDGET = 24;

/**
 * Fixed up-to-2-canvas (2048x2048 x 2 <= 32 MB, CPU willReadFrequently) LRU pool
 * for zoom-dependent high-res LOD sprites with mathematical zero-thrashing guarantee.
 */
export class PieceLodCache {
  constructor() {
    this.pages = [];
    this.backPatternCache = new WeakMap();

    this.signature = null;
    this.slotStep = 128;
    this.colsPerSide = 16;
    this.slotsPerPage = 256;
    this.totalSlots = 512;
    this.nextFreshSlot = 0;
    this.lru = new Map();

    this.frameRasterCount = 0;
    this.budgetExhausted = false;
    this.evictedInFrame = false;
  }

  get canvasCount() {
    return this.pages.length;
  }

  getStats() {
    return {
      canvasCount: this.pages.length,
      cachedEntries: this.lru.size,
      totalSlots: this.totalSlots,
      slotStep: this.slotStep,
      signature: this.signature,
      evictedInFrame: this.evictedInFrame,
      budgetExhausted: this.budgetExhausted,
    };
  }

  _acquirePage(pageIndex) {
    if (pageIndex < this.pages.length) {
      return this.pages[pageIndex];
    }
    if (this.pages.length >= MAX_LOD_CANVASES) {
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = LOD_ATLAS_SIZE;
    canvas.height = LOD_ATLAS_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const page = { canvas, ctx };
    this.pages.push(page);
    return page;
  }

  _getBackPattern(ctx, backPatternCanvas) {
    if (!backPatternCanvas || !ctx) return null;
    let pat = this.backPatternCache.get(ctx);
    if (!pat) {
      pat = ctx.createPattern(backPatternCanvas, 'repeat');
      if (pat) this.backPatternCache.set(ctx, pat);
    }
    return pat;
  }

  clear() {
    this.lru.clear();
    this.nextFreshSlot = 0;
    this.frameRasterCount = 0;
    this.budgetExhausted = false;
    this.evictedInFrame = false;
    this.signature = null;
    for (const page of this.pages) {
      page.ctx.setTransform(1, 0, 0, 1, 0, 0);
      page.ctx.clearRect(0, 0, LOD_ATLAS_SIZE, LOD_ATLAS_SIZE);
    }
  }

  resolveLodConfig(desiredScale, engine, visibleCount = 64) {
    if (!engine || !engine.sourceCanvas || engine.pieces.length === 0) return null;
    const p0 = engine.pieces[0];
    const baseScale = p0.spriteScale || 2;
    if (desiredScale <= baseScale * 1.15) return null;

    const logicalW = p0.spriteLogicalW || Math.ceil(engine.pieceW + engine.spritePad * 2);
    const logicalH = p0.spriteLogicalH || Math.ceil(engine.pieceH + engine.spritePad * 2);
    const logicalMax = Math.max(1, logicalW, logicalH);

    let bucket = LOD_BUCKETS[LOD_BUCKETS.length - 1];
    for (const b of LOD_BUCKETS) {
      if (b >= desiredScale) {
        bucket = b;
        break;
      }
    }

    // Guarantee total slots across MAX_LOD_CANVASES >= visibleCount (zero LRU thrashing)
    const count = Math.max(1, visibleCount);
    const minColsPerSide = Math.max(1, Math.ceil(Math.sqrt(Math.ceil(count / MAX_LOD_CANVASES))));
    const maxSlotStepByCount = Math.floor(LOD_ATLAS_SIZE / minColsPerSide);
    const maxScaleByCell = (MAX_LOD_CELL_PX - LOD_SLOT_PAD) / logicalMax;
    const desiredClamped = Math.min(bucket, maxScaleByCell);

    const slotStep = Math.min(
      MAX_LOD_CELL_PX,
      maxSlotStepByCount,
      Math.max(16, Math.ceil(logicalMax * desiredClamped) + LOD_SLOT_PAD),
    );
    const lodScale = Math.min(desiredClamped, (slotStep - LOD_SLOT_PAD) / logicalMax);
    if (lodScale <= baseScale * 1.15) return null;

    return { bucket, lodScale, slotStep };
  }

  beginFrame(puzzleGeneration, bucket, slotStep) {
    this.frameRasterCount = 0;
    this.budgetExhausted = false;
    this.evictedInFrame = false;
    const sig = `${puzzleGeneration}:${bucket}:${slotStep}`;
    if (this.signature !== sig) {
      this.clear();
      this.signature = sig;
      this.slotStep = slotStep;
      this.colsPerSide = Math.max(1, Math.floor(LOD_ATLAS_SIZE / slotStep));
      this.slotsPerPage = this.colsPerSide * this.colsPerSide;
      this.totalSlots = this.slotsPerPage * MAX_LOD_CANVASES;
    }
  }

  getOrRender(piece, { isFlipped, lodScale, engine, maxBudget = DEFAULT_FRAME_BUDGET }) {
    const key = `${piece.id}:${isFlipped ? 1 : 0}`;
    const cached = this.lru.get(key);
    if (cached) {
      this.lru.delete(key);
      this.lru.set(key, cached);
      return cached;
    }

    if (this.frameRasterCount >= maxBudget) {
      this.budgetExhausted = true;
      return null;
    }

    let pageIdx;
    let sx;
    let sy;
    if (this.nextFreshSlot < this.totalSlots) {
      const idx = this.nextFreshSlot++;
      pageIdx = Math.floor(idx / this.slotsPerPage);
      const localIdx = idx % this.slotsPerPage;
      sx = (localIdx % this.colsPerSide) * this.slotStep;
      sy = Math.floor(localIdx / this.colsPerSide) * this.slotStep;
    } else {
      const oldest = this.lru.entries().next().value;
      if (!oldest) return null;
      this.lru.delete(oldest[0]);
      this.evictedInFrame = true;
      pageIdx = oldest[1].pageIdx;
      sx = oldest[1].sx;
      sy = oldest[1].sy;
    }

    const page = this._acquirePage(pageIdx);
    if (!page) return null;
    page.ctx.clearRect(sx, sy, this.slotStep, this.slotStep);

    const logicalW = piece.spriteLogicalW || Math.ceil(engine.pieceW + engine.spritePad * 2);
    const logicalH = piece.spriteLogicalH || Math.ceil(engine.pieceH + engine.spritePad * 2);
    const physW = Math.min(this.slotStep - 2, Math.ceil(logicalW * lodScale));
    const physH = Math.min(this.slotStep - 2, Math.ceil(logicalH * lodScale));
    const slot = { pageIdx, canvas: page.canvas, sx, sy, sw: physW, sh: physH };

    if (isFlipped) {
      drawBackPieceToSlot(page.ctx, slot, {
        piece,
        pieceW: engine.pieceW,
        pieceH: engine.pieceH,
        logicalW,
        logicalH,
        renderScale: lodScale,
        pattern: this._getBackPattern(page.ctx, engine.backPatternCanvas),
        isLod: true,
      });
    } else {
      drawFrontPieceToSlot(page.ctx, slot, {
        piece,
        sourceCanvas: engine.sourceCanvas,
        boardW: engine.boardW,
        boardH: engine.boardH,
        pieceW: engine.pieceW,
        pieceH: engine.pieceH,
        logicalW,
        logicalH,
        renderScale: lodScale,
        isLod: true,
      });
    }

    this.frameRasterCount += 1;
    this.lru.set(key, slot);
    return slot;
  }
}
