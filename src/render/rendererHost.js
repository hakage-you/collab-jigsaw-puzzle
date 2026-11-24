import { CanvasRenderer } from './canvas2d/canvasRenderer.js';
import { ViewState } from './viewState.js';
import { WebGL2Renderer } from './webgl2/webgl2Renderer.js';
import { WebGPURenderer } from './webgpu/webgpuRenderer.js';

/** How long a lost WebGL context may take to come back before switching to Canvas 2D. */
const CONTEXT_RESTORE_WAIT_MS = 3000;

/** Renderer modes a player can choose. */
export const RENDERER_MODES = Object.freeze(['auto', 'webgpu', 'webgl2', 'canvas2d']);

/**
 * Picks and owns the table renderer, and swaps it without losing the view:
 * - 'auto': starts synchronously with WebGL2 (or Canvas 2D), then promotes to WebGPU if available.
 * - 'webgpu': tries WebGPU (including fallback adapter if needed), falls back to WebGL2 -> Canvas 2D.
 * - 'webgl2': WebGL2 only, falling back to Canvas 2D.
 * - 'canvas2d': always Canvas 2D (compatibility mode).
 * Every renderer shares one ViewState, so camera, drag and effects carry over a swap.
 */
export class RendererHost {
  constructor({
    canvasStage,
    canvas,
    engine,
    room,
    getSettings,
    mode = 'auto',
    onChange,
    restoreWaitMs = CONTEXT_RESTORE_WAIT_MS,
    createWebGPU = null,
  }) {
    this.base = { canvasStage, canvas, engine, room, getSettings };
    this.onChange = onChange || (() => {});
    this.restoreWaitMs = restoreWaitMs;
    this._customCreateWebGPU = createWebGPU;
    this._createWebGPU = createWebGPU || ((opts) => WebGPURenderer.create(opts));
    this.viewState = new ViewState({
      getViewportSize: () => canvasStage.getBoundingClientRect(),
      engine,
      getSettings,
    });
    this.mode = RENDERER_MODES.includes(mode) ? mode : 'auto';
    this.current = null;
    this.reason = null;
    this._lostTimer = null;
    this._token = 0;
    this._disposed = false;
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

  _canTryWebGPU() {
    return Boolean(this._customCreateWebGPU || (typeof navigator !== 'undefined' && navigator.gpu));
  }

  _createSyncFallback() {
    try {
      const renderer = new WebGL2Renderer({
        ...this.base,
        viewState: this.viewState,
        onContextLost: () => this._onContextLost(),
        onContextRestored: () => clearTimeout(this._lostTimer),
      });
      return { renderer, reason: null };
    } catch (err) {
      return {
        renderer: new CanvasRenderer({ ...this.base, viewState: this.viewState }),
        reason: err?.message || String(err),
      };
    }
  }

  _start() {
    this._token += 1;
    const token = this._token;
    clearTimeout(this._lostTimer);
    this.current?.dispose();
    this.current = null;

    if (this.mode === 'canvas2d') {
      this.current = new CanvasRenderer({ ...this.base, viewState: this.viewState });
      this.reason = 'compatibility mode selected';
      this.viewState.requestRender();
      this.onChange({ kind: 'canvas2d', reason: this.reason });
      return;
    }

    const { renderer, reason } = this._createSyncFallback();
    this.current = renderer;
    this.reason = reason;
    this.viewState.requestRender();
    this.onChange({ kind: this.current.kind, reason: this.reason });

    if (this.mode === 'webgpu') {
      this._promoteToWebGPU(token, { allowFallbackAdapter: true });
    } else if (this.mode === 'auto' && this._canTryWebGPU()) {
      this._promoteToWebGPU(token, { allowFallbackAdapter: false });
    }
  }

  async _promoteToWebGPU(token, { allowFallbackAdapter }) {
    try {
      const gpuRenderer = await this._createWebGPU({
        ...this.base,
        viewState: this.viewState,
        allowFallbackAdapter,
        onContextLost: () => {
          if (this._disposed || token !== this._token) return;
          this._downgradeFromWebGPU('WebGPU device was lost');
        },
        onGpuError: (err) => {
          if (this._disposed || token !== this._token) return;
          this._downgradeFromWebGPU(`WebGPU error: ${err?.message || String(err)}`);
        },
      });
      if (this._disposed || token !== this._token) {
        gpuRenderer?.dispose();
        return;
      }
      this.current?.dispose();
      this.current = gpuRenderer;
      this.reason = null;
      this.viewState.requestRender();
      this.onChange({ kind: 'webgpu', reason: null });
    } catch (err) {
      if (this._disposed || token !== this._token) return;
      if (this.mode === 'webgpu') {
        const gpuReason = err?.message || String(err);
        this.reason = this.current.kind === 'webgl2' ? gpuReason : `${gpuReason}; ${this.reason}`;
        this.onChange({ kind: this.current.kind, reason: this.reason });
      }
    }
  }

  _downgradeFromWebGPU(reason) {
    this._token += 1;
    clearTimeout(this._lostTimer);
    this.current?.dispose();
    const { renderer, reason: glReason } = this._createSyncFallback();
    this.current = renderer;
    this.reason = renderer.kind === 'webgl2' ? reason : `${reason}; ${glReason}`;
    this.viewState.requestRender();
    this.onChange({ kind: this.current.kind, reason: this.reason });
  }

  _downgradeFromWebGL2(reason) {
    this._token += 1;
    clearTimeout(this._lostTimer);
    this.current?.dispose();
    this.current = new CanvasRenderer({ ...this.base, viewState: this.viewState });
    this.reason = reason;
    this.viewState.requestRender();
    this.onChange({ kind: 'canvas2d', reason: this.reason });
  }

  _onContextLost() {
    clearTimeout(this._lostTimer);
    this._lostTimer = setTimeout(() => {
      if (!this._disposed && this.current?.kind === 'webgl2' && this.current.lost) {
        this._downgradeFromWebGL2('WebGL context was lost and did not come back');
      }
    }, this.restoreWaitMs);
  }

  /** Switches between 'auto', 'webgpu', 'webgl2', and 'canvas2d'. */
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

  /** Where the completion sticker goes on the stage (ViewState.completionSpot). */
  completionSpot() {
    return this.viewState.completionSpot();
  }

  getStats() {
    return { ...this.current.getStats(), mode: this.mode, fallbackReason: this.reason };
  }

  dispose() {
    this._disposed = true;
    this._token += 1;
    clearTimeout(this._lostTimer);
    this.current?.dispose();
  }
}
