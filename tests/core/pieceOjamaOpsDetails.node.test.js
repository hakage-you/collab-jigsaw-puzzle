import { afterEach, describe, expect, it, vi } from 'vitest';
import { OJAMA_CONFIG, PUZZLE_CONFIG } from '../../src/config/constants.js';
import { MAX_FAKE_PIECES, turnStates } from '../../src/core/pieceOjamaOps.js';
import { createEngine, dropNearTarget, solveAll } from '../helpers/coreEngine.js';

// The board side of the ojama, with Math.random fed by hand: which pieces are picked, what happens
// to them, and the limits. How far pieces fly is visual tuning and only bounded here
// (ojamaOps.node.test.js covers the same operations with a seeded random).

afterEach(() => {
  vi.restoreAllMocks();
});

/** Makes Math.random return the given values in turn, then the last one again. */
function randomSequence(...values) {
  let i = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => values[Math.min(i++, values.length - 1)]);
}

const snapDistance = (engine) =>
  Math.max(
    PUZZLE_CONFIG.MIN_SNAP_DISTANCE,
    Math.min(engine.pieceW, engine.pieceH) * PUZZLE_CONFIG.SNAP_DISTANCE_RATIO,
  );

describe('dropLockedPieces', () => {
  it('knocks off the picked pieces into new groups on top, away from their targets', () => {
    const engine = createEngine();
    solveAll(engine);
    const { nextGroupId, maxZ } = engine;
    const versions = [engine.lockedVersion, engine.zVersion];
    // Pick the first locked piece twice; first piece: angle 0, nearest distance, turned 3 times;
    // second: angle 90 degrees, middle distance, not turned.
    randomSequence(0, 0, 0, 0, 0.5, 0.99, 0.25, 0.5, 0.7);
    const dropped = engine.dropLockedPieces(2, true);

    expect(dropped.map((p) => p.id)).toEqual([0, 1]);
    expect(dropped.map((p) => [p.isLocked, p.groupId, p.zOrder])).toEqual([
      [false, nextGroupId, maxZ],
      [false, nextGroupId + 1, maxZ + 1],
    ]);
    expect(dropped.map((p) => p.rotation)).toEqual([3, 0]);
    const [first, second] = dropped;
    expect(first.y).toBeCloseTo(first.targetY);
    expect(first.x - first.targetX).toBeGreaterThan(snapDistance(engine));
    expect(second.x).toBeCloseTo(second.targetX);
    expect(second.y - second.targetY).toBeGreaterThan(snapDistance(engine));
    expect(engine.completedFired).toBe(false);
    expect(engine.lockedVersion).toBeGreaterThan(versions[0]);
    expect(engine.zVersion).toBeGreaterThan(versions[1]);
  });

  it('picks at random among the locked pieces only', () => {
    const engine = createEngine();
    for (const p of engine.pieces.slice(0, 5)) dropNearTarget(engine, p);
    randomSequence(0.99);
    expect(engine.dropLockedPieces(2).map((p) => p.id)).toEqual([4, 3]);
  });

  it('keeps knocked-off pieces close to the board', () => {
    const engine = createEngine();
    solveAll(engine);
    // Every piece flies the longest way, straight left.
    randomSequence(0, 0.5, 0.999);
    const dropped = engine.dropLockedPieces(engine.pieces.length);
    for (const p of dropped) {
      expect(p.x).toBeGreaterThanOrEqual(-engine.boardW / 2 - engine.pieceW / 2);
    }
    // ...and straight down.
    const again = createEngine();
    solveAll(again);
    randomSequence(0, 0.25, 0.999);
    for (const p of again.dropLockedPieces(again.pieces.length)) {
      expect(p.y).toBeLessThanOrEqual(again.boardH / 2 + again.pieceH / 2);
    }
  });

  it('leaves the turn alone when turning is off', () => {
    const engine = createEngine();
    solveAll(engine);
    randomSequence(0);
    expect(engine.dropLockedPieces(3, false).map((p) => p.rotation)).toEqual([0, 0, 0]);
  });
});

