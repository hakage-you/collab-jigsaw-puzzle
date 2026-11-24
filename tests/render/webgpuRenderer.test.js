import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameSession } from '../../src/app/gameSession.js';
import { requestWebGPUDevice } from '../../src/render/webgpu/gpuContext.js';
import { FLOATS_PER_INSTANCE } from '../../src/render/webgpu/piecePipeline.js';
import { POST_EFFECT_MODE } from '../../src/render/webgpu/postProcessPipeline.js';
import {
  computeBoardBounds,
  computeSheetBounds,
} from '../../src/render/webgpu/tableBakePipeline.js';
import { WebGPURenderer } from '../../src/render/webgpu/webgpuRenderer.js';
import { seedMathRandom } from '../helpers/determinism.js';
import { SMALL_PUZZLE } from '../helpers/puzzle.js';

const W = 400;
const H = 300;
const cleanups = [];

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function createMockGpuEnv({ withTimestamp = false } = {}) {
  let loseDevice;
  const lostPromise = new Promise((resolve) => {
    loseDevice = resolve;
  });
  const drawCalls = [];
  const uploadedRegions = [];
  const createdTextures = [];
  const createdBuffers = [];
  const listeners = new Map();

  const mockDevice = {
    features: new Set(withTimestamp ? ['timestamp-query'] : []),
    lost: lostPromise,
    addEventListener: vi.fn((type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    }),
    removeEventListener: vi.fn((type, fn) => {
      listeners.get(type)?.delete(fn);
    }),
    emit: (type, event) => {
      for (const fn of listeners.get(type) || []) fn(event);
    },
    createShaderModule: vi.fn(() => ({})),
    createSampler: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createComputePipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createBuffer: vi.fn((desc) => {
      const buf = { desc, destroy: vi.fn(), unmap: vi.fn(), mapAsync: vi.fn() };
      createdBuffers.push(buf);
      return buf;
    }),
    createTexture: vi.fn((desc) => {
      const tex = { desc, createView: vi.fn(() => ({})), destroy: vi.fn() };
      createdTextures.push(tex);
      return tex;
    }),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: vi.fn(() => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
      })),
      beginRenderPass: vi.fn(() => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        setVertexBuffer: vi.fn(),
        draw: vi.fn((vertCount, instCount = 1) => drawCalls.push({ vertCount, instCount })),
        end: vi.fn(),
      })),
      resolveQuerySet: vi.fn(),
      copyBufferToBuffer: vi.fn(),
      finish: vi.fn(() => ({})),
    })),
    queue: {
      copyExternalImageToTexture: vi.fn((src, dst, size) => {
        uploadedRegions.push({ src, dst, size });
      }),
      writeBuffer: vi.fn(),
      submit: vi.fn(),
    },
    destroy: vi.fn(),
  };

  const mockContext = {
    configure: vi.fn(),
    unconfigure: vi.fn(),
    getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({})) })),
  };

  return {
    mockDevice,
    mockContext,
    loseDevice,
    drawCalls,
    uploadedRegions,
    createdTextures,
    createdBuffers,
  };
}

function setupWebGPURenderer({ onContextLost = vi.fn(), onGpuError = vi.fn() } = {}) {
  localStorage.clear();
  const restoreRandom = seedMathRandom(0x5eed);
  const stage = document.createElement('div');
  stage.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `width:${W}px;height:${H}px;display:block;`;
  stage.appendChild(canvas);
  document.body.appendChild(stage);

  const app = new GameSession();
  app.patchSettings({ ...SMALL_PUZZLE, theme: 'light', referenceMode: 'none', deskStyle: 'grid' });
  app.startNewPuzzle();
  restoreRandom();

  const env = createMockGpuEnv();
  const piecesCanvas = document.createElement('canvas');
  const renderer = new WebGPURenderer({
    canvasStage: stage,
    canvas,
    engine: app.engine,
    room: app.room,
    getSettings: () => app.getSettings(),
    onContextLost,
    onGpuError,
    gpu: {
      adapter: {},
      device: env.mockDevice,
      context: env.mockContext,
      format: 'bgra8unorm',
      isFallbackAdapter: false,
      piecesCanvas,
    },
  });
  renderer.fitView();
  cleanups.push(() => {
    renderer.dispose();
    stage.remove();
  });
  return { app, renderer, stage, canvas, env };
}

