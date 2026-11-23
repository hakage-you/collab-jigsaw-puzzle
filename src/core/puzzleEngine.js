import { PUZZLE_CONFIG } from '../config/constants.js';
import { mulberry32 } from './prng.js';
import { clampGridDimensions, generateCutLayout, normalizeCutComplexity } from './jigsawPath.js';
import { isPointInOutline } from './pieceHitTest.js';
import { buildPieceSet } from './pieceFactory.js';
import { buildSavedMap, computeCoordScale, restoreStats } from './saveRestore.js';
import {
  sortEdgesPieces,
  sortByColorPieces,
  sortByQuadrantPieces,
  alignAllUprightPieces,
} from './pieceSorter.js';
import {
  dropLockedPiecesOp,
  prankLoosePiecesOp,
  turnStates,
  addFakePiecesOp,
  syncFakePiecesFromSpecsOp,
} from './pieceOjamaOps.js';
import { applyPiecePatchesOp, exportSaveDataOp, resolveDropOp } from './puzzleSnapshot.js';

/** Clears the previous source canvas once it has been replaced by a new one. */
function releasePreviousSource(prevSrc, sourceCanvas) {
  if (prevSrc && prevSrc !== sourceCanvas) {
    prevSrc.width = 0;
    prevSrc.height = 0;
  }
}

/** Used when no image analyzer was given: core cannot read pixels itself. */
const MISSING_ANALYZER = Object.freeze({
  signature() {
    throw new Error('PuzzleEngine needs an imageAnalyzer (services/imagePixels.js)');
  },
  pieceColors() {
    throw new Error('PuzzleEngine needs an imageAnalyzer (services/imagePixels.js)');
  },
});

export class PuzzleEngine {
  /**
   * @param {object} [deps]
   * @param {{ signature(image): string, pieceColors(image, cols, rows): object[] }} [deps.imageAnalyzer]
   *   reads the source image's pixels (services/imagePixels.js imageAnalyzer)
   */
  constructor({ imageAnalyzer = MISSING_ANALYZER } = {}) {
    this.imageAnalyzer = imageAnalyzer;
    this.sourceCanvas = null;
    this.isSampleImage = true;
    this.sampleImageId = PUZZLE_CONFIG.DEFAULT_SAMPLE_IMAGE_ID;
    this.imageHash = '';
    this.cols = PUZZLE_CONFIG.DEFAULT_COLS;
    this.rows = PUZZLE_CONFIG.DEFAULT_ROWS;
    this.seed = PUZZLE_CONFIG.DEFAULT_SEED;
    this.cutComplexity = 'standard';

    this.boardW = 600;
    this.boardH = 400;
    this.pieceW = 100;
    this.pieceH = 100;
    this.tabSize = 24;
    this.spritePad = 32;

    this.pieces = [];
    this.fakePieces = [];
    this.nextFakePieceSeq = 1;
    this.nextGroupId = 1;
    this.maxZ = 1;
    this.zoneLabels = [];

    this.stats = {
      elapsedMs: 0,
      placedCount: 0,
      ojamaTotal: 0,
      ojamaBreakdown: {
        drop: 0,
        visual: 0,
        superchat: 0,
        prank: 0,
        fake: 0,
        heavy: 0,
        runaway: 0,
      },
    };

    this.puzzleGeneration = 0;
    this.zVersion = 0;
    this.lockedVersion = 0;
    this._sortedLooseCache = { version: -1, list: [] };
    this.completedFired = false;
  }

  bumpZVersion() {
    this.zVersion += 1;
  }

  bumpLockedVersion() {
    this.lockedVersion += 1;
  }

  getSortedLoosePieces() {
    if (this._sortedLooseCache.version !== this.zVersion) {
      const loose = [];
      for (const p of this.pieces) {
        if (!p.isLocked) loose.push(p);
      }
      for (const fp of this.fakePieces) {
        loose.push(fp);
      }
      loose.sort((a, b) => a.zOrder - b.zOrder);
      this._sortedLooseCache = { version: this.zVersion, list: loose };
    }
    return this._sortedLooseCache.list;
  }

