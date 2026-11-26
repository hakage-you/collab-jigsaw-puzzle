import { describe, expect, it } from 'vitest';
import { PUZZLE_CONFIG } from '../../src/config/constants.js';
import { createEngine, movePieceTo } from '../helpers/coreEngine.js';

// Dropping a group (snap onto the board, merge with neighbours), applying piece patches from the
// host, and writing a save.

const pieceAt = (engine, row, col) => engine.pieces.find((p) => p.row === row && p.col === col);

const snapDistance = (engine) =>
  Math.max(
    PUZZLE_CONFIG.MIN_SNAP_DISTANCE,
    Math.min(engine.pieceW, engine.pieceH) * PUZZLE_CONFIG.SNAP_DISTANCE_RATIO,
  );

/** Puts `piece` next to `anchor` where it belongs, plus (dx, dy). Both stay away from the board. */
function placeBeside(engine, anchor, piece, dx = 0, dy = 0) {
  movePieceTo(
    engine,
    piece,
    anchor.x + (piece.col - anchor.col) * engine.pieceW + dx,
    anchor.y + (piece.row - anchor.row) * engine.pieceH + dy,
  );
}

describe('resolveDrop: snapping onto the board', () => {
  it('places the whole group on its targets, at the bottom, and counts it', () => {
    const engine = createEngine();
    const a = pieceAt(engine, 1, 1);
    const b = pieceAt(engine, 1, 2);
    b.groupId = a.groupId;
    movePieceTo(engine, a, a.targetX + 3, a.targetY - 2);
    const versions = [engine.lockedVersion, engine.zVersion];

    expect(engine.resolveDrop(a.groupId)).toEqual({ type: 'snap', count: 2, completed: false });
    for (const p of [a, b]) {
      expect([p.x, p.y, p.isLocked, p.zOrder]).toEqual([p.targetX, p.targetY, true, 0]);
    }
    expect(engine.stats.placedCount).toBe(2);
    expect(engine.lockedVersion).toBeGreaterThan(versions[0]);
    expect(engine.zVersion).toBeGreaterThan(versions[1]);
  });

  it('reports completion when the last group is placed', () => {
    const engine = createEngine({ cols: 2, rows: 2 });
    for (const p of engine.pieces) p.groupId = 1;
    movePieceTo(engine, engine.pieces[0], engine.pieces[0].targetX, engine.pieces[0].targetY);
    expect(engine.resolveDrop(1)).toEqual({ type: 'snap', count: 4, completed: true });
  });

  it.each([
    ['turned', { rotation: 1 }],
    ['flipped', { isFlipped: true }],
  ])('does not snap a group with a %s piece', (_, change) => {
    const engine = createEngine();
    const piece = pieceAt(engine, 1, 1);
    Object.assign(piece, change);
    movePieceTo(engine, piece, piece.targetX, piece.targetY);
    expect(engine.resolveDrop(piece.groupId)).toEqual({ type: 'none', reason: 'orientation' });
    expect(piece.isLocked).toBe(false);
  });

  it('does nothing for fake pieces or a group with no pieces', () => {
    const engine = createEngine();
    expect(engine.resolveDrop(-1)).toEqual({ type: 'none', reason: 'fake' });
    expect(engine.resolveDrop(9999)).toEqual({ type: 'none' });
    const piece = engine.pieces[0];
    piece.isFake = true;
    expect(engine.resolveDrop(piece.groupId)).toEqual({ type: 'none', reason: 'fake' });
  });
});

