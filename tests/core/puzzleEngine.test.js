import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PUZZLE_CONFIG } from '../../src/config/constants.js';
import { generateSampleImageCanvas } from '../../src/services/sampleImage.js';
import {
  boardState,
  createEngine,
  dropNearTarget,
  movePieceTo,
  solveAll,
} from '../helpers/puzzle.js';
import { hashOf, seedMathRandom } from '../helpers/determinism.js';

/** Snap radius, computed the same way the engine does (see resolveDropOp). */
function snapDistanceOf(engine) {
  return Math.max(
    PUZZLE_CONFIG.MIN_SNAP_DISTANCE,
    Math.min(engine.pieceW, engine.pieceH) * PUZZLE_CONFIG.SNAP_DISTANCE_RATIO,
  );
}

/** Piece at a grid position (row, col), looked up through the public piece list. */
function pieceAt(engine, row, col) {
  return engine.pieces.find((p) => p.row === row && p.col === col);
}

/** Creates an engine after reseeding Math.random so repeated builds are identical. */
function buildSeeded(options = {}) {
  const restore = seedMathRandom();
  try {
    return createEngine(options);
  } finally {
    restore();
  }
}

/** Rounded position of every piece, ordered by id. */
function positionsById(engine) {
  const r = (v) => Math.round(v * 100) / 100;
  return [...engine.pieces]
    .sort((a, b) => a.id - b.id)
    .map((p) => ({ id: p.id, x: r(p.x), y: r(p.y) }));
}

