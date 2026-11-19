import { PUZZLE_CONFIG } from '../config/constants.js';

/**
 * Generates a colorful, high-contrast test illustration on an offscreen canvas
 * so users can play immediately without uploading an image.
 */
export function generateSampleImageCanvas(
  width = PUZZLE_CONFIG.SAMPLE_IMAGE_WIDTH,
  height = PUZZLE_CONFIG.SAMPLE_IMAGE_HEIGHT
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // 1. Sky & Ocean split background with vivid color regions
  const skyGrad = ctx.createLinearGradient(0, 0, width, height * 0.58);
  skyGrad.addColorStop(0, '#ff6b6b');
  skyGrad.addColorStop(0.35, '#fbbf24');
  skyGrad.addColorStop(0.68, '#38bdf8');
  skyGrad.addColorStop(1, '#7c3aed');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height * 0.58);

  const landGrad = ctx.createLinearGradient(0, height * 0.55, width, height);
  landGrad.addColorStop(0, '#10b981');
  landGrad.addColorStop(0.45, '#059669');
  landGrad.addColorStop(0.55, '#0284c7');
  landGrad.addColorStop(1, '#1e3a8a');
  ctx.fillStyle = landGrad;
  ctx.fillRect(0, height * 0.55, width, height * 0.45);

  // 2. Glowing Sun (Top-Left)
  const sunX = width * 0.19;
  const sunY = height * 0.24;
  const sunGlow = ctx.createRadialGradient(sunX, sunY, 15, sunX, sunY, 150);
  sunGlow.addColorStop(0, '#fef08a');
  sunGlow.addColorStop(0.45, 'rgba(250, 204, 21, 0.7)');
  sunGlow.addColorStop(1, 'rgba(251, 146, 60, 0)');
  ctx.fillStyle = sunGlow;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 150, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fef9c3';
  ctx.beginPath();
  ctx.arc(sunX, sunY, 54, 0, Math.PI * 2);
  ctx.fill();

  // 3. Rainbow Arc across the center sky
  const rainbowColors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#ec4899'];
  rainbowColors.forEach((col, i) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.56, 250 - i * 11, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
  });

  // 4. Layered Mountains
  const drawMountain = (pts, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();
    ctx.fill();
  };

  drawMountain([[0, height * 0.58], [width * 0.22, height * 0.34], [width * 0.44, height * 0.58]], '#4338ca');
  drawMountain([[width * 0.3, height * 0.58], [width * 0.54, height * 0.27], [width * 0.78, height * 0.58]], '#6d28d9');
  drawMountain([[width * 0.62, height * 0.58], [width * 0.84, height * 0.32], [width, height * 0.58]], '#312e81');

  drawMountain([[width * 0.48, height * 0.34], [width * 0.54, height * 0.27], [width * 0.6, height * 0.34], [width * 0.54, height * 0.32]], '#f8fafc');
  drawMountain([[width * 0.79, height * 0.38], [width * 0.84, height * 0.32], [width * 0.89, height * 0.38], [width * 0.84, height * 0.36]], '#e0f2fe');

  // 5. Rolling Green Hills (Bottom-Left) + Cute Houses
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.ellipse(width * 0.22, height * 0.76, width * 0.32, height * 0.19, 0, 0, Math.PI * 2);
  ctx.fill();

  const drawHouse = (hx, hy, roofCol, wallCol) => {
    ctx.fillStyle = wallCol;
    ctx.fillRect(hx - 24, hy - 22, 48, 34);
    ctx.fillStyle = roofCol;
    ctx.beginPath();
    ctx.moveTo(hx - 32, hy - 20);
    ctx.lineTo(hx, hy - 48);
    ctx.lineTo(hx + 32, hy - 20);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(hx - 14, hy - 14, 12, 12);
    ctx.fillStyle = '#78350f';
    ctx.fillRect(hx + 4, hy - 10, 11, 22);
  };

  drawHouse(width * 0.16, height * 0.73, '#ef4444', '#fef3c7');
  drawHouse(width * 0.29, height * 0.78, '#f97316', '#fce7f3');

  // 6. Sailboat & Waves (Bottom-Right)
  ctx.strokeStyle = 'rgba(186, 230, 253, 0.55)';
  ctx.lineWidth = 4;
  for (let row = 0; row < 4; row++) {
    const wy = height * (0.68 + row * 0.08);
    ctx.beginPath();
    for (let wx = width * 0.48; wx <= width; wx += 40) {
      ctx.quadraticCurveTo(wx + 10, wy - 8, wx + 20, wy);
      ctx.quadraticCurveTo(wx + 30, wy + 8, wx + 40, wy);
    }
    ctx.stroke();
  }

  const bx = width * 0.72;
  const by = height * 0.76;
  ctx.fillStyle = '#b45309';
  ctx.beginPath();
  ctx.moveTo(bx - 48, by);
  ctx.lineTo(bx + 48, by);
  ctx.lineTo(bx + 32, by + 22);
  ctx.lineTo(bx - 32, by + 22);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(bx - 4, by - 4);
  ctx.lineTo(bx - 4, by - 78);
  ctx.lineTo(bx + 38, by - 14);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#f43f5e';
  ctx.beginPath();
  ctx.moveTo(bx - 10, by - 4);
  ctx.lineTo(bx - 10, by - 60);
  ctx.lineTo(bx - 42, by - 10);
  ctx.closePath();
  ctx.fill();

  // 7. Frame & Corner Compass Badges
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, width - 24, height - 24);

  const corners = [
    { label: 'NW', x: 48, y: 48, bg: '#ef4444' },
    { label: 'NE', x: width - 48, y: 48, bg: '#8b5cf6' },
    { label: 'SW', x: 48, y: height - 48, bg: '#10b981' },
    { label: 'SE', x: width - 48, y: height - 48, bg: '#0284c7' },
  ];
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const c of corners) {
    ctx.fillStyle = c.bg;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(c.label, c.x, c.y + 1);
  }

  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.beginPath();
  ctx.roundRect(width / 2 - 150, 26, 300, 40, 20);
  ctx.fill();
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('COLLAB JIGSAW SAMPLE', width / 2, 47);

  return canvas;
}
