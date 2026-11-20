import { CUT_COMPLEXITY_CONFIG, PUZZLE_CONFIG } from '../config/constants.js';
import { mulberry32 } from './prng.js';

/**
 * Normalizes cutComplexity values including backward-compatibility aliases:
 * 'irregular' -> 'standard', 'extreme' -> 'complex'.
 */
export function normalizeCutComplexity(value) {
  if (value === 'uniform') return 'uniform';
  if (value === 'complex' || value === 'extreme') return 'complex';
  return 'standard';
}

/**
 * Clamps (cols, rows) to [MIN_GRID..MAX_GRID] and ensures cols * rows <= MAX_TOTAL_PIECES.
 */
export function clampGridDimensions(cols, rows) {
  let c = Math.max(
    PUZZLE_CONFIG.MIN_GRID,
    Math.min(PUZZLE_CONFIG.MAX_GRID, Math.round(Number(cols) || PUZZLE_CONFIG.DEFAULT_COLS)),
  );
  let r = Math.max(
    PUZZLE_CONFIG.MIN_GRID,
    Math.min(PUZZLE_CONFIG.MAX_GRID, Math.round(Number(rows) || PUZZLE_CONFIG.DEFAULT_ROWS)),
  );
  const maxTotal = PUZZLE_CONFIG.MAX_TOTAL_PIECES;
  if (c * r > maxTotal) {
    if (c >= r) {
      c = Math.max(PUZZLE_CONFIG.MIN_GRID, Math.floor(maxTotal / r));
    } else {
      r = Math.max(PUZZLE_CONFIG.MIN_GRID, Math.floor(maxTotal / c));
    }
  }
  return { cols: c, rows: r };
}

/**
 * Deterministically picks (cols, rows) in [MIN_GRID..MAX_GRID] closest to targetCount
 * (capped at MAX_TOTAL_PIECES) while keeping each piece close to square for the image aspect ratio.
 */
export function computeGridForPieceCount(targetCount, imgWidth, imgHeight) {
  const minG = PUZZLE_CONFIG.MIN_GRID;
  const maxG = PUZZLE_CONFIG.MAX_GRID;
  const maxTotal = PUZZLE_CONFIG.MAX_TOTAL_PIECES;
  const target = Math.max(minG * minG, Math.min(maxTotal, Math.round(Number(targetCount) || 24)));
  const aspect = Math.max(
    0.2,
    Math.min(5, (Number(imgWidth) || 3) / Math.max(1, Number(imgHeight) || 2)),
  );

  let bestCols = PUZZLE_CONFIG.DEFAULT_COLS;
  let bestRows = PUZZLE_CONFIG.DEFAULT_ROWS;
  let bestScore = Infinity;

  for (let r = minG; r <= maxG; r++) {
    for (let c = minG; c <= maxG; c++) {
      if (c * r > maxTotal) continue;
      const countDiff = Math.abs(c * r - target);
      const ratioPenalty = Math.abs(Math.log((aspect * r) / c)) * Math.max(2, target * 0.12);
      const score = countDiff + ratioPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestCols = c;
        bestRows = r;
      }
    }
  }
  return { cols: bestCols, rows: bestRows };
}

/**
 * Builds the (rows+1) x (cols+1) vertex grid, jittering inner vertices when warping.
 * Consumes rng only for inner vertices when warpRatio > 0.
 */
function buildWarpedGrid(rng, { cols, rows, boardW, boardH, complexity }) {
  const pieceW = boardW / cols;
  const pieceH = boardH / rows;
  const grid = [];
  const warpRatio = CUT_COMPLEXITY_CONFIG.WARP_RATIOS[complexity] ?? 0;
  const warpX = pieceW * warpRatio;
  const warpY = pieceH * warpRatio;

  for (let r = 0; r <= rows; r++) {
    const rowVerts = [];
    for (let c = 0; c <= cols; c++) {
      let x = -boardW / 2 + c * pieceW;
      let y = -boardH / 2 + r * pieceH;
      const isInner = r > 0 && r < rows && c > 0 && c < cols;
      if (isInner && warpRatio > 0) {
        x += (rng() * 2 - 1) * warpX;
        y += (rng() * 2 - 1) * warpY;
      }
      rowVerts.push({ x, y });
    }
    grid.push(rowVerts);
  }
  return grid;
}

/**
 * Returns a function that draws the parameters of one edge from rng.
 */