describe('PuzzleEngine behavior', () => {
  let restoreRandom = null;

  beforeEach(() => {
    restoreRandom = seedMathRandom();
  });

  afterEach(() => {
    restoreRandom?.();
    restoreRandom = null;
  });

  it('同じ設定と同じseedからは同一の盤面が生成され、seedが違えば配置も変わる', async () => {
    const a = buildSeeded({ seed: 777 });
    const b = buildSeeded({ seed: 777 });

    expect(boardState(a)).toEqual(boardState(b));
    for (const pa of a.pieces) {
      const pb = b.getPieceById(pa.id);
      expect(pb.targetX).toBe(pa.targetX);
      expect(pb.targetY).toBe(pa.targetY);
    }

    const c = buildSeeded({ seed: 778 });
    const hashA = await hashOf(positionsById(a));
    const hashC = await hashOf(positionsById(c));
    expect(hashC).not.toBe(hashA);
  });

  it('ピース数は cols*rows に一致し、開始時は全て未ロックでgroupIdは互いに異なる', () => {
    const sizes = [
      [2, 2],
      [4, 3],
      [10, 8],
    ];
    for (const [cols, rows] of sizes) {
      const engine = createEngine({ cols, rows });
      expect(engine.pieces).toHaveLength(cols * rows);
      expect(engine.pieces.every((p) => p.isLocked === false)).toBe(true);
      const groupIds = new Set(engine.pieces.map((p) => p.groupId));
      expect(groupIds.size).toBe(cols * rows);
    }
  });

  it('ターゲット位置へ置いたピースはsnapしてロックされ、位置がターゲットに揃う', () => {
    const engine = createEngine();
    const piece = pieceAt(engine, 1, 1);

    const result = dropNearTarget(engine, piece);

    expect(result.type).toBe('snap');
    expect(piece.isLocked).toBe(true);
    expect(piece.x).toBeCloseTo(piece.targetX, 6);
    expect(piece.y).toBeCloseTo(piece.targetY, 6);
  });

  it('snap距離の90%以内ならsnapし、110%ならsnapしない', () => {
    const engine = createEngine();
    const snap = snapDistanceOf(engine);

    const near = pieceAt(engine, 1, 1);
    const nearResult = dropNearTarget(engine, near, snap * 0.9, 0);
    expect(nearResult.type).toBe('snap');
    expect(near.isLocked).toBe(true);

    const far = pieceAt(engine, 1, 2);
    const farResult = dropNearTarget(engine, far, snap * 1.1, 0);
    expect(farResult.type).not.toBe('snap');
    expect(far.isLocked).toBe(false);
  });

  it('隣接ピースを正しい相対位置に置くと merge になり、同じgroupIdで一緒に動く', () => {
    const engine = createEngine();
    const a = pieceAt(engine, 1, 1);
    const b = pieceAt(engine, 1, 2);

    // Place A away from its target, then put B at the correct offset from A.
    movePieceTo(engine, a, a.targetX + 200, a.targetY + 150);
    movePieceTo(engine, b, a.x + (b.targetX - a.targetX), a.y + (b.targetY - a.targetY));
    expect(b.x - a.x).toBeCloseTo(b.targetX - a.targetX, 6);
    expect(b.y - a.y).toBeCloseTo(b.targetY - a.targetY, 6);

    const result = engine.resolveDrop(b.groupId);

    expect(result.type).toBe('merge');
    expect(result.mergedCount).toBe(1);
    expect(result.groupSize).toBe(2);
    expect(a.groupId).toBe(b.groupId);

    const before = { ax: a.x, ay: a.y, bx: b.x, by: b.y };
    engine.moveGroup(b.groupId, 30, -20);
    expect(a.x - before.ax).toBeCloseTo(30, 6);
    expect(a.y - before.ay).toBeCloseTo(-20, 6);
    expect(b.x - before.bx).toBeCloseTo(30, 6);
    expect(b.y - before.by).toBeCloseTo(-20, 6);
  });

  it('ロック済みのピースはmoveGroupで動かず、未ロックのピースは動く', () => {
    const engine = createEngine();
    const locked = pieceAt(engine, 1, 1);
    const loose = pieceAt(engine, 0, 0);

    dropNearTarget(engine, locked);
    const looseX = loose.x;
    const looseY = loose.y;

    engine.moveGroup(locked.groupId, 40, -25);
    expect(locked.x).toBeCloseTo(locked.targetX, 6);
    expect(locked.y).toBeCloseTo(locked.targetY, 6);
    expect(locked.isLocked).toBe(true);

    engine.moveGroup(loose.groupId, 40, -25);
    expect(loose.x).toBeCloseTo(looseX + 40, 6);
    expect(loose.y).toBeCloseTo(looseY - 25, 6);
  });

  it('全ピースを正しい位置に置くと完成し、最後のdropがcompletedを報告する', () => {
    const engine = createEngine();

    const last = solveAll(engine);

    expect(engine.isCompleted()).toBe(true);
    expect(last.type).toBe('snap');
    expect(last.completed).toBe(true);
    expect(engine.getLockedCount()).toBe(engine.pieces.length);
  });

  it('exportSaveData した内容を restoreFromSave すると盤面が再現される', () => {
    const original = createEngine();
    movePieceTo(original, pieceAt(original, 0, 0), 50, 60);
    movePieceTo(original, pieceAt(original, 2, 3), -120, 30);
    dropNearTarget(original, pieceAt(original, 1, 1));

    const settings = { cutComplexity: 'standard', allowRotation: false, allowFlip: false };
    const save = JSON.parse(JSON.stringify(original.exportSaveData(settings)));

    const restored = createEngine();
    restored.restoreFromSave(save, generateSampleImageCanvas(), true);

    expect(boardState(restored)).toEqual(boardState(original));
  });

  it('allowRotation が false なら回転できず、true なら90度ずつ回り4回で元に戻る', () => {
    const locked = createEngine({ allowRotation: false });
    const fixed = locked.pieces[0];
    expect(locked.rotateGroup(fixed, false)).toBeFalsy();
    expect(fixed.rotation).toBe(0);

    const engine = createEngine({ allowRotation: true });
    const piece = engine.pieces[0];
    const start = piece.rotation;
    for (let i = 1; i <= 4; i++) {
      expect(engine.rotateGroup(piece, true)).toBe(true);
      expect(piece.rotation).toBe((start + i) % 4);
    }
    expect(piece.rotation).toBe(start);
  });

  it('allowFlip が false なら反転できず、true なら反転が切り替わり2回で元に戻る', () => {
    const disabled = createEngine({ allowFlip: false });
    const fixed = disabled.pieces[0];
    expect(disabled.flipPiece(fixed, false)).toBe(false);
    expect(Boolean(fixed.isFlipped)).toBe(false);

    const engine = createEngine({ allowFlip: true });
    const piece = engine.pieces[0];
    const start = Boolean(piece.isFlipped);
    expect(engine.flipPiece(piece, true)).toBe(true);
    expect(Boolean(piece.isFlipped)).toBe(!start);
    expect(engine.flipPiece(piece, true)).toBe(true);
    expect(Boolean(piece.isFlipped)).toBe(start);
  });

  it('並べ替え系の操作はピース数を変えず、ロック済みは位置を保ち、未ロック同士の位置は重ならない', () => {
    const sorters = ['sortEdges', 'sortByColor', 'sortByQuadrant', 'alignAllUpright'];
    for (const name of sorters) {
      const engine = createEngine();
      dropNearTarget(engine, pieceAt(engine, 1, 1));
      dropNearTarget(engine, pieceAt(engine, 0, 3));
      const lockedBefore = engine.pieces
        .filter((p) => p.isLocked)
        .map((p) => ({ id: p.id, x: p.x, y: p.y }));
      const countBefore = engine.pieces.length;

      engine[name]();

      expect(engine.pieces.length, name).toBe(countBefore);
      for (const before of lockedBefore) {
        const p = engine.getPieceById(before.id);
        expect(p.isLocked, name).toBe(true);
        expect(p.x, name).toBeCloseTo(before.x, 6);
        expect(p.y, name).toBeCloseTo(before.y, 6);
      }

      const loose = engine.pieces.filter((p) => !p.isLocked);
      const keys = new Set(loose.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`));
      expect(keys.size, name).toBe(loose.length);
    }
  });

  it('hitTest はピース自身の位置でそのピースを返し、盤から遠い点では null を返す', () => {
    const engine = createEngine();
    const piece = pieceAt(engine, 0, 1);
    // Isolate the piece so no other piece overlaps its centre.
    movePieceTo(engine, piece, 5000, 5000);

    expect(engine.hitTest(piece.x, piece.y)).toBe(piece);
    expect(engine.hitTest(-9000, -9000)).toBeNull();
  });
});
