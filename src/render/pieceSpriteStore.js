import { PUZZLE_CONFIG } from '../config/constants.js';
import { MAX_FAKE_PIECES } from '../core/pieceOjamaOps.js';
import { PieceLodCache } from './pieceLodCache.js';
import {
  PieceSpriteAtlas,
  computeSpriteMetrics,
  createBacksidePatternCanvas,
  drawBackPieceToSlot,
  drawFrontPieceToSlot,
  outlineToPath2D,
} from './pieceSpriteBuilder.js';

// Fake pieces get their own small atlas: 4 x 4 slots of 256 px (4 MB fixed).
const FAKE_ATLAS_SIZE = 1024;
const FAKE_SLOT_COLS = 4;
const FAKE_SLOT_STEP = FAKE_ATLAS_SIZE / FAKE_SLOT_COLS;

function createAtlasCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/**
 * Everything drawn for pieces: sprite atlases, the Path2D of each outline, the back pattern,
 * the zoom (LOD) cache and fake-piece sprites. The engine only holds piece state; sprites are
 * looked up here by piece id and rebuilt when the engine's puzzleGeneration changes.
 *
 * Sprite: { canvas, sx, sy, sw, sh } (a region of an atlas). Every sprite is drawn at the
 * puzzle-wide `metrics` size ({ logicalW, logicalH, halfW, halfH, spriteScale }).
 */
export class PieceSpriteStore {
  constructor() {
    this.engine = null;
    this.generation = null;
    this.metrics = null;
    this.atlas = null;
    this.atlasPages = [];
    this.front = new Map();
    this.back = new Map();
    this.paths = new WeakMap();
    this.backPatternCanvas = createBacksidePatternCanvas();
    this.lodCache = new PieceLodCache();
    this.fakeAtlas = null;
    this.fakeSprites = new Map();
  }

  /** Rebuilds the sprites when the engine built a new puzzle. Call before drawing a frame. */
  sync(engine) {
    this.engine = engine;
    if (engine.puzzleGeneration === this.generation) return;
    this.generation = engine.puzzleGeneration;
    this.front.clear();
    this.back.clear();
    this.fakeSprites.clear();
    this.lodCache.clear();
    if (engine.pieces.length === 0 || !engine.sourceCanvas) {
      this.metrics = null;
      return;
    }
    this._buildAtlas(engine);
  }

  /** Front sprites for every piece (and backs of pieces that start flipped), in build order. */
  _buildAtlas(engine) {
    this.metrics = this._metricsFor(engine);
    const atlas = new PieceSpriteAtlas(
      PUZZLE_CONFIG.SPRITE_ATLAS_SIZE,
      PUZZLE_CONFIG.SPRITE_ATLAS_PAD,
      this.atlasPages,
    );
    this.atlas = atlas;
    for (const piece of engine.pieces) {
      this.front.set(piece.id, this._drawFront(atlas, piece, this.metrics.spriteScale));
      if (piece.isFlipped) this.backSprite(piece);
    }
    atlas.releaseUnusedPool();
    this.atlasPages = atlas.pages.map((p) => ({ canvas: p.canvas, ctx: p.ctx }));
  }

  _metricsFor(engine) {
    const m = computeSpriteMetrics({
      sourceCanvas: engine.sourceCanvas,
      boardW: engine.boardW,
      pieceW: engine.pieceW,
      pieceH: engine.pieceH,
      spritePad: engine.spritePad,
      totalPieces: engine.pieces.length,
    });
    return {
      logicalW: m.logicalW,
      logicalH: m.logicalH,
      spriteScale: m.spriteScale,
      physW: m.physW,
      physH: m.physH,
      halfW: engine.pieceW / 2 + engine.spritePad,
      halfH: engine.pieceH / 2 + engine.spritePad,
    };
  }

  _geometry() {
    const e = this.engine;
    const { logicalW, logicalH, halfW, halfH } = this.metrics;
    return {
      sourceCanvas: e.sourceCanvas,
      boardW: e.boardW,
      boardH: e.boardH,
      pieceW: e.pieceW,
      pieceH: e.pieceH,
      logicalW,
      logicalH,
      halfW,
      halfH,
    };
  }

  _drawFront(atlas, piece, renderScale) {
    const { physW, physH } = this.metrics;
    const slot = atlas.allocate(physW, physH);
    drawFrontPieceToSlot(slot.ctx, slot, {
      ...this._geometry(),
      piece,
      path: this.pathOf(piece),
      renderScale,
      isLod: false,
    });
    return { canvas: slot.canvas, sx: slot.sx, sy: slot.sy, sw: physW, sh: physH };
  }