  /**
   * Initializes a brand-new puzzle from a source image canvas and settings.
   */
  initPuzzle({
    sourceCanvas,
    isSampleImage,
    sampleImageId = PUZZLE_CONFIG.DEFAULT_SAMPLE_IMAGE_ID,
    cols,
    rows,
    seed,
    cutComplexity = 'standard',
    allowRotation,
    allowFlip,
  }) {
    const prevSrc = this.sourceCanvas;
    this.sourceCanvas = sourceCanvas;
    this.isSampleImage = Boolean(isSampleImage);
    this.sampleImageId = this.isSampleImage
      ? sampleImageId || PUZZLE_CONFIG.DEFAULT_SAMPLE_IMAGE_ID
      : null;
    this.imageHash = this.imageAnalyzer.signature(sourceCanvas);
    const clamped = clampGridDimensions(cols, rows);
    this.cols = clamped.cols;
    this.rows = clamped.rows;
    this.seed = Number(seed) || 1;
    this.cutComplexity = normalizeCutComplexity(cutComplexity);

    this._computeGeometry();
    this.stats = {
      elapsedMs: 0,
      placedCount: 0,
      ojamaTotal: 0,
      ojamaBreakdown: { drop: 0, visual: 0, superchat: 0, prank: 0, fake: 0, heavy: 0, runaway: 0 },
    };

    this._buildPieces({ allowRotation, allowFlip, savedMap: null });
    this.completedFired = false;
    releasePreviousSource(prevSrc, sourceCanvas);
  }

  /**
   * Restores a puzzle state from a saved JSON payload and a source image canvas.
   */
  restoreFromSave(saveData, sourceCanvas, isSampleImage) {
    const prevSrc = this.sourceCanvas;
    this._applySaveHeader(saveData, sourceCanvas, isSampleImage);

    const savedMap = buildSavedMap(saveData.pieces);
    const { coordScaleX, coordScaleY } = computeCoordScale(this, saveData.puzzle, sourceCanvas);
    this._buildPieces({
      allowRotation: false,
      allowFlip: false,
      savedMap,
      coordScaleX,
      coordScaleY,
    });

    this.stats = restoreStats(saveData.stats);
    this.completedFired = this.isCompleted();
    releasePreviousSource(prevSrc, sourceCanvas);
  }

  /** Applies the source image, grid, seed and geometry recorded in a save file. */
  _applySaveHeader(saveData, sourceCanvas, isSampleImage) {
    const pInfo = saveData.puzzle;
    this.sourceCanvas = sourceCanvas;
    this.isSampleImage = Boolean(isSampleImage);
    this.sampleImageId = this.isSampleImage
      ? pInfo.sampleImageId || PUZZLE_CONFIG.DEFAULT_SAMPLE_IMAGE_ID
      : null;
    this.imageHash = this.imageAnalyzer.signature(sourceCanvas);
    const clamped = clampGridDimensions(pInfo.cols, pInfo.rows);
    this.cols = clamped.cols;
    this.rows = clamped.rows;
    this.seed = pInfo.seed;
    this.cutComplexity = normalizeCutComplexity(
      pInfo.cutComplexity || saveData.settings?.cutComplexity,
    );
    this._computeGeometry();
  }

  _buildPieces({ allowRotation, allowFlip, savedMap, coordScaleX = 1, coordScaleY = 1 }) {
    this.fakePieces = [];
    this._sortedLooseCache = { version: -1, list: [] };

    const layout = generateCutLayout({
      cols: this.cols,
      rows: this.rows,
      boardW: this.boardW,
      boardH: this.boardH,
      seed: this.seed,
      cutComplexity: this.cutComplexity,
    });
    const colorInfos = this.imageAnalyzer.pieceColors(this.sourceCanvas, this.cols, this.rows);
    const rng = mulberry32(this.seed ^ 0x9e3779b9);

    this.pieces = [];
    this.zoneLabels = [];
    this.nextGroupId = 1;
    this.maxZ = 1;

    const { highestGroup, highestZ } = buildPieceSet(this, {
      layout,
      colorInfos,
      rng,
      savedMap,
      allowRotation,
      allowFlip,
      coordScaleX,
      coordScaleY,
    });

    if (savedMap) {
      this.nextGroupId = highestGroup + 1;
      this.maxZ = highestZ + 1;
    }
    this.puzzleGeneration += 1;
    this.bumpLockedVersion();
    this.bumpZVersion();
  }

