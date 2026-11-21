import { CanvasRenderer } from './canvas2d/canvasRenderer.js';
import { ViewState } from './viewState.js';
import { WebGL2Renderer } from './webgl2/webgl2Renderer.js';

/** How long a lost WebGL context may take to come back before switching to Canvas 2D. */
const CONTEXT_RESTORE_WAIT_MS = 3000;

/** Renderer modes a player can choose: 'auto' tries WebGL2 first, 'canvas2d' never uses it. */
const RENDERER_MODES = Object.freeze(['auto', 'canvas2d']);

/**
 * Picks and owns the table renderer, and swaps it without losing the view:
 * - 'auto': WebGL2 when it is available and hardware accelerated, otherwise Canvas 2D.
 * - 'canvas2d': always Canvas 2D (compatibility mode, chosen in the settings).
 * - If the WebGL context is lost and not restored within a few seconds, Canvas 2D takes over.
 * Every renderer shares one ViewState, so camera, drag and effects carry over a swap.
 * The rest of the app uses this object as "the renderer".
 */
export class RendererHost {
  /**
   * @param {object} options
   * @param {HTMLElement} options.canvasStage stage element (layers are added inside it)
   * @param {HTMLCanvasElement} options.canvas bottom canvas, also the input target
   * @param {object} options.engine PuzzleEngine
   * @param {object} options.room RoomController
   * @param {() => object} options.getSettings current settings
   * @param {string} [options.mode] 'auto' or 'canvas2d'
   * @param {(info: {kind: string, reason: string|null}) => void} [options.onChange]
   * @param {number} [options.restoreWaitMs] wait before replacing a lost WebGL context
   */
  constructor({
    canvasStage,
    canvas,
    engine,
    room,
    getSettings,
    mode = 'auto',
    onChange,
    restoreWaitMs = CONTEXT_RESTORE_WAIT_MS,
  }) {
    this.base = { canvasStage, canvas, engine, room, getSettings };
    this.onChange = onChange || (() => {});
    this.restoreWaitMs = restoreWaitMs;
    this.viewState = new ViewState({
      getViewportSize: () => canvasStage.getBoundingClientRect(),
      engine,
      getSettings,
    });
    this.mode = RENDERER_MODES.includes(mode) ? mode : 'auto';
    this.current = null;
    this.reason = null;
    this._lostTimer = null;
    this._start();
  }

  get kind() {
    return this.current.kind;
  }

  get canvas() {
    return this.base.canvas;
  }

  /** The camera ({ x, y, scale }). */
  get view() {
    return this.viewState.camera;
  }

  /** Creates the renderer for the current mode; falls back to Canvas 2D when WebGL2 fails. */
  _start(fallbackReason = null) {
    clearTimeout(this._lostTimer);
    this.current?.dispose();
    this.current = null;
    let reason = fallbackReason;
    if (this.mode === 'auto' && !fallbackReason) {
      try {
        this.current = new WebGL2Renderer({
          ...this.base,
          viewState: this.viewState,
          onContextLost: () => this._onContextLost(),
          onContextRestored: () => clearTimeout(this._lostTimer),
        });
      } catch (err) {
        reason = err?.message || String(err);
      }
    } else if (this.mode === 'canvas2d') {
      reason = 'compatibility mode selected';
    }
    if (!this.current) {
      this.current = new CanvasRenderer({ ...this.base, viewState: this.viewState });
    }
    this.reason = this.current.kind === 'webgl2' ? null : reason;
    this.viewState.requestRender();
    this.onChange({ kind: this.current.kind, reason: this.reason });
  }

  _onContextLost() {
    clearTimeout(this._lostTimer);
    this._lostTimer = setTimeout(() => {
      if (this.current?.kind === 'webgl2' && this.current.lost) {
        this._start('WebGL context was lost and did not come back');
      }
    }, this.restoreWaitMs);
  }

  /** Switches between 'auto' and 'canvas2d' (the settings toggle). */
  setMode(mode) {
    const next = RENDERER_MODES.includes(mode) ? mode : 'auto';
    if (next === this.mode) return;
    this.mode = next;
    this._start();
  }

  renderFrame(now, onTimerTick) {
    this.current.renderFrame(now, onTimerTick);
  }

  requestRender() {
    this.viewState.requestRender();
  }

  fitView() {
    this.viewState.fitView();
  }

  resizeCanvas() {
    this.current.resizeCanvas();
  }

  launchConfetti() {
    this.current.launchConfetti();
  }

  getStats() {
    return { ...this.current.getStats(), mode: this.mode, fallbackReason: this.reason };
  }

  dispose() {
    clearTimeout(this._lostTimer);
    this.current?.dispose();
  }
}
