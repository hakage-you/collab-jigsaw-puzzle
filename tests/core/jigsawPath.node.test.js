import { describe, expect, it } from 'vitest';
import { CUT_COMPLEXITY_CONFIG, PUZZLE_CONFIG } from '../../src/config/constants.js';
import {
  clampGridDimensions,
  computeGridForPieceCount,
  generateCutLayout,
  normalizeCutComplexity,
} from '../../src/core/jigsawPath.js';
import { isPointInOutline } from '../../src/core/pieceHitTest.js';
import { createEngine } from '../helpers/coreEngine.js';

// How the board is cut into pieces. Invariants first (the pieces tile the board, each style stays
// within its limits), then a golden test of the exact shapes: a save stores only the seed and cuts
// the same shapes again when it is loaded, so the cut must not change by accident.

const COMPLEXITIES = ['uniform', 'standard', 'complex'];
const { WARP_RATIOS, STANDARD_ARCHETYPES, JITTER } = CUT_COMPLEXITY_CONFIG;

/** A layout on an 800 x 600 board of 8 x 6 cells (100 x 100 each). */
const layoutOf = (cutComplexity, seed = 7) =>
  generateCutLayout({ cols: 8, rows: 6, boardW: 800, boardH: 600, seed, cutComplexity });

const allEdges = (layout) => [...layout.hEdges.flat(), ...layout.vEdges.flat()];

const range = (values) => [Math.min(...values), Math.max(...values)];

describe('normalizeCutComplexity', () => {
  it.each([
    ['uniform', 'uniform'],
    ['standard', 'standard'],
    ['complex', 'complex'],
    ['irregular', 'standard'],
    ['extreme', 'complex'],
    ['nonsense', 'standard'],
    [undefined, 'standard'],
  ])('reads %s as %s', (value, expected) => {
    expect(normalizeCutComplexity(value)).toBe(expected);
  });
});

describe('clampGridDimensions', () => {
  it.each([
    ['keeps a valid grid', [6, 4], [6, 4]],
    ['rounds to whole cells', [4.6, 3.2], [5, 3]],
    ['raises to the minimum and caps at the maximum', [1, 100], [2, 80]],
    ['caps at the maximum on the other side', [81, 2], [80, 2]],
    ['falls back to the defaults for missing values', ['x', null], [6, 4]],
    ['falls back to the defaults for zero', [0, 0], [6, 4]],
    ['shrinks the longer side to the piece limit', [80, 80], [37, 80]],
    ['shrinks the rows when they are the longer side', [40, 80], [40, 75]],
    ['keeps a grid of exactly the piece limit', [60, 50], [60, 50]],
  ])('%s', (_, [cols, rows], [eCols, eRows]) => {
    expect(clampGridDimensions(cols, rows)).toEqual({ cols: eCols, rows: eRows });
  });
});

describe('computeGridForPieceCount', () => {
  it.each([
    ['24 pieces of a 3:2 image', [24, 3, 2], [6, 4]],
    ['100 pieces of a square image', [100, 1, 1], [10, 10]],
    ['48 pieces of a 2:3 image', [48, 2, 3], [6, 8]],
    ['fewer than 4 pieces (the smallest grid)', [1, 1, 1], [2, 2]],
    ['9 pieces of a square image', [9, 1, 1], [3, 3]],
    ['missing values (24 pieces, 3:2)', [undefined, undefined, undefined], [6, 4]],
    ['an image without a size (taken as 3:2)', [60, 0, 0], [10, 6]],
    ['exactly the piece limit', [3000, 6, 5], [60, 50]],
    ['the widest grid', [1280, 5, 1], [80, 16]],
    ['the tallest grid', [1280, 1, 5], [16, 80]],
  ])('%s', (_, args, [cols, rows]) => {
    expect(computeGridForPieceCount(...args)).toEqual({ cols, rows });
  });

  it('treats images wider than 5:1 or taller than 1:5 as 5:1 and 1:5', () => {
    expect(computeGridForPieceCount(48, 10, 1)).toEqual(computeGridForPieceCount(48, 5, 1));
    expect(computeGridForPieceCount(48, 1, 10)).toEqual(computeGridForPieceCount(48, 1, 5));
    expect(computeGridForPieceCount(48, 10, 1)).toEqual({ cols: 16, rows: 3 });
    expect(computeGridForPieceCount(48, 1, 10)).toEqual({ cols: 3, rows: 16 });
  });

  it.each([
    [3000, 3, 2],
    [5000, 1, 1],
  ])('stays within the piece limit for %i pieces of a %i:%i image', (count, w, h) => {
    const { cols, rows } = computeGridForPieceCount(count, w, h);
    expect(cols * rows).toBeLessThanOrEqual(PUZZLE_CONFIG.MAX_TOTAL_PIECES);
    expect(cols * rows).toBeGreaterThan(PUZZLE_CONFIG.MAX_TOTAL_PIECES * 0.98);
    // Close to square pieces.
    expect((w / cols) * (rows / h)).toBeGreaterThan(0.9);
    expect((w / cols) * (rows / h)).toBeLessThan(1.1);
  });
});