describe('resolveDrop: joining neighbours', () => {
  it.each([
    ['above', -1, 0],
    ['below', 1, 0],
    ['left of', 0, -1],
    ['right of', 0, 1],
  ])('joins a neighbour %s the dropped piece, lining the dropped group up with it', (_, dr, dc) => {
    const engine = createEngine({ cols: 5, rows: 4 });
    const dropped = pieceAt(engine, 1, 2);
    const neighbour = pieceAt(engine, 1 + dr, 2 + dc);
    movePieceTo(engine, neighbour, 1000, 1000);
    // Slightly off, but within the snap distance.
    placeBeside(engine, neighbour, dropped, 4, -3);

    const result = engine.resolveDrop(dropped.groupId);
    expect(result).toEqual({ type: 'merge', mergedCount: 1, groupSize: 2 });
    expect(neighbour.groupId).toBe(dropped.groupId);
    expect(dropped.x - neighbour.x).toBeCloseTo((dropped.col - neighbour.col) * engine.pieceW);
    expect(dropped.y - neighbour.y).toBeCloseTo((dropped.row - neighbour.row) * engine.pieceH);
    // The neighbour stays where it was; the dropped group moved.
    expect(neighbour.x).toBeCloseTo(1000);
    expect(neighbour.y).toBeCloseTo(1000);
  });

  it('joins only within the snap distance', () => {
    const engine = createEngine();
    const [a, b] = [pieceAt(engine, 1, 1), pieceAt(engine, 1, 2)];
    movePieceTo(engine, a, 1000, 1000);
    const snap = snapDistance(engine);
    placeBeside(engine, a, b, snap * 1.05, 0);
    expect(engine.resolveDrop(b.groupId)).toEqual({ type: 'none' });
    placeBeside(engine, a, b, snap * 0.95, 0);
    expect(engine.resolveDrop(b.groupId).type).toBe('merge');
  });

  it.each([
    ['placed on the board', { isLocked: true }],
    ['turned', { rotation: 2 }],
    ['flipped', { isFlipped: true }],
  ])('does not join a neighbour that is %s', (_, change) => {
    const engine = createEngine();
    const [a, b] = [pieceAt(engine, 1, 1), pieceAt(engine, 1, 2)];
    movePieceTo(engine, a, 1000, 1000);
    placeBeside(engine, a, b);
    Object.assign(a, change);
    expect(engine.resolveDrop(b.groupId)).toEqual({ type: 'none' });
  });

  it('keeps joining until no neighbour fits, and brings the group to the front', () => {
    const engine = createEngine({ cols: 5, rows: 4 });
    const left = pieceAt(engine, 1, 1);
    const middle = pieceAt(engine, 1, 2);
    const right = pieceAt(engine, 1, 3);
    const below = pieceAt(engine, 2, 3);
    movePieceTo(engine, left, 1000, 1000);
    placeBeside(engine, left, right);
    placeBeside(engine, left, below);
    placeBeside(engine, left, middle);

    expect(engine.resolveDrop(middle.groupId)).toEqual({
      type: 'merge',
      mergedCount: 3,
      groupSize: 4,
    });
    const others = engine.pieces.filter((p) => p.groupId !== middle.groupId);
    expect(others.every((p) => p.zOrder < middle.zOrder)).toBe(true);
  });
});

