import { describe, expect, it } from 'vitest';
import { PUZZLE_CONFIG } from '../../src/config/constants.js';
import { PuzzleEngine } from '../../src/core/puzzleEngine.js';
import {
  SMALL_PUZZLE,
  createEngine,
  createFakeImage,
  dropNearTarget,
  solveAll,
} from '../helpers/coreEngine.js';

// PuzzleEngine's own bookkeeping: images, board geometry, lookups, stacking order, hit testing
// and fake piece housekeeping (puzzleEngine.node.test.js covers the main play flow).

const saveOf = (engine) => JSON.parse(JSON.stringify(engine.exportSaveData({})));

/** A piece whose outline is a bar to the right of its centre: x 0 to 50, y -10 to 4. */
function barPiece(id, over = {}) {
  return {
    id,
    groupId: id + 1,
    isLocked: false,
    rotation: 0,
    isFlipped: false,
    x: 0,
    y: 0,
    zOrder: 1,
    outline: {
      commands: [
        { op: 'M', x: 0, y: -10 },
        { op: 'L', x: 50, y: -10 },
        { op: 'L', x: 50, y: 4 },
        { op: 'L', x: 0, y: 4 },
        { op: 'L', x: 0, y: -10 },
      ],
    },
    ...over,
  };
}

/** An engine holding only the given pieces, with a hit radius of 140 (80 / 2 + 100) around each. */
function engineWith(...pieces) {
  const engine = createEngine();
  engine.pieces = pieces;
  engine.pieceW = 80;
  engine.pieceH = 40;
  engine.spritePad = 100;
  engine.bumpZVersion();
  return engine;
}

describe('images', () => {
  it('needs an image analyzer to start a puzzle', () => {
    const engine = new PuzzleEngine();
    expect(() =>
      engine.initPuzzle({ ...SMALL_PUZZLE, sourceCanvas: createFakeImage(), isSampleImage: true }),
    ).toThrow(/imageAnalyzer/);
  });

  it('frees the previous image once a new one replaces it', () => {
    const engine = createEngine();
    const first = engine.sourceCanvas;
    engine.initPuzzle({ ...SMALL_PUZZLE, sourceCanvas: first, isSampleImage: true });
    expect([first.width, first.height]).toEqual([960, 640]);

    const second = createFakeImage();
    engine.initPuzzle({ ...SMALL_PUZZLE, sourceCanvas: second, isSampleImage: true });
    expect([first.width, first.height]).toEqual([0, 0]);

    const save = saveOf(engine);
    engine.restoreFromSave(save, createFakeImage(), true);
    expect([second.width, second.height]).toEqual([0, 0]);
  });

  it('remembers the sample image, or none for an own image', () => {
    expect(createEngine({ sampleImageId: '' }).sampleImageId).toBe(
      PUZZLE_CONFIG.DEFAULT_SAMPLE_IMAGE_ID,
    );
    expect(createEngine({ sampleImageId: 'rainbow' }).sampleImageId).toBe('rainbow');
    expect(createEngine({ isSampleImage: false }).sampleImageId).toBeNull();

    const save = saveOf(createEngine());
    delete save.puzzle.sampleImageId;
    const sample = createEngine();
    sample.restoreFromSave(save, createFakeImage(), true);
    expect(sample.sampleImageId).toBe(PUZZLE_CONFIG.DEFAULT_SAMPLE_IMAGE_ID);
    const own = createEngine();
    own.restoreFromSave(save, createFakeImage(), false);
    expect([own.isSampleImage, own.sampleImageId]).toEqual([false, null]);
  });
});