describe('generateCutLayout', () => {
  it('is the same for the same seed and differs for another one', () => {
    for (const c of COMPLEXITIES) {
      expect(layoutOf(c, 7)).toEqual(layoutOf(c, 7));
    }
    expect(layoutOf('standard', 7)).not.toEqual(layoutOf('standard', 8));
  });

  it('has a corner grid and one edge per cell boundary inside the board', () => {
    const layout = layoutOf('standard');
    expect(layout.complexity).toBe('standard');
    expect(layout.grid).toHaveLength(7);
    expect(layout.grid.every((row) => row.length === 9)).toBe(true);
    expect(layout.hEdges).toHaveLength(5);
    expect(layout.hEdges.every((row) => row.length === 8)).toBe(true);
    expect(layout.vEdges).toHaveLength(6);
    expect(layout.vEdges.every((row) => row.length === 7)).toBe(true);
    expect(layoutOf('extreme').complexity).toBe('complex');
    expect(generateCutLayout({ cols: 2, rows: 2, boardW: 2, boardH: 2, seed: 1 }).complexity).toBe(
      'standard',
    );
  });

  it.each(COMPLEXITIES)(
    '%s: keeps the border straight and moves inner corners within its limit',
    (complexity) => {
      const { grid } = layoutOf(complexity);
      const limit = WARP_RATIOS[complexity];
      let largest = 0;
      grid.forEach((row, r) =>
        row.forEach((v, c) => {
          const dx = (v.x - (-400 + c * 100)) / 100;
          const dy = (v.y - (-300 + r * 100)) / 100;
          if (r === 0 || r === 6 || c === 0 || c === 8) {
            expect([dx, dy]).toEqual([0, 0]);
          } else {
            largest = Math.max(largest, Math.abs(dx), Math.abs(dy));
          }
        }),
      );
      expect(largest).toBeLessThanOrEqual(limit);
      // Uses most of its range (35 corners): standard and complex really differ.
      expect(largest).toBeGreaterThanOrEqual(limit * 0.8);
    },
  );

  it('uniform: every edge is the same classic tab, only its side varies', () => {
    const edges = allEdges(layoutOf('uniform'));
    for (const { sign, secondSign, ...shape } of edges) {
      expect(secondSign).toBe(sign);
      expect(shape).toEqual({
        uCenter: 0.5,
        depth: 0.96,
        headWidth: 0.18,
        neckWidth: 0.11,
        tilt: 0,
        asymL: 0,
        asymR: 0,
        shoulderBow: 0,
        shape: 'classic',
      });
    }
    expect(new Set(edges.map((e) => e.sign))).toEqual(new Set([1, -1]));
  });

  /** Checks every edge parameter stays within its archetype range plus the jitter * scale. */
  function expectWithinJitter(edges, scale) {
    const archetype = (key) => range(STANDARD_ARCHETYPES.map((a) => a[key]));
    const limits = {
      uCenter: [archetype('uCenter'), JITTER.U_CENTER],
      depth: [archetype('depth'), JITTER.DEPTH],
      headWidth: [archetype('headWidth'), JITTER.HEAD_WIDTH],
      tilt: [archetype('tilt'), JITTER.TILT],
      asymL: [[0, 0], JITTER.EAR_ASYM],
      asymR: [[0, 0], JITTER.EAR_ASYM],
      shoulderBow: [[0, 0], JITTER.SHOULDER_BOW],
    };
    for (const [key, [[lo, hi], jitter]] of Object.entries(limits)) {
      const [min, max] = range(edges.map((e) => e[key]));
      expect(min, key).toBeGreaterThanOrEqual(lo - jitter * scale - 1e-12);
      expect(max, key).toBeLessThanOrEqual(hi + jitter * scale + 1e-12);
    }
    const necks = new Set(STANDARD_ARCHETYPES.map((a) => a.neckWidth));
    expect(edges.every((e) => necks.has(e.neckWidth))).toBe(true);
  }

  it('standard: classic tabs from the five archetypes with a little jitter', () => {
    const edges = allEdges(layoutOf('standard'));
    expect(new Set(edges.map((e) => e.shape))).toEqual(new Set(['classic']));
    expect(new Set(edges.map((e) => e.sign))).toEqual(new Set([1, -1]));
    expectWithinJitter(edges, 1);
    // Every archetype is used (82 edges).
    expect(new Set(edges.map((e) => e.neckWidth)).size).toBe(
      new Set(STANDARD_ARCHETYPES.map((a) => a.neckWidth)).size,
    );
  });

  it('complex: classic, square and double tabs with 1.4 times the jitter', () => {
    const edges = allEdges(layoutOf('complex'));
    expect(new Set(edges.map((e) => e.shape))).toEqual(new Set(['classic', 'square', 'double']));
    expectWithinJitter(edges, JITTER.COMPLEX_MULT);
    // ...and really more than standard's.
    const [lo, hi] = range(edges.map((e) => e.asymL));
    expect(Math.max(-lo, hi)).toBeGreaterThan(JITTER.EAR_ASYM);
    const doubles = edges.filter((e) => e.shape === 'double');
    expect(new Set(doubles.map((e) => e.secondSign === e.sign))).toEqual(new Set([true, false]));
  });
});