describe('applyPiecePatches', () => {
  it('applies position, turn, flip, group and stacking from each patch', () => {
    const engine = createEngine();
    const [a, b] = engine.pieces;
    engine.applyPiecePatches([
      {
        id: a.id,
        x: 11,
        y: 22,
        rotation: 5,
        isFlipped: 1,
        isLocked: false,
        groupId: 40,
        zOrder: 70,
      },
      { id: b.id, x: 0, y: 0, rotation: -1, isFlipped: false, isLocked: true, groupId: 41 },
    ]);
    expect([a.x, a.y, a.rotation, a.isFlipped, a.groupId, a.zOrder]).toEqual([
      11,
      22,
      1,
      true,
      40,
      70,
    ]);
    // A placed piece goes to its target whatever the patch says.
    expect([b.x, b.y, b.rotation, b.isLocked, b.groupId]).toEqual([
      b.targetX,
      b.targetY,
      3,
      true,
      41,
    ]);
    expect(engine.nextGroupId).toBe(42);
    expect(engine.maxZ).toBe(71);
  });

  it('keeps the next group id and z order when the patches are below them', () => {
    const engine = createEngine();
    const { nextGroupId, maxZ } = engine;
    const [a] = engine.pieces;
    engine.applyPiecePatches([{ ...a, groupId: 1, zOrder: 0 }]);
    expect([engine.nextGroupId, engine.maxZ]).toEqual([nextGroupId, maxZ]);
  });

  it('keeps positions of loose pieces when asked to', () => {
    const engine = createEngine();
    const [a] = engine.pieces;
    const { x, y } = a;
    engine.applyPiecePatches([{ ...a, x: x + 50, y: y + 50, rotation: 2 }], {
      preservePositions: true,
    });
    expect([a.x, a.y, a.rotation]).toEqual([x, y, 2]);
  });

  it('skips unknown ids, patches fake pieces, and ignores an empty or broken list', () => {
    const engine = createEngine();
    engine.addFakePieces(1, 0);
    const [fake] = engine.fakePieces;
    const before = JSON.stringify(engine.pieces);
    const zVersion = engine.zVersion;
    engine.applyPiecePatches([]);
    engine.applyPiecePatches('x');
    expect(engine.zVersion).toBe(zVersion);
    engine.applyPiecePatches([
      { id: 9999, x: 1, y: 1, rotation: 0, groupId: 99 },
      { id: fake.id, x: 5, y: 6, rotation: 0, isFlipped: false, groupId: fake.groupId },
    ]);
    expect(JSON.stringify(engine.pieces)).toBe(before);
    expect([fake.x, fake.y]).toEqual([5, 6]);
    expect(engine.nextGroupId).toBeLessThan(99);
  });

  it('tells the renderer about new stacking always, and about placed pieces only when they change', () => {
    const engine = createEngine();
    const [a] = engine.pieces;
    const locked = engine.lockedVersion;
    const z = engine.zVersion;
    engine.applyPiecePatches([{ ...a, x: 1 }]);
    expect([engine.lockedVersion, engine.zVersion]).toEqual([locked, z + 1]);
    engine.applyPiecePatches([{ ...a, isLocked: true }]);
    expect(engine.lockedVersion).toBe(locked + 1);
  });
});

describe('exportSaveData', () => {
  it('writes the header, rounded piece positions, stats and contributions', () => {
    const engine = createEngine();
    movePieceTo(engine, engine.pieces[0], 1.234, -5.678);
    const contributions = [{ name: 'A', role: 'host', contrib: 3 }];
    const save = engine.exportSaveData({ theme: 'dark' }, contributions);
    expect(save.version).toBe(1);
    expect(Number.isNaN(Date.parse(save.savedAt))).toBe(false);
    expect(save.puzzle).toMatchObject({
      seed: engine.seed,
      cols: 4,
      rows: 3,
      boardW: engine.boardW,
      boardH: engine.boardH,
      cutComplexity: 'standard',
      imageWidth: 960,
      imageHeight: 640,
      imageHash: engine.imageHash,
      isSampleImage: true,
      sampleImageId: engine.sampleImageId,
    });
    expect(save.pieces[0]).toMatchObject({ id: 0, x: 1.23, y: -5.68 });
    expect(save.stats).toEqual(engine.stats);
    expect(save.stats).not.toBe(engine.stats);
    expect(save.contributions).toEqual(contributions);
    expect(save.contributions).not.toBe(contributions);
  });

  it('leaves out the sample image id for an own image and contributions when there are none', () => {
    const engine = createEngine({ isSampleImage: false });
    const save = engine.exportSaveData({});
    expect(save.puzzle).not.toHaveProperty('sampleImageId');
    expect(save).not.toHaveProperty('contributions');
  });

  it("leaves out this player's own effects and sound settings", () => {
    const engine = createEngine();
    const settings = { theme: 'dark', effectStrength: 'off', volume: { normal: 0, ojama: 0 } };
    const save = engine.exportSaveData(settings);
    expect(save.settings).toEqual({ theme: 'dark' });
    expect(settings.volume).toEqual({ normal: 0, ojama: 0 });
    expect(engine.exportSaveData(null).settings).toBeNull();
  });
});