describe('addFakePieces', () => {
  it("borrows an inner piece's shape and shows another part of the image", () => {
    const engine = createEngine();
    const maxZ = engine.maxZ;
    // All picks take the first item: shape from piece 5 (the first inner one), crop near piece 0.
    randomSequence(0);
    const [fake] = engine.addFakePieces(1, 0);
    const shape = engine.pieces[5];
    expect(fake).toMatchObject({
      id: -1,
      fakeId: -1,
      groupId: -1,
      sourcePieceId: shape.id,
      row: shape.row,
      col: shape.col,
      isEdge: false,
      isFake: true,
      isLocked: false,
      rotation: 0,
      isFlipped: true,
      expiresAt: 0,
      zOrder: maxZ,
    });
    expect(fake.outline).toBe(shape.outline);
    expect(fake.colorInfo).toBe(shape.colorInfo);
    // The crop is inside the board but not where any real piece's image is.
    expect(Math.abs(fake.targetX)).toBeLessThan(engine.boardW / 2);
    expect(Math.abs(fake.targetY)).toBeLessThan(engine.boardH / 2);
    expect(engine.pieces.some((p) => p.targetX === fake.targetX)).toBe(false);
    // Random 0: the far left of the spread, off the board.
    expect(fake.x).toBeLessThan(-engine.boardW / 2);
  });

  it('numbers fake pieces downwards and stacks each new one on top', () => {
    const engine = createEngine();
    const fakes = engine.addFakePieces(3, 0);
    expect(fakes.map((f) => f.id)).toEqual([-1, -2, -3]);
    expect(fakes[1].zOrder).toBe(fakes[0].zOrder + 1);
    expect(engine.addFakePieces(1, 0)[0].id).toBe(-4);
  });

  it('takes any piece as the shape when every piece is on the border', () => {
    const engine = createEngine({ cols: 2, rows: 2 });
    randomSequence(0.99);
    expect(engine.addFakePieces(1, 0)[0].sourcePieceId).toBe(3);
  });

  it('turns and flips them only when that is allowed', () => {
    const engine = createEngine();
    randomSequence(0.99);
    const [turned] = engine.addFakePieces(1, 0, true, true);
    expect([turned.rotation, turned.isFlipped]).toEqual([3, false]);
    randomSequence(0);
    const [plain] = engine.addFakePieces(1, 0, false, false);
    expect([plain.rotation, plain.isFlipped]).toEqual([0, false]);
  });

  it.each([
    ['above the limit of 16', 100, MAX_FAKE_PIECES],
    ['below 1', -5, 1],
    ['missing', 0, OJAMA_CONFIG.FAKE_PIECE_MAX_COUNT],
    ['not a number', 'x', OJAMA_CONFIG.FAKE_PIECE_MAX_COUNT],
  ])('keeps a sensible number on the table when the cap is %s', (_, maxCount, expected) => {
    const engine = createEngine();
    engine.addFakePieces(20, 0, true, true, maxCount);
    expect(engine.fakePieces).toHaveLength(expected);
  });

  it.each([
    [10, 1000 + 10000],
    [0, 0],
    [-5, 0],
    ['x', 0],
  ])('with duration %s, expires at %s', (duration, expiresAt) => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const engine = createEngine();
    expect(engine.addFakePieces(1, duration)[0].expiresAt).toBe(expiresAt);
  });

  it('adds nothing when there are no pieces', () => {
    const engine = createEngine();
    engine.pieces = [];
    expect(engine.addFakePieces(3, 0)).toEqual([]);
    expect(engine.stats.ojamaBreakdown.fake).toBe(0);
  });

  it('counts each call once and tells the renderer', () => {
    const engine = createEngine();
    const zVersion = engine.zVersion;
    engine.addFakePieces(3, 0);
    expect(engine.stats.ojamaBreakdown.fake).toBe(1);
    expect(engine.stats.ojamaTotal).toBe(1);
    expect(engine.zVersion).toBeGreaterThan(zVersion);
  });
});

describe('syncFakePiecesFromSpecs', () => {
  const spec = (over = {}) => ({
    fakeId: -7,
    sourcePieceId: 5,
    targetX: 12,
    targetY: 34,
    x: 100,
    y: 200,
    rotation: 1,
    isFlipped: false,
    expiresAt: 5000,
    zOrder: 80,
    ...over,
  });

  it("rebuilds the host's fake pieces from their specs", () => {
    const engine = createEngine();
    engine.syncFakePiecesFromSpecs([spec({ rotation: 5, isFlipped: 1 })]);
    const [fake] = engine.fakePieces;
    expect(fake).toMatchObject({
      id: -7,
      sourcePieceId: 5,
      targetX: 12,
      targetY: 34,
      x: 100,
      y: 200,
      rotation: 1,
      isFlipped: true,
      expiresAt: 5000,
      zOrder: 80,
    });
    expect(fake.outline).toBe(engine.pieces[5].outline);
    expect(engine.maxZ).toBe(81);
  });

  it('fills in what a spec leaves out', () => {
    const engine = createEngine();
    const maxZ = engine.maxZ;
    const source = engine.pieces[5];
    engine.syncFakePiecesFromSpecs([
      spec({ targetX: undefined, targetY: undefined, expiresAt: undefined, zOrder: undefined }),
    ]);
    const [fake] = engine.fakePieces;
    expect([fake.targetX, fake.targetY, fake.expiresAt, fake.zOrder]).toEqual([
      source.targetX,
      source.targetY,
      0,
      maxZ,
    ]);
    expect(engine.maxZ).toBe(maxZ + 1);
  });

  it('skips unknown source pieces, keeps at most 16, and ignores a broken list', () => {
    const engine = createEngine();
    const specs = Array.from({ length: 20 }, (_, i) => spec({ fakeId: -1 - i }));
    specs[0].sourcePieceId = 999;
    engine.syncFakePiecesFromSpecs(specs);
    expect(engine.fakePieces.map((f) => f.id)).toEqual(
      Array.from({ length: MAX_FAKE_PIECES - 1 }, (_, i) => -2 - i),
    );
    const zVersion = engine.zVersion;
    engine.syncFakePiecesFromSpecs('x');
    expect(engine.fakePieces).toHaveLength(MAX_FAKE_PIECES - 1);
    expect(engine.zVersion).toBe(zVersion);
    engine.syncFakePiecesFromSpecs([]);
    expect(engine.fakePieces).toEqual([]);
    expect(engine.zVersion).toBe(zVersion + 1);
  });
});

