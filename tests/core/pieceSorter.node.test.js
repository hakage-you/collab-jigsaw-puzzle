import { describe, expect, it } from 'vitest';
import { COLOR_BUCKETS, PUZZLE_CONFIG } from '../../src/config/constants.js';
import { createEngine, dropNearTarget } from '../helpers/coreEngine.js';

// Layout of the sort buttons (外枠 / 色別 / エリア別 / 向きをそろえる). Checked: which pieces move,
// rows and spacing, alignment and symmetry, and that blocks overlap neither each other nor the
// board. The exact gaps around the board are visual tuning and are not pinned down here.

const close = (v) => Math.round(v * 1000) / 1000;

/** Bounding box of the piece centres. */
function box(pieces) {
  const xs = pieces.map((p) => p.x);
  const ys = pieces.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** The pieces' rows, top to bottom, each as its sorted x positions. */
function rowsOf(pieces) {
  const byY = new Map();
  for (const p of pieces) {
    const key = close(p.y);
    byY.set(key, [...(byY.get(key) ?? []), p.x]);
  }
  return [...byY.entries()].sort((a, b) => a[0] - b[0]).map(([, xs]) => xs.sort((a, b) => a - b));
}

/** Checks rows of pieces `stepX` apart and rows `stepY` apart; returns the row lengths. */
function expectGrid(pieces, stepX, stepY) {
  const rows = rowsOf(pieces);
  for (const xs of rows) {
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(stepX);
  }
  const ys = [...new Set(pieces.map((p) => close(p.y)))].sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(stepY, 2);
  return rows.map((xs) => xs.length);
}

/** The area a block of pieces covers (centres plus half a piece). */
function area(engine, pieces) {
  const b = box(pieces);
  const hw = engine.pieceW / 2;
  const hh = engine.pieceH / 2;
  return { minX: b.minX - hw, maxX: b.maxX + hw, minY: b.minY - hh, maxY: b.maxY + hh };
}

const boardArea = (engine) => ({
  minX: -engine.boardW / 2,
  maxX: engine.boardW / 2,
  minY: -engine.boardH / 2,
  maxY: engine.boardH / 2,
});

const overlaps = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

/** Checks that no two of the areas overlap. */
function expectApart(areas) {
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      expect(overlaps(areas[i], areas[j]), `${i}/${j}`).toBe(false);
    }
  }
}

const positions = (pieces) => pieces.map((p) => [p.id, p.x, p.y]);

