/**
 * End-user device load: puzzle startup and canvas frame cost in headless Chromium.
 * Seeded puzzles, 800x600 canvas, devicePixelRatio pinned to 1, project CSS loaded.
 * Output: measure/.latest/client.json
 *
 * Numbers are from headless Chromium on this machine. Use them to compare versions, not as
 * absolute device performance.
 */
import { it } from 'vitest';
import { GameSession } from '../src/app/gameSession.js';
import { CanvasRenderer } from '../src/render/canvas2d/canvasRenderer.js';
import { PUZZLE_CONFIG } from '../src/config/constants.js';
import { computeGridForPieceCount } from '../src/core/jigsawPath.js';
import { seedMathRandom } from '../tests/helpers/determinism.js';
import { median, percentile, round, writeResult } from './measureUtils.js';

const NOTE =
  'Numbers are from headless Chromium on this machine (no GPU guarantees, no real device); use them ' +
  'to compare versions, not as absolute performance. startupMs = GameSession.startNewPuzzle() ' +
  '(engine.initPuzzle plus session setup) on a seeded sample image. frame ms = wall time of one ' +
  'renderFrame call with requestRender() before it, so each call redraws; canvas 2D work may be ' +
  'partly deferred by the browser and not fully visible in this time. 120 frames per case, ' +
  'with now advancing 1000/60 ms per frame. Heap numbers come from performance.memory when ' +
  'available (Chromium, coarse, includes garbage not yet collected). Chromium quantizes ' +
  'performance.memory, so small heap deltas read as 0; treat heap numbers as indicative only. ' +
  'Frame ms that read 0 are real: those frames drew little (see firstFrameMs for the build cost).';

const STYLE_HREFS = ['/styles/tokens.css', '/styles/base.css', '/styles/app.css'];
const STAGE_W = 800;
const STAGE_H = 600;
const FRAMES = 120;
const FRAME_STEP_MS = 1000 / 60;
const RANDOM_SEED = 0x5eed;
const SAMPLE_W = PUZZLE_CONFIG.SAMPLE_IMAGE_WIDTH;
const SAMPLE_H = PUZZLE_CONFIG.SAMPLE_IMAGE_HEIGHT;
const BASE_SETTINGS = {
  seed: 12345,
  cutComplexity: 'standard',
  allowRotation: false,
  allowFlip: false,
  theme: 'light',
  soundEnabled: false,
  referenceMode: 'underlay',
};
const CASES = [
  { label: 'small (about 9 pieces)', pieces: 9 },
  { label: 'about 500 pieces', pieces: 500 },
  { label: 'about 3000 pieces', pieces: 3000 },
  { label: 'about 3000 pieces, zoom 400%', pieces: 3000, zoomScale: 4 },
];

function loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = resolve;
    link.onerror = () => reject(new Error(`failed to load ${href}`));
    document.head.appendChild(link);
  });
}

/** Pins devicePixelRatio to 1 so the backing store is host-independent. Returns a restore function. */
function pinDevicePixelRatio() {
  const original = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 1 });
  return () => {
    if (original) Object.defineProperty(window, 'devicePixelRatio', original);
    else delete window.devicePixelRatio;
  };
}

function createStage() {
  const stage = document.createElement('div');
  stage.style.cssText = `position:fixed;left:0;top:0;width:${STAGE_W}px;height:${STAGE_H}px;overflow:hidden;`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `width:${STAGE_W}px;height:${STAGE_H}px;display:block;`;
  stage.appendChild(canvas);
  document.body.appendChild(stage);
  return { stage, canvas };
}

/** Used JS heap in MB, or null where performance.memory is not exposed. */
function usedHeapMB() {
  const bytes = performance.memory?.usedJSHeapSize;
  return Number.isFinite(bytes) ? round(bytes / 1048576, 2) : null;
}

function runCase({ label, pieces, zoomScale = null }) {
  localStorage.clear();
  sessionStorage.clear();
  const { cols, rows } = computeGridForPieceCount(pieces, SAMPLE_W, SAMPLE_H);
  const restoreRandom = seedMathRandom(RANDOM_SEED);
  const { stage, canvas } = createStage();
  const heapBefore = usedHeapMB();
  try {
    const app = new GameSession();
    app.patchSettings({ ...BASE_SETTINGS, cols, rows });

    const startupStart = performance.now();
    app.startNewPuzzle();
    const startupMs = performance.now() - startupStart;

    const renderer = new CanvasRenderer({
      canvasStage: stage,
      canvas,
      engine: app.engine,
      room: app.room,
      getSettings: () => app.getSettings(),
    });
    renderer.fitView();
    if (zoomScale) Object.assign(renderer.view, { x: 0, y: 0, scale: zoomScale });
    const heapAfterSetup = usedHeapMB();

    const frameMs = [];
    let now = 1000;
    for (let i = 0; i < FRAMES; i += 1) {
      now += FRAME_STEP_MS;
      renderer.requestRender();
      const t = performance.now();
      renderer.renderFrame(now, () => {});
      frameMs.push(performance.now() - t);
    }
    const heapAfterFrames = usedHeapMB();

    return {
      label,
      grid: `${cols}x${rows}`,
      pieces: app.engine.pieces.length,
      viewScale: round(renderer.view.scale, 3),
      startupMs: round(startupMs, 1),
      frames: FRAMES,
      firstFrameMs: round(frameMs[0], 2),
      medianFrameMs: round(median(frameMs), 2),
      p95FrameMs: round(percentile(frameMs, 95), 2),
      maxFrameMs: round(Math.max(...frameMs), 2),
      heapMB: {
        before: heapBefore,
        afterSetup: heapAfterSetup,
        afterFrames: heapAfterFrames,
        deltaFromBefore:
          heapBefore !== null && heapAfterFrames !== null
            ? round(heapAfterFrames - heapBefore, 2)
            : null,
      },
    };
  } finally {
    restoreRandom();
    stage.remove();
  }
}

function summaryLine(r) {
  const heap =
    r.heapMB.deltaFromBefore === null
      ? 'heap n/a'
      : `heap ${r.heapMB.deltaFromBefore >= 0 ? '+' : ''}${r.heapMB.deltaFromBefore} MB after frames`;
  return (
    `${r.label} (${r.pieces} pcs, view ${r.viewScale}x): startup ${r.startupMs} ms; ` +
    `frame median ${r.medianFrameMs} ms, p95 ${r.p95FrameMs} ms (${r.frames} frames, 800x600, DPR 1); ${heap}`
  );
}

it('client startup and frame cost for 9, 500, 3000 pieces and a 400% zoom', async () => {
  const restoreDpr = pinDevicePixelRatio();
  try {
    document.documentElement.setAttribute('data-theme', 'light');
    await Promise.all(STYLE_HREFS.map(loadStylesheet));
    const cases = [];
    for (const c of CASES) {
      cases.push(runCase(c));
    }
    await writeResult({
      system: 'client',
      note: NOTE,
      summary: cases.map(summaryLine),
      details: { canvas: `${STAGE_W}x${STAGE_H}`, devicePixelRatio: 1, frames: FRAMES, cases },
    });
  } finally {
    restoreDpr();
  }
}, 120000);