describe('prankLoosePieces', () => {
  it('flips a loose piece, or turns it 1 to 3 times in place', () => {
    const engine = createEngine();
    const piece = engine.pieces[0];
    const { x, y } = piece;
    // Pick the first piece, then flip (random below 0.45).
    randomSequence(0, 0.2);
    expect(engine.prankLoosePieces(1)).toEqual([piece]);
    expect([piece.isFlipped, piece.rotation]).toEqual([true, 0]);

    // Pick it again; 0.45 is not below 0.45, so it turns, 3 times.
    randomSequence(0, 0.45, 0.99);
    engine.prankLoosePieces(1);
    expect([piece.isFlipped, piece.rotation, piece.x, piece.y]).toEqual([true, 3, x, y]);
  });

  it('turns a whole group around the picked piece', () => {
    const engine = createEngine();
    const [a, b] = engine.pieces;
    // Every piece is in a pair, so there are no single pieces and the pairs are used.
    engine.pieces.forEach((p, i) => {
      p.groupId = 100 + Math.floor(i / 2);
    });
    Object.assign(a, { x: 0, y: 0 });
    Object.assign(b, { x: 100, y: 50 });
    randomSequence(0, 0);
    const changed = engine.prankLoosePieces(1);
    expect(changed).toEqual([a, b]);
    expect([a.x, a.y, a.rotation]).toEqual([0, 0, 1]);
    // A quarter turn clockwise around a: (100, 50) -> (-50, 100).
    expect([b.x, b.y, b.rotation]).toEqual([-50, 100, 1]);
    expect(a.zOrder).toBe(Math.max(...engine.pieces.map((p) => p.zOrder)));
  });

  it('picks at random among the loose pieces', () => {
    const engine = createEngine();
    randomSequence(0.99, 0.2);
    expect(engine.prankLoosePieces(1)).toEqual([engine.pieces.at(-1)]);
  });

  it('uses grouped pieces when there are no single ones, still skipping excluded groups', () => {
    const engine = createEngine();
    engine.pieces.forEach((p, i) => {
      p.groupId = 100 + Math.floor(i / 2);
    });
    const [a, b, ...rest] = engine.pieces;
    const before = JSON.stringify(rest);
    const changed = engine.prankLoosePieces(3, new Set(rest.map((p) => p.groupId)));
    expect(new Set(changed)).toEqual(new Set([a, b]));
    expect(JSON.stringify(rest)).toBe(before);
  });

  it('neither changes nor counts anything when nothing is loose or placed', () => {
    const engine = createEngine();
    solveAll(engine);
    expect(engine.prankLoosePieces(3)).toEqual([]);
    expect(engine.stats.ojamaBreakdown.prank).toBe(0);

    const fresh = createEngine();
    const versions = [fresh.lockedVersion, fresh.zVersion];
    expect(fresh.dropLockedPieces(3)).toEqual([]);
    expect(fresh.stats.ojamaBreakdown.drop).toBe(0);
    expect([fresh.lockedVersion, fresh.zVersion]).toEqual(versions);
  });

  it('leaves placed pieces and excluded groups alone', () => {
    const engine = createEngine();
    const [placed, free, ...rest] = engine.pieces;
    dropNearTarget(engine, placed);
    const before = turnStates(engine.pieces);
    const changed = engine.prankLoosePieces(5, new Set(rest.map((p) => p.groupId)));
    expect(changed).toEqual([free]);
    expect(before.get(placed.id)).toEqual({
      rotation: placed.rotation,
      isFlipped: placed.isFlipped,
    });
  });

  it('counts each prank once', () => {
    const engine = createEngine();
    engine.prankLoosePieces(2);
    expect(engine.stats.ojamaBreakdown.prank).toBe(1);
    expect(engine.stats.ojamaTotal).toBe(1);
  });
});

describe('turnStates', () => {
  it('maps each piece id to its turn and flip', () => {
    const states = turnStates([
      { id: 3, rotation: 2, isFlipped: true, x: 1 },
      { id: 4, rotation: 0, isFlipped: false },
    ]);
    expect([...states]).toEqual([
      [3, { rotation: 2, isFlipped: true }],
      [4, { rotation: 0, isFlipped: false }],
    ]);
  });
});
