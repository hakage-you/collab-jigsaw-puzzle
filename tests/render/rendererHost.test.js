import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameSession } from '../../src/app/gameSession.js';
import { PieceSpriteStore } from '../../src/render/pieceSpriteStore.js';
import { RENDERER_MODES, RendererHost } from '../../src/render/rendererHost.js';
import { seedMathRandom } from '../helpers/determinism.js';
import { SMALL_PUZZLE } from '../helpers/puzzle.js';
import { waitFor } from '../helpers/wait.js';

// The renderer host picks WebGL2 or Canvas 2D and swaps between them without losing the view.
// (The test browser provides WebGL2 through SwiftShader.)

const W = 400;
const H = 300;
const cleanups = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function setup({
  mode = 'auto',
  restoreWaitMs = 3000,
  prepare = () => {},
  referenceMode = 'none',
  createWebGPU = null,
} = {}) {
  localStorage.clear();
  const restoreRandom = seedMathRandom(0x5eed);
  const stage = document.createElement('div');
  stage.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `width:${W}px;height:${H}px;display:block;`;
  stage.appendChild(canvas);
  document.body.appendChild(stage);
  const app = new GameSession();
  app.patchSettings({ ...SMALL_PUZZLE, theme: 'light', referenceMode });
  app.startNewPuzzle();
  restoreRandom();
  prepare(app);
  const changes = [];
  const host = new RendererHost({
    canvasStage: stage,
    canvas,
    engine: app.engine,
    room: app.room,
    getSettings: () => app.getSettings(),
    mode,
    restoreWaitMs,
    createWebGPU,
    onChange: (info) => changes.push(info),
  });
  cleanups.push(() => {
    host.dispose();
    stage.remove();
  });
  host.fitView();
  return { app, host, stage, canvas, changes };
}

/** What the player sees: every canvas layer of the stage composited in order. */
function composite(stage) {
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  for (const layer of stage.querySelectorAll('canvas')) ctx.drawImage(layer, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H).data;
}

