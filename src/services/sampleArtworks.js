function drawPolygon(ctx, pts, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.closePath();
  ctx.fill();
}

function drawStarrySkyAndMoon(ctx, width, height, horizonY) {
  const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
  sky.addColorStop(0, '#070b1a');
  sky.addColorStop(0.55, '#1e1b4b');
  sky.addColorStop(1, '#312e81');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizonY);

  const aurora = ctx.createLinearGradient(0, height * 0.08, width, height * 0.42);
  aurora.addColorStop(0, 'rgba(45, 212, 191, 0.35)');
  aurora.addColorStop(0.5, 'rgba(56, 189, 248, 0.4)');
  aurora.addColorStop(1, 'rgba(168, 85, 247, 0.35)');
  ctx.fillStyle = aurora;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.25);
  ctx.bezierCurveTo(width * 0.28, height * 0.05, width * 0.62, height * 0.4, width, height * 0.16);
  ctx.lineTo(width, height * 0.34);
  ctx.bezierCurveTo(width * 0.64, height * 0.52, width * 0.3, height * 0.18, 0, height * 0.4);
  ctx.closePath();
  ctx.fill();

  for (let i = 0; i < 65; i++) {
    const sx = ((i * 173 + 37) % 97) * (width / 97);
    const sy = ((i * 97 + 19) % 58) * (height / 100);
    const r = (i % 4 === 0 ? 2.8 : 1.5) * (width / 960);
    ctx.fillStyle = i % 5 === 0 ? '#fde68a' : '#f8fafc';
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const mx = width * 0.78;
  const my = height * 0.21;
  const halo = ctx.createRadialGradient(mx, my, 10, mx, my, width * 0.14);
  halo.addColorStop(0, 'rgba(254, 240, 138, 0.7)');
  halo.addColorStop(1, 'rgba(254, 240, 138, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(mx, my, width * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fef08a';
  ctx.beginPath();
  ctx.arc(mx, my, width * 0.055, 0, Math.PI * 2);
  ctx.fill();
}

function drawStarryTownAndLake(ctx, width, height, horizonY) {
  drawPolygon(
    ctx,
    [
      [0, horizonY],
      [width * 0.18, height * 0.44],
      [width * 0.4, horizonY],
    ],
    '#1e293b',
  );
  drawPolygon(
    ctx,
    [
      [width * 0.32, horizonY],
      [width * 0.58, height * 0.38],
      [width * 0.85, horizonY],
    ],
    '#0f172a',
  );

  const lake = ctx.createLinearGradient(0, horizonY, 0, height);
  lake.addColorStop(0, '#0f172a');
  lake.addColorStop(1, '#1e3a8a');
  ctx.fillStyle = lake;
  ctx.fillRect(0, horizonY, width, height - horizonY);

  const buildings = [
    { x: 0.08, w: 0.09, h: 0.17, col: '#1e293b' },
    { x: 0.18, w: 0.08, h: 0.22, col: '#334155' },
    { x: 0.27, w: 0.1, h: 0.14, col: '#1e293b' },
    { x: 0.4, w: 0.09, h: 0.24, col: '#0f172a' },
    { x: 0.51, w: 0.11, h: 0.19, col: '#334155' },
    { x: 0.65, w: 0.08, h: 0.21, col: '#1e293b' },
    { x: 0.76, w: 0.12, h: 0.16, col: '#334155' },
  ];
  for (const b of buildings) {
    const bx = width * b.x;
    const bw = width * b.w;
    const bh = height * b.h;
    ctx.fillStyle = b.col;
    ctx.fillRect(bx, horizonY - bh, bw, bh);
    const rows = Math.max(2, Math.floor(b.h * 22));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 3; c++) {
        if ((r + c) % 3 === 1) continue;
        const wx = bx + bw * (0.18 + c * 0.26);
        const wy = horizonY - bh + height * 0.025 + r * height * 0.036;
        if (wy + 10 > horizonY) continue;
        ctx.fillStyle = (r + c) % 2 === 0 ? '#fde047' : '#fb923c';
        ctx.fillRect(wx, wy, bw * 0.16, height * 0.018);
        ctx.fillStyle = 'rgba(253, 224, 71, 0.22)';
        ctx.fillRect(wx, horizonY + (horizonY - wy) * 0.65, bw * 0.16, height * 0.012);
      }
    }
  }
}

export function drawStarrySample(ctx, width, height) {
  const horizonY = height * 0.64;
  drawStarrySkyAndMoon(ctx, width, height, horizonY);
  drawStarryTownAndLake(ctx, width, height, horizonY);
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.7)';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, width - 20, height - 20);
}