function createEdgeParamsFactory(rng, complexity) {
  const { STANDARD_ARCHETYPES, JITTER } = CUT_COMPLEXITY_CONFIG;

  return () => {
    const sign = rng() < 0.5 ? 1 : -1;

    if (complexity === 'uniform') {
      return {
        sign,
        uCenter: 0.5,
        depth: 0.96,
        headWidth: 0.18,
        neckWidth: 0.11,
        tilt: 0,
        asymL: 0,
        asymR: 0,
        shoulderBow: 0,
        shape: 'classic',
        secondSign: sign,
      };
    }

    const base = STANDARD_ARCHETYPES[Math.floor(rng() * STANDARD_ARCHETYPES.length)];
    const jitterScale = complexity === 'complex' ? JITTER.COMPLEX_MULT : 1.0;

    let shape = 'classic';
    if (complexity === 'complex') {
      const shapes = ['classic', 'classic', 'square', 'double'];
      shape = shapes[Math.floor(rng() * shapes.length)];
    }

    return {
      sign,
      uCenter: base.uCenter + (rng() * 2 - 1) * JITTER.U_CENTER * jitterScale,
      depth: base.depth + (rng() * 2 - 1) * JITTER.DEPTH * jitterScale,
      headWidth: base.headWidth + (rng() * 2 - 1) * JITTER.HEAD_WIDTH * jitterScale,
      neckWidth: base.neckWidth,
      tilt: base.tilt + (rng() * 2 - 1) * JITTER.TILT * jitterScale,
      asymL: (rng() * 2 - 1) * JITTER.EAR_ASYM * jitterScale,
      asymR: (rng() * 2 - 1) * JITTER.EAR_ASYM * jitterScale,
      shoulderBow: (rng() * 2 - 1) * JITTER.SHOULDER_BOW * jitterScale,
      shape,
      secondSign: rng() < 0.5 ? sign : -sign,
    };
  };
}

/**
 * Generates deterministic grid vertices and edge parameters from `seed` and `cutComplexity`.
 * cutComplexity: 'uniform' | 'standard' | 'complex'
 * @param {object} options
 * @param {number} options.cols grid column count
 * @param {number} options.rows grid row count
 * @param {number} options.boardW board width
 * @param {number} options.boardH board height
 * @param {number} options.seed PRNG seed
 * @param {string} [options.cutComplexity='standard'] cut complexity preset
 */
export function generateCutLayout({
  cols,
  rows,
  boardW,
  boardH,
  seed,
  cutComplexity = 'standard',
}) {
  const rng = mulberry32(seed);
  const complexity = normalizeCutComplexity(cutComplexity);
  const grid = buildWarpedGrid(rng, { cols, rows, boardW, boardH, complexity });
  const makeEdgeParams = createEdgeParamsFactory(rng, complexity);

  const hEdges = [];
  for (let r = 0; r < rows - 1; r++) {
    const rowArr = [];
    for (let c = 0; c < cols; c++) {
      rowArr.push(makeEdgeParams());
    }
    hEdges.push(rowArr);
  }

  const vEdges = [];
  for (let r = 0; r < rows; r++) {
    const rowArr = [];
    for (let c = 0; c < cols - 1; c++) {
      rowArr.push(makeEdgeParams());
    }
    vEdges.push(rowArr);
  }

  return { grid, hEdges, vEdges, complexity };
}

/**
 * Builds one bump of a "double" tab centred at uMid: three cubic segments.
 * `pt(u, v, amp)` maps edge-local coordinates to a point.
 */
function makeDoubleBump(pt, uMid, bumpAmp) {
  const w = 0.11;
  const pStart = pt(uMid - w * 1.4, 0, bumpAmp);
  const c1a = pt(uMid - w * 0.7, -0.05, bumpAmp);
  const c1b = pt(uMid - w * 0.9, 0.92, bumpAmp);
  const pTop = pt(uMid, 0.92, bumpAmp);
  const c2a = pt(uMid + w * 0.9, 0.92, bumpAmp);
  const c2b = pt(uMid + w * 0.7, -0.05, bumpAmp);
  const pEnd = pt(uMid + w * 1.4, 0, bumpAmp);
  return [
    { cp1: pStart, cp2: pStart, end: pStart },
    { cp1: c1a, cp2: c1b, end: pTop },
    { cp1: c2a, cp2: c2b, end: pEnd },
  ];
}

/**
 * Segments for the 'double' edge shape (two bumps joined in the middle).
 */