describe('WebGPURenderer', () => {
  it('uploads sprites via copyExternalImageToTexture without bakeBevel, never redraws bottom canvas, and avoids re-bake on pan/zoom', () => {
    const { app, renderer, stage, canvas, env } = setupWebGPURenderer();
    expect(renderer.kind).toBe('webgpu');
    expect(renderer.sprites.bakeBevel).toBe(false);
    expect(stage.querySelector('canvas.webgpu-pieces-canvas')).not.toBeNull();

    const ctx2d = canvas.getContext('2d');
    const clearSpy = vi.spyOn(ctx2d, 'clearRect');
    const fillSpy = vi.spyOn(ctx2d, 'fillRect');

    renderer.renderFrame(1000, () => {});
    expect(clearSpy).not.toHaveBeenCalled();
    expect(fillSpy).not.toHaveBeenCalled();
    expect(env.uploadedRegions.length).toBeGreaterThan(0);
    expect(env.uploadedRegions.every((u) => u.dst.premultipliedAlpha === true)).toBe(true);
    const uploadsAfterFirstFrame = env.uploadedRegions.length;

    // Drag, pan, and zoom must neither draw on bottom Canvas 2D nor re-bake the board texture.
    const loose = app.engine.getSortedLoosePieces()[0];
    renderer.viewState.setDraggingGroup(loose.groupId);
    app.engine.moveGroup(loose.groupId, 15, 10);
    renderer.requestRender();
    renderer.renderFrame(1016, () => {});
    renderer.viewState.panBy(20, 0);
    renderer.renderFrame(1032, () => {});
    renderer.viewState.setScale(1.1);
    renderer.renderFrame(1048, () => {});
    expect(clearSpy).not.toHaveBeenCalled();
    expect(fillSpy).not.toHaveBeenCalled();
    expect(env.uploadedRegions.length).toBe(uploadsAfterFirstFrame);
  });

  it('allocates and runs postProcessPipeline only when color sabotage is active', () => {
    const { renderer, canvas, env } = setupWebGPURenderer();
    renderer.renderFrame(1000, () => {});
    renderer.requestRender();
    renderer.renderFrame(1008, () => {});
    const texturesBefore = env.createdTextures.length;
    const encodersBefore = env.mockDevice.createCommandEncoder.mock.results.length;
    const passCount = (idx) =>
      env.mockDevice.createCommandEncoder.mock.results[idx].value.beginRenderPass.mock.calls.length;
    expect(passCount(encodersBefore - 1)).toBe(2);

    canvas.classList.add('sabotage-hue');
    renderer.renderFrame(1016, () => {});
    expect(env.createdTextures.length).toBe(texturesBefore + 1);
    expect(passCount(env.mockDevice.createCommandEncoder.mock.results.length - 1)).toBe(3);

    canvas.classList.remove('sabotage-hue');
    renderer.renderFrame(1032, () => {});
    expect(passCount(env.mockDevice.createCommandEncoder.mock.results.length - 1)).toBe(2);
  });

  it('emits soft shadow instance in normal effectStrength and omits it in reduced/off', () => {
    const { app, renderer, env } = setupWebGPURenderer();
    const pieceCount = app.engine.pieces.length;
    const loose = app.engine.getSortedLoosePieces()[0];
    renderer.viewState.setDraggingGroup(loose.groupId);

    renderer.viewState.effectIntensity = 'normal';
    renderer.requestRender();
    renderer.renderFrame(1000, () => {});
    const normalDraw = env.drawCalls.at(-1);
    expect(normalDraw.instCount).toBe(pieceCount + 1);
    const hasShadow = Array.from({ length: normalDraw.instCount }, (_, i) => {
      return renderer.data[i * FLOATS_PER_INSTANCE + 15] > 0;
    }).some(Boolean);
    expect(hasShadow).toBe(true);

    renderer.viewState.effectIntensity = 'reduced';
    renderer.requestRender();
    renderer.renderFrame(1016, () => {});
    const reducedDraw = env.drawCalls.at(-1);
    expect(reducedDraw.instCount).toBe(pieceCount);
  });

  it('notifies onContextLost on unexpected device.lost and cleans up resources on dispose', async () => {
    const onContextLost = vi.fn();
    const { renderer, stage, env } = setupWebGPURenderer({ onContextLost });
    renderer.renderFrame(1000, () => {});
    expect(renderer.getStats().gpuTextureBytes).toBeGreaterThan(0);

    env.loseDevice({ reason: 'unknown', message: 'GPU reset' });
    await Promise.resolve();
    expect(onContextLost).toHaveBeenCalledTimes(1);
    expect(renderer.lost).toBe(true);
    expect(renderer.getStats().gpuTextureBytes).toBe(0);

    renderer.dispose();
    expect(stage.querySelector('canvas.webgpu-pieces-canvas')).toBeNull();
    expect(env.mockDevice.destroy).toHaveBeenCalledTimes(1);
    expect(env.mockContext.unconfigure).toHaveBeenCalledTimes(1);
  });

  it('launches Compute confetti respecting effectIntensity (normal / reduced / off)', () => {
    const { renderer, env } = setupWebGPURenderer();

    renderer.viewState.effectIntensity = 'off';
    renderer.launchConfetti();
    expect(renderer.getStats().activeParticles).toBe(0);
    renderer.renderFrame(1000, () => {});
    const offEncoder = env.mockDevice.createCommandEncoder.mock.results.at(-1).value;
    expect(offEncoder.beginComputePass).not.toHaveBeenCalled();

    renderer.viewState.effectIntensity = 'reduced';
    renderer.launchConfetti();
    expect(renderer.getStats().activeParticles).toBe(240);
    renderer.renderFrame(1016, () => {});
    const reducedEncoder = env.mockDevice.createCommandEncoder.mock.results.at(-1).value;
    expect(reducedEncoder.beginComputePass).toHaveBeenCalledTimes(1);
    expect(env.drawCalls.at(-1)).toEqual({ vertCount: 4, instCount: 240 });

    renderer.viewState.effectIntensity = 'normal';
    renderer.launchConfetti();
    expect(renderer.getStats().activeParticles).toBe(2400);
    renderer.renderFrame(1032, () => {});
    const normalEncoder = env.mockDevice.createCommandEncoder.mock.results.at(-1).value;
    expect(normalEncoder.beginComputePass).toHaveBeenCalledTimes(1);
    expect(env.drawCalls.at(-1)).toEqual({ vertCount: 4, instCount: 2400 });
  });

  it('renders sabotage-mist with animated=1 in normal mode and static animated=0 in reduced/off', () => {
    const { renderer, canvas, env } = setupWebGPURenderer();
    canvas.classList.add('sabotage-mist');
    const lastPostUniform = () => {
      const calls = env.mockDevice.queue.writeBuffer.mock.calls.filter(
        (c) => c[0] === renderer.postProcessPipeline.uniformBuf,
      );
      const raw = calls.at(-1)[2];
      const u32 = new Uint32Array(raw);
      return { mode: u32[0], animated: u32[3] };
    };

    renderer.viewState.effectIntensity = 'normal';
    expect(renderer._resolvePostMode()).toBe(POST_EFFECT_MODE.MIST);
    renderer.renderFrame(1000, () => {});
    expect(renderer.viewState.needsRender).toBe(true);
    expect(lastPostUniform()).toEqual({ mode: POST_EFFECT_MODE.MIST, animated: 1 });

    renderer.viewState.effectIntensity = 'reduced';
    expect(renderer._resolvePostMode()).toBe(POST_EFFECT_MODE.MIST);
    renderer.renderFrame(1016, () => {});
    expect(renderer.viewState.needsRender).toBe(false);
    expect(lastPostUniform()).toEqual({ mode: POST_EFFECT_MODE.MIST, animated: 0 });

    renderer.viewState.effectIntensity = 'off';
    expect(renderer._resolvePostMode()).toBe(POST_EFFECT_MODE.MIST);
  });

  it('notifies onGpuError and stops GPU commands on uncapturederror, removing listener on dispose', () => {
    const onGpuError = vi.fn();
    const { renderer, env } = setupWebGPURenderer({ onGpuError });
    renderer.renderFrame(1000, () => {});
    const submitsBefore = env.mockDevice.queue.submit.mock.calls.length;

    const err = new Error('WGSL validation error');
    env.mockDevice.emit('uncapturederror', { error: err });
    expect(onGpuError).toHaveBeenCalledWith(err);
    expect(renderer.lost).toBe(true);

    renderer.requestRender();
    renderer.renderFrame(1016, () => {});
    expect(env.mockDevice.queue.submit.mock.calls.length).toBe(submitsBefore);

    renderer.dispose();
    expect(env.mockDevice.removeEventListener).toHaveBeenCalledWith(
      'uncapturederror',
      renderer._onUncapturedError,
    );
  });

  it('bakes extreme wide 1920x620 / 3000-piece board and refSheet without clipping or aspect skew', () => {
    const board = computeBoardBounds({ boardW: 8000, boardH: 2583, pieceW: 80, pieceH: 80 });
    expect(board.texW).toBeLessThanOrEqual(2048);
    expect(board.texH).toBeLessThanOrEqual(2048);
    expect(board.texW / board.worldRect.w).toBeCloseTo(board.bakeScale, 6);
    expect(board.texH / board.worldRect.h).toBeCloseTo(board.bakeScale, 6);

    const sheet = computeSheetBounds({ x: 0, y: 0, w: 3520, h: 1137 });
    expect(sheet.texW).toBeLessThanOrEqual(2048);
    expect(sheet.texH).toBeLessThanOrEqual(2048);
    expect(sheet.texW / sheet.localRect.w).toBeCloseTo(sheet.bakeScale, 6);
    expect(sheet.texH / sheet.localRect.h).toBeCloseTo(sheet.bakeScale, 6);

    const { app, renderer, env } = setupWebGPURenderer();
    app.patchSettings({ referenceMode: 'sheet' });
    app.engine.boardW = 8000;
    app.engine.boardH = 2583;
    app.engine.pieceW = 80;
    app.engine.pieceH = 80;
    app.engine.puzzleGeneration += 1;
    Object.assign(renderer.viewState.refSheet, { x: 0, y: 0, w: 3520, h: 1137 });
    renderer.requestRender();
    renderer.renderFrame(1000, () => {});
    for (const u of env.uploadedRegions) {
      expect(u.size.width).toBeLessThanOrEqual(2048);
      expect(u.size.height).toBeLessThanOrEqual(2048);
    }
  });

  it('requestWebGPUDevice reports adapter fallback or unavailability cleanly', async () => {
    const desc = Object.getOwnPropertyDescriptor(navigator, 'gpu');
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
    try {
      await expect(requestWebGPUDevice()).rejects.toThrow(/not supported/);
    } finally {
      if (desc) Object.defineProperty(navigator, 'gpu', desc);
      else delete navigator.gpu;
    }

    const fakeGpu = {
      requestAdapter: vi.fn(() =>
        Promise.resolve({
          info: { isFallbackAdapter: true },
          features: new Set(),
          requestDevice: vi.fn(() => Promise.resolve({})),
        }),
      ),
    };
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: fakeGpu });
    try {
      await expect(requestWebGPUDevice({ allowFallbackAdapter: false })).rejects.toThrow(
        /fallback/,
      );
      const ok = await requestWebGPUDevice({ allowFallbackAdapter: true });
      expect(ok.isFallbackAdapter).toBe(true);
    } finally {
      if (desc) Object.defineProperty(navigator, 'gpu', desc);
      else delete navigator.gpu;
    }
  });
});