describe('sortEdges', () => {
  it('puts the edge pieces above the board and the inner ones below, in centred rows', () => {
    const engine = createEngine();
    const result = engine.sortEdges();
    expect(result).toEqual({ total: 12, edges: 10, inner: 2 });

    const edges = engine.pieces.filter((p) => p.isEdge);
    const inner = engine.pieces.filter((p) => !p.isEdge);
    const step = PUZZLE_CONFIG.SORT_EDGE_STEP_RATIO;
    // 12 pieces: rows of max(4, ceil(sqrt(12) * 1.3)) = 5.
    expect(expectGrid(edges, engine.pieceW * step, engine.pieceH * step)).toEqual([5, 5]);
    expect(expectGrid(inner, engine.pieceW * step, engine.pieceH * step)).toEqual([2]);
    for (const block of [edges, inner]) {
      const b = box(block);
      expect(b.minX + b.maxX).toBeCloseTo(0);
    }
    expect(area(engine, edges).maxY).toBeLessThan(-engine.boardH / 2);
    expect(area(engine, inner).minY).toBeGreaterThan(engine.boardH / 2);
  });

  it.each([
    ['2 x 2 (at least 4 a row)', 2, 2, [4]],
    ['10 x 10 (100 pieces: at most 10 a row)', 10, 10, [10, 10, 10, 6]],
    ['12 x 10 (over 100 pieces: up to 40 a row)', 12, 10, [15, 15, 10]],
  ])('lays out the edge pieces of %s', (_, cols, rows, edgeRows) => {
    const engine = createEngine({ cols, rows });
    engine.sortEdges();
    const step = PUZZLE_CONFIG.SORT_EDGE_STEP_RATIO;
    const edges = engine.pieces.filter((p) => p.isEdge);
    expect(expectGrid(edges, engine.pieceW * step, engine.pieceH * step)).toEqual(edgeRows);
  });

  it('labels each block above it with its count', () => {
    const engine = createEngine();
    engine.sortEdges();
    const [edgeLabel, innerLabel] = engine.zoneLabels;
    expect(engine.zoneLabels).toHaveLength(2);
    expect(edgeLabel).toMatchObject({ text: '外枠ピース (10)', x: 0 });
    expect(innerLabel).toMatchObject({ text: '内側ピース (2)', x: 0 });
    expect(edgeLabel.y).toBeLessThan(box(engine.pieces.filter((p) => p.isEdge)).minY);
    expect(innerLabel.y).toBeLessThan(box(engine.pieces.filter((p) => !p.isEdge)).minY);
    expect(innerLabel.y).toBeGreaterThan(engine.boardH / 2);
  });

  it('keeps the edge block and its label at the same distance from the board, however many rows', () => {
    const gaps = [createEngine(), createEngine({ cols: 10, rows: 10 })].map((engine) => {
      engine.sortEdges();
      const b = box(engine.pieces.filter((p) => p.isEdge));
      return [
        close((-engine.boardH / 2 - b.maxY) / engine.pieceH),
        close((b.minY - engine.zoneLabels[0].y) / engine.pieceH),
      ];
    });
    expect(gaps[0]).toEqual(gaps[1]);
  });

  it('has no edge label when every edge piece is excluded', () => {
    const engine = createEngine();
    const excluded = new Set(engine.pieces.filter((p) => p.isEdge).map((p) => p.groupId));
    expect(engine.sortEdges(excluded)).toEqual({ total: 2, edges: 0, inner: 2 });
    expect(engine.zoneLabels.map((l) => l.text)).toEqual(['内側ピース (2)']);
  });

  it('has no inner block or label when every piece is an edge piece', () => {
    const engine = createEngine({ cols: 2, rows: 2 });
    expect(engine.sortEdges()).toEqual({ total: 4, edges: 4, inner: 0 });
    expect(engine.zoneLabels.map((l) => l.text)).toEqual(['外枠ピース (4)']);
  });

  it('leaves placed pieces, groups and excluded groups where they are', () => {
    const engine = createEngine();
    const [placed, grouped1, grouped2, excluded] = engine.pieces;
    dropNearTarget(engine, placed);
    grouped2.groupId = grouped1.groupId;
    const kept = [placed, grouped1, grouped2, excluded];
    const before = positions(kept);

    const result = engine.sortEdges(new Set([excluded.groupId]));
    expect(result.total).toBe(8);
    expect(positions(kept)).toEqual(before);
  });

  it('brings the sorted pieces to the front, in layout order', () => {
    const engine = createEngine();
    const placed = engine.pieces[5];
    dropNearTarget(engine, placed);
    const zVersion = engine.zVersion;
    engine.sortEdges();
    expect(engine.zVersion).toBeGreaterThan(zVersion);
    const sorted = engine.pieces.filter((p) => p !== placed);
    expect(Math.min(...sorted.map((p) => p.zOrder))).toBeGreaterThan(placed.zOrder ?? -1);
    const edges = sorted.filter((p) => p.isEdge);
    const zs = edges.map((p) => p.zOrder);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
  });
});

