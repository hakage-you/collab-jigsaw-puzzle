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

  it('a prank turns an arrow the way each group turned, or turns it over where a piece was flipped', () => {
    const { engine, vs } = setup();
    const [a, b, c] = engine.pieces;
    const before = new Map(
      [a, b, c].map((p) => [p.id, { rotation: p.rotation, isFlipped: p.isFlipped }]),
    );
    a.rotation = (a.rotation + 1) % 4; // a quarter turn clockwise
    b.rotation = (b.rotation + 3) % 4; // three quarters clockwise: shown as a quarter anticlockwise
    c.isFlipped = !c.isFlipped;
    vs.playPrankEffect([a, b, c], before);
    const got = vs.particles.map(
      (p) => `${p.name}@${p.x},${p.y}${p.name === 'prankTurn' ? ` ${p.dir}` : ''}`,
    );
    expect(new Set(got)).toEqual(
      new Set([
        `prankTurn@${a.x},${a.y} 1`,
        `prankTurn@${b.x},${b.y} -1`,
        `prankFlip@${c.x},${c.y}`,
      ]),
    );
  });

  it('hitting and driving off the superchat card play on the top layer, over the card', () => {
    const { renderer, vs } = setup();
    const stage = renderer.canvasStage;
    const top = renderer.topEffects.canvas;
    // The superchat card is part of the stage; the top layer comes after it, so it is drawn over.
    expect(top.parentElement).toBe(stage);
    expect(stage.lastElementChild).toBe(top);

    vs.playSuperchatHit(100, 80);
    vs.playSuperchatDefeat(200, 150);
    expect(vs.particles).toHaveLength(0);
    expect(new Set(vs.overlayParticles.map((p) => `${p.name}@${p.x},${p.y} ${p.screen}`))).toEqual(
      new Set([
        'superchatHit@100,80 true',
        'superchatBurstPuff@200,150 true',
        'superchatBurstStars@200,150 true',
      ]),
    );

    for (const now of [1000, 1100, 1116]) renderer.renderFrame(now, () => {});
    const dpr = top.width / 400;
    const box = top
      .getContext('2d')
      .getImageData(
        Math.round(70 * dpr),
        Math.round(50 * dpr),
        Math.round(60 * dpr),
        Math.round(60 * dpr),
      );
    expect(box.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
  });

  it('confetti falls in waves, and a struggling PC skips the later waves but keeps the first', () => {
    const play = (frameMs) => {
      const { renderer, vs } = setup();
      renderer.renderFrame(1000, () => {});
      vs.launchConfetti();
      const all = vs.particles.length;
      let now = 1000;
      for (const ms of frameMs) renderer.renderFrame((now += ms), () => {});
      return { all, left: vs.particles.length };
    };
    const smooth = play([16, 16, 16, 16]);
    const hiccup = play([16, 90, 16, 16]);
    const struggling = play([90, 90, 90, 16]);
    expect(smooth.left).toBe(smooth.all);
    expect(hiccup.left).toBe(hiccup.all);
    expect(struggling.left).toBeGreaterThan(0);
    expect(struggling.left).toBeLessThan(struggling.all / 2);
  });
});
