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

function drawGeometricCell(ctx, { x, y, cellW, cellH, baseCol, accentCol, kind }) {
  ctx.fillStyle = baseCol;
  ctx.fillRect(x, y, cellW, cellH);

  ctx.fillStyle = accentCol;
  if (kind === 0) {
    ctx.beginPath();
    ctx.arc(x + cellW / 2, y + cellH / 2, Math.min(cellW, cellH) * 0.34, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 1) {
    drawPolygon(
      ctx,
      [
        [x + cellW / 2, y + cellH * 0.14],
        [x + cellW * 0.86, y + cellH * 0.84],
        [x + cellW * 0.14, y + cellH * 0.84],
      ],
      accentCol,
    );
  } else {
    drawPolygon(
      ctx,
      [
        [x + cellW / 2, y + cellH * 0.12],
        [x + cellW * 0.88, y + cellH / 2],
        [x + cellW / 2, y + cellH * 0.88],
        [x + cellW * 0.12, y + cellH / 2],
      ],
      accentCol,
    );
  }
}

export function drawGeometricSample(ctx, width, height) {
  const palette = [
    '#ef4444',
    '#f97316',
    '#facc15',
    '#22c55e',
    '#06b6d4',
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
  ];
  const cols = 4;
  const rows = 3;
  const cellW = width / cols;
  const cellH = height / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = (r * cols + c) % palette.length;
      drawGeometricCell(ctx, {
        x: c * cellW,
        y: r * cellH,
        cellW,
        cellH,
        baseCol: palette[idx],
        accentCol: palette[(idx + 3) % palette.length],
        kind: (r + c) % 3,
      });
    }
  }

  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 6;
  for (let c = 1; c < cols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * cellW, 0);
    ctx.lineTo(c * cellW, height);
    ctx.stroke();
  }
  for (let r = 1; r < rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * cellH);
    ctx.lineTo(width, r * cellH);
    ctx.stroke();
  }

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, Math.min(width, height) * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = '#fef08a';
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, Math.min(width, height) * 0.065, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, width - 10, height - 10);
}

function drawBlossom(ctx, { cx, cy, outerR, petals, petalCol, innerCol }) {
  for (let i = 0; i < petals; i++) {
    const angle = (i * Math.PI * 2) / petals;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = petalCol;
    ctx.beginPath();
    ctx.ellipse(outerR * 0.56, 0, outerR * 0.44, outerR * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = innerCol;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

export function drawBotanicalSample(ctx, width, height) {
  const bg = ctx.createRadialGradient(
    width / 2,
    height / 2,
    20,
    width / 2,
    height / 2,
    width * 0.65,
  );
  bg.addColorStop(0, '#0f766e');
  bg.addColorStop(0.65, '#065f46');
  bg.addColorStop(1, '#022c22');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const ringRadii = [0.42, 0.34, 0.25];
  for (const ratio of ringRadii) {
    ctx.strokeStyle = 'rgba(253, 230, 138, 0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, Math.min(width, height) * ratio, 0, Math.PI * 2);
    ctx.stroke();
  }

  const baseR = Math.min(width, height);
  drawBlossom(ctx, {
    cx: width / 2,
    cy: height / 2,
    outerR: baseR * 0.42,
    petals: 12,
    petalCol: '#10b981',
    innerCol: '#047857',
  });
  drawBlossom(ctx, {
    cx: width / 2,
    cy: height / 2,
    outerR: baseR * 0.33,
    petals: 10,
    petalCol: '#fb7185',
    innerCol: '#f59e0b',
  });
  drawBlossom(ctx, {
    cx: width / 2,
    cy: height / 2,
    outerR: baseR * 0.21,
    petals: 8,
    petalCol: '#fde047',
    innerCol: '#f97316',
  });

  const cornerSpots = [
    [width * 0.14, height * 0.2, '#f472b6', '#fef08a'],
    [width * 0.86, height * 0.2, '#38bdf8', '#fef08a'],
    [width * 0.14, height * 0.8, '#fbbf24', '#f43f5e'],
    [width * 0.86, height * 0.8, '#a78bfa', '#fef08a'],
  ];
  for (const [cx, cy, petalCol, innerCol] of cornerSpots) {
    drawBlossom(ctx, {
      cx,
      cy,
      outerR: baseR * 0.16,
      petals: 8,
      petalCol: '#34d399',
      innerCol: '#064e3b',
    });
    drawBlossom(ctx, { cx, cy, outerR: baseR * 0.12, petals: 6, petalCol, innerCol });
  }

  ctx.strokeStyle = 'rgba(254, 240, 138, 0.75)';
  ctx.lineWidth = 8;
  ctx.strokeRect(12, 12, width - 24, height - 24);
}