function buildDoubleEdgeSegments(pt, pB, edge, tabSize) {
  const amp1 = edge.sign * tabSize * 0.78;
  const amp2 = edge.secondSign * tabSize * 0.78;
  const b1 = makeDoubleBump(pt, 0.32, amp1);
  const b2 = makeDoubleBump(pt, 0.68, amp2);
  return [
    ...b1,
    { cp1: b1[2].end, cp2: b2[0].end, end: b2[0].end },
    ...b2,
    { cp1: b2[2].end, cp2: pB, end: pB },
  ];
}

/**
 * Segments for the 'square' edge shape (flat-headed tab).
 */
function buildSquareEdgeSegments(pt, pB, edge) {
  const uc = edge.uCenter;
  const sk = edge.tilt;
  const d = edge.depth;
  const neckL = uc - 0.11;
  const neckR = uc + 0.11;
  const headL = uc - 0.16 + sk * 0.5;
  const headR = uc + 0.16 + sk * 0.5;

  const p1 = pt(neckL, 0.18 * d);
  const p2 = pt(uc + sk * 0.5, 0.94 * d);
  const p3 = pt(neckR, 0.18 * d);

  return [
    { cp1: pt(neckL * 0.55, edge.shoulderBow), cp2: pt(neckL + 0.02, -0.04), end: p1 },
    { cp1: pt(headL, 0.45 * d), cp2: pt(headL, 0.94 * d), end: p2 },
    { cp1: pt(headR, 0.94 * d), cp2: pt(headR, 0.45 * d), end: p3 },
    {
      cp1: pt(neckR - 0.02, -0.04),
      cp2: pt(neckR + (1 - neckR) * 0.45, -edge.shoulderBow),
      end: pB,
    },
  ];
}

/**
 * Segments for the 'classic' (and 'uniform' / 'complex' non-special) edge shape.
 */
function buildClassicEdgeSegments(pt, pB, edge) {
  const uc = edge.uCenter;
  const sk = edge.tilt;
  const d = edge.depth;
  const neckL = uc - edge.neckWidth;
  const neckR = uc + edge.neckWidth;
  const hw = edge.headWidth;
  const p1U = neckL;
  const p1V = 0.18 * d;
  const p3U = neckR;
  const p3V = 0.18 * d;
  const p1 = pt(p1U, p1V);
  const p2 = pt(uc + sk, d);
  const p3 = pt(p3U, p3V);

  // Enforce C1-continuous collinear tangents at neck points p1 and p3
  const tanU = Math.max(0.038, (hw - edge.neckWidth) * 0.72);
  const tanV = 0.25 * d;
  const leadScale = 0.72;
  const exitScale = 1.08;

  return [
    {
      cp1: pt(neckL * 0.52, edge.shoulderBow),
      cp2: pt(p1U + tanU * leadScale, p1V - tanV * leadScale),
      end: p1,
    },
    {
      cp1: pt(p1U - tanU * exitScale, p1V + tanV * exitScale),
      cp2: pt(uc - hw * 0.96 + sk, (0.97 + edge.asymL * 0.35) * d),
      end: p2,
    },
    {
      cp1: pt(uc + hw * 0.96 + sk, (0.97 + edge.asymR * 0.35) * d),
      cp2: pt(p3U + tanU * exitScale, p3V + tanV * exitScale),
      end: p3,
    },
    {
      cp1: pt(p3U - tanU * leadScale, p3V - tanV * leadScale),
      cp2: pt(neckR + (1 - neckR) * 0.48, -edge.shoulderBow),
      end: pB,
    },
  ];
}

/**
 * Computes canonical cubic Bezier segments from pA to pB.
 * Explicit segments allow exact mathematical reversal so adjacent pieces share
 * bit-identical curves even when asymmetric or warped.
 * @param {{x: number, y: number}} pA start point
 * @param {{x: number, y: number}} pB end point
 * @param {{nx: number, ny: number, edge: object, tabSize: number}} options
 *   nx, ny: unit normal of the edge; edge: edge parameters; tabSize: tab amplitude
 */
function buildCanonicalEdgeSegments(pA, pB, { nx, ny, edge, tabSize }) {
  const dx = pB.x - pA.x;
  const dy = pB.y - pA.y;
  const amp = edge.sign * tabSize;

  const pt = (u, v, customAmp = amp) => ({
    x: pA.x + dx * u + nx * (v * customAmp),
    y: pA.y + dy * u + ny * (v * customAmp),
  });

  if (edge.shape === 'double') return buildDoubleEdgeSegments(pt, pB, edge, tabSize);
  if (edge.shape === 'square') return buildSquareEdgeSegments(pt, pB, edge);
  return buildClassicEdgeSegments(pt, pB, edge);
}