// ============================================================
// 共通数理・カラーユーティリティ
// ============================================================
function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function lerpColor(hex1, hex2, t) {
  const c1 = parseInt(hex1.slice(1), 16);
  const c2 = parseInt(hex2.slice(1), 16);
  const r1 = (c1 >> 16) & 255;
  const g1 = (c1 >> 8) & 255;
  const b1 = c1 & 255;
  const r2 = (c2 >> 16) & 255;
  const g2 = (c2 >> 8) & 255;
  const b2 = c2 & 255;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

function multiStopGradient(stops, t) {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  return lerpColor(stops[idx], stops[idx + 1], frac);
}

// ============================================================
// 3. クリスタル山脈の夕暮れ (Delaunay Low-Poly)
// ============================================================
const LOWPOLY_SKY_STOPS = ['#182949', '#2c4d75', '#4c7c96', '#eab875', '#e2735b'];
const LOWPOLY_SUNSET_STOPS = ['#e8986b', '#d15e52', '#754468', '#355c7d', '#243b55'];

function buildLowPolyGrid(w, h, cols, rows) {
  const cellW = w / cols;
  const cellH = h / rows;
  const pts = [];
  for (let r = 0; r <= rows; r++) {
    pts[r] = [];
    for (let c = 0; c <= cols; c++) {
      const onEdgeX = c === 0 || c === cols;
      const onEdgeY = r === 0 || r === rows;
      const jx = onEdgeX ? 0 : (hash(r * 31 + c * 17) - 0.5) * cellW * 0.68;
      const jy = onEdgeY ? 0 : (hash(r * 47 + c * 29) - 0.5) * cellH * 0.68;
      const x = c * cellW + jx;
      const y = r * cellH + jy;
      const nx = c / cols;
      const ny = r / rows;
      const z =
        Math.sin(nx * Math.PI * 2.5) * Math.cos(ny * Math.PI * 1.5) * 40 +
        hash(r * 13 + c * 7) * 35;
      pts[r][c] = { x, y, z };
    }
  }
  return pts;
}

function drawLowPolyTriangle(ctx, tri, dims, seed) {
  const [p1, p2, p3] = tri;
  const { w, h } = dims;
  const cx = (p1.x + p2.x + p3.x) / 3;
  const cy = (p1.y + p2.y + p3.y) / 3;

  const ux = p2.x - p1.x;
  const uy = p2.y - p1.y;
  const uz = p2.z - p1.z;
  const vx = p3.x - p1.x;
  const vy = p3.y - p1.y;
  const vz = p3.z - p1.z;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;

  const light = nx * 0.45 + ny * 0.35 + Math.abs(nz) * 0.7;
  const t = (cy / h) * 0.68 + (cx / w) * 0.32 + (hash(seed) - 0.5) * 0.08;
  const baseHexStops = cy < h * 0.48 ? LOWPOLY_SKY_STOPS : LOWPOLY_SUNSET_STOPS;
  const baseCol = multiStopGradient(baseHexStops, Math.max(0, Math.min(1, t)));

  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();

  ctx.fillStyle = baseCol;
  ctx.fill();

  ctx.fillStyle =
    light > 0.55
      ? `rgba(255, 245, 220, ${(light - 0.55) * 0.45})`
      : `rgba(15, 20, 40, ${(0.55 - light) * 0.5})`;
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = Math.max(0.7, w / 960);
  ctx.stroke();
}

export function drawDelaunayLowPoly(ctx, w, h) {
  const cols = 16;
  const rows = 11;
  const pts = buildLowPolyGrid(w, h, cols, rows);
  const dims = { w, h };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p00 = pts[r][c];
      const p10 = pts[r][c + 1];
      const p01 = pts[r + 1][c];
      const p11 = pts[r + 1][c + 1];
      const d1 = Math.hypot(p00.x - p11.x, p00.y - p11.y);
      const d2 = Math.hypot(p10.x - p01.x, p10.y - p01.y);
      if (d1 < d2) {
        drawLowPolyTriangle(ctx, [p00, p10, p11], dims, r * 100 + c * 2);
        drawLowPolyTriangle(ctx, [p00, p11, p01], dims, r * 100 + c * 2 + 1);
      } else {
        drawLowPolyTriangle(ctx, [p00, p10, p01], dims, r * 100 + c * 2);
        drawLowPolyTriangle(ctx, [p10, p11, p01], dims, r * 100 + c * 2 + 1);
      }
    }
  }
}

// ============================================================
// 4. 黄金四分木バウハウス (Bauhaus Quadtree)
// ============================================================
const BAUHAUS_PALETTE = ['#1f3247', '#d95b43', '#e5a93c', '#3b7a75', '#7a4968', '#2d4c3e'];
const BAUHAUS_BG_LIST = ['#f4efe4', '#eae0ce', '#22303f', '#dfdad0'];