describe('sortByColor', () => {
  const ids = COLOR_BUCKETS.map((b) => b.id);

  /** 24 pieces in all seven buckets: 6 red, then 3 each (one 'magenta' that counts as neutral). */
  function colouredEngine() {
    const engine = createEngine({ cols: 6, rows: 4 });
    const buckets = [
      ...Array(6).fill('red'),
      ...['orange', 'green', 'cyan', 'blue', 'purple'].flatMap((id) => Array(3).fill(id)),
      'neutral',
      'neutral',
      'magenta',
    ];
    engine.pieces.forEach((p, i) => {
      p.colorInfo = { ...p.colorInfo, bucket: buckets[i] };
    });
    return engine;
  }

  const blockOf = (engine, id) =>
    engine.pieces.filter(
      (p) => p.colorInfo.bucket === id || (id === 'neutral' && !ids.includes(p.colorInfo.bucket)),
    );

  it('makes one block per colour around the board, apart from each other', () => {
    const engine = colouredEngine();
    expect(engine.sortByColor()).toEqual({ total: 24, bucketCount: 7 });
    const blocks = ids.map((id) => blockOf(engine, id));
    expect(blocks.map((b) => b.length)).toEqual([6, 3, 3, 3, 3, 3, 3]);
    const step = PUZZLE_CONFIG.SORT_STEP_RATIO;
    // Rows of max(2, min(4, ceil(sqrt(n)))): 3 for 6 pieces, 2 for 3.
    expect(blocks.map((b) => expectGrid(b, engine.pieceW * step, engine.pieceH * step))).toEqual([
      [3, 3],
      [2, 1],
      [2, 1],
      [2, 1],
      [2, 1],
      [2, 1],
      [2, 1],
    ]);
    expectApart([boardArea(engine), ...blocks.map((b) => area(engine, b))]);
  });

  it('goes clockwise from the top left, aligned towards the board and symmetric', () => {
    const engine = colouredEngine();
    engine.sortByColor();
    const [tl, top, tr, right, br, bottom, bl] = ids.map((id) => box(blockOf(engine, id)));
    // Left blocks end at the same x; right blocks start at its mirror image.
    expect(close(tl.maxX)).toBe(close(bl.maxX));
    for (const b of [tr, right, br]) expect(close(b.minX)).toBe(close(-tl.maxX));
    // Top blocks grow upwards from the same line; bottom blocks downwards from its mirror image.
    expect(close(tl.maxY)).toBe(close(tr.maxY));
    expect(close(br.minY)).toBe(close(-tl.maxY));
    expect(close(bl.minY)).toBe(close(-tl.maxY));
    // Middle blocks: centred on the axis, a little further out than the corners.
    for (const b of [top, bottom]) expect(b.minX + b.maxX).toBeCloseTo(0);
    expect(top.maxY).toBeLessThan(tl.maxY);
    expect(bottom.minY).toBeGreaterThan(bl.minY);
    expect(right.minY).toBeCloseTo(0);
  });

  it('labels each block above its middle, with its colour and count', () => {
    const engine = colouredEngine();
    engine.sortByColor();
    expect(engine.zoneLabels).toHaveLength(7);
    engine.zoneLabels.forEach((label, i) => {
      const bucket = COLOR_BUCKETS[i];
      const b = box(blockOf(engine, bucket.id));
      expect(label.text).toBe(`${bucket.label} (${blockOf(engine, bucket.id).length})`);
      expect(label.color).toBe(bucket.swatch);
      expect(close(label.x)).toBe(close((b.minX + b.maxX) / 2));
      expect(label.y).toBeLessThan(b.minY);
    });
    const gaps = engine.zoneLabels.map((label, i) => {
      const b = box(blockOf(engine, COLOR_BUCKETS[i].id));
      return close(b.minY - label.y);
    });
    expect(new Set(gaps).size).toBe(1);
  });

  it('skips empty colours, so the first used colour takes the top left', () => {
    const engine = createEngine();
    engine.pieces.forEach((p) => {
      p.colorInfo = { ...p.colorInfo, bucket: 'blue' };
    });
    expect(engine.sortByColor()).toEqual({ total: 12, bucketCount: 1 });
    const b = area(engine, engine.pieces);
    expect(b.maxX).toBeLessThan(-engine.boardW / 2);
    expect(b.maxY).toBeLessThan(-engine.boardH / 2);
    expect(engine.zoneLabels.map((l) => l.text)).toEqual(['青・紺系 (12)']);
  });
});