describe('board geometry', () => {
  it.each([
    ['3:2', 960, 640],
    ['5:1', 1000, 200],
    ['1:5', 200, 1000],
  ])('fits a %s image with square-ish pieces', (_, w, h) => {
    const engine = createEngine({ cols: 6, rows: 6, sourceCanvas: createFakeImage(w, h) });
    expect(engine.boardW / engine.boardH).toBeCloseTo(w / h, 1);
    expect(engine.pieceW).toBe(engine.boardW / 6);
    expect(engine.pieceH).toBe(engine.boardH / 6);
    expect(engine.tabSize).toBeCloseTo(
      Math.min(engine.pieceW, engine.pieceH) * PUZZLE_CONFIG.TAB_RATIO,
    );
    // About TARGET_PIECE_SIZE per piece.
    expect(Math.sqrt(engine.pieceW * engine.pieceH)).toBeCloseTo(
      PUZZLE_CONFIG.TARGET_PIECE_SIZE,
      -1,
    );
  });

  it('treats images beyond 5:1 or 1:5 as 5:1 and 1:5', () => {
    const size = (w, h) => {
      const e = createEngine({ cols: 6, rows: 6, sourceCanvas: createFakeImage(w, h) });
      return [e.boardW, e.boardH];
    };
    expect(size(2000, 100)).toEqual(size(1000, 200));
    expect(size(100, 2000)).toEqual(size(200, 1000));
  });

  it('keeps a small board at least 180 x 120', () => {
    const wide = createEngine({ cols: 2, rows: 2, sourceCanvas: createFakeImage(1000, 200) });
    expect(wide.boardH).toBe(120);
    const tall = createEngine({ cols: 2, rows: 2, sourceCanvas: createFakeImage(200, 1000) });
    expect(tall.boardW).toBe(180);
  });

  it('leaves room around each sprite for its tabs', () => {
    const engine = createEngine();
    expect(engine.spritePad).toBeGreaterThan(engine.tabSize);
  });
});

describe('lookups and counts', () => {
  it('finds real and fake pieces by id and group', () => {
    const engine = createEngine();
    const [fake] = engine.addFakePieces(1, 0);
    expect(engine.getPieceById(3)).toBe(engine.pieces[3]);
    expect(engine.getPieceById(fake.id)).toBe(fake);
    expect(engine.getPieceById(999)).toBeNull();
    expect(engine.getPieceById(-999)).toBeNull();
    expect(engine.getGroupPieces(fake.groupId)).toEqual([fake]);
    expect(engine.getGroupPieces(-999)).toEqual([]);
  });

  it('counts group sizes and placed pieces', () => {
    const engine = createEngine();
    engine.pieces[1].groupId = engine.pieces[0].groupId;
    dropNearTarget(engine, engine.pieces[5]);
    const counts = engine.getGroupCounts();
    expect(counts.get(engine.pieces[0].groupId)).toBe(2);
    expect(counts.get(engine.pieces[2].groupId)).toBe(1);
    expect(engine.getLockedCount()).toBe(1);
  });

  it('is not complete without pieces', () => {
    const engine = createEngine();
    engine.pieces = [];
    expect(engine.isCompleted()).toBe(false);
  });

  it('starts a new puzzle with fresh stats; a restored one knows whether it was complete', () => {
    const engine = createEngine();
    solveAll(engine);
    engine.recordVisualOjama();
    engine.completedFired = true;
    const solved = saveOf(engine);
    engine.initPuzzle({ ...SMALL_PUZZLE, sourceCanvas: createFakeImage(), isSampleImage: true });
    expect(engine.stats).toEqual(createEngine().stats);
    expect(engine.completedFired).toBe(false);

    engine.restoreFromSave(solved, createFakeImage(), true);
    expect(engine.completedFired).toBe(true);
  });

  it('marks a new puzzle as new for the renderer', () => {
    const engine = createEngine();
    const before = [engine.puzzleGeneration, engine.lockedVersion, engine.zVersion];
    engine.initPuzzle({ ...SMALL_PUZZLE, sourceCanvas: createFakeImage(), isSampleImage: true });
    const after = [engine.puzzleGeneration, engine.lockedVersion, engine.zVersion];
    after.forEach((v, i) => expect(v).toBeGreaterThan(before[i]));
  });

  it('restores an old save without a cut or settings as the standard cut', () => {
    const save = saveOf(createEngine({ cutComplexity: 'complex' }));
    delete save.puzzle.cutComplexity;
    delete save.settings;
    const engine = createEngine();
    engine.restoreFromSave(save, createFakeImage(), true);
    expect(engine.cutComplexity).toBe('standard');
  });

  it('counts timed ojama by kind', () => {
    const engine = createEngine();
    engine.recordTimedOjama('heavy');
    engine.recordTimedOjama('heavy');
    engine.recordTimedOjama('later');
    expect(engine.stats.ojamaBreakdown).toMatchObject({ heavy: 2, later: 1 });
    expect(engine.stats.ojamaTotal).toBe(3);
  });
});