function drawBauhausCornerArc(ctx, rect, colors, seed) {
  const { x, y, sw, sh } = rect;
  const { c1, c2 } = colors;
  const r = Math.min(sw, sh);
  const corner = Math.floor(hash(seed * 29) * 4);
  const ox = corner % 2 === 0 ? x : x + sw;
  const oy = corner < 2 ? y : y + sh;
  ctx.beginPath();
  ctx.arc(ox, oy, r, 0, Math.PI * 2);
  ctx.fillStyle = c1;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ox, oy, r * 0.52, 0, Math.PI * 2);
  ctx.fillStyle = c2;
  ctx.fill();
}

function drawBauhausShape(ctx, rect, colors, seed) {
  const { x, y, sw, sh } = rect;
  const { c1, c2, bgCol } = colors;
  const cx = x + sw * 0.5;
  const cy = y + sh * 0.5;
  const r = Math.min(sw, sh);
  const shapeType = Math.floor(hash(seed * 23) * 5);

  if (shapeType === 0) {
    drawBauhausCornerArc(ctx, rect, colors, seed);
    return;
  }
  if (shapeType === 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = c1;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = bgCol === '#22303f' ? '#f4efe4' : c2;
    ctx.fill();
    return;
  }
  if (shapeType === 2) {
    drawPolygon(
      ctx,
      [
        [x, y],
        [x + sw, y],
        [x, y + sh],
      ],
      c1,
    );
    ctx.beginPath();
    ctx.arc(x + sw, y + sh, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = c2;
    ctx.fill();
    return;
  }
  if (shapeType === 3) {
    const stripes = 5;
    ctx.fillStyle = c2;
    for (let i = 0; i < stripes; i += 2) {
      ctx.fillRect(x + (sw / stripes) * i, y, sw / stripes, sh);
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = c1;
    ctx.fill();
    return;
  }
  drawPolygon(
    ctx,
    [
      [cx, y + sh * 0.08],
      [x + sw * 0.92, cy],
      [cx, y + sh * 0.92],
      [x + sw * 0.08, cy],
    ],
    c1,
  );
}

function drawBauhausLeaf(ctx, rect, bounds, seed) {
  const { x, y, sw, sh } = rect;
  const { w, h } = bounds;
  const cx = x + sw * 0.5;
  const cy = y + sh * 0.5;
  const zoneIdx = Math.floor((cx / w) * 3) + Math.floor((cy / h) * 2) * 3;
  const c1 = BAUHAUS_PALETTE[(zoneIdx + Math.floor(hash(seed) * 2)) % BAUHAUS_PALETTE.length];
  const c2 =
    BAUHAUS_PALETTE[(zoneIdx + 2 + Math.floor(hash(seed * 3) * 2)) % BAUHAUS_PALETTE.length];
  const bgCol = BAUHAUS_BG_LIST[Math.floor(hash(seed * 11) * BAUHAUS_BG_LIST.length)];

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, sw, sh);
  ctx.clip();

  ctx.fillStyle = bgCol;
  ctx.fillRect(x, y, sw, sh);
  drawBauhausShape(ctx, rect, { c1, c2, bgCol }, seed);

  ctx.strokeStyle = '#22303f';
  ctx.lineWidth = Math.max(1.5, w / 480);
  ctx.strokeRect(x, y, sw, sh);
  ctx.restore();
}

function subdivideBauhaus(ctx, rect, bounds, state) {
  const { x, y, sw, sh } = rect;
  const { w, h } = bounds;
  const { depth, seed } = state;
  const minSize = Math.min(w, h) * 0.11;
  const shouldSplit =
    depth < 2 || (depth < 4 && Math.min(sw, sh) > minSize && hash(seed * 19) > 0.28);

  if (!shouldSplit) {
    drawBauhausLeaf(ctx, rect, bounds, seed);
    return;
  }

  const ratio = depth === 0 ? 0.5 : hash(seed * 7) > 0.5 ? 0.5 : 0.618;
  if (sw > sh * 1.15) {
    const w1 = sw * ratio;
    subdivideBauhaus(ctx, { x, y, sw: w1, sh }, bounds, { depth: depth + 1, seed: seed * 2 + 1 });
    subdivideBauhaus(ctx, { x: x + w1, y, sw: sw - w1, sh }, bounds, {
      depth: depth + 1,
      seed: seed * 2 + 2,
    });
    return;
  }
  if (sh > sw * 1.15) {
    const h1 = sh * ratio;
    subdivideBauhaus(ctx, { x, y, sw, sh: h1 }, bounds, { depth: depth + 1, seed: seed * 2 + 3 });
    subdivideBauhaus(ctx, { x, y: y + h1, sw, sh: sh - h1 }, bounds, {
      depth: depth + 1,
      seed: seed * 2 + 4,
    });
    return;
  }
  const hw = sw * 0.5;
  const hh = sh * 0.5;
  subdivideBauhaus(ctx, { x, y, sw: hw, sh: hh }, bounds, {
    depth: depth + 1,
    seed: seed * 4 + 1,
  });
  subdivideBauhaus(ctx, { x: x + hw, y, sw: sw - hw, sh: hh }, bounds, {
    depth: depth + 1,
    seed: seed * 4 + 2,
  });
  subdivideBauhaus(ctx, { x, y: y + hh, sw: hw, sh: sh - hh }, bounds, {
    depth: depth + 1,
    seed: seed * 4 + 3,
  });
  subdivideBauhaus(ctx, { x: x + hw, y: y + hh, sw: sw - hw, sh: sh - hh }, bounds, {
    depth: depth + 1,
    seed: seed * 4 + 4,
  });
}

export function drawBauhausQuadtree(ctx, w, h) {
  ctx.fillStyle = '#f4efe4';
  ctx.fillRect(0, 0, w, h);
  subdivideBauhaus(ctx, { x: 0, y: 0, sw: w, sh: h }, { w, h }, { depth: 0, seed: 42 });
}

// ============================================================
// 6. 麻の葉ハニカム文様 (Hexagon Pinwheel)
// ============================================================
const HEX_PINWHEEL_PALETTE = [
  '#264653',
  '#2a9d8f',
  '#e9c46a',
  '#f4a261',
  '#e76f51',
  '#6d597a',
  '#b56576',
  '#355070',
];

function fillHexSubTriangles(ctx, center, verts, baseIdx) {
  const { cx, cy } = center;
  for (let i = 0; i < 6; i++) {
    const v1 = verts[i];
    const v2 = verts[(i + 1) % 6];
    const tx = (cx + v1.x + v2.x) / 3;
    const ty = (cy + v1.y + v2.y) / 3;
    const cMain = HEX_PINWHEEL_PALETTE[(baseIdx + (i % 3)) % HEX_PINWHEEL_PALETTE.length];
    const cSub = HEX_PINWHEEL_PALETTE[(baseIdx + 2 + ((i + 1) % 3)) % HEX_PINWHEEL_PALETTE.length];
    const cOuter =
      i % 2 === 0 ? '#f6f1e7' : HEX_PINWHEEL_PALETTE[(baseIdx + 4) % HEX_PINWHEEL_PALETTE.length];

    drawPolygon(
      ctx,
      [
        [cx, cy],
        [v1.x, v1.y],
        [tx, ty],
      ],
      cMain,
    );
    drawPolygon(
      ctx,
      [
        [cx, cy],
        [tx, ty],
        [v2.x, v2.y],
      ],
      cSub,
    );
    drawPolygon(
      ctx,
      [
        [v1.x, v1.y],
        [v2.x, v2.y],
        [tx, ty],
      ],
      cOuter,
    );
  }
}

function strokeHexPinwheel(ctx, center, verts, w) {
  const { cx, cy } = center;
  ctx.strokeStyle = '#f6f1e7';
  ctx.lineWidth = Math.max(1.2, w / 640);
  for (let i = 0; i < 6; i++) {
    const v1 = verts[i];
    const v2 = verts[(i + 1) % 6];
    const tx = (cx + v1.x + v2.x) / 3;
    const ty = (cy + v1.y + v2.y) / 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(v1.x, v1.y);
    ctx.lineTo(v2.x, v2.y);
    ctx.moveTo(cx, cy);
    ctx.lineTo(tx, ty);
    ctx.lineTo(v1.x, v1.y);
    ctx.moveTo(tx, ty);
    ctx.lineTo(v2.x, v2.y);
    ctx.stroke();
  }

  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    if (i === 0) ctx.moveTo(verts[i].x, verts[i].y);
    else ctx.lineTo(verts[i].x, verts[i].y);
  }
  ctx.closePath();
  ctx.strokeStyle = '#1d2d35';
  ctx.lineWidth = Math.max(2, w / 420);
  ctx.stroke();
}

export function drawHexagonPinwheel(ctx, w, h) {
  ctx.fillStyle = '#f2ece1';
  ctx.fillRect(0, 0, w, h);

  const radius = w / 11;
  const hexH = Math.sqrt(3) * radius;
  const stepX = radius * 1.5;
  const stepY = hexH;
  const cols = Math.ceil(w / stepX) + 2;
  const rows = Math.ceil(h / stepY) + 2;

  for (let c = -1; c <= cols; c++) {
    for (let r = -1; r <= rows; r++) {
      const cx = c * stepX;
      const cy = r * stepY + ((c & 1) !== 0 ? hexH * 0.5 : 0);
      const verts = [];
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        verts.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
      }
      const baseIdx = Math.max(0, Math.floor((cx / w) * 4 + (cy / h) * 3));
      const center = { cx, cy };
      fillHexSubTriangles(ctx, center, verts, baseIdx);
      strokeHexPinwheel(ctx, center, verts, w);
    }
  }
}
