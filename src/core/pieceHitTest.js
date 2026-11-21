/**
 * Point-in-piece test on the plain-data outline (core/jigsawPath.js buildPieceOutline), so hit
 * testing needs no canvas. Each cubic Bezier is flattened into a polygon once per outline and
 * cached; fake pieces share their source piece's outline object and therefore its polygon.
 */

/** Line segments per cubic Bezier. The error at the outline is far below a screen pixel. */
const CURVE_STEPS = 12;

const polygonCache = new WeakMap();

function cubicPoint(t, a, b, c, d) {
  const mt = 1 - t;
  return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
}

/** Flattens an outline into a closed polygon: Float32Array [x0, y0, x1, y1, ...]. */
function flattenOutline(outline) {
  const pts = [];
  let px = 0;
  let py = 0;
  for (const c of outline.commands) {
    if (c.op === 'C') {
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS;
        pts.push(cubicPoint(t, px, c.x1, c.x2, c.x), cubicPoint(t, py, c.y1, c.y2, c.y));
      }
    } else {
      pts.push(c.x, c.y);
    }
    px = c.x;
    py = c.y;
  }
  return Float32Array.from(pts);
}

function polygonOf(outline) {
  let poly = polygonCache.get(outline);
  if (!poly) {
    poly = flattenOutline(outline);
    polygonCache.set(outline, poly);
  }
  return poly;
}

/** True when the point (x, y), in the outline's local coordinates, is inside the piece. */
export function isPointInOutline(outline, x, y) {
  const poly = polygonOf(outline);
  const n = poly.length;
  let inside = false;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = poly[i];
    const yi = poly[i + 1];
    const xj = poly[j];
    const yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
