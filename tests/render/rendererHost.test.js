import { afterEach, describe, expect, it } from 'vitest';
import { GameSession } from '../../src/app/gameSession.js';
import { RendererHost } from '../../src/render/rendererHost.js';
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

function setup({ mode = 'auto', restoreWaitMs = 3000, prepare = () => {} } = {}) {
  localStorage.clear();
  const restoreRandom = seedMathRandom(0x5eed);
  const stage = document.createElement('div');
  stage.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `width:${W}px;height:${H}px;display:block;`;
  stage.appendChild(canvas);
  document.body.appendChild(stage);
  const app = new GameSession();
  app.patchSettings({ ...SMALL_PUZZLE, theme: 'light', referenceMode: 'none' });
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
    expect(stage.querySelectorAll('canvas')).toHaveLength(3);
    host.setMode('canvas2d');
    expect(host.kind).toBe('canvas2d');
    expect(host.view).toMatchObject({ x: 12, y: -34, scale: 0.8 });
    expect(stage.querySelectorAll('canvas')).toHaveLength(2);
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
});