  /** Path2D of a piece's outline, centred on the piece (fakes share their source's outline). */
  pathOf(piece) {
    let path = this.paths.get(piece.outline);
    if (!path) {
      path = outlineToPath2D(piece.outline);
      this.paths.set(piece.outline, path);
    }
    return path;
  }

  frontSprite(piece) {
    if (!this.metrics) return null;
    return piece.isFake ? this._fakeFront(piece) : this.front.get(piece.id) || null;
  }

  /** Back sprite, drawn into the main atlas the first time a piece is shown flipped. */
  backSprite(piece) {
    if (!this.metrics) return null;
    const cached = this.back.get(piece.id);
    if (cached) return cached;
    if (!this.atlas) {
      this.atlas = new PieceSpriteAtlas(
        PUZZLE_CONFIG.SPRITE_ATLAS_SIZE,
        PUZZLE_CONFIG.SPRITE_ATLAS_PAD,
        this.atlasPages,
      );
    }
    const scale = piece.isFake ? this._fakeScale() : this.metrics.spriteScale;
    const { logicalW, logicalH, halfW, halfH } = this.metrics;
    const physW = Math.max(8, Math.ceil(logicalW * scale));
    const physH = Math.max(8, Math.ceil(logicalH * scale));
    const slot = this.atlas.allocate(physW, physH);
    drawBackPieceToSlot(slot.ctx, slot, {
      path: this.pathOf(piece),
      halfW,
      halfH,
      pieceW: this.engine.pieceW,
      pieceH: this.engine.pieceH,
      logicalW,
      logicalH,
      renderScale: scale,
      pattern: this.atlas.getBackPattern(slot.ctx, this.backPatternCanvas),
      isLod: false,
    });
    const sprite = { canvas: slot.canvas, sx: slot.sx, sy: slot.sy, sw: physW, sh: physH };
    this.atlas.pages.forEach((p, i) => {
      this.atlasPages[i] = { canvas: p.canvas, ctx: p.ctx };
    });
    this.back.set(piece.id, sprite);
    return sprite;
  }

  /** Fake pieces are drawn smaller than real ones so 16 of them fit the fake atlas. */
  _fakeScale() {
    const { logicalW, logicalH, spriteScale } = this.metrics;
    return Math.min(spriteScale, (FAKE_SLOT_STEP - 4) / Math.max(1, logicalW, logicalH));
  }

  /** A free fake-atlas slot: one not used by a fake piece that is still on the table. */
  _freeFakeSlot() {
    const live = new Set(this.engine.fakePieces.map((fp) => fp.id));
    const used = new Set();
    for (const [id, entry] of this.fakeSprites) {
      if (live.has(id)) used.add(entry.slotIdx);
      else this.fakeSprites.delete(id);
    }
    for (let i = 0; i < MAX_FAKE_PIECES; i++) if (!used.has(i)) return i;
    return 0;
  }

  _fakeFront(piece) {
    const key = `${piece.sourcePieceId}:${piece.targetX}:${piece.targetY}`;
    const cached = this.fakeSprites.get(piece.id);
    if (cached && cached.key === key) return cached.sprite;
    if (!this.fakeAtlas) this.fakeAtlas = createAtlasCanvas(FAKE_ATLAS_SIZE);
    const slotIdx = cached ? cached.slotIdx : this._freeFakeSlot();
    const { canvas, ctx } = this.fakeAtlas;
    const sx = (slotIdx % FAKE_SLOT_COLS) * FAKE_SLOT_STEP;
    const sy = Math.floor(slotIdx / FAKE_SLOT_COLS) * FAKE_SLOT_STEP;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(sx, sy, FAKE_SLOT_STEP, FAKE_SLOT_STEP);
    const renderScale = this._fakeScale();
    const { logicalW, logicalH } = this.metrics;
    const sw = Math.min(FAKE_SLOT_STEP - 2, Math.max(8, Math.ceil(logicalW * renderScale)));
    const sh = Math.min(FAKE_SLOT_STEP - 2, Math.max(8, Math.ceil(logicalH * renderScale)));
    const slot = { canvas, sx, sy, sw, sh };
    drawFrontPieceToSlot(ctx, slot, {
      ...this._geometry(),
      piece,
      path: this.pathOf(piece),
      renderScale,
      isLod: false,
    });
    this.fakeSprites.set(piece.id, { key, slotIdx, sprite: slot });
    return slot;
  }

  /** Diagnostics: atlas pages and LOD cache use. */
  getStats() {
    return {
      atlasCount: this.atlasPages.length,
      lodCanvasCount: this.lodCache.canvasCount,
      lod: this.lodCache.getStats(),
    };
  }
}
