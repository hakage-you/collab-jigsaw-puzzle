import { describe, expect, it } from 'vitest';
import { OJAMA_CONFIG } from '../../src/config/constants.js';
import { PieceMotion } from '../../src/render/effects/pieceMotion.js';

// Runaway hops, their kick-off lines and the opening deal: the shape of each motion (where it starts
// and ends, symmetry, order). The timing and size constants are visual tuning and not pinned here.

const HOP_MS = OJAMA_CONFIG.RUNAWAY_HOP_SEC * 1000;

/** Pieces on a 3 x 2 grid, 120 apart, each in its own group. */
function fakeEngine(count = 6) {
  const pieces = Array.from({ length: count }, (_, id) => ({
    id,
    groupId: id,
    x: (id % 3) * 120,
    y: Math.floor(id / 3) * 120,
    isLocked: false,
  }));
  return {
    pieces,
    pieceW: 100,
    pieceH: 80,
    getGroupPieces: (gid) => pieces.filter((p) => p.groupId === gid),
  };
}

/** A piece that hopped from (0, 0) to (300, 400). */
function hopped() {
  const engine = fakeEngine(1);
  Object.assign(engine.pieces[0], { x: 300, y: 400 });
  const motion = new PieceMotion();
  motion.playHop(engine.pieces, new Map([[0, { x: 0, y: 0 }]]), 1000);
  return { engine, motion };
}

describe('PieceMotion: hops', () => {
  it('draws the piece back at its old spot first, without lift', () => {
    const { engine, motion } = hopped();
    expect(motion.step(1000, engine, 0)).toBe(true);
    expect(motion.offsets.get(0)).toEqual({ dx: -300, dy: -400, lift: 0 });
  });

  it('lifts the piece most halfway, on the way to where it landed', () => {
    const { engine, motion } = hopped();
    const at = (u) => {
      motion.step(1000 + HOP_MS * u, engine, 0);
      return motion.offsets.get(0);
    };
    const quarter = at(0.25);
    const half = at(0.5);
    const threeQuarters = at(0.75);
    expect(half.lift).toBeGreaterThan(quarter.lift);
    expect(quarter.lift).toBeCloseTo(threeQuarters.lift);
    // Eased: as far from the start at 3/4 as from the end at 1/4.
    expect(quarter.dx + threeQuarters.dx).toBeCloseTo(-300);
    expect(quarter.dx).toBeLessThan(-150);
    expect(half.dx).toBeCloseTo(-150);
    expect(half.dy).toBeCloseTo(-200 - half.lift);
  });

  it('ends after the hop time and leaves the piece where it landed', () => {
    const { engine, motion } = hopped();
    motion.kicks = [];
    expect(motion.step(1000 + HOP_MS, engine, 0)).toBe(false);
    expect(motion.hops.size).toBe(0);
    expect(motion.offsets.size).toBe(0);
  });

  it('moves only the pieces it has a start for, and tracks the hop by group', () => {
    const engine = fakeEngine(3);
    for (const p of engine.pieces) p.groupId = 7;
    const motion = new PieceMotion();
    motion.playHop(engine.pieces, new Map([[1, { x: 0, y: 0 }]]), 0, false);
    expect([...motion.hops.keys()]).toEqual([7]);
    motion.step(0, engine, 0);
    expect([...motion.offsets.keys()]).toEqual([1]);
  });

  it('ignores a hop with no known pieces', () => {
    const engine = fakeEngine(2);
    const motion = new PieceMotion();
    motion.playHop(engine.pieces, new Map([[9, { x: 0, y: 0 }]]), 0);
    expect(motion.active).toBe(false);
    expect(motion.kicks).toEqual([]);
  });
});

describe('PieceMotion: kick-off lines', () => {
  it('starts at the average old spot, pointing to where the pieces went', () => {
    const engine = fakeEngine(2);
    for (const p of engine.pieces) p.groupId = 1;
    const motion = new PieceMotion();
    const from = new Map([
      [0, { x: 0, y: 0 }],
      [1, { x: 20, y: 40 }],
    ]);
    // Pieces now at (0, 0) and (120, 0): average (60, 0), from average (10, 20).
    motion.playHop(engine.pieces, from, 0);
    expect(motion.kicks).toEqual([{ x: 10, y: 20, dir: Math.atan2(-20, 50), age: 0 }]);
  });

  it('age with the frame time and disappear, keeping the motion active until then', () => {
    const { engine, motion } = hopped();
    motion.hops.clear();
    expect(motion.hasPieceMotion).toBe(false);
    expect(motion.step(0, engine, 0.1)).toBe(true);
    expect(motion.kicks[0].age).toBeCloseTo(0.1);
    expect(motion.step(0, engine, 1)).toBe(false);
    expect(motion.kicks).toEqual([]);
  });

  it('fade out while moving outwards', () => {
    const start = PieceMotion.kickPhase({ age: 0 });
    const later = PieceMotion.kickPhase({ age: 0.1 });
    const end = PieceMotion.kickPhase({ age: 10 });
    expect(start).toEqual({ alpha: 1, out: 0 });
    expect(later.alpha).toBeLessThan(1);
    expect(later.alpha + later.out).toBeCloseTo(1);
    expect(end.alpha).toBe(0);
  });

  it('are not added when asked not to', () => {
    const engine = fakeEngine(1);
    const motion = new PieceMotion();
    motion.playHop(engine.pieces, new Map([[0, { x: 9, y: 9 }]]), 0, false);
    expect(motion.kicks).toEqual([]);
    expect(motion.hasPieceMotion).toBe(true);
  });
});

