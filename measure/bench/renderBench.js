/**
 * Render bench page logic (measure/bench/render.html). Not part of the game.
 * Builds a seeded puzzle, runs each scene for a few seconds with requestAnimationFrame and
 * records the real frame interval (what the player sees) and the JS work per frame.
 * See _plan/20261121_1014_webgl_comparison.md section 5 and 6.
 */
import { GameSession } from '../../src/app/gameSession.js';
import { PUZZLE_CONFIG, STORAGE_KEYS } from '../../src/config/constants.js';
import { computeGridForPieceCount } from '../../src/core/jigsawPath.js';
import { mulberry32 } from '../../src/core/prng.js';
import { CanvasRenderer } from '../../src/ui/canvasRenderer.js';
import { seedMathRandom } from '../../tests/helpers/determinism.js';
import { EffectsOverlay, MinimalCanvas2DPieces } from './benchLayers.js';
import { SCENES } from './benchScenes.js';
import { WebGL2PiecePrototype } from './webgl2Prototype.js';

const WARMUP_FRAMES = 30;
const MEASURE_MS = 3000;
const MODES = {
  app: 'ゲーム本体の Canvas 2D 描画（盤面・縁取りを含む）',
  c2d: 'Canvas 2D 最小版（ピースだけ）',
  webgl2: 'WebGL2 試作（ピースだけ）',
};

const nextFrame = () =>
  new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function percentile(values, p) {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
}

const round = (v) => Math.round(v * 10) / 10;

/** Pins window.devicePixelRatio (the game renderer reads it every frame). Returns a restore fn. */
function pinDevicePixelRatio(value) {
  const original = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => value });
  return () => {
    if (original) Object.defineProperty(window, 'devicePixelRatio', original);
    else delete window.devicePixelRatio;
  };
}

/** Builds the seeded puzzle without leaving bench settings in the player's saved settings. */
function buildPuzzle(pieceCount) {
  const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
  const restoreRandom = seedMathRandom(0x5eed);
  try {
    const { SAMPLE_IMAGE_WIDTH: w, SAMPLE_IMAGE_HEIGHT: h } = PUZZLE_CONFIG;
    const { cols, rows } = computeGridForPieceCount(pieceCount, w, h);
    const app = new GameSession();
    app.patchSettings({ cols, rows, seed: 12345, allowRotation: true, allowFlip: true });
    app.startNewPuzzle();
    return app;
  } finally {
    restoreRandom();
    if (savedSettings === null) localStorage.removeItem(STORAGE_KEYS.SETTINGS);
    else localStorage.setItem(STORAGE_KEYS.SETTINGS, savedSettings);
  }
}

/** Fresh canvases for one mode: the piece layer (id puzzleCanvas for the CSS filters) + effects. */
function freshCanvases(stage) {
  stage.replaceChildren();
  const pieceCanvas = document.createElement('canvas');
  pieceCanvas.id = 'puzzleCanvas';
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.className = 'bench-overlay';
  stage.append(pieceCanvas, overlayCanvas);
  return { pieceCanvas, overlayCanvas };
}

/** Creates the piece layer for a mode. Returns { render(now), view, gpuName }. */
function createPieceLayer(mode, { app, stage, pieceCanvas }) {
  // fitView measures its canvas, so a stand-in canvas must sit in the stage while fitting
  // (the WebGL2 piece canvas cannot also get a 2D context).
  const fitCanvas = mode === 'app' ? pieceCanvas : document.createElement('canvas');
  if (fitCanvas !== pieceCanvas) stage.appendChild(fitCanvas);
  const fitter = new CanvasRenderer({
    canvasStage: stage,
    canvas: fitCanvas,
    engine: app.engine,
    room: app.room,
    getSettings: () => app.getSettings(),
  });
  fitter.fitView();
  if (fitCanvas !== pieceCanvas) fitCanvas.remove();
  const view = fitter.view;
  const css = () => stage.getBoundingClientRect();
  if (mode === 'app') {
    return {
      view,
      setDragging: (gid) => {
        fitter.draggingGroupId = gid;
      },
      render: (now) => {
        fitter.requestRender();
        fitter.renderFrame(now, () => {});
      },
    };
  }
  const layer =
    mode === 'webgl2'
      ? new WebGL2PiecePrototype(pieceCanvas, app.engine)
      : new MinimalCanvas2DPieces(pieceCanvas, app.engine);
  return {
    view,
    setDragging: () => {},
    gpuName: layer.gpuName?.(),
    render: () => {
      const r = css();
      layer.render(view, r.width, r.height, window.devicePixelRatio);
    },
  };
}

