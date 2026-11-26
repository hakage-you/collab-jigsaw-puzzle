import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEngine, boardState, dropNearTarget, solveAll } from '../helpers/coreEngine.js';
import { seedMathRandom } from '../helpers/determinism.js';
import { OJAMA_CONFIG } from '../../src/config/constants.js';

let restoreRandom = null;

beforeEach(() => {
  restoreRandom = seedMathRandom(4242);
});

afterEach(() => {
  restoreRandom?.();
  restoreRandom = null;
  vi.useRealTimers();
});

/** Locks the first `n` loose pieces by dropping them exactly on their targets. */
function lockPieces(engine, n) {
  let done = 0;
  for (const p of engine.pieces) {
    if (done >= n) break;
    if (p.isLocked) continue;
    dropNearTarget(engine, p);
    done++;
  }
  return done;
}

/** Ids of rows that differ between two boardState snapshots (same piece order). */
function changedIds(before, after) {
  return before
    .filter((row, i) => JSON.stringify(row) !== JSON.stringify(after[i]))
    .map((r) => r.id);
}

describe('dropLockedPieces', () => {
  it('only unlocks previously locked pieces and never more than count', () => {
    const engine = createEngine();
    const locked = lockPieces(engine, 6);
    expect(engine.getLockedCount()).toBe(locked);

    const before = boardState(engine);
    const lockedBefore = before.filter((r) => r.isLocked).map((r) => r.id);
    const looseBefore = before.filter((r) => !r.isLocked);

    const returned = engine.dropLockedPieces(2, false).length;

    const after = boardState(engine);
    const unlockedNow = after.filter((r) => !r.isLocked).map((r) => r.id);
    const newlyUnlocked = unlockedNow.filter((id) => !looseBefore.some((r) => r.id === id));

    expect(returned).toBe(2);
    expect(newlyUnlocked).toHaveLength(2);
    expect(newlyUnlocked.every((id) => lockedBefore.includes(id))).toBe(true);
    // Pieces that were already loose must not be touched.
    for (const row of looseBefore) {
      expect(after.find((r) => r.id === row.id)).toEqual(row);
    }
    // Only the dropped pieces may change at all.
    expect(changedIds(before, after).length).toBeLessThanOrEqual(2);
  });

  it('keeps the total piece count unchanged', () => {
    const engine = createEngine();
    solveAll(engine);
    const total = engine.pieces.length;

    engine.dropLockedPieces(OJAMA_CONFIG.DEFAULT_DROP_COUNT, false);

    expect(engine.pieces).toHaveLength(total);
    expect(new Set(engine.pieces.map((p) => p.id)).size).toBe(total);
  });

  it('caps the number of dropped pieces at the number of locked pieces', () => {
    const engine = createEngine();
    const locked = lockPieces(engine, 3);

    const returned = engine.dropLockedPieces(10, false).length;

    expect(returned).toBe(locked);
    expect(engine.getLockedCount()).toBe(0);
  });

  it('drops pieces near their target position', () => {
    const engine = createEngine();
    solveAll(engine);
    const before = boardState(engine);

    engine.dropLockedPieces(4, false);

    const moved = engine.pieces.filter((p) => !p.isLocked);
    expect(moved).toHaveLength(4);
    for (const p of moved) {
      const dist = Math.hypot(p.x - p.targetX, p.y - p.targetY);
      // Code places dropped pieces 0.6..1.6 piece widths from target; clamping only shrinks that.
      expect(dist).toBeLessThanOrEqual(2 * engine.pieceW);
      expect(dist).toBeGreaterThan(0);
    }
    expect(changedIds(before, boardState(engine))).toHaveLength(4);
  });

  it('does not apply rotation when allowRotation is false', () => {
    const engine = createEngine();
    solveAll(engine);
    const rotationsBefore = engine.pieces.map((p) => [p.id, p.rotation]);

    engine.dropLockedPieces(engine.pieces.length, false);

    expect(engine.pieces.map((p) => [p.id, p.rotation])).toEqual(rotationsBefore);
  });

  it('marks the puzzle as not completed after dropping', () => {
    const engine = createEngine();
    solveAll(engine);
    expect(engine.isCompleted()).toBe(true);

    engine.dropLockedPieces(1, false);

    expect(engine.isCompleted()).toBe(false);
  });

  it('is a no-op when no piece is locked', () => {
    const engine = createEngine();
    expect(engine.getLockedCount()).toBe(0);
    const before = boardState(engine);

    const returned = engine.dropLockedPieces(3, false).length;

    expect(returned).toBe(0);
    expect(boardState(engine)).toEqual(before);
  });
});

