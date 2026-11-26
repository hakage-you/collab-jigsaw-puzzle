import { describe, expect, it } from 'vitest';
import { PUZZLE_CONFIG } from '../../src/config/constants.js';
import { scatterBand } from '../../src/core/pieceFactory.js';
import {
  createEngine,
  createFakeImage,
  dropNearTarget,
  movePieceTo,
} from '../helpers/coreEngine.js';

// The pieces of a new or restored puzzle. Where exactly a new puzzle scatters its pieces is visual
// tuning; checked here is only that they lie around the board, on every side.

/** The engine's state as a save file, after a JSON round trip. */
const saveOf = (engine) => JSON.parse(JSON.stringify(engine.exportSaveData({})));

/** A fresh engine restored from `save`. */
function restore(save) {
  const engine = createEngine();
  engine.restoreFromSave(save, createFakeImage(), true);
  return engine;
}

describe('a new puzzle', () => {
  it('numbers the pieces row by row and marks the border pieces', () => {
    const engine = createEngine({ cols: 5, rows: 4 });
    engine.pieces.forEach((p, i) => {
      expect([p.id, p.row, p.col]).toEqual([i, Math.floor(i / 5), i % 5]);
      expect(p.isEdge).toBe(p.row === 0 || p.row === 3 || p.col === 0 || p.col === 4);
    });
  });

  it('targets the centre of each grid cell', () => {
    const engine = createEngine({ cols: 5, rows: 4 });
    for (const p of engine.pieces) {
      expect(p.targetX).toBeCloseTo(-engine.boardW / 2 + (p.col + 0.5) * engine.pieceW);
      expect(p.targetY).toBeCloseTo(-engine.boardH / 2 + (p.row + 0.5) * engine.pieceH);
    }
  });

  it('starts every piece around the board, none over it', () => {
    const engine = createEngine({ cols: 8, rows: 6 });
    const off = engine.pieces.filter(
      (p) =>
        Math.abs(p.x) < engine.boardW / 2 + engine.pieceW / 2 &&
        Math.abs(p.y) < engine.boardH / 2 + engine.pieceH / 2,
    );
    expect(off).toEqual([]);
  });

  it('spreads the pieces over all four sides, in no particular order', () => {
    const engine = createEngine({ cols: 8, rows: 6 });
    const w = engine.boardW / 2;
    const h = engine.boardH / 2;
    const sideOf = (p) => {
      if (p.y < -h && Math.abs(p.x) < w) return 'top';
      if (p.y > h && Math.abs(p.x) < w) return 'bottom';
      if (p.x < -w && Math.abs(p.y) < h) return 'left';
      if (p.x > w && Math.abs(p.y) < h) return 'right';
      return 'corner';
    };
    const sides = engine.pieces.map(sideOf);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(sides.filter((s) => s === side).length, side).toBeGreaterThan(4);
    }
    // Shuffled: not one side after another in piece order.
    expect(sides.slice(0, 4)).not.toEqual(['top', 'right', 'bottom', 'left']);
  });

  it('gives each piece its own group and stacks them in piece order', () => {
    const engine = createEngine();
    engine.pieces.forEach((p, i) => {
      expect(p.groupId).toBe(i + 1);
      expect(p.isLocked).toBe(false);
    });
    const zs = engine.pieces.map((p) => p.zOrder);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
    expect(new Set(zs).size).toBe(zs.length);
    expect(engine.nextGroupId).toBe(engine.pieces.length + 1);
    expect(engine.maxZ).toBeGreaterThan(Math.max(...zs));
  });

  it('starts every piece upright and face up when turning and flipping are off', () => {
    const engine = createEngine({ cols: 8, rows: 6 });
    expect(new Set(engine.pieces.map((p) => p.rotation))).toEqual(new Set([0]));
    expect(new Set(engine.pieces.map((p) => p.isFlipped))).toEqual(new Set([false]));
  });

  it('turns pieces every way when turning is on', () => {
    const engine = createEngine({ cols: 8, rows: 6, allowRotation: true });
    expect(new Set(engine.pieces.map((p) => p.rotation))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('flips about a third of the pieces when flipping is on', () => {
    const engine = createEngine({ cols: 10, rows: 8, allowFlip: true });
    const flipped = engine.pieces.filter((p) => p.isFlipped).length / engine.pieces.length;
    expect(flipped).toBeGreaterThan(PUZZLE_CONFIG.FLIP_INITIAL_PROB - 0.15);
    expect(flipped).toBeLessThan(PUZZLE_CONFIG.FLIP_INITIAL_PROB + 0.15);
  });
});

describe('scatterBand', () => {
  it('keeps the band clear of the board', () => {
    const engine = createEngine({ cols: 10, rows: 10 });
    const band = scatterBand(engine);
    expect(band.marginX).toBeGreaterThan(engine.boardW / 2 + engine.pieceW / 2);
    expect(band.marginY).toBeGreaterThan(engine.boardH / 2 + engine.pieceH / 2);
  });

  it('widens with the piece count, between a minimum and a cap', () => {
    const engine = createEngine({ cols: 10, rows: 10 });
    expect(scatterBand(engine)).toEqual(scatterBand(engine, 100));
    const least = scatterBand(engine, 1);
    expect(scatterBand(engine, 2)).toEqual(least);
    const most = scatterBand(engine, 1e6);
    expect(scatterBand(engine, 2e6)).toEqual(most);
    expect(most.bandW).toBeGreaterThan(least.bandW);
    expect(most.bandH).toBeGreaterThan(least.bandH);
    const some = scatterBand(engine, 100);
    expect(some.bandH).toBeGreaterThan(least.bandH);
    expect(some.bandH).toBeLessThan(most.bandH);
  });
});

describe('restoring a save', () => {
  /** An engine with turned, flipped, grouped and placed pieces. */
  function playedEngine() {
    const engine = createEngine({ cols: 5, rows: 4, allowRotation: true, allowFlip: true });
    const [a, b, c] = engine.pieces;
    a.rotation = 1;
    a.isFlipped = true;
    b.groupId = a.groupId;
    movePieceTo(engine, a, 30, -500);
    dropNearTarget(engine, c);
    return engine;
  }

  const state = (engine) =>
    engine.pieces.map((p) => ({
      id: p.id,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      rotation: p.rotation,
      isFlipped: p.isFlipped,
      isLocked: p.isLocked,
      groupId: p.groupId,
    }));

  it('restores positions, turns, flips, groups and placed pieces', () => {
    const engine = playedEngine();
    expect(state(restore(saveOf(engine)))).toEqual(state(engine));
  });

  it('reads any saved turn as 0 to 3 quarter turns', () => {
    const save = saveOf(createEngine());
    save.pieces[0].rotation = 5;
    save.pieces[1].rotation = -1;
    const [first, second] = restore(save).pieces;
    expect([first.rotation, second.rotation]).toEqual([1, 3]);
  });

  it('puts placed pieces exactly on their target', () => {
    const save = saveOf(createEngine());
    Object.assign(save.pieces[0], { isLocked: true, x: 1, y: 2 });
    const [piece] = restore(save).pieces;
    expect([piece.x, piece.y]).toEqual([piece.targetX, piece.targetY]);
  });

  it('stacks placed pieces at the bottom and keeps new groups and moves above the restored ones', () => {
    const save = saveOf(playedEngine());
    save.pieces[4].groupId = 50;
    const engine = restore(save);
    const placed = engine.pieces.filter((p) => p.isLocked);
    expect(placed.map((p) => p.zOrder)).toEqual(placed.map(() => 0));
    const loose = engine.pieces.filter((p) => !p.isLocked);
    const zs = loose.map((p) => p.zOrder);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
    expect(engine.nextGroupId).toBe(51);

    const top = loose[0];
    engine.bringGroupToFront(top.groupId);
    expect(loose.filter((p) => p.groupId !== top.groupId).every((p) => p.zOrder < top.zOrder)).toBe(
      true,
    );
  });

  it('scales loose pieces onto a board of another size', () => {
    const original = createEngine();
    const save = saveOf(original);
    save.puzzle.boardW /= 2;
    save.puzzle.boardH /= 4;
    Object.assign(save.pieces[1], { isLocked: true });
    const engine = restore(save);
    const [loose, placed] = engine.pieces;
    expect(loose.x).toBeCloseTo(save.pieces[0].x * 2, 1);
    expect(loose.y).toBeCloseTo(save.pieces[0].y * 4, 1);
    expect([placed.x, placed.y]).toEqual([placed.targetX, placed.targetY]);
  });

  it('uses the old fixed board size for saves without a board size', () => {
    const save = saveOf(createEngine());
    delete save.puzzle.boardW;
    delete save.puzzle.boardH;
    const engine = restore(save);
    // The old board fitted the image into BOARD_MAX_WIDTH x BOARD_MAX_HEIGHT.
    const fit = Math.min(
      PUZZLE_CONFIG.BOARD_MAX_WIDTH / save.puzzle.imageWidth,
      PUZZLE_CONFIG.BOARD_MAX_HEIGHT / save.puzzle.imageHeight,
    );
    const oldW = Math.round(save.puzzle.imageWidth * fit);
    const oldH = Math.round(save.puzzle.imageHeight * fit);
    expect(engine.pieces[0].x).toBeCloseTo((save.pieces[0].x * engine.boardW) / oldW, 1);
    expect(engine.pieces[0].y).toBeCloseTo((save.pieces[0].y * engine.boardH) / oldH, 1);

    // Without the image size either, the current image's size stands in for it.
    delete save.puzzle.imageWidth;
    delete save.puzzle.imageHeight;
    expect(restore(save).pieces[0].x).toBeCloseTo(engine.pieces[0].x, 6);
  });

  it('restores the stats, counting missing or broken counters as 0', () => {
    const save = saveOf(createEngine());
    save.stats = { placedCount: 3, elapsedMs: 'x', ojamaBreakdown: { heavy: 2 } };
    expect(restore(save).stats).toEqual({
      elapsedMs: 0,
      placedCount: 3,
      ojamaTotal: 0,
      ojamaBreakdown: { drop: 0, visual: 0, superchat: 0, prank: 0, fake: 0, heavy: 2, runaway: 0 },
    });
    delete save.stats;
    expect(restore(save).stats.ojamaBreakdown.heavy).toBe(0);
  });

  it('takes the cut from the save, or from its settings for old saves', () => {
    const save = saveOf(createEngine({ cutComplexity: 'complex' }));
    expect(restore(save).cutComplexity).toBe('complex');
    delete save.puzzle.cutComplexity;
    save.settings = { cutComplexity: 'uniform' };
    expect(restore(save).cutComplexity).toBe('uniform');
  });
});