  _computeGeometry() {
    const imgW = this.sourceCanvas.width;
    const imgH = this.sourceCanvas.height;
    const aspect = Math.max(0.2, Math.min(5, imgW / Math.max(1, imgH)));
    const target = PUZZLE_CONFIG.TARGET_PIECE_SIZE || 76;
    const targetArea = this.cols * this.rows * target * target;

    this.boardW = Math.max(180, Math.round(Math.sqrt(targetArea * aspect)));
    this.boardH = Math.max(120, Math.round(this.boardW / aspect));
    this.pieceW = this.boardW / this.cols;
    this.pieceH = this.boardH / this.rows;
    this.tabSize = Math.min(this.pieceW, this.pieceH) * PUZZLE_CONFIG.TAB_RATIO;
    const padExtra = Math.min(
      PUZZLE_CONFIG.SPRITE_PAD_EXTRA,
      Math.max(2, Math.ceil(Math.min(this.pieceW, this.pieceH) * 0.12)),
    );
    this.spritePad =
      Math.ceil(
        this.tabSize * PUZZLE_CONFIG.SPRITE_PAD_TAB_MULT +
          Math.max(this.pieceW, this.pieceH) * PUZZLE_CONFIG.SPRITE_PAD_WARP_MULT,
      ) + padExtra;
  }

  getPieceById(pieceId) {
    if (pieceId < 0) return this.fakePieces.find((p) => p.id === pieceId) || null;
    return this.pieces.find((p) => p.id === pieceId) || null;
  }

  getGroupPieces(groupId) {
    if (groupId < 0) return this.fakePieces.filter((p) => p.groupId === groupId);
    return this.pieces.filter((p) => p.groupId === groupId);
  }

  getGroupCounts() {
    const counts = new Map();
    for (const p of this.pieces) {
      counts.set(p.groupId, (counts.get(p.groupId) || 0) + 1);
    }
    return counts;
  }

  getLockedCount() {
    let count = 0;
    for (const p of this.pieces) {
      if (p.isLocked) count++;
    }
    return count;
  }

  isCompleted() {
    return this.pieces.length > 0 && this.getLockedCount() === this.pieces.length;
  }

  hitTest(wx, wy) {
    const sorted = this.getSortedLoosePieces();
    const hitR = Math.max(this.pieceW / 2, this.pieceH / 2) + this.spritePad;

    for (let i = sorted.length - 1; i >= 0; i--) {
      const piece = sorted[i];
      const dx = wx - piece.x;
      if (dx > hitR || dx < -hitR) continue;
      const dy = wy - piece.y;
      if (dy > hitR || dy < -hitR) continue;

      let lx;
      let ly;
      switch (piece.rotation) {
        case 0:
          lx = dx;
          ly = dy;
          break;
        case 1:
          lx = dy;
          ly = -dx;
          break;
        case 2:
          lx = -dx;
          ly = -dy;
          break;
        default:
          lx = -dy;
          ly = dx;
          break;
      }
      if (piece.isFlipped) lx = -lx;

      if (isPointInOutline(piece.outline, lx, ly)) {
        return piece;
      }
    }
    return null;
  }

  bringGroupToFront(groupId) {
    const z = this.maxZ++;
    let changed = false;
    const list = groupId < 0 ? this.fakePieces : this.pieces;
    for (const p of list) {
      if (p.groupId === groupId && !p.isLocked) {
        p.zOrder = z;
        changed = true;
      }
    }
    if (changed) this.bumpZVersion();
  }

  moveGroup(groupId, dx, dy) {
    const list = groupId < 0 ? this.fakePieces : this.pieces;
    for (const p of list) {
      if (p.groupId === groupId && !p.isLocked) {
        p.x += dx;
        p.y += dy;
      }
    }
  }