describe('sortByQuadrant', () => {
  const quadrantOf = (engine, p) =>
    (p.row < engine.rows / 2 ? 'N' : 'S') + (p.col < engine.cols / 2 ? 'W' : 'E');

  it.each([
    ['4 x 3', 4, 3, { NW: 4, NE: 4, SW: 2, SE: 2 }],
    ['5 x 3 (the middle column goes left)', 5, 3, { NW: 6, NE: 4, SW: 3, SE: 2 }],
    ['6 x 4 (two rows each)', 6, 4, { NW: 6, NE: 6, SW: 6, SE: 6 }],
  ])('moves each quarter of %s to its corner of the desk', (_, cols, rows, counts) => {
    const engine = createEngine({ cols, rows });
    expect(engine.sortByQuadrant()).toEqual({ total: cols * rows });
    const blocks = Object.fromEntries(
      Object.keys(counts).map((q) => [q, engine.pieces.filter((p) => quadrantOf(engine, p) === q)]),
    );
    expect(Object.fromEntries(Object.entries(blocks).map(([q, b]) => [q, b.length]))).toEqual(
      counts,
    );

    const nw = area(engine, blocks.NW);
    const se = area(engine, blocks.SE);
    expect(nw.maxX).toBeLessThan(-engine.boardW / 2);
    expect(nw.maxY).toBeLessThan(-engine.boardH / 2);
    expect(se.minX).toBeGreaterThan(engine.boardW / 2);
    expect(se.minY).toBeGreaterThan(engine.boardH / 2);
    expectApart([boardArea(engine), ...Object.values(blocks).map((b) => area(engine, b))]);

    // Aligned towards the board and symmetric.
    const [bNW, bNE, bSW, bSE] = ['NW', 'NE', 'SW', 'SE'].map((q) => box(blocks[q]));
    expect(close(bNE.minX)).toBe(close(-bNW.maxX));
    expect(close(bSW.maxX)).toBe(close(bNW.maxX));
    expect(close(bSE.minX)).toBe(close(-bNW.maxX));
    expect(close(bSW.minY)).toBe(close(-bNW.maxY));
    expect(close(bSE.minY)).toBe(close(-bNE.maxY));
  });

  it('lays out each quarter in rows and labels it above its middle', () => {
    const engine = createEngine({ cols: 6, rows: 4 });
    engine.sortByQuadrant();
    const step = PUZZLE_CONFIG.SORT_QUADRANT_STEP_RATIO;
    const names = { NW: '左上エリア', NE: '右上エリア', SW: '左下エリア', SE: '右下エリア' };
    expect(engine.zoneLabels.map((l) => l.text)).toEqual(
      Object.values(names).map((n) => `${n} (6)`),
    );
    const gaps = Object.keys(names).map((q, i) => {
      const block = engine.pieces.filter((p) => quadrantOf(engine, p) === q);
      // 6 pieces: rows of max(2, min(4, ceil(sqrt(6)))) = 3.
      expect(expectGrid(block, engine.pieceW * step, engine.pieceH * step)).toEqual([3, 3]);
      const b = box(block);
      expect(close(engine.zoneLabels[i].x)).toBe(close((b.minX + b.maxX) / 2));
      expect(engine.zoneLabels[i].y).toBeLessThan(b.minY);
      return close(b.minY - engine.zoneLabels[i].y);
    });
    // The label sits the same distance above every block, top or bottom.
    expect(new Set(gaps).size).toBe(1);
  });

  it('skips empty quarters', () => {
    const engine = createEngine();
    const excluded = new Set(engine.pieces.filter((p) => p.col >= 2).map((p) => p.groupId));
    expect(engine.sortByQuadrant(excluded)).toEqual({ total: 6 });
    expect(engine.zoneLabels.map((l) => l.text)).toEqual(['左上エリア (4)', '左下エリア (2)']);
  });
});

describe('alignAllUpright', () => {
  it('turns loose pieces upright and face up, except placed and excluded ones', () => {
    const engine = createEngine({ allowRotation: true, allowFlip: true });
    const [rotated, flipped, placed, excluded, upright] = engine.pieces;
    for (const p of engine.pieces) {
      p.rotation = 0;
      p.isFlipped = false;
    }
    rotated.rotation = 3;
    flipped.isFlipped = true;
    placed.rotation = 2;
    placed.isLocked = true;
    excluded.rotation = 1;

    expect(engine.alignAllUpright(new Set([excluded.groupId]))).toBe(2);
    expect([rotated.rotation, rotated.isFlipped]).toEqual([0, false]);
    expect([flipped.rotation, flipped.isFlipped]).toEqual([0, false]);
    expect(placed.rotation).toBe(2);
    expect(excluded.rotation).toBe(1);
    expect([upright.rotation, upright.isFlipped]).toEqual([0, false]);
    expect(engine.alignAllUpright()).toBe(1);
  });
});
