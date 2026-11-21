import { EffectsLayer } from './canvas2d/effectsLayer.js';
import { PieceSpriteStore } from './pieceSpriteStore.js';
import { ViewState } from './viewState.js';

/** Theme colours read from CSS custom properties. */
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
 * What every renderer of the puzzle table shares (the renderer contract, see
 * _plan/20261121_1014_render_separation_plan.md 2.2):
 * - `viewState`: what is shown (camera, dragged/hovered piece, effects). Shared when the
 *   renderer is swapped, so the view does not jump.
 * - `renderFrame(now, onTimerTick)`: draws one animation frame if something changed.
 * - `requestRender()`, `fitView()`, `resizeCanvas()`, `launchConfetti()`, `getStats()`, `dispose()`.
 * - `kind`: 'canvas2d' or 'webgl2'.
 *
 * Subclasses draw the table in `_drawTable()` (desk, board, pieces), and may add world-space
 * drawing on the effects layer with `_drawOverlay(ctx, frame)` (e.g. outlines over WebGL pieces).
 * The stage and the bottom canvas (`canvas`, which also receives input) are passed in; layers a
 * renderer needs on top of it are created here and removed by dispose().
 */
export class TableRendererBase {
  constructor({ canvasStage, canvas, engine, room, getSettings, viewState = null }) {
    if (!canvasStage || !canvas) throw new Error('A renderer needs canvasStage and canvas');
    this.canvasStage = canvasStage;
    this.canvas = canvas;
    this.engine = engine;
    this.room = room;
    this.getSettings = getSettings;
    this.viewState =
      viewState ||
      new ViewState({
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
    this.sprites = new PieceSpriteStore();
  }

  /** The camera ({ x, y, scale }); kept for callers that read or set it directly. */
  get view() {
    return this.viewState.camera;
  }

  getStats() {
    return { renderer: this.kind, ...this.sprites.getStats() };
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

  /** Matches every layer's backing store to the stage size and device pixel ratio. */
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
    if (this._resizeLayers(targetW, targetH)) this.viewState.requestRender();
    if (this.effects.resize(rect.width, rect.height, dpr)) this.effects.dirty = true;
  }

  /** Subclasses resize extra layers; return true when one changed. */
  _resizeLayers() {
    return false;
  }

  _tickTimer(dt, onTimerTick) {
    if (this.engine.pieces.length > 0 && !this.engine.isCompleted()) {
      this.engine.stats.elapsedMs += dt;
      onTimerTick(this.engine.stats.elapsedMs);
    }
  }

  /** Runs callbacks queued with viewState.afterNextRender; call after the table was drawn. */
  _finishTable(lodConfig) {
    const lod = this.sprites.lodCache;
    // Zoom sprites are drawn a few per frame: keep redrawing until all visible ones are ready.
    this.viewState.needsRender = Boolean(lodConfig && lod.budgetExhausted && !lod.evictedInFrame);
    const callbacks = this.viewState.postRenderCallbacks.splice(0);
    for (const cb of callbacks) cb();
  }

  renderFrame(now, onTimerTick) {
    const dt = Math.min(100, Math.max(0, now - this.lastFrameTime));
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
    // The table's last frame, so the effects layer can redraw its overlay on its own.
    if (drawTable) this._lastTableFrame = this._drawTable();
    if (drawTable || moved.cursorsMoved || vs.hasEffects || this.effects.dirty) {
      const frame = this._lastTableFrame;
      this.effects.render({
        viewState: vs,
        room: this.room,
        pal: this._getThemePalette(),
        rect: this.canvasStage.getBoundingClientRect(),
        dpr: window.devicePixelRatio || 1,
        dtSec: dt / 1000,
        drawWorld: frame ? (ctx) => this._drawOverlay(ctx, frame) : null,
      });
    }
  }

  /** World-space drawing on the effects layer, above the pieces. Default: nothing. */
  _drawOverlay() {}

  /** Removes the layers this renderer added to the stage. */
  dispose() {
    this.effects.canvas.remove();
  }
}