  rotateGroup(pivotPiece, allowRotationSetting) {
    if (!pivotPiece || pivotPiece.isLocked) return false;
    const group = this.getGroupPieces(pivotPiece.groupId);
    const hasRotatedPiece = group.some((p) => p.rotation !== 0);
    if (!allowRotationSetting && !hasRotatedPiece) {
      return false;
    }

    const px = pivotPiece.x;
    const py = pivotPiece.y;
    for (const p of group) {
      const dx = p.x - px;
      const dy = p.y - py;
      p.x = px - dy;
      p.y = py + dx;
      p.rotation = (p.rotation + 1) % 4;
    }
    this.bringGroupToFront(pivotPiece.groupId);
    return true;
  }

  flipPiece(piece, allowFlipSetting) {
    if (!piece || piece.isLocked) return false;
    const group = this.getGroupPieces(piece.groupId);
    if (group.length > 1) return false;
    if (!allowFlipSetting && !piece.isFlipped) return false;

    piece.isFlipped = !piece.isFlipped;
    this.bringGroupToFront(piece.groupId);
    return true;
  }

  resolveDrop(groupId) {
    return resolveDropOp(this, groupId);
  }

  sortEdges(excludedGroupIds = null) {
    return sortEdgesPieces(this, excludedGroupIds);
  }

  sortByColor(excludedGroupIds = null) {
    return sortByColorPieces(this, excludedGroupIds);
  }

  sortByQuadrant(excludedGroupIds = null) {
    return sortByQuadrantPieces(this, excludedGroupIds);
  }

  alignAllUpright(excludedGroupIds = null) {
    return alignAllUprightPieces(this, excludedGroupIds);
  }

  /** Returns the pieces that were knocked off the board (empty when none were locked). */
  dropLockedPieces(count, allowRotation = false) {
    return dropLockedPiecesOp(this, count, allowRotation);
  }

  addFakePieces(count, durationSec, allowRotation = true, allowFlip = true, maxCount = undefined) {
    return addFakePiecesOp(this, {
      count,
      durationSec,
      allowRotation,
      allowFlip,
      maxCount,
    });
  }

  pruneExpiredFakePieces(now = Date.now()) {
    if (this.fakePieces.length === 0) return false;
    const before = this.fakePieces.length;
    this.fakePieces = this.fakePieces.filter((fp) => !fp.expiresAt || fp.expiresAt > now);
    if (this.fakePieces.length !== before) {
      this.bumpZVersion();
      return true;
    }
    return false;
  }

  clearFakePieces() {
    if (this.fakePieces.length === 0) return false;
    this.fakePieces = [];
    this.bumpZVersion();
    return true;
  }

  serializeFakePieces() {
    return this.fakePieces.map((fp) => ({
      fakeId: fp.fakeId ?? fp.id,
      sourcePieceId: fp.sourcePieceId,
      targetX: Math.round(fp.targetX * 10) / 10,
      targetY: Math.round(fp.targetY * 10) / 10,
      x: Math.round(fp.x * 10) / 10,
      y: Math.round(fp.y * 10) / 10,
      rotation: fp.rotation,
      isFlipped: fp.isFlipped,
      expiresAt: fp.expiresAt,
      zOrder: fp.zOrder,
    }));
  }

  syncFakePiecesFromSpecs(specs) {
    syncFakePiecesFromSpecsOp(this, specs);
  }

  /** Returns every piece that was rotated, flipped or moved (empty when nothing could be). */
  /** How every piece is turned and flipped now (see turnStates), to tell a later change apart. */
  turnStates() {
    return turnStates(this.pieces);
  }

  prankLoosePieces(count, excludedGroupIds = null) {
    return prankLoosePiecesOp(this, count, excludedGroupIds);
  }

  recordVisualOjama() {
    this.stats.ojamaTotal += 1;
    this.stats.ojamaBreakdown.visual += 1;
  }

  recordSuperchatOjama() {
    this.stats.ojamaTotal += 1;
    this.stats.ojamaBreakdown.superchat += 1;
  }

  /** Counts a timed ojama ('heavy' or 'runaway') in the stats. */
  recordTimedOjama(kind) {
    this.stats.ojamaTotal += 1;
    this.stats.ojamaBreakdown[kind] = (this.stats.ojamaBreakdown[kind] || 0) + 1;
  }

  applyPiecePatches(patches, options) {
    applyPiecePatchesOp(this, patches, options);
  }

  exportSaveData(settings, contributions = null) {
    return exportSaveDataOp(this, settings, contributions);
  }
}
