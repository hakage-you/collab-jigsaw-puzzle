import { afterEach, describe, expect, it } from 'vitest';
import { CanvasRenderer } from '../../src/render/canvas2d/canvasRenderer.js';
import { seedMathRandom } from '../helpers/determinism.js';
import { createEngine } from '../helpers/puzzle.js';

// Game events that play stamp effects (src/render/effects): where and when they start.

const stages = [];
afterEach(() => {
  for (const s of stages.splice(0)) s.remove();
});

function setup() {
  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px;';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:400px;height:300px;display:block;';
  stage.appendChild(canvas);
  document.body.appendChild(stage);
  stages.push(stage);
  const engine = createEngine();
  const renderer = new CanvasRenderer({
    canvasStage: stage,
    canvas,
    engine,
    room: null,
    getSettings: () => ({ referenceMode: 'none', theme: 'light' }),
  });
  renderer.fitView();
  return { renderer, engine, vs: renderer.viewState };
}

function addFakes(engine, n) {
  const restore = seedMathRandom(3);
  engine.addFakePieces(n, 0, false, false);
  restore();
  return engine.fakePieces;
}

describe('effect triggers', () => {
  it('a fake piece that expires vanishes in a puff of smoke where it was', () => {
    const { renderer, engine, vs } = setup();
    const [gone, stays] = addFakes(engine, 2);
    renderer.renderFrame(1000, () => {});
    expect(vs.particles).toHaveLength(0);

    gone.expiresAt = Date.now() - 1;
    stays.expiresAt = Date.now() + 60_000;
    renderer.renderFrame(1016, () => {});
    expect(engine.fakePieces).toEqual([stays]);
    expect(vs.particles.length).toBeGreaterThan(0);
    expect(new Set(vs.particles.map((p) => `${p.name}@${p.x},${p.y}`))).toEqual(
      new Set([`smokePuff@${gone.x},${gone.y}`]),
    );
  });

  it('starting a new puzzle does not puff the old fake pieces', () => {
    const { renderer, engine, vs } = setup();
    addFakes(engine, 2);
    renderer.renderFrame(1000, () => {});
    engine.clearFakePieces();
    vs.resetForNewPuzzle({ clearEffects: true });
    renderer.renderFrame(1016, () => {});
    expect(vs.particles).toHaveLength(0);
  });

  it('pieces knocked off the board puff at their board spot and where they landed', () => {
    const { engine, vs } = setup();
    const [p] = engine.pieces;
    Object.assign(p, { x: p.targetX + 120, y: p.targetY - 40 });
    vs.playDropEffect([p]);
    const spots = new Set(vs.particles.map((q) => `${q.name}@${q.x},${q.y}`));
    expect(spots).toEqual(
      new Set([`smokePuff@${p.targetX},${p.targetY}`, `smallPuff@${p.x},${p.y}`]),
    );
  });
});
