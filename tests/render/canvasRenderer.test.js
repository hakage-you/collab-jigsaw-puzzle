import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GameSession } from '../../src/app/gameSession.js';
import { CanvasRenderer } from '../../src/render/canvas2d/canvasRenderer.js';
import { hashCanvas, seedMathRandom } from '../helpers/determinism.js';
import { SMALL_PUZZLE, dropNearTarget, movePieceTo } from '../helpers/puzzle.js';

/**
 * Pixel-level regression tests for CanvasRenderer.renderFrame.
 * Each scenario builds a fresh session from scratch, renders one frame and hashes the canvas.
 * Only public state is touched (settings, session actions, engine piece state, view fields).
 */

const STYLE_HREFS = ['/styles/tokens.css', '/styles/base.css', '/styles/app.css'];
const STAGE_W = 800;
const STAGE_H = 600;
const RANDOM_SEED = 0x5eed;
const FRAME_TIME = 1000; // fixed `now` for renderFrame; animations are frozen by this single frame
const BASE_SETTINGS = {
  ...SMALL_PUZZLE,
  theme: 'light',
  soundEnabled: false,
  referenceMode: 'underlay',
  // A textured desk loads its image asynchronously; the grid draws the same on every frame.
  deskStyle: 'grid',
  boardStyle: 'classic',
};

let restoreDevicePixelRatio = () => {};

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

beforeAll(async () => {
  // Pin devicePixelRatio so the canvas backing-store size (and therefore the hash) is host-independent.
  const original = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 1 });
  restoreDevicePixelRatio = () => {
    if (original) Object.defineProperty(window, 'devicePixelRatio', original);
    else delete window.devicePixelRatio;
  };
  // The renderer reads palette colours from CSS custom properties, so the project styles must be present.
  document.documentElement.setAttribute('data-theme', 'light');
  await Promise.all(STYLE_HREFS.map(loadStylesheet));
});

afterAll(() => {
  restoreDevicePixelRatio();
});

function createStage() {
  const stage = document.createElement('div');
  stage.style.cssText = `position:fixed;left:0;top:0;width:${STAGE_W}px;height:${STAGE_H}px;overflow:hidden;`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `width:${STAGE_W}px;height:${STAGE_H}px;display:block;`;
  stage.appendChild(canvas);
  document.body.appendChild(stage);
  return { stage, canvas };
}

/**
 * Builds a complete scenario from scratch and renders exactly one frame.
 * @param {object} scenario
 * @param {object} [scenario.settings]  patched onto the session after construction
 * @param {Function} [scenario.prepare] mutates board/session state, receives { app, renderer }
 * @param {object} [scenario.view]      fields written onto renderer.view after fitView()
 */
async function renderScenario({ settings = {}, prepare = () => {}, view = null } = {}) {
  localStorage.clear();
  sessionStorage.clear();
  const restoreRandom = seedMathRandom(RANDOM_SEED);
  const { stage, canvas } = createStage();
  try {
    const app = new GameSession();
    app.patchSettings({ ...BASE_SETTINGS, ...settings });
    app.startNewPuzzle();

    const renderer = new CanvasRenderer({
      canvasStage: stage,
      canvas,
      engine: app.engine,
      room: app.room,
      getSettings: () => app.getSettings(),
    });

    prepare({ app, renderer });
    renderer.fitView();
    if (view) Object.assign(renderer.view, view);

    renderer.renderFrame(FRAME_TIME, () => {});
    return {
      hash: await hashCanvas(canvas),
      lodCanvases: renderer.getStats().lodCanvasCount,
    };
  } finally {
    restoreRandom();
    stage.remove();
  }
}

/** Renders the scenario twice from scratch; both hashes must match before the snapshot is compared. */
async function expectStableSnapshot(scenario) {
  const first = await renderScenario(scenario);
  const second = await renderScenario(scenario);
  expect(second.hash).toBe(first.hash);
  expect(first.hash).toMatchSnapshot();
  return first;
}

describe('CanvasRenderer pixel snapshots', () => {
  it('fresh puzzle with default underlay reference', async () => {
    await expectStableSnapshot({});
  });

  it('fresh puzzle with reference mode none', async () => {
    await expectStableSnapshot({ settings: { referenceMode: 'none' } });
  });

  it('fresh puzzle with reference sheet, view widened to include the sheet', async () => {
    // The sheet sits at its default refSheet geometry (left of the board); widen the view to show it.
    await expectStableSnapshot({
      settings: { referenceMode: 'sheet' },
      view: { x: -300, y: 0, scale: 0.5 },
    });
  });

  it('two pieces snapped and one two-piece group merged', async () => {
    await expectStableSnapshot({
      prepare: ({ app }) => {
        const e = app.engine;
        const at = (row, col) => e.pieces.find((p) => p.row === row && p.col === col);
        dropNearTarget(e, at(0, 0));
        dropNearTarget(e, at(2, 3));
        const left = at(1, 1);
        const right = at(1, 2);
        movePieceTo(e, left, right.x - e.pieceW, right.y);
        const res = e.resolveDrop(left.groupId);
        if (res.type !== 'merge') throw new Error(`expected merge, got ${res.type}`);
      },
    });
  });

  it('edges highlight filter with a hovered loose piece', async () => {
    await expectStableSnapshot({
      prepare: ({ app, renderer }) => {
        app.setHighlightFilter('edges');
        // Hover state is a plain field the pointer handler writes; there is no setter for it.
        renderer.viewState.setHoveredPiece(app.engine.pieces.find((p) => !p.isLocked));
      },
    });
  });

  it('rotation and flip enabled with rotated and flipped pieces', async () => {
    await expectStableSnapshot({
      settings: { allowRotation: true, allowFlip: true },
      prepare: ({ app }) => {
        const [a, b, c, d] = app.engine.pieces.filter((p) => !p.isLocked);
        const expectTrue = (ok, label) => {
          if (!ok) throw new Error(`${label} was rejected`);
        };
        expectTrue(app.submitRotate(a), 'rotate a');
        expectTrue(app.submitRotate(b), 'rotate b');
        expectTrue(app.submitRotate(b), 'rotate b again');
        expectTrue(app.submitFlip(c), 'flip c');
        expectTrue(app.submitRotate(d), 'rotate d');
        expectTrue(app.submitFlip(d), 'flip d');
      },
    });
  });

  it('ghost pieces active with fake pieces present', async () => {
    await expectStableSnapshot({
      prepare: ({ app, renderer }) => {
        dropNearTarget(app.engine, app.engine.pieces[0]);
        renderer.viewState.setGhostPiecesActive(true);
        // durationSec 0 means the fake pieces never expire, so no wall-clock dependency.
        app.engine.addFakePieces(3, 0, true, true);
      },
    });
  });

  it('zoomed in to 400 percent (high-resolution LOD path)', async () => {
    // The LOD path only engages on dense boards (the sprite base scale drops below ~1.2 above 48 pieces),
    // so this scenario uses a 16x12 grid. Two pieces near the centre are snapped so the zoomed viewport
    // contains locked pieces as well as loose ones.
    const result = await expectStableSnapshot({
      settings: { cols: 16, rows: 12 },
      prepare: ({ app }) => {
        const e = app.engine;
        dropNearTarget(
          e,
          e.pieces.find((p) => p.row === 5 && p.col === 7),
        );
        dropNearTarget(
          e,
          e.pieces.find((p) => p.row === 6 && p.col === 8),
        );
      },
      view: { x: 0, y: 0, scale: 4 },
    });
    expect(result.lodCanvases).toBeGreaterThan(0);
  });
});