describe('piece outlines', () => {
  /** World-space box around a piece's outline (a Bezier curve stays inside its control points). */
  function outlineBox(p) {
    const xs = p.outline.commands.flatMap((c) => [c.x, c.x1, c.x2].filter((v) => v !== undefined));
    const ys = p.outline.commands.flatMap((c) => [c.y, c.y1, c.y2].filter((v) => v !== undefined));
    return {
      piece: p,
      minX: p.targetX + Math.min(...xs),
      maxX: p.targetX + Math.max(...xs),
      minY: p.targetY + Math.min(...ys),
      maxY: p.targetY + Math.max(...ys),
    };
  }

  /** How many pieces cover the world point (x, y). Only pieces whose box holds it are tested. */
  const coverage = (boxes, x, y) =>
    boxes.filter(
      (b) =>
        x >= b.minX &&
        x <= b.maxX &&
        y >= b.minY &&
        y <= b.maxY &&
        isPointInOutline(b.piece.outline, x - b.piece.targetX, y - b.piece.targetY),
    ).length;

  it.each(COMPLEXITIES)(
    '%s: every point of the board is in exactly one piece, and no point around it',
    (cutComplexity) => {
      const engine = createEngine({ cols: 5, rows: 4, cutComplexity });
      const boxes = engine.pieces.map(outlineBox);
      const w = engine.boardW / 2;
      const h = engine.boardH / 2;
      const wrong = [];
      // An uneven step (a quarter of a tab or less) so that no sample falls exactly on a cut.
      for (let y = -h - 20.3; y < h + 20; y += 4.37) {
        for (let x = -w - 20.3; x < w + 20; x += 4.37) {
          const expected = Math.abs(x) < w && Math.abs(y) < h ? 1 : 0;
          const n = coverage(boxes, x, y);
          if (n !== expected) wrong.push({ x, y, n });
        }
      }
      expect(wrong).toEqual([]);
    },
    // Slow only under Stryker's instrumented code.
    30000,
  );

  it('outlines start at the top left corner and are centred on the piece', () => {
    const engine = createEngine({ cols: 5, rows: 4, cutComplexity: 'uniform' });
    for (const p of engine.pieces) {
      const [first] = p.outline.commands;
      expect(first.op).toBe('M');
      expect(first.x).toBeCloseTo(-engine.pieceW / 2);
      expect(first.y).toBeCloseTo(-engine.pieceH / 2);
      expect(isPointInOutline(p.outline, 0, 0)).toBe(true);
    }
  });

  it('border pieces have straight outer sides', () => {
    const engine = createEngine({ cols: 5, rows: 4 });
    const corner = engine.pieces[0];
    // Top and left sides of the top left piece are single straight lines.
    const ops = corner.outline.commands.map((c) => c.op);
    expect(ops[0]).toBe('M');
    expect(ops[1]).toBe('L');
    expect(ops.at(-1)).toBe('L');
  });
});

/** 32-bit FNV-1a of a string, as 8 hex digits. */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Every outline command of every piece (rounded to 1e-4) reduced to a count and a hash. */
function outlineDigest(engine) {
  const round = (v) => Math.round(v * 1e4) / 1e4;
  const keys = ['x1', 'y1', 'x2', 'y2', 'x', 'y'];
  const lines = engine.pieces.flatMap((p) =>
    p.outline.commands.map((c) =>
      [p.id, c.op, ...keys.filter((k) => k in c).map((k) => round(c[k]))].join(' '),
    ),
  );
  return { commands: lines.length, hash: fnv1a(lines.join('\n')) };
}

describe('piece shapes (golden)', () => {
  // A save keeps only the seed and cuts the pieces again on load, so the same seed must give the
  // same shapes. When the cut is changed on purpose, update with `npx vitest run -u` and say why
  // in the commit message (old saves then load with the new shapes).
  it.each(COMPLEXITIES)('%s cut of a fixed seed', (cutComplexity) => {
    const engine = createEngine({ cols: 5, rows: 4, seed: 20261126, cutComplexity });
    expect(outlineDigest(engine)).toMatchSnapshot();
  });
});