describe('stacking order', () => {
  it('lists loose and fake pieces bottom to top, and reuses the list until the order changes', () => {
    const engine = createEngine();
    dropNearTarget(engine, engine.pieces[0]);
    const [fake] = engine.addFakePieces(1, 0);
    engine.bringGroupToFront(engine.pieces[3].groupId);
    const list = engine.getSortedLoosePieces();
    expect(list).toHaveLength(engine.pieces.length);
    expect(list).not.toContain(engine.pieces[0]);
    expect(list).toContain(fake);
    expect(list.at(-1)).toBe(engine.pieces[3]);
    const zs = list.map((p) => p.zOrder);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));

    expect(engine.getSortedLoosePieces()).toBe(list);
    engine.pieces[3].zOrder = -100;
    expect(engine.getSortedLoosePieces()).toBe(list);
    engine.bumpZVersion();
    expect(engine.getSortedLoosePieces()[0]).toBe(engine.pieces[3]);
  });

  it('brings fake groups to the front and skips placed groups', () => {
    const engine = createEngine();
    const [fake] = engine.addFakePieces(1, 0);
    engine.bringGroupToFront(fake.groupId);
    expect(fake.zOrder).toBe(engine.maxZ - 1);

    const placed = engine.pieces[0];
    dropNearTarget(engine, placed);
    const zVersion = engine.zVersion;
    engine.bringGroupToFront(placed.groupId);
    expect([placed.zOrder, engine.zVersion]).toEqual([0, zVersion]);
  });

  it('moves fake groups but not placed pieces', () => {
    const engine = createEngine();
    const [fake] = engine.addFakePieces(1, 0);
    const { x, y } = fake;
    engine.moveGroup(fake.groupId, 5, 6);
    expect([fake.x, fake.y]).toEqual([x + 5, y + 6]);
  });
});

describe('hitTest', () => {
  // Points 8 off the bar's axis, on its wide side (local y = -8) and on its narrow side (y = 8).
  it.each([
    [0, false, [30, -8], [30, 8]],
    [1, false, [8, 30], [-8, 30]],
    [2, false, [-30, 8], [-30, -8]],
    [3, false, [-8, -30], [8, -30]],
    [0, true, [-30, -8], [-30, 8]],
    [1, true, [8, -30], [-8, -30]],
  ])('turned %i times (flipped: %s) hits at %j and not at %j', (rotation, isFlipped, hit, miss) => {
    const piece = barPiece(0, { rotation, isFlipped });
    const engine = engineWith(piece);
    expect(engine.hitTest(...hit)).toBe(piece);
    expect(engine.hitTest(...miss)).toBeNull();
  });

  it('returns the topmost piece where pieces overlap', () => {
    const lower = barPiece(0, { zOrder: 1 });
    const upper = barPiece(1, { zOrder: 2 });
    expect(engineWith(lower, upper).hitTest(30, 0)).toBe(upper);
    expect(engineWith(upper, lower).hitTest(30, 0)).toBe(upper);
  });

  it.each([
    [0, [130, -2], [150, -2]],
    [1, [2, 130], [2, 150]],
    [2, [-130, 2], [-150, 2]],
    [3, [-2, -130], [-2, -150]],
  ])('turned %i times, reaches %j but not %j', (rotation, near, far) => {
    // A bar 500 long: only the part within the hit radius (140) can be hit.
    const long = barPiece(0, { rotation });
    long.outline.commands[1].x = 500;
    long.outline.commands[2].x = 500;
    const engine = engineWith(long);
    expect(engine.hitTest(...near)).toBe(long);
    expect(engine.hitTest(...far)).toBeNull();
  });

  it('ignores placed pieces', () => {
    const placed = barPiece(0, { isLocked: true });
    expect(engineWith(placed).hitTest(30, 0)).toBeNull();
  });
});