/**
 * Appends the edge from pA to pB onto `path`, reversed when `reverse` is true.
 * @param {Path2D} path target path
 * @param {{x: number, y: number}} pA start point
 * @param {{x: number, y: number}} pB end point
 * @param {{nx: number, ny: number, edge: object|null, tabSize: number, reverse: boolean}} options
 */
function appendEdgeSegments(path, pA, pB, { nx, ny, edge, tabSize, reverse }) {
  if (!edge) {
    path.lineTo(reverse ? pA.x : pB.x, reverse ? pA.y : pB.y);
    return;
  }

  const segs = buildCanonicalEdgeSegments(pA, pB, { nx, ny, edge, tabSize });
  if (!reverse) {
    for (const s of segs) {
      path.bezierCurveTo(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.end.x, s.end.y);
    }
  } else {
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      const prevPt = i === 0 ? pA : segs[i - 1].end;
      path.bezierCurveTo(s.cp2.x, s.cp2.y, s.cp1.x, s.cp1.y, prevPt.x, prevPt.y);
    }
  }
}

function unitRightNormal(pA, pB, clockwise90 = true) {
  const dx = pB.x - pA.x;
  const dy = pB.y - pA.y;
  const len = Math.hypot(dx, dy) || 1;
  if (clockwise90) {
    return { nx: -dy / len, ny: dx / len };
  }
  return { nx: dy / len, ny: -dx / len };
}

/**
 * Builds a Path2D centered at piece's nominal center (targetX, targetY).
 * @param {object} options
 * @param {number} options.row piece row
 * @param {number} options.col piece column
 * @param {number} options.cols grid column count
 * @param {number} options.rows grid row count
 * @param {number} options.targetX piece center X
 * @param {number} options.targetY piece center Y
 * @param {object} options.layout layout returned by generateCutLayout
 * @param {number} options.tabSize tab amplitude
 */
export function buildPiecePath({ row, col, cols, rows, targetX, targetY, layout, tabSize }) {
  const toLocal = (v) => ({ x: v.x - targetX, y: v.y - targetY });

  const tl = toLocal(layout.grid[row][col]);
  const tr = toLocal(layout.grid[row][col + 1]);
  const br = toLocal(layout.grid[row + 1][col + 1]);
  const bl = toLocal(layout.grid[row + 1][col]);

  const topEdge = row === 0 ? null : layout.hEdges[row - 1][col];
  const rightEdge = col === cols - 1 ? null : layout.vEdges[row][col];
  const bottomEdge = row === rows - 1 ? null : layout.hEdges[row][col];
  const leftEdge = col === 0 ? null : layout.vEdges[row][col - 1];

  const path = new Path2D();
  path.moveTo(tl.x, tl.y);

  {
    const { nx, ny } = unitRightNormal(tl, tr, true);
    appendEdgeSegments(path, tl, tr, { nx, ny, edge: topEdge, tabSize, reverse: false });
  }
  {
    const { nx, ny } = unitRightNormal(tr, br, false);
    appendEdgeSegments(path, tr, br, { nx, ny, edge: rightEdge, tabSize, reverse: false });
  }
  {
    const { nx, ny } = unitRightNormal(bl, br, true);
    appendEdgeSegments(path, bl, br, { nx, ny, edge: bottomEdge, tabSize, reverse: true });
  }
  {
    const { nx, ny } = unitRightNormal(tl, bl, false);
    appendEdgeSegments(path, tl, bl, { nx, ny, edge: leftEdge, tabSize, reverse: true });
  }

  path.closePath();
  return path;
}

/**
 * Creates a reusable cardboard-like backside pattern canvas for flipped pieces.
 */
export function createBacksidePatternCanvas() {
  const size = PUZZLE_CONFIG.BACKSIDE_PATTERN_SIZE;
  const pCanvas = document.createElement('canvas');
  pCanvas.width = size;
  pCanvas.height = size;
  const ctx = pCanvas.getContext('2d');

  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = -size; i <= size * 2; i += 16) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(226, 232, 240, 0.22)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 3, 0, Math.PI * 2);
  ctx.fill();

  return pCanvas;
}
