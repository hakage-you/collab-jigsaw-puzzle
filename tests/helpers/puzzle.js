import { PuzzleEngine } from '../../src/core/puzzleEngine.js';
import { imageAnalyzer } from '../../src/services/imagePixels.js';
import { generateSampleImageCanvas } from '../../src/services/sampleImage.js';

/** Small, fast default puzzle used by most tests. */
export const SMALL_PUZZLE = Object.freeze({
  cols: 4,
  rows: 3,
  seed: 12345,
  cutComplexity: 'standard',
  allowRotation: false,
  allowFlip: false,
});

/** Creates an engine with a fresh puzzle built from the sample image. */
export function createEngine(options = {}) {
  const engine = new PuzzleEngine({ imageAnalyzer });
  engine.initPuzzle({
    sourceCanvas: generateSampleImageCanvas(),
    isSampleImage: true,
    ...SMALL_PUZZLE,
    ...options,
  });
  return engine;
}

/**
 * Comparable view of the board: one row per piece, sorted by id, rounded to 0.01.
 * Use it to compare two engines (e.g. host vs guest) or before/after an operation.
 */
export function boardState(engine) {
  const r = (v) => Math.round(v * 100) / 100;
  return [...engine.pieces]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((p) => ({
      id: p.id,
      x: r(p.x),
      y: r(p.y),
      rotation: p.rotation,
      isFlipped: Boolean(p.isFlipped),
      isLocked: Boolean(p.isLocked),
      groupId: p.groupId,
    }));
}

/** Moves a piece's whole group so that `piece` sits at (x, y). */
export function movePieceTo(engine, piece, x, y) {
  engine.moveGroup(piece.groupId, x - piece.x, y - piece.y);
}

/** Moves a piece's group onto its correct position plus an offset, then resolves the drop. */
export function dropNearTarget(engine, piece, dx = 0, dy = 0) {
  movePieceTo(engine, piece, piece.targetX + dx, piece.targetY + dy);
  return engine.resolveDrop(piece.groupId);
}

/** Places every piece on its correct position, one drop at a time. Returns the last drop result. */
export function solveAll(engine) {
  let last = null;
  for (const p of engine.pieces) {
    if (!p.isLocked) last = dropNearTarget(engine, p);
  }
  return last;
}
