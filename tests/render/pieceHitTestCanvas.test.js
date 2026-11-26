import { describe, expect, it } from 'vitest';
import { isPointInOutline } from '../../src/core/pieceHitTest.js';
import { mulberry32 } from '../../src/core/prng.js';
import { outlineToPath2D } from '../../src/render/pieceSpriteBuilder.js';
import { createEngine } from '../helpers/puzzle.js';

// Hit testing moved from canvas isPointInPath to a polygon test on the outline data. The two must
// agree everywhere except right at the outline, where the polygon approximates the curves.
// Runs in the browser for the real canvas; the rest of the hit test lives in
// tests/core/pieceHitTest.node.test.js.
const EDGE_TOLERANCE = 0.5; // world units; a screen pixel is at least 1/3 unit at max zoom

/** Fine polyline of the outline, used only to measure how close a point is to the edge. */
function fineOutline(outline, steps = 200) {
  const pts = [];
  let px = 0;
  let py = 0;
  const cubic = (t, a, b, c, d) =>
    (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;
  for (const c of outline.commands) {
    if (c.op === 'C') {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        pts.push([cubic(t, px, c.x1, c.x2, c.x), cubic(t, py, c.y1, c.y2, c.y)]);
      }
    } else {
      pts.push([c.x, c.y]);
    }
    px = c.x;
    py = c.y;
  }
  return pts;
}

function distanceToPolyline(pts, x, y) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

describe.each(['standard', 'uniform', 'complex'])('hit test, %s cut', (cutComplexity) => {
  it('agrees with canvas isPointInPath except right at the outline', () => {
    const engine = createEngine({ cols: 6, rows: 5, cutComplexity, seed: 777 });
    const ctx = document.createElement('canvas').getContext('2d');
    const rng = mulberry32(99);
    const reach = Math.max(engine.pieceW, engine.pieceH) / 2 + engine.spritePad;
    let checked = 0;
    let disagreements = 0;

    for (const piece of engine.pieces) {
      const fine = fineOutline(piece.outline);
      const path = outlineToPath2D(piece.outline);
      for (let i = 0; i < 300; i++) {
        const x = (rng() * 2 - 1) * reach;
        const y = (rng() * 2 - 1) * reach;
        const expected = ctx.isPointInPath(path, x, y);
        checked++;
        if (isPointInOutline(piece.outline, x, y) !== expected) {
          disagreements++;
          expect(distanceToPolyline(fine, x, y)).toBeLessThan(EDGE_TOLERANCE);
        }
      }
    }
    expect(checked).toBe(engine.pieces.length * 300);
    // Disagreements are rare boundary cases, not a systematic difference.
    expect(disagreements / checked).toBeLessThan(0.005);
  });
});
