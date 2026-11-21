import { VIEWPORT_CONFIG } from '../../config/constants.js';
import { PieceSpriteStore } from '../pieceSpriteStore.js';
import { LockedBoardCache } from './lockedBoardCache.js';
import {
  collectVisiblePieces,
  drawBoardStage,
  drawConfettiStage,
  drawCursorStage,
  drawDeskStage,
  drawLockBadgeStage,
  drawPieceStage,
  drawSnapFlashStage,
  enterWorld,
  leaveWorld,
  prepareCanvas,
} from './renderStages.js';

/**
 * Canvas 2D renderer of the puzzle table (board, pieces, cursors, effects).
 * The render layer does not look up screen elements: the stage and canvas are passed in
 * (src/ui/puzzleRenderer.js does that for the game page).
 */
export class CanvasRenderer {
  constructor({ canvasStage, canvas, engine, room, getSettings }) {
    if (!canvasStage || !canvas) throw new Error('CanvasRenderer needs canvasStage and canvas');
    this.canvasStage = canvasStage;
    this.canvas = canvas;
    this.ctx = this.canvas.getContext('2d');
    this.engine = engine;
    this.room = room;
    this.getSettings = getSettings;

    this.view = {
      x: 0,
      y: 0,
      scale: VIEWPORT_CONFIG.DEFAULT_SCALE,
    };

    this.refSheet = {
      x: -520,
      y: -40,
      w: 280,
      h: 186,
    };

    this.hoveredPiece = null;
    this.draggingGroupId = null;
    this.highlightFilter = 'all';
    this.ghostPiecesActive = false;
    this.snapFlashes = [];
    this.confetti = [];
    this.needsRender = true;
    this.postRenderCallbacks = [];
    this.lastFrameTime = performance.now();
    this._paletteCache = { key: null, palette: null };
    this._lockedCache = new LockedBoardCache();
    this.sprites = new PieceSpriteStore();
  }

  afterNextRender(callback) {
    if (typeof callback === 'function') {
      this.postRenderCallbacks.push(callback);
      this.needsRender = true;
    }
  }

  /** Diagnostics: sprite atlas pages and zoom cache use. */
  getStats() {
    return this.sprites.getStats();
  }

  requestRender() {
    this.needsRender = true;
  }

  setGhostPiecesActive(active) {
    const next = Boolean(active);
    if (this.ghostPiecesActive !== next) {
      this.ghostPiecesActive = next;
      this.needsRender = true;
    }
  }

  screenToWorld(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    return {
      x: (sx - cx) / this.view.scale + this.view.x,
      y: (sy - cy) / this.view.scale + this.view.y,
    };
  }