describe('PieceMotion: opening deal', () => {
  it('deals loose pieces only, from the top left to the bottom right', () => {
    const engine = fakeEngine(6);
    engine.pieces[4].isLocked = true;
    const motion = new PieceMotion();
    motion.playDeal(engine.pieces, engine.pieceW, engine.pieceH);
    const { items, endMs } = motion.deal;
    expect(items.map((i) => i.id)).toEqual([0, 1, 2, 3, 5]);
    const delay = (id) => items.find((i) => i.id === id).delay;
    expect(delay(0)).toBeLessThan(delay(5));
    for (const item of items) {
      expect(item.delay).toBeGreaterThanOrEqual(0);
      expect(item.delay).toBeLessThan(endMs);
      expect(Math.abs(item.slideX)).toBeLessThan(engine.pieceW / 2);
    }
    expect(motion.deal.dropHeight).toBeGreaterThan(0);
    expect(motion.deal.dropHeight).toBeLessThanOrEqual(engine.pieceH);
  });

  it('has nothing to deal when every piece is placed', () => {
    const engine = fakeEngine(2);
    for (const p of engine.pieces) p.isLocked = true;
    const motion = new PieceMotion();
    motion.deal = { stale: true };
    motion.playDeal(engine.pieces, 100, 80);
    expect(motion.deal).toBeNull();
  });

  it('drops each piece in after its delay, fading in, and leaves it resting', () => {
    const engine = fakeEngine(6);
    const motion = new PieceMotion();
    motion.playDeal(engine.pieces, engine.pieceW, engine.pieceH);
    const { dropHeight, dropDur } = motion.deal;
    const last = motion.deal.items.at(-1);
    motion.step(0, engine, 0); // the waiting frame
    motion.step(100, engine, 0); // starts at 100

    // Before its delay: waiting above its spot, invisible.
    motion.step(100 + last.delay - 1, engine, 0);
    expect(motion.offsets.get(last.id)).toMatchObject({
      dy: -dropHeight,
      lift: dropHeight,
      alpha: 0,
    });

    // Falling: lower and more visible as time goes on.
    motion.step(100 + last.delay + dropDur * 0.2, engine, 0);
    const early = motion.offsets.get(last.id);
    motion.step(100 + last.delay + dropDur * 0.6, engine, 0);
    const late = motion.offsets.get(last.id);
    expect(early.dy).toBeLessThan(late.dy);
    expect(late.dy).toBeLessThan(0);
    expect(early.alpha).toBeLessThan(late.alpha);
    expect(late.alpha).toBeLessThanOrEqual(1);
    expect(early.scale).toBeGreaterThan(late.scale);
    expect(late.scale).toBeGreaterThan(1);
    expect(Math.abs(early.dx)).toBeGreaterThanOrEqual(Math.abs(late.dx));

    // Landed: no offset any more.
    motion.step(100 + last.delay + dropDur, engine, 0);
    expect(motion.offsets.has(last.id)).toBe(false);
  });

  it('lets a hop override the deal for the same piece', () => {
    const engine = fakeEngine(1);
    const motion = new PieceMotion();
    motion.playDeal(engine.pieces, engine.pieceW, engine.pieceH);
    engine.pieces[0].x = 50;
    motion.playHop(engine.pieces, new Map([[0, { x: 0, y: 0 }]]), 0, false);
    motion.step(0, engine, 0);
    expect(motion.offsets.get(0)).toEqual({ dx: -50, dy: 0, lift: 0 });
  });
});

describe('PieceMotion: clearing', () => {
  it('clear stops everything, including the tether', () => {
    const { motion } = hopped();
    motion.playDeal(fakeEngine(2).pieces, 100, 80);
    motion.tether = { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } };
    motion.offsets.set(0, {});
    motion.clear();
    expect([
      motion.hops.size,
      motion.deal,
      motion.offsets.size,
      motion.kicks,
      motion.tether,
    ]).toEqual([0, null, 0, [], null]);
    expect(motion.active).toBe(false);
  });

  it('cancelDeal leaves hops alone and does nothing without a deal', () => {
    const { motion } = hopped();
    motion.offsets.set(0, {});
    motion.cancelDeal();
    expect(motion.offsets.size).toBe(1);
    expect(motion.hops.size).toBe(1);
  });
});
