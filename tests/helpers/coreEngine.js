import { PUZZLE_CONFIG } from '../../src/config/constants.js';
import { analyzePieceColors, colorSampleSize } from '../../src/core/colorAnalysis.js';
import { IMAGE_SIGNATURE_SAMPLE_SIZE, imageSignatureFromPixels } from '../../src/core/prng.js';
import { PuzzleEngine } from '../../src/core/puzzleEngine.js';

// Canvas-free engine for tests that run in Node (*.node.test.js, vitest project "node").
// src/core reads only the source image's width/height and gets pixels from the injected
// imageAnalyzer, so a { width, height } object plus generated pixels stands in for a canvas.
// Keep this file free of services / render / ui imports: it must load in plain Node.

/** Small, fast default puzzle used by most tests. */
export const SMALL_PUZZLE = Object.freeze({
  cols: 4,
  rows: 3,
  seed: 12345,
  cutComplexity: 'standard',
  allowRotation: false,
  allowFlip: false,
});

/** Fake source image: only its size, which is all src/core reads from it. */
export function createFakeImage(
  width = PUZZLE_CONFIG.SAMPLE_IMAGE_WIDTH,
  height = PUZZLE_CONFIG.SAMPLE_IMAGE_HEIGHT,
) {
  return { width, height };
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return [channel(0), channel(8), channel(4)];
}

/**
 * RGBA pixels of the fake image downscaled to width x height: hue runs left to right and
 * lightness top to bottom, so pieces fall into several color buckets (sortByColor has work to do).
 */
function fakePixels(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = hslToRgb((x / width) * 360, 0.8, 0.35 + (0.3 * y) / height);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** imageAnalyzer that feeds generated pixels to the same core functions the real one uses. */
const fakeImageAnalyzer = Object.freeze({
  signature(image) {
    const size = IMAGE_SIGNATURE_SAMPLE_SIZE;
    return imageSignatureFromPixels(fakePixels(size, size), image.width, image.height);
  },
  pieceColors(image, cols, rows) {
    const { width, height } = colorSampleSize(image.width, image.height, cols, rows);
    return analyzePieceColors(fakePixels(width, height), cols, rows);
  },
});

/** Creates an engine with a fresh puzzle built from a fake image. */
export function createEngine(options = {}) {
  const engine = new PuzzleEngine({ imageAnalyzer: fakeImageAnalyzer });
  engine.initPuzzle({
    sourceCanvas: createFakeImage(),
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
