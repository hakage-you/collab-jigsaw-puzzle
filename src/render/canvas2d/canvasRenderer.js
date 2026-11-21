import { PieceSpriteStore } from '../pieceSpriteStore.js';
import { ViewState } from '../viewState.js';
import { EffectsLayer } from './effectsLayer.js';
import { LockedBoardCache } from './lockedBoardCache.js';
import {
  collectVisiblePieces,
  drawBoardStage,
  drawDeskStage,
  drawLockBadgeStage,
  drawPieceStage,
  enterWorld,
  leaveWorld,
  prepareCanvas,
} from './renderStages.js';

/** Theme colours read from CSS custom properties, cached per theme. */
function readThemePalette() {
  const cs = getComputedStyle(document.documentElement);
  const read = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
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
}

/**
 * Canvas 2D renderer of the puzzle table. Two canvases: the table (desk, board, pieces, lock
 * badges), redrawn only when something on it changed, and a transparent effects layer on top
 * (cursors, snap flashes, confetti). What is shown comes from `viewState`; the renderer only
 * reads it, except for advancing effects.
 * The render layer does not look up page elements: the stage and canvas are passed in
 * (src/ui/puzzleRenderer.js does that for the game page). The effects canvas is created here.
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
    this.viewState = new ViewState({
      getViewportSize: () => this.canvasStage.getBoundingClientRect(),
      engine,
      getSettings,
    });

    const effectsCanvas = document.createElement('canvas');
    effectsCanvas.className = 'effects-canvas';
    effectsCanvas.setAttribute('aria-hidden', 'true');
    canvas.after(effectsCanvas);
    this.effects = new EffectsLayer(effectsCanvas);

    this.lastFrameTime = performance.now();
    this._paletteCache = { key: null, palette: null };
    this._lockedCache = new LockedBoardCache();
    this.sprites = new PieceSpriteStore();
  }

  /** The camera ({ x, y, scale }); kept for callers that read or set it directly. */
  get view() {
    return this.viewState.camera;
  }

  /** Diagnostics: sprite atlas pages and zoom cache use. */
  getStats() {
    return this.sprites.getStats();
  }

  requestRender() {
    this.viewState.requestRender();
  }

  fitView() {
    this.viewState.fitView();
  }

  _getThemePalette() {
    const themeKey = document.documentElement.getAttribute('data-theme') || 'light';
    if (this._paletteCache.key !== themeKey) {
      this._paletteCache = { key: themeKey, palette: readThemePalette() };
    }
    return this._paletteCache.palette;
  }

  /** Confetti in the theme's colours (the result screen calls this on completion). */
  launchConfetti() {
    const pal = this._getThemePalette();
    this.viewState.launchConfetti([
      pal.accent,
      pal.secondary,
      pal.success,
      pal.warning,
      pal.danger,
    ]);
  }

  resizeCanvas() {
    const rect = this.canvasStage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.max(1, Math.floor(rect.width * dpr));
    const targetH = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      this.viewState.requestRender();
    }
    if (this.effects.resize(rect.width, rect.height, dpr)) this.effects.dirty = true;
  }

  _tickTimer(dt, onTimerTick) {
    if (this.engine.pieces.length > 0 && !this.engine.isCompleted()) {
      this.engine.stats.elapsedMs += dt;
      onTimerTick(this.engine.stats.elapsedMs);
    }
  }

  /** Snapshot of everything the table draw stages need for one frame. */
  _buildFrame() {
    const settings = this.getSettings();
    const vs = this.viewState;
    return {
      ctx: this.ctx,
      engine: this.engine,
      room: this.room,
      view: vs.camera,
      refSheet: vs.refSheet,
      settings,
      isDark: settings.theme === 'dark',
      pal: this._getThemePalette(),
      rect: this.canvasStage.getBoundingClientRect(),
      dpr: window.devicePixelRatio || 1,
      highlightFilter: vs.highlightFilter,
      ghostPiecesActive: vs.ghostPiecesActive,
      draggingGroupId: vs.draggingGroupId,
      hoveredPiece: vs.hoveredPiece,
      lockedCache: this._lockedCache,
      sprites: this.sprites,
    };
  }

  _drawTable() {
    this.sprites.sync(this.engine);
    const frame = this._buildFrame();
    prepareCanvas(frame);
    drawDeskStage(frame);
    enterWorld(frame);
    drawBoardStage(frame);
    const lodConfig = drawPieceStage(frame, collectVisiblePieces(frame));
    drawLockBadgeStage(frame);
    leaveWorld(frame);

    const lod = this.sprites.lodCache;
    // Zoom sprites are drawn a few per frame: keep redrawing until all visible ones are ready.
    this.viewState.needsRender = Boolean(lodConfig && lod.budgetExhausted && !lod.evictedInFrame);
    const callbacks = this.viewState.postRenderCallbacks.splice(0);
    for (const cb of callbacks) cb();
  }

  renderFrame(now, onTimerTick) {
    const dt = Math.min(100, now - this.lastFrameTime);
    this.lastFrameTime = now;
    this._tickTimer(dt, onTimerTick);
    this.resizeCanvas();

    const vs = this.viewState;
    if (this.engine.fakePieces.length > 0 && this.engine.pruneExpiredFakePieces()) {
      vs.requestRender();
    }
    const moved = this.room
      ? this.room.stepInterpolation()
      : { cursorsMoved: false, piecesMoved: false };

    const drawTable = vs.needsRender || moved.piecesMoved;
    if (drawTable) this._drawTable();
    if (drawTable || moved.cursorsMoved || vs.hasEffects || this.effects.dirty) {
      this.effects.render({
        viewState: vs,
        room: this.room,
        pal: this._getThemePalette(),
        rect: this.canvasStage.getBoundingClientRect(),
        dpr: window.devicePixelRatio || 1,
        dtSec: dt / 1000,
      });
    }
  }
}