describe('fake pieces', () => {
  it('adds fake pieces without touching engine.pieces, lock state or completion', () => {
    const engine = createEngine();
    lockPieces(engine, 2);
    const pieceCount = engine.pieces.length;
    const lockedBefore = engine.getLockedCount();
    const completedBefore = engine.isCompleted();

    const added = engine.addFakePieces(3, 0);

    expect(added).toHaveLength(3);
    expect(engine.fakePieces).toHaveLength(3);
    expect(engine.pieces).toHaveLength(pieceCount);
    expect(engine.getLockedCount()).toBe(lockedBefore);
    expect(engine.isCompleted()).toBe(completedBefore);
    for (const fp of engine.fakePieces) {
      expect(fp.id).toBeLessThan(0);
    }
  });

  it('is excluded from the exported save data', () => {
    const engine = createEngine();
    engine.addFakePieces(3, 0);
    const fakeIds = new Set(engine.fakePieces.map((fp) => fp.id));
    expect(fakeIds.size).toBe(3);

    const save = engine.exportSaveData({});

    expect(save.pieces).toHaveLength(engine.cols * engine.rows);
    const realIds = engine.pieces.map((p) => p.id).sort((a, b) => a - b);
    expect(save.pieces.map((sp) => sp.id).sort((a, b) => a - b)).toEqual(realIds);
    for (const sp of save.pieces) {
      expect(fakeIds.has(sp.id)).toBe(false);
    }
  });

  it('never counts as completed, even when every real piece is placed', () => {
    const engine = createEngine();
    engine.addFakePieces(OJAMA_CONFIG.FAKE_PIECE_ADD_COUNT, 0);
    expect(engine.fakePieces.length).toBeGreaterThan(0);

    solveAll(engine);

    expect(engine.isCompleted()).toBe(true);
    expect(engine.getLockedCount()).toBe(engine.pieces.length);
    expect(engine.fakePieces.length).toBeGreaterThan(0);
  });

  it('keeps at most maxCount pieces and removes the oldest first', () => {
    const engine = createEngine();
    const created = [];
    created.push(...engine.addFakePieces(3, 0, false, false, 4).map((p) => p.id));
    created.push(...engine.addFakePieces(3, 0, false, false, 4).map((p) => p.id));

    const ids = engine.fakePieces.map((p) => p.id);
    expect(ids).toHaveLength(4);
    expect(ids).toEqual(created.slice(-4));
  });

  it('enforces the default cap from OJAMA_CONFIG', () => {
    const engine = createEngine();
    const max = OJAMA_CONFIG.FAKE_PIECE_MAX_COUNT;
    const created = [];
    for (let i = 0; i < 5; i++) {
      created.push(...engine.addFakePieces(3, 0).map((p) => p.id));
    }

    expect(created.length).toBeGreaterThan(max);
    expect(engine.fakePieces.map((p) => p.id)).toEqual(created.slice(-max));
  });

  it('expires only timed pieces whose expiry has passed; duration 0 is persistent', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const base = Date.now();
    const engine = createEngine();

    const timed = engine.addFakePieces(2, 10).map((p) => p.id);
    const persistent = engine.addFakePieces(1, 0).map((p) => p.id);
    expect(engine.fakePieces).toHaveLength(3);

    expect(engine.pruneExpiredFakePieces(base + 9_999)).toBe(false);
    expect(engine.fakePieces.map((p) => p.id)).toEqual([...timed, ...persistent]);

    expect(engine.pruneExpiredFakePieces(base + 10_001)).toBe(true);
    expect(engine.fakePieces.map((p) => p.id)).toEqual(persistent);

    expect(engine.pruneExpiredFakePieces(base + 10_000_000)).toBe(false);
    expect(engine.fakePieces.map((p) => p.id)).toEqual(persistent);
  });

  it('clearFakePieces removes all fake pieces and leaves real pieces alone', () => {
    const engine = createEngine();
    engine.addFakePieces(3, 0);
    const before = boardState(engine);

    expect(engine.clearFakePieces()).toBe(true);

    expect(engine.fakePieces).toHaveLength(0);
    expect(boardState(engine)).toEqual(before);
  });

  it('serializes and re-syncs to identical fake pieces on a second engine', () => {
    const source = createEngine();
    source.addFakePieces(3, 30);
    const specs = source.serializeFakePieces();
    expect(specs).toHaveLength(3);

    const replica = createEngine();
    replica.syncFakePiecesFromSpecs(specs);

    expect(replica.fakePieces.map((p) => p.id)).toEqual(source.fakePieces.map((p) => p.id));
    expect(replica.serializeFakePieces()).toEqual(specs);
    for (const fp of replica.fakePieces) {
      const spec = specs.find((s) => s.fakeId === fp.id);
      expect(fp.x).toBeCloseTo(spec.x, 6);
      expect(fp.y).toBeCloseTo(spec.y, 6);
    }
  });
});