  fitView() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const pad = Math.max(this.engine.pieceW, this.engine.pieceH) * 1.4 + this.engine.spritePad;
    let minX = -this.engine.boardW / 2 - pad;
    let maxX = this.engine.boardW / 2 + pad;
    let minY = -this.engine.boardH / 2 - pad;
    let maxY = this.engine.boardH / 2 + pad;
    for (const p of this.engine.pieces) {
      if (p.x - pad < minX) minX = p.x - pad;
      if (p.x + pad > maxX) maxX = p.x + pad;
      if (p.y - pad < minY) minY = p.y - pad;
      if (p.y + pad > maxY) maxY = p.y + pad;
    }
    const spanW = Math.max(1, maxX - minX);
    const spanH = Math.max(1, maxY - minY);
    const s = Math.min(rect.width / spanW, rect.height / spanH);
    this.view.scale = Math.max(VIEWPORT_CONFIG.MIN_ZOOM, Math.min(1.2, s));
    this.view.x = (minX + maxX) / 2;
    this.view.y = (minY + maxY) / 2;
    this.needsRender = true;
  }

  resetRefSheetGeometry(sourceCanvas) {
    const aspect = sourceCanvas.height / Math.max(1, sourceCanvas.width);
    this.refSheet.w = Math.max(180, Math.min(480, Math.round(this.engine.boardW * 0.44)));
    this.refSheet.h = Math.round(this.refSheet.w * aspect);
    this.refSheet.x =
      -this.engine.boardW / 2 - this.refSheet.w / 2 - Math.max(60, this.engine.pieceW * 1.1);
    this.refSheet.y = 0;
  }

  isPointInRefSheet(wx, wy) {
    const settings = this.getSettings();
    if ((settings.referenceMode || 'underlay') !== 'sheet') return false;
    return (
      wx >= this.refSheet.x - this.refSheet.w / 2 - 10 &&
      wx <= this.refSheet.x + this.refSheet.w / 2 + 10 &&
      wy >= this.refSheet.y - this.refSheet.h / 2 - 28 &&
      wy <= this.refSheet.y + this.refSheet.h / 2 + 10
    );
  }

  addSnapFlashes(pieces) {
    for (const sp of pieces) {
      this.snapFlashes.push({
        x: sp.x,
        y: sp.y,
        w: this.engine.pieceW,
        h: this.engine.pieceH,
        alpha: 0.9,
      });
    }
    this.needsRender = true;
  }

  _getThemePalette() {
    const themeKey = document.documentElement.getAttribute('data-theme') || 'light';
    if (this._paletteCache.key === themeKey && this._paletteCache.palette) {
      return this._paletteCache.palette;
    }
    const cs = getComputedStyle(document.documentElement);
    const read = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    const palette = {
      accent: read('--accent', '#1565c0'),
      secondary: read('--secondary', '#6d28d9'),
      success: read('--success', '#166534'),
      warning: read('--warning', '#92400e'),
      danger: read('--danger', '#c62828'),
      surface: read('--surface', '#ffffff'),
      text: read('--text', '#0f172a'),
      borderStrong: read('--border-strong', '#64748b'),
      boardBg: read('--canvas-board-bg', 'rgb(255 255 255 / 92%)'),
      deskGrid: read('--canvas-grid', 'rgb(15 23 42 / 6%)'),
      cellGrid: read('--canvas-cell-grid', 'rgb(15 23 42 / 12%)'),
      sheetBg: read('--canvas-sheet-bg', '#f8fafc'),
      sheetText: read('--canvas-sheet-text', '#1e293b'),
    };
    this._paletteCache = { key: themeKey, palette };
    return palette;
  }

  launchConfetti() {
    const rect = this.canvasStage.getBoundingClientRect();
    const pal = this._getThemePalette();
    const colors = [pal.accent, pal.secondary, pal.success, pal.warning, pal.danger];
    for (let i = 0; i < 90; i++) {
      this.confetti.push({
        x: Math.random() * rect.width,
        y: -10 - Math.random() * 80,
        vx: (Math.random() - 0.5) * 5,
        vy: 2 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.2,
        size: 7 + Math.random() * 6,
        color: colors[i % colors.length],
      });
    }
    this.needsRender = true;
  }

  clearEffects() {
    this.confetti = [];
    this.snapFlashes = [];
    this.needsRender = true;
  }

  resizeCanvas() {
    const rect = this.canvasStage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.max(1, Math.floor(rect.width * dpr));
    const targetH = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      this.needsRender = true;
    }
  }

  _tickTimer(dt, onTimerTick) {
    if (this.engine.pieces.length > 0 && !this.engine.isCompleted()) {
      this.engine.stats.elapsedMs += dt;
      onTimerTick(this.engine.stats.elapsedMs);
    }
  }

  /** Snapshot of everything the draw stages need for one frame. */
  _buildFrame() {
    const settings = this.getSettings();
    return {
      ctx: this.ctx,
      engine: this.engine,
      room: this.room,
      view: this.view,
      refSheet: this.refSheet,
      settings,
      isDark: settings.theme === 'dark',
      pal: this._getThemePalette(),
      rect: this.canvasStage.getBoundingClientRect(),
      dpr: window.devicePixelRatio || 1,
      highlightFilter: this.highlightFilter,
      ghostPiecesActive: this.ghostPiecesActive,
      draggingGroupId: this.draggingGroupId,
      hoveredPiece: this.hoveredPiece,
      snapFlashes: this.snapFlashes,
      confetti: this.confetti,
      lockedCache: this._lockedCache,
      sprites: this.sprites,
    };
  }

  _finishFrame(lodConfig) {
    const lod = this.sprites.lodCache;
    this.needsRender = Boolean(lodConfig && lod?.budgetExhausted && !lod?.evictedInFrame);
    if (this.postRenderCallbacks.length > 0) {
      const callbacks = this.postRenderCallbacks.splice(0);
      for (const cb of callbacks) cb();
    }
  }

  renderFrame(now, onTimerTick) {
    const dt = Math.min(100, now - this.lastFrameTime);
    this.lastFrameTime = now;
    this._tickTimer(dt, onTimerTick);

    this.resizeCanvas();

    if (this.engine.fakePieces.length > 0 && this.engine.pruneExpiredFakePieces()) {
      this.needsRender = true;
    }

    const interpolated = this.room ? this.room.stepInterpolation() : false;
    if (!(
      this.needsRender ||
      interpolated ||
      this.snapFlashes.length > 0 ||
      this.confetti.length > 0
    )) {
      return;
    }

    this.sprites.sync(this.engine);
    const frame = this._buildFrame();
    prepareCanvas(frame);
    drawDeskStage(frame);

    enterWorld(frame);
    drawBoardStage(frame);
    const lodConfig = drawPieceStage(frame, collectVisiblePieces(frame));
    drawLockBadgeStage(frame);
    drawSnapFlashStage(frame);
    drawCursorStage(frame);
    leaveWorld(frame);

    drawConfettiStage(frame);
    this._finishFrame(lodConfig);
  }
}