function sceneState(app, layer, overlay, pieceCanvas, stage) {
  return {
    engine: app.engine,
    view: layer.view,
    overlay,
    pieceCanvas,
    setDragging: layer.setDragging,
    rng: mulberry32(42),
    worldToScreen(x, y) {
      const r = stage.getBoundingClientRect();
      const v = layer.view;
      return { x: (x - v.x) * v.scale + r.width / 2, y: (y - v.y) * v.scale + r.height / 2 };
    },
  };
}

/** Runs one scene and returns its frame statistics. */
async function runScene(scene, ctx) {
  const { layer, overlay, stage, refreshMs } = ctx;
  const s = sceneState(ctx.app, layer, overlay, ctx.pieceCanvas, stage);
  scene.setup(s);
  const intervals = [];
  const work = [];
  const start = performance.now();
  let last = start;
  for (let frame = 0; ; frame++) {
    const now = await nextFrame();
    const t0 = performance.now();
    const tSec = (now - start) / 1000;
    scene.step(s, tSec, Math.min(0.1, (now - last) / 1000));
    layer.render(now);
    if (overlay.active) {
      const r = stage.getBoundingClientRect();
      overlay.render((now - last) / 1000, r.width, r.height, window.devicePixelRatio);
    }
    if (frame >= WARMUP_FRAMES) {
      intervals.push(now - last);
      work.push(performance.now() - t0);
    }
    last = now;
    if (frame >= WARMUP_FRAMES && now - start > MEASURE_MS) break;
  }
  overlay.clear();
  ctx.pieceCanvas.classList.remove('sabotage-hue');
  return {
    scene: scene.id,
    frameMsMedian: round(median(intervals)),
    frameMsP95: round(percentile(intervals, 95)),
    droppedPct: round(
      (intervals.filter((v) => v > refreshMs * 1.5).length / intervals.length) * 100,
    ),
    workMsMedian: round(median(work)),
    workMsP95: round(percentile(work, 95)),
  };
}

/** Median requestAnimationFrame interval with nothing drawn: the display's refresh period. */
async function measureRefresh() {
  const intervals = [];
  let last = await nextFrame();
  for (let i = 0; i < 60; i++) {
    const now = await nextFrame();
    intervals.push(now - last);
    last = now;
  }
  return median(intervals);
}

/** Runs every scene for one mode. `onProgress(text)` reports what is running. */
export async function runMode({ mode, pieceCount, dpr, stage, refreshMs, onProgress }) {
  const restoreDpr = pinDevicePixelRatio(dpr);
  try {
    const app = buildPuzzle(pieceCount);
    const { pieceCanvas, overlayCanvas } = freshCanvases(stage);
    const layer = createPieceLayer(mode, { app, stage, pieceCanvas });
    const overlay = new EffectsOverlay(overlayCanvas);
    const ctx = { app, layer, overlay, stage, refreshMs, pieceCanvas };
    const results = [];
    for (const scene of SCENES) {
      onProgress(`${MODES[mode]}: ${scene.label}`);
      results.push({
        mode,
        pieces: app.engine.pieces.length,
        dpr,
        ...(await runScene(scene, ctx)),
      });
    }
    return { results, gpuName: layer.gpuName ?? null };
  } finally {
    restoreDpr();
  }
}

export { MODES, SCENES, measureRefresh };