describe('fake piece housekeeping', () => {
  it('reports when there was nothing to clear or expire', () => {
    const engine = createEngine();
    const zVersion = engine.zVersion;
    expect(engine.clearFakePieces()).toBe(false);
    expect(engine.pruneExpiredFakePieces(1e15)).toBe(false);
    engine.addFakePieces(1, 0);
    const after = engine.zVersion;
    expect(engine.pruneExpiredFakePieces(1e15)).toBe(false);
    expect(engine.zVersion).toBe(after);
    expect(after).toBeGreaterThan(zVersion);
  });

  it('expires a piece at its expiry time and tells the renderer', () => {
    const engine = createEngine();
    engine.addFakePieces(2, 0);
    const [first, second] = engine.fakePieces;
    first.expiresAt = 5000;
    second.expiresAt = 5001;
    let zVersion = engine.zVersion;
    expect(engine.pruneExpiredFakePieces(5000)).toBe(true);
    expect(engine.fakePieces).toEqual([second]);
    expect(engine.zVersion).toBe(zVersion + 1);
    zVersion = engine.zVersion;
    expect(engine.clearFakePieces()).toBe(true);
    expect(engine.zVersion).toBe(zVersion + 1);
  });

  it('expires by the current time when none is given', () => {
    const engine = createEngine();
    engine.addFakePieces(1, 0);
    engine.fakePieces[0].expiresAt = Date.now() - 1;
    expect(engine.pruneExpiredFakePieces()).toBe(true);
    expect(engine.fakePieces).toEqual([]);
  });

  it('serializes fake pieces rounded to a tenth', () => {
    const engine = createEngine();
    engine.addFakePieces(1, 0);
    const [fake] = engine.fakePieces;
    Object.assign(fake, { x: 1.26, y: -3.04, targetX: 7.77, targetY: 0.05 });
    expect(engine.serializeFakePieces()[0]).toEqual({
      fakeId: fake.id,
      sourcePieceId: fake.sourcePieceId,
      targetX: 7.8,
      targetY: 0.1,
      x: 1.3,
      y: -3,
      rotation: fake.rotation,
      isFlipped: fake.isFlipped,
      expiresAt: 0,
      zOrder: fake.zOrder,
    });
    delete fake.fakeId;
    expect(engine.serializeFakePieces()[0].fakeId).toBe(fake.id);
  });
});

describe('turning and flipping', () => {
  it('turns a group a quarter turn around the grabbed piece and brings it to the front', () => {
    const engine = createEngine({ allowRotation: true });
    const [a, b] = engine.pieces;
    b.groupId = a.groupId;
    Object.assign(a, { x: 10, y: 20, rotation: 0 });
    Object.assign(b, { x: 110, y: 70, rotation: 3 });
    expect(engine.rotateGroup(a, true)).toBe(true);
    expect([a.x, a.y, a.rotation]).toEqual([10, 20, 1]);
    // (100, 50) from a becomes (-50, 100).
    expect([b.x, b.y, b.rotation]).toEqual([-40, 120, 0]);
    expect(a.zOrder).toBe(engine.maxZ - 1);
  });

  it('lets a turned group be turned back even when turning is off', () => {
    const engine = createEngine();
    const [a, b] = engine.pieces;
    b.groupId = a.groupId;
    b.rotation = 2;
    expect(engine.rotateGroup(a, false)).toBe(true);
    a.rotation = 0;
    b.rotation = 0;
    expect(engine.rotateGroup(a, false)).toBe(false);
  });

  it('does not turn or flip placed pieces or nothing', () => {
    const engine = createEngine();
    const piece = engine.pieces[0];
    dropNearTarget(engine, piece);
    expect(engine.rotateGroup(piece, true)).toBe(false);
    expect(engine.flipPiece(piece, true)).toBe(false);
    expect(engine.rotateGroup(null, true)).toBe(false);
    expect(engine.flipPiece(null, true)).toBe(false);
  });

  it('flips single pieces only, and lets a flipped one be flipped back when flipping is off', () => {
    const engine = createEngine();
    const [a, b, c] = engine.pieces;
    b.groupId = a.groupId;
    expect(engine.flipPiece(a, true)).toBe(false);
    c.isFlipped = true;
    expect(engine.flipPiece(c, false)).toBe(true);
    expect(c.isFlipped).toBe(false);
    expect(c.zOrder).toBe(engine.maxZ - 1);
    expect(engine.flipPiece(c, false)).toBe(false);
  });
});
