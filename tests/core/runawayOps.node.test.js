import { describe, expect, it } from 'vitest';
import { OJAMA_CONFIG } from '../../src/config/constants.js';
import { canRunAway, hopGroup } from '../../src/core/runawayOps.js';
import { createEngine, movePieceTo } from '../helpers/coreEngine.js';

// Board side of the runaway ojama: which groups run away and where they hop. The host's rules and
// the sync to guests are covered in tests/sync/runaway.test.js (browser).

const { RUNAWAY_MAX_GROUP, RUNAWAY_HOP_MIN_PIECES, RUNAWAY_HOP_MAX_PIECES } = OJAMA_CONFIG;

/** Puts the first `n` pieces into the group of the first one. */
function groupOf(engine, n) {
  const pieces = engine.pieces.slice(0, n);
  for (const p of pieces) p.groupId = pieces[0].groupId;
  return pieces;
}

/** random() returning the given values in turn, then the last one again. */
function sequence(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

const pieceSize = (engine) => Math.max(engine.pieceW, engine.pieceH);

/** Hop length for a given random() draw (1.5 piece sizes at 0, 3 at 1). */
const hopLength = (engine, r) =>
  pieceSize(engine) *
  (RUNAWAY_HOP_MIN_PIECES + r * (RUNAWAY_HOP_MAX_PIECES - RUNAWAY_HOP_MIN_PIECES));

/** Just enough of an engine for hopGroup: one 10 x 10 piece (group 1) on a square board. */
function fakeEngine(piece, boardSize) {
  return {
    pieces: [piece],
    pieceW: 10,
    pieceH: 10,
    boardW: boardSize,
    boardH: boardSize,
    getGroupPieces: (id) => (id === 1 ? [piece] : []),
    bringGroupToFront() {},
  };
}

/** Widens the desk (which spans every piece) with two far-away pieces, so hops aren't cut short. */
function roomyDesk(engine) {
  movePieceTo(engine, engine.pieces.at(-1), 10000, 10000);
  movePieceTo(engine, engine.pieces.at(-2), -10000, -10000);
}

/** A piece moved to (x, y) on a fresh engine with a roomy desk. */
function pieceAt(x, y) {
  const engine = createEngine();
  roomyDesk(engine);
  const piece = engine.pieces[0];
  movePieceTo(engine, piece, x, y);
  return { engine, piece };
}

describe('canRunAway', () => {
  it('lets a loose piece run away', () => {
    const engine = createEngine();
    expect(canRunAway(engine, engine.pieces[0].groupId)).toBe(true);
  });

  it.each([
    [RUNAWAY_MAX_GROUP, true],
    [RUNAWAY_MAX_GROUP + 1, false],
  ])('lets a loose group of %i pieces run away: %s', (n, expected) => {
    const engine = createEngine();
    const [first] = groupOf(engine, n);
    expect(canRunAway(engine, first.groupId)).toBe(expected);
  });

  it('keeps a group that has a piece placed on the board', () => {
    const engine = createEngine();
    const [first, second] = groupOf(engine, 2);
    second.isLocked = true;
    expect(canRunAway(engine, first.groupId)).toBe(false);
  });

  it('takes a custom group limit', () => {
    const engine = createEngine();
    const [first] = groupOf(engine, 2);
    expect(canRunAway(engine, first.groupId, 1)).toBe(false);
    expect(canRunAway(engine, first.groupId, 2)).toBe(true);
  });

  it('does not run away with a group that has no pieces', () => {
    expect(canRunAway(createEngine(), 9999)).toBe(false);
  });
});

describe('hopGroup', () => {
  it('moves nothing and returns nothing for a group with no pieces', () => {
    const engine = createEngine();
    const before = engine.pieces.map((p) => [p.x, p.y]);
    expect(hopGroup(engine, 9999, null, () => 0.5)).toEqual([]);
    expect(engine.pieces.map((p) => [p.x, p.y])).toEqual(before);
  });

  it('hops straight away from the grab point and returns the new positions', () => {
    const { engine, piece } = pieceAt(0, 0);
    // random() = 0.5: no turn of the direction, hop length halfway between the limits.
    const moved = hopGroup(engine, piece.groupId, { x: -10, y: 0 }, () => 0.5);
    expect(piece.x).toBeCloseTo(hopLength(engine, 0.5));
    expect(piece.y).toBeCloseTo(0);
    expect(moved).toEqual([{ id: piece.id, x: piece.x, y: piece.y }]);
  });

  it.each([
    ['the shortest', 0],
    ['the longest', 1],
  ])('hops %s distance at the ends of the random range', (_, r) => {
    const { engine, piece } = pieceAt(0, 0);
    hopGroup(engine, piece.groupId, { x: 0, y: -10 }, sequence(0.5, r));
    expect(piece.x).toBeCloseTo(0);
    expect(piece.y).toBeCloseTo(hopLength(engine, r));
  });

  it('turns the direction by up to 0.6 rad either way', () => {
    const { engine, piece } = pieceAt(0, 0);
    hopGroup(engine, piece.groupId, { x: -10, y: 0 }, sequence(1, 0.5));
    const length = hopLength(engine, 0.5);
    expect(piece.x).toBeCloseTo(Math.cos(0.6) * length);
    expect(piece.y).toBeCloseTo(Math.sin(0.6) * length);
  });

  it('moves a group as a whole, away from the grab point as seen from its centre', () => {
    const engine = createEngine();
    roomyDesk(engine);
    const [a, b] = groupOf(engine, 2);
    movePieceTo(engine, a, 0, 0);
    b.x = 100;
    b.y = 40;
    // Centre (50, 20); grabbed at (40, 10), so the hop goes at 45 degrees.
    hopGroup(engine, a.groupId, { x: 40, y: 10 }, () => 0.5);
    const step = hopLength(engine, 0.5) / Math.SQRT2;
    expect([a.x, a.y, b.x, b.y].map((v) => Math.round(v * 1000) / 1000)).toEqual(
      [step, step, 100 + step, 40 + step].map((v) => Math.round(v * 1000) / 1000),
    );
  });

  it.each([
    ['there is no grab point', [0, 0], null],
    ['the grab point is 0.001 from the centre', [0, 0], { x: -0.001, y: 0 }],
    ['the grab point is at the centre', [30, 50], { x: 30.0005, y: 50 }],
  ])('hops in a random direction when %s', (_, [x, y], from) => {
    const { engine, piece } = pieceAt(x, y);
    // 0.25 of a full turn: straight down (+y), then no turn and the middle length.
    hopGroup(engine, piece.groupId, from, sequence(0.25, 0.5, 0.5));
    expect(piece.x).toBeCloseTo(x);
    expect(piece.y).toBeCloseTo(y + hopLength(engine, 0.5));
  });

  it('turns aside at the edge of the desk', () => {
    // The rightmost piece sets the desk's right edge, so it can't hop further right.
    const engine = createEngine();
    const piece = engine.pieces[0];
    movePieceTo(engine, piece, 5000, 0);
    hopGroup(engine, piece.groupId, { x: 4990, y: 0 }, () => 0.5);
    expect(piece.x).toBeCloseTo(5000);
    expect(piece.y).toBeCloseTo(Math.sin(Math.PI / 4) * hopLength(engine, 0.5));
  });

  it.each([
    ['right', [40, 0], { x: 30, y: 0 }, [60, 0]],
    ['left', [-40, 0], { x: -30, y: 0 }, [-60, 0]],
    ['bottom', [0, 40], { x: 0, y: 30 }, [0, 60]],
    ['top', [0, -40], { x: 0, y: -30 }, [0, -60]],
  ])('stops at the %s of the board plus one piece', (_, [x, y], from, expected) => {
    // Board 100 x 100, pieces 10 x 10: the desk is -60..60 both ways. A hop is 15 to 30 long,
    // so the 20 left to the edge is far enough and the direction is kept.
    const piece = { id: 0, x, y, groupId: 1, isLocked: false };
    hopGroup(fakeEngine(piece, 100), 1, from, () => 0.5);
    expect([piece.x, piece.y].map((v) => Math.round(v * 1000) / 1000)).toEqual(expected);
  });

  it('tries turning the other way when the first turn is blocked too', () => {
    // In the bottom-right corner, grabbed from the left: right and down-right are blocked,
    // so it goes up-right.
    const piece = { id: 0, x: 60, y: 60, groupId: 1, isLocked: false };
    hopGroup(fakeEngine(piece, 100), 1, { x: 50, y: 60 }, () => 0.5);
    expect(piece.x).toBeCloseTo(60);
    expect(piece.y).toBeCloseTo(60 - Math.sin(Math.PI / 4) * 22.5);
  });

  it('takes the longest move it can find when every way is too short', () => {
    // A desk 20 x 20 around the piece: no direction allows a full hop.
    const piece = { id: 0, x: 0, y: 0, groupId: 1, isLocked: false };
    hopGroup(fakeEngine(piece, 0), 1, { x: -1, y: 0 }, () => 0.5);
    // The diagonal to the corner is the longest; the first one found is kept.
    expect([piece.x, piece.y]).toEqual([10, 10]);
  });

  it('brings the group to the front', () => {
    const { engine, piece } = pieceAt(0, 0);
    hopGroup(engine, piece.groupId, null, () => 0.5);
    const others = engine.pieces.filter((p) => p !== piece);
    expect(others.every((p) => p.zOrder < piece.zOrder)).toBe(true);
  });
});