function createMockGpuRenderer(opts) {
  const pieces = document.createElement('canvas');
  pieces.className = 'webgpu-pieces-canvas';
  opts.canvas.after(pieces);
  return {
    kind: 'webgpu',
    onContextLost: opts.onContextLost,
    onGpuError: opts.onGpuError,
    renderFrame: vi.fn(),
    resizeCanvas: vi.fn(),
    launchConfetti: vi.fn(),
    getStats: () => ({ renderer: 'webgpu', gpuTextureBytes: 1024, lastGpuMs: 0.4 }),
    dispose: vi.fn(() => pieces.remove()),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('RendererHost', () => {
  it('uses WebGL2 in auto mode and Canvas 2D in compatibility mode', () => {
    expect(setup().host.kind).toBe('webgl2');
    const compat = setup({ mode: 'canvas2d' });
    expect(compat.host.kind).toBe('canvas2d');
    expect(compat.changes.at(-1)).toEqual({
      kind: 'canvas2d',
      reason: 'compatibility mode selected',
    });
  });

  it('falls back to Canvas 2D when WebGL2 cannot be created, and says why', () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, opts) {
      return type === 'webgl2' ? null : original.call(this, type, opts);
    };
    try {
      const { host, changes } = setup();
      expect(host.kind).toBe('canvas2d');
      expect(changes.at(-1).reason).toMatch(/WebGL2 is not available/);
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });

  it('switching modes keeps the camera and removes the old layers', () => {
    const { host, stage } = setup();
    Object.assign(host.view, { x: 12, y: -34, scale: 0.8 });
    expect(stage.querySelectorAll('canvas')).toHaveLength(4);
    host.setMode('canvas2d');
    expect(host.kind).toBe('canvas2d');
    expect(host.view).toMatchObject({ x: 12, y: -34, scale: 0.8 });
    expect(stage.querySelectorAll('canvas')).toHaveLength(3);
    host.setMode('auto');
    expect(host.kind).toBe('webgl2');
  });

  it('switches to Canvas 2D when a lost WebGL context does not come back', async () => {
    const { host, stage, changes } = setup({ restoreWaitMs: 50 });
    host.renderFrame(1000, () => {});
    const gl = stage.querySelector('canvas.webgl-pieces-canvas').getContext('webgl2');
    gl.getExtension('WEBGL_lose_context').loseContext();
    await waitFor(() => host.kind === 'canvas2d', { message: 'did not fall back' });
    expect(changes.at(-1).reason).toMatch(/lost/);
    host.renderFrame(1016, () => {});
  });

  it('draws the same picture with WebGL2 as with Canvas 2D', () => {
    const prepare = (app) => {
      const [a, b] = app.engine.pieces;
      app.submitRotate(a);
      app.engine.flipPiece(b, true);
    };
    const gl = setup({ prepare });
    gl.host.renderFrame(1000, () => {});
    const c2d = setup({ mode: 'canvas2d', prepare });
    c2d.host.renderFrame(1000, () => {});
    const a = composite(gl.stage);
    const b = composite(c2d.stage);
    let far = 0;
    let total = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(
        Math.abs(a[i] - b[i]),
        Math.abs(a[i + 1] - b[i + 1]),
        Math.abs(a[i + 2] - b[i + 2]),
      );
      total += d;
      if (d > 64) far++;
    }
    // Mipmapped GPU sampling softens edges slightly; the layout and colours must match.
    expect(total / (a.length / 4)).toBeLessThan(3);
    expect(far / (a.length / 4)).toBeLessThan(0.01);
  });

  it('sprites drawn after the first frame (flips, fake pieces) reach the GPU without errors', () => {
    const later = (app) => {
      const p = app.engine.pieces.find((q) => !q.isLocked && !q.isFlipped);
      app.engine.flipPiece(p, true);
      seedMathRandom(7);
      app.engine.addFakePieces(2, 0, false, false);
    };
    const gl = setup();
    gl.host.renderFrame(1000, () => {});
    later(gl.app);
    gl.host.requestRender();
    gl.host.renderFrame(1016, () => {});
    const ctx = gl.stage.querySelector('canvas.webgl-pieces-canvas').getContext('webgl2');
    expect(ctx.getError()).toBe(ctx.NO_ERROR);

    const c2d = setup({ mode: 'canvas2d' });
    c2d.host.renderFrame(1000, () => {});
    later(c2d.app);
    c2d.host.requestRender();
    c2d.host.renderFrame(1016, () => {});
    const a = composite(gl.stage);
    const b = composite(c2d.stage);
    let far = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(
        Math.abs(a[i] - b[i]),
        Math.abs(a[i + 1] - b[i + 1]),
        Math.abs(a[i + 2] - b[i + 2]),
      );
      if (d > 64) far++;
    }
    expect(far / (a.length / 4)).toBeLessThan(0.01);
  });

  // The reference image (underlay under the board, or a sheet beside it) is drawn on the bottom
  // canvas in WebGL2 mode; pieces must still cover it exactly as in Canvas 2D.
  it.each([
    ['underlay', null],
    ['sheet', { x: -300, y: 0, scale: 0.5 }],
    ['floating', null],
  ])('reference mode %s looks the same with WebGL2 and Canvas 2D', (referenceMode, view) => {
    const render = (mode) => {
      const r = setup({ mode, referenceMode });
      if (view) Object.assign(r.host.view, view);
      r.host.renderFrame(1000, () => {});
      return composite(r.stage);
    };
    const a = render('auto');
    const b = render('canvas2d');
    let far = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(
        Math.abs(a[i] - b[i]),
        Math.abs(a[i + 1] - b[i + 1]),
        Math.abs(a[i + 2] - b[i + 2]),
      );
      if (d > 64) far++;
    }
    expect(far / (a.length / 4)).toBeLessThan(0.01);
  });

  it('supports switching across auto, webgpu, webgl2, and canvas2d modes', async () => {
    expect(RENDERER_MODES).toEqual(['auto', 'webgpu', 'webgl2', 'canvas2d']);
    const createWebGPU = vi.fn((opts) => Promise.resolve(createMockGpuRenderer(opts)));
    const { host, changes } = setup({ mode: 'webgl2', createWebGPU });
    expect(host.kind).toBe('webgl2');
    expect(createWebGPU).not.toHaveBeenCalled();

    host.setMode('webgpu');
    await waitFor(() => host.kind === 'webgpu', { message: 'did not promote in webgpu mode' });
    expect(changes.at(-1)).toEqual({ kind: 'webgpu', reason: null });

    host.setMode('canvas2d');
    expect(host.kind).toBe('canvas2d');
    expect(changes.at(-1)).toEqual({ kind: 'canvas2d', reason: 'compatibility mode selected' });
  });

  it('falls back to WebGL2 with reason when forced webgpu fails', async () => {
    const createWebGPU = vi.fn(() => Promise.reject(new Error('No WebGPU adapter')));
    const { host, changes } = setup({ mode: 'webgpu', createWebGPU });
    await waitFor(() => Boolean(host.reason), { message: 'fallback reason was not set' });
    expect(host.kind).toBe('webgl2');
    expect(changes.at(-1)).toEqual({ kind: 'webgl2', reason: 'No WebGPU adapter' });
  });

  it('promotes asynchronously to WebGPU in auto mode while keeping camera and cleaning old layers', async () => {
    const d = deferred();
    let mockGpu = null;
    const createWebGPU = vi.fn(async (opts) => {
      await d.promise;
      mockGpu = createMockGpuRenderer(opts);
      return mockGpu;
    });
    const { host, stage, changes } = setup({ mode: 'auto', createWebGPU });
    expect(host.kind).toBe('webgl2');
    Object.assign(host.view, { x: 45, y: -22, scale: 1.35 });
    expect(stage.querySelectorAll('canvas')).toHaveLength(4);

    d.resolve();
    await waitFor(() => host.kind === 'webgpu', { message: 'did not promote to webgpu' });

    expect(host.view).toMatchObject({ x: 45, y: -22, scale: 1.35 });
    expect(stage.querySelector('canvas.webgl-pieces-canvas')).toBeNull();
    expect(stage.querySelector('canvas.webgpu-pieces-canvas')).not.toBeNull();
    expect(changes.at(-1)).toEqual({ kind: 'webgpu', reason: null });
    expect(mockGpu.getStats().lastGpuMs).toBe(0.4);
  });

  it('guards against setMode and dispose races while WebGPU initialization is pending', async () => {
    const d1 = deferred();
    const created = [];
    const createWebGPU = vi.fn(async (opts) => {
      await d1.promise;
      const r = createMockGpuRenderer(opts);
      created.push(r);
      return r;
    });
    const first = setup({ mode: 'auto', createWebGPU });
    first.host.setMode('canvas2d');
    d1.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(first.host.kind).toBe('canvas2d');
    expect(created[0].dispose).toHaveBeenCalledTimes(1);
    expect(first.stage.querySelector('canvas.webgpu-pieces-canvas')).toBeNull();

    const d2 = deferred();
    const secondCreated = [];
    const second = setup({
      mode: 'webgpu',
      createWebGPU: async (opts) => {
        await d2.promise;
        const r = createMockGpuRenderer(opts);
        secondCreated.push(r);
        return r;
      },
    });
    const changesBeforeDispose = second.changes.length;
    second.host.dispose();
    d2.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(secondCreated[0].dispose).toHaveBeenCalledTimes(1);
    expect(second.changes.length).toBe(changesBeforeDispose);
  });

  it('automatically downgrades from WebGPU to WebGL2 when device.lost fires', async () => {
    let mockGpu = null;
    const createWebGPU = vi.fn((opts) => {
      mockGpu = createMockGpuRenderer(opts);
      return Promise.resolve(mockGpu);
    });
    const { host, stage, changes } = setup({ mode: 'auto', createWebGPU });
    await waitFor(() => host.kind === 'webgpu');
    Object.assign(host.view, { x: -18, y: 77, scale: 0.65 });

    mockGpu.onContextLost();
    expect(mockGpu.dispose).toHaveBeenCalledTimes(1);
    expect(host.kind).toBe('webgl2');
    expect(host.view).toMatchObject({ x: -18, y: 77, scale: 0.65 });
    expect(stage.querySelector('canvas.webgpu-pieces-canvas')).toBeNull();
    expect(stage.querySelector('canvas.webgl-pieces-canvas')).not.toBeNull();
    expect(changes.at(-1).reason).toMatch(/lost/);
  });

  it('automatically downgrades from WebGPU to WebGL2 on uncapturederror and records reason', async () => {
    let mockGpu = null;
    const createWebGPU = vi.fn((opts) => {
      mockGpu = createMockGpuRenderer(opts);
      return Promise.resolve(mockGpu);
    });
    const { host, stage, changes } = setup({ mode: 'auto', createWebGPU });
    await waitFor(() => host.kind === 'webgpu');

    mockGpu.onGpuError(new Error('Validation failed'));
    expect(mockGpu.dispose).toHaveBeenCalledTimes(1);
    expect(host.kind).toBe('webgl2');
    expect(stage.querySelector('canvas.webgpu-pieces-canvas')).toBeNull();
    expect(changes.at(-1)).toEqual({ kind: 'webgl2', reason: 'WebGPU error: Validation failed' });
    expect(host.getStats().fallbackReason).toBe('WebGPU error: Validation failed');
  });

  it('PieceSpriteStore({ bakeBevel: false }) builds sprites without baked border lines', () => {
    const { app } = setup({ mode: 'canvas2d' });
    const withBevel = new PieceSpriteStore({ bakeBevel: true });
    const noBevel = new PieceSpriteStore({ bakeBevel: false });
    withBevel.sync(app.engine);
    noBevel.sync(app.engine);
    expect(noBevel.bakeBevel).toBe(false);
    expect(noBevel.front.size).toBe(withBevel.front.size);
    expect(noBevel.metrics).toEqual(withBevel.metrics);
  });
});
