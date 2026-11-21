import { afterEach, describe, expect, it } from 'vitest';
import { CanvasRenderer } from '../../src/render/canvas2d/canvasRenderer.js';
import { createEngine } from '../helpers/puzzle.js';

// The table (pieces) and the effects layer (cursors, flashes, confetti) are separate canvases:
// things that move on their own must not force every piece to be redrawn.

const stages = [];
afterEach(() => {
  for (const s of stages.splice(0)) s.remove();
});

/** A stand-in for RoomController with one remote cursor; `moved` controls what moved. */
function fakeRoom(moved) {
  return {
    moved,
    remoteCursors: new Map([['p2', { x: 0, y: 0, name: 'B', color: '#c62828' }]]),
    groupLocks: new Map(),
    myPlayerId: 'host',
    isMultiplayer: () => true,
    getPlayerMeta: () => null,
    stepInterpolation() {
      return this.moved;
    },
  };
}

function setup(room = null) {
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
    room,
    getSettings: () => ({ referenceMode: 'none', theme: 'light' }),
  });
  renderer.fitView();
  let tableDraws = 0;
  const original = renderer.ctx.clearRect.bind(renderer.ctx);
  renderer.ctx.clearRect = (...args) => {
    tableDraws++;
    return original(...args);
  };
  return { renderer, engine, tableDraws: () => tableDraws };
}

describe('table and effects layers', () => {
  it('a moving remote cursor redraws only the effects layer', () => {
    const room = fakeRoom({ cursorsMoved: false, piecesMoved: false });
    const { renderer, tableDraws } = setup(room);
    renderer.renderFrame(1000, () => {});
    expect(tableDraws()).toBe(1);

    room.moved = { cursorsMoved: true, piecesMoved: false };
    for (let i = 1; i <= 5; i++) renderer.renderFrame(1000 + i * 16, () => {});
    expect(tableDraws()).toBe(1);

    room.moved = { cursorsMoved: false, piecesMoved: true };
    renderer.renderFrame(1200, () => {});
    expect(tableDraws()).toBe(2);
  });

  it('confetti and snap flashes play without redrawing the table, then clear', () => {
    const { renderer, engine, tableDraws } = setup();
    renderer.renderFrame(1000, () => {});
    const vs = renderer.viewState;
    vs.addSnapFlashes([engine.pieces[0]]);
    renderer.launchConfetti();
    for (let i = 1; i <= 600 && vs.hasEffects; i++) renderer.renderFrame(1000 + i * 16, () => {});
    expect(vs.hasEffects).toBe(false);
    expect(tableDraws()).toBe(1);
  });

  it('effects move at the same speed on 60 Hz and 144 Hz screens', () => {
    const positionsAfterOneSecond = [60, 144].map((hz) => {
      const { renderer } = setup();
      renderer.renderFrame(1000, () => {});
      renderer.viewState.launchConfetti();
      for (let i = 1; i <= hz; i++) renderer.renderFrame(1000 + (i * 1000) / hz, () => {});
      return Math.max(...renderer.viewState.particles.map((p) => p.age));
    });
    // The first wave has played one second, whatever the screen's refresh rate.
    expect(positionsAfterOneSecond[0]).toBeCloseTo(1, 1);
    expect(positionsAfterOneSecond[1]).toBeCloseTo(1, 1);
  });
});

describe('ViewState camera', () => {
  it('zooming keeps the world point under the pointer in place', () => {
    const { renderer } = setup();
    const vs = renderer.viewState;
    const before = vs.screenToWorld(120, 80);
    vs.zoomAt(120, 80, 2.5);
    const after = vs.screenToWorld(120, 80);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('screenToWorld and worldToScreen are inverse, and panning moves the view by the drag', () => {
    const { renderer } = setup();
    const vs = renderer.viewState;
    const w = vs.screenToWorld(33, 44);
    const s = vs.worldToScreen(w.x, w.y);
    expect(s.x).toBeCloseTo(33, 6);
    expect(s.y).toBeCloseTo(44, 6);
    vs.panBy(10, -20);
    const moved = vs.worldToScreen(w.x, w.y);
    expect(moved.x).toBeCloseTo(43, 6);
    expect(moved.y).toBeCloseTo(24, 6);
  });

  it('hover is kept by piece id and survives only while the piece exists', () => {
    const { renderer, engine } = setup();
    const vs = renderer.viewState;
    expect(vs.setHoveredPiece(engine.pieces[1])).toBe(true);
    expect(vs.setHoveredPiece(engine.pieces[1])).toBe(false);
    expect(vs.hoveredPiece).toBe(engine.pieces[1]);
    vs.resetForNewPuzzle();
    expect(vs.hoveredPiece).toBeNull();
  });
});