describe('prankLoosePieces', () => {
  it('never moves locked pieces', () => {
    const engine = createEngine();
    lockPieces(engine, 4);
    const lockedBefore = boardState(engine).filter((r) => r.isLocked);

    engine.prankLoosePieces(3);

    const lockedAfter = boardState(engine).filter((r) => r.isLocked);
    expect(lockedAfter).toEqual(lockedBefore);
  });

  it('affects at most count pieces and keeps the piece count', () => {
    const engine = createEngine();
    lockPieces(engine, 2);
    const total = engine.pieces.length;
    const before = boardState(engine);

    const returned = engine.prankLoosePieces(3).length;

    expect(returned).toBeGreaterThan(0);
    expect(returned).toBeLessThanOrEqual(3);
    expect(engine.pieces).toHaveLength(total);
    expect(changedIds(before, boardState(engine)).length).toBeLessThanOrEqual(3);
  });

  it('does nothing to a fully solved board', () => {
    const engine = createEngine();
    solveAll(engine);
    const before = boardState(engine);

    const returned = engine.prankLoosePieces(3).length;

    expect(returned).toBe(0);
    expect(boardState(engine)).toEqual(before);
  });
});

describe('physical interference reports what it changed', () => {
  it('dropLockedPieces returns exactly the pieces that changed', () => {
    const engine = createEngine();
    lockPieces(engine, 6);
    const before = boardState(engine);
    const changed = engine.dropLockedPieces(3, true);
    expect(changed.map((p) => p.id).sort()).toEqual(changedIds(before, boardState(engine)).sort());
  });

  it('prankLoosePieces returns exactly the pieces that changed', () => {
    const engine = createEngine();
    lockPieces(engine, 2);
    const before = boardState(engine);
    const changed = engine.prankLoosePieces(3);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.map((p) => p.id).sort()).toEqual(changedIds(before, boardState(engine)).sort());
  });
});

describe('ojama stats', () => {
  const breakdownKeys = ['drop', 'visual', 'superchat', 'prank', 'fake'];

  function snapshotStats(engine) {
    return {
      total: engine.stats.ojamaTotal,
      breakdown: { ...engine.stats.ojamaBreakdown },
    };
  }

  /** Expects exactly `key` to increase by one, everything else unchanged. */
  function expectSingleIncrement(before, after, key) {
    expect(after.total - before.total).toBe(1);
    for (const k of breakdownKeys) {
      const expected = before.breakdown[k] + (k === key ? 1 : 0);
      expect(after.breakdown[k], `breakdown.${k}`).toBe(expected);
    }
  }

  it('starts with zeroed ojama counters', () => {
    const engine = createEngine();
    const s = snapshotStats(engine);
    expect(s.total).toBe(0);
    for (const k of breakdownKeys) expect(s.breakdown[k]).toBe(0);
  });

  it('dropLockedPieces increments the drop counter', () => {
    const engine = createEngine();
    solveAll(engine);
    const before = snapshotStats(engine);

    engine.dropLockedPieces(2, false);

    expectSingleIncrement(before, snapshotStats(engine), 'drop');
  });

  it('addFakePieces increments the fake counter', () => {
    const engine = createEngine();
    const before = snapshotStats(engine);

    engine.addFakePieces(3, 0);

    expectSingleIncrement(before, snapshotStats(engine), 'fake');
  });

  it('prankLoosePieces increments the prank counter', () => {
    const engine = createEngine();
    lockPieces(engine, 2);
    const before = snapshotStats(engine);

    engine.prankLoosePieces(2);

    expectSingleIncrement(before, snapshotStats(engine), 'prank');
  });

  it('visual and superchat recorders increment their counters', () => {
    const engine = createEngine();

    const beforeVisual = snapshotStats(engine);
    engine.recordVisualOjama();
    expectSingleIncrement(beforeVisual, snapshotStats(engine), 'visual');

    const beforeSuper = snapshotStats(engine);
    engine.recordSuperchatOjama();
    expectSingleIncrement(beforeSuper, snapshotStats(engine), 'superchat');
  });
});
