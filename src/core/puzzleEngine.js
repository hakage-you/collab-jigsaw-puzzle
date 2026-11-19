import { PUZZLE_CONFIG } from '../config/constants.js';
import { mulberry32, computeImageSignature } from './prng.js';
import {
  clampGridDimensions,
  generateCutLayout,
  buildPiecePath,
  createBacksidePatternCanvas,
  normalizeCutComplexity,
} from './jigsawPath.js';
import { analyzePieceColors } from './colorAnalysis.js';
import {
  PieceSpriteAtlas,
  renderPieceBackSprite,
  renderPieceSprites,
} from './pieceSpriteBuilder.js';
import {
  sortEdgesPieces,
  sortByColorPieces,
  sortByQuadrantPieces,
  alignAllUprightPieces,
} from './pieceSorter.js';
import { dropLockedPiecesOp, prankLoosePiecesOp } from './pieceOjamaOps.js';
import { applyPiecePatchesOp, exportSaveDataOp, resolveDropOp } from './puzzleSnapshot.js';

export class PuzzleEngine {
  constructor() {
    this.sourceCanvas = null;
    this.isSampleImage = true;
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
      },
    };

    this.hitCanvas = document.createElement('canvas');
    this.hitCanvas.width = 1;
    this.hitCanvas.height = 1;
    this.hitCtx = this.hitCanvas.getContext('2d');
    this.backPatternCanvas = createBacksidePatternCanvas();
    this.spriteAtlas = null;
    this.spriteAtlasPages = [];
    this.puzzleGeneration = 0;
    this.zVersion = 0;
    this.lockedVersion = 0;
    this._sortedLooseCache = { version: -1, list: [] };
    this.completedFired = false;
  }

  get atlasCount() {
    return this.spriteAtlas ? this.spriteAtlas.canvases.length : 0;
  }

  get spriteAtlases() {
    return this.spriteAtlas ? this.spriteAtlas.canvases : [];
  }

  ensureBackSprite(piece) {
    if (!piece) return null;
    if (piece.backSprite) return piece.backSprite;
    if (!this.spriteAtlas) {
      this.spriteAtlas = new PieceSpriteAtlas(
        PUZZLE_CONFIG.SPRITE_ATLAS_SIZE,
        PUZZLE_CONFIG.SPRITE_ATLAS_PAD,
        this.spriteAtlasPages
      );
    }
    const sprite = renderPieceBackSprite(
      piece,
      this.pieceW,
      this.pieceH,
      this.spritePad,
      this.backPatternCanvas,
      this.spriteAtlas
    );
    this.spriteAtlasPages = this.spriteAtlas.pages.map((p) => ({ canvas: p.canvas, ctx: p.ctx }));
    return sprite;
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
    cols,
    rows,
    seed,
    cutComplexity = 'standard',
    allowRotation,
    allowFlip,
  }) {
    const prevSrc = this.sourceCanvas;
    this.sourceCanvas = sourceCanvas;
    this.isSampleImage = !!isSampleImage;
    this.imageHash = computeImageSignature(sourceCanvas);
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
      ojamaBreakdown: { drop: 0, visual: 0, superchat: 0, prank: 0 },
    };

    this._buildPieces({ allowRotation, allowFlip, savedMap: null });
    this.completedFired = false;
    if (prevSrc && prevSrc !== sourceCanvas) {
      prevSrc.width = 0;
      prevSrc.height = 0;
    }
  }

  /**
   * Restores a puzzle state from a saved JSON payload and a source image canvas.
   */
  restoreFromSave(saveData, sourceCanvas, isSampleImage) {
    const prevSrc = this.sourceCanvas;
    const pInfo = saveData.puzzle;
    this.sourceCanvas = sourceCanvas;
    this.isSampleImage = !!isSampleImage;
    this.imageHash = computeImageSignature(sourceCanvas);
    const clamped = clampGridDimensions(pInfo.cols, pInfo.rows);
    this.cols = clamped.cols;
    this.rows = clamped.rows;
    this.seed = pInfo.seed;
    this.cutComplexity = normalizeCutComplexity(
      pInfo.cutComplexity || saveData.settings?.cutComplexity
    );

    this._computeGeometry();

    const savedMap = new Map();
    for (const sp of saveData.pieces) {
      savedMap.set(sp.id, sp);
    }

    this._buildPieces({ allowRotation: false, allowFlip: false, savedMap });

    const st = saveData.stats || {};
    this.stats = {
      elapsedMs: Number(st.elapsedMs) || 0,
      placedCount: Number(st.placedCount) || 0,
      ojamaTotal: Number(st.ojamaTotal) || 0,
      ojamaBreakdown: {
        drop: Number(st.ojamaBreakdown?.drop) || 0,
        visual: Number(st.ojamaBreakdown?.visual) || 0,
        superchat: Number(st.ojamaBreakdown?.superchat) || 0,
        prank: Number(st.ojamaBreakdown?.prank) || 0,
      },
    };
    this.completedFired = this.isCompleted();
    if (prevSrc && prevSrc !== sourceCanvas) {
      prevSrc.width = 0;
      prevSrc.height = 0;
    }
  }

  _buildPieces({ allowRotation, allowFlip, savedMap }) {
    for (const oldP of this.pieces) {
      oldP.frontSprite = null;
      oldP.backSprite = null;
      oldP.path = null;
    }
    this._sortedLooseCache = { version: -1, list: [] };

    const layout = generateCutLayout(this.cols, this.rows, this.boardW, this.boardH, this.seed, this.cutComplexity);
    const colorInfos = analyzePieceColors(this.sourceCanvas, this.cols, this.rows);
    const rng = mulberry32(this.seed ^ 0x9e3779b9);

    const atlas = new PieceSpriteAtlas(
      PUZZLE_CONFIG.SPRITE_ATLAS_SIZE,
      PUZZLE_CONFIG.SPRITE_ATLAS_PAD,
      this.spriteAtlasPages
    );

    this.pieces = [];
    this.zoneLabels = [];
    this.nextGroupId = 1;
    this.maxZ = 1;

    const total = this.cols * this.rows;
    const positions = savedMap ? null : this._generatePerimeterScatterPositions(total, rng);
    let highestGroup = 0;
    let highestZ = 1;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const id = r * this.cols + c;
        const targetX = -this.boardW / 2 + (c + 0.5) * this.pieceW;
        const targetY = -this.boardH / 2 + (r + 0.5) * this.pieceH;
        const path = buildPiecePath(r, c, this.cols, this.rows, targetX, targetY, layout, this.tabSize);

        const sp = savedMap ? savedMap.get(id) : null;
        const pos = positions ? positions[id] : null;
        const isLocked = sp ? !!sp.isLocked : false;
        const groupId = sp ? sp.groupId : this.nextGroupId++;
        const zOrder = sp ? (isLocked ? 0 : ++highestZ) : this.maxZ++;
        highestGroup = Math.max(highestGroup, groupId);

        const piece = {
          id, row: r, col: c,
          isEdge: r === 0 || r === this.rows - 1 || c === 0 || c === this.cols - 1,
          targetX, targetY,
          x: sp ? (isLocked ? targetX : sp.x) : pos.x,
          y: sp ? (isLocked ? targetY : sp.y) : pos.y,
          rotation: sp ? ((sp.rotation % 4) + 4) % 4 : allowRotation ? Math.floor(rng() * 4) : 0,
          isFlipped: sp ? !!sp.isFlipped : allowFlip ? rng() < PUZZLE_CONFIG.FLIP_INITIAL_PROB : false,
          groupId, isLocked, zOrder, colorInfo: colorInfos[id], path,
          frontSprite: null, backSprite: null,
          spriteHalfW: this.pieceW / 2 + this.spritePad,
          spriteHalfH: this.pieceH / 2 + this.spritePad,
        };

        renderPieceSprites(
          piece, this.sourceCanvas, this.boardW, this.boardH,
          this.pieceW, this.pieceH, this.spritePad, atlas, total
        );
        if (piece.isFlipped) {
          renderPieceBackSprite(
            piece, this.pieceW, this.pieceH, this.spritePad, this.backPatternCanvas, atlas
          );
        }
        this.pieces.push(piece);
      }
    }

    atlas.releaseUnusedPool();
    this.spriteAtlas = atlas;
    this.spriteAtlasPages = atlas.pages.map((p) => ({ canvas: p.canvas, ctx: p.ctx }));
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
    const scale = Math.min(
      PUZZLE_CONFIG.BOARD_MAX_WIDTH / imgW,
      PUZZLE_CONFIG.BOARD_MAX_HEIGHT / imgH
    );

    this.boardW = Math.round(imgW * scale);
    this.boardH = Math.round(imgH * scale);
    this.pieceW = this.boardW / this.cols;
    this.pieceH = this.boardH / this.rows;
    this.tabSize = Math.min(this.pieceW, this.pieceH) * PUZZLE_CONFIG.TAB_RATIO;
    const padExtra = Math.min(
      PUZZLE_CONFIG.SPRITE_PAD_EXTRA,
      Math.max(2, Math.ceil(Math.min(this.pieceW, this.pieceH) * 0.12))
    );
    this.spritePad =
      Math.ceil(
        this.tabSize * PUZZLE_CONFIG.SPRITE_PAD_TAB_MULT +
          Math.max(this.pieceW, this.pieceH) * PUZZLE_CONFIG.SPRITE_PAD_WARP_MULT
      ) + padExtra;
  }

  _generatePerimeterScatterPositions(count, rng) {
    const positions = [];
    const marginX = this.boardW / 2 + this.pieceW * 0.95;
    const marginY = this.boardH / 2 + this.pieceH * 0.95;
    const bandW = Math.max(260, this.pieceW * 3.2);
    const bandH = Math.max(200, this.pieceH * 2.4);

    for (let i = 0; i < count; i++) {
      const side = i % 4;
      let x;
      let y;
      if (side === 0) {
        x = (rng() - 0.5) * (this.boardW + bandW * 1.4);
        y = -marginY - rng() * bandH;
      } else if (side === 1) {
        x = marginX + rng() * bandW;
        y = (rng() - 0.5) * (this.boardH + bandH * 0.8);
      } else if (side === 2) {
        x = (rng() - 0.5) * (this.boardW + bandW * 1.4);
        y = marginY + rng() * bandH;
      } else {
        x = -marginX - rng() * bandW;
        y = (rng() - 0.5) * (this.boardH + bandH * 0.8);
      }
      positions.push({ x, y });
    }

    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    return positions;
  }

  getGroupPieces(groupId) {
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

      if (this.hitCtx.isPointInPath(piece.path, lx, ly)) {
        return piece;
      }
    }
    return null;
  }

  bringGroupToFront(groupId) {
    const z = this.maxZ++;
    let changed = false;
    for (const p of this.pieces) {
      if (p.groupId === groupId && !p.isLocked) {
        p.zOrder = z;
        changed = true;
      }
    }
    if (changed) this.bumpZVersion();
  }

  moveGroup(groupId, dx, dy) {
    for (const p of this.pieces) {
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

  dropLockedPieces(count) {
    return dropLockedPiecesOp(this, count);
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

  applyPiecePatches(patches) {
    applyPiecePatchesOp(this, patches);
  }

  exportSaveData(settings) {
    return exportSaveDataOp(this, settings);
  }
}
