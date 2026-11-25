import { PUZZLE_CONFIG, SAMPLE_CAPTIONS } from '../config/constants.js';
import {
  drawBauhausQuadtree,
  drawDelaunayLowPoly,
  drawHexagonPinwheel,
  drawStarrySample,
} from './sampleArtworks.js';

export const DEFAULT_SAMPLE_IMAGE_ID = PUZZLE_CONFIG.DEFAULT_SAMPLE_IMAGE_ID;
const FALLBACK_PROCEDURAL_SAMPLE_ID = 'delaunay-lowpoly';

/**
 * Colour grading applied to every sample: more saturated and contrasty, like a picture book or
 * a board game box. Same steps as the CSS filter `saturate(1.35) contrast(1.12)
 * brightness(1.03)`, computed on the pixels so every browser (host and guests alike, since
 * guests draw the sample themselves) gets the same colours.
 */
const VIVID = Object.freeze({ saturate: 1.35, contrast: 1.12, brightness: 1.03 });

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function gradeVivid(ctx, width, height) {
  const img = ctx.getImageData(0, 0, width, height);
  const px = img.data;
  const s = VIVID.saturate;
  // The W3C saturate() matrix.
  const m = [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ];
  const tone = (v) => clamp255(clamp255((v - 127.5) * VIVID.contrast + 127.5) * VIVID.brightness);
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    px[i] = tone(clamp255(m[0][0] * r + m[0][1] * g + m[0][2] * b));
    px[i + 1] = tone(clamp255(m[1][0] * r + m[1][1] * g + m[1][2] * b));
    px[i + 2] = tone(clamp255(m[2][0] * r + m[2][1] * g + m[2][2] * b));
  }
  ctx.putImageData(img, 0, 0);
}

export const SAMPLE_IMAGE_PRESETS = Object.freeze([
  Object.freeze({
    id: 'met-seaside',
    name: '海辺にて',
    hint: 'W. M. チェイス',
    kind: 'artwork',
    width: 2048,
    height: 1230,
    assetUrl: 'assets/artworks/met-10464-seaside.webp',
    thumbUrl: 'assets/artworks/met-10464-seaside-thumb.webp',
    caption: SAMPLE_CAPTIONS['met-seaside'],
  }),
  Object.freeze({
    id: 'met-fruit',
    name: 'ザクロと果物の静物',
    hint: 'A. ブリューゲル',
    kind: 'artwork',
    width: 1901,
    height: 1600,
    assetUrl: 'assets/artworks/met-436752-fruit.webp',
    thumbUrl: 'assets/artworks/met-436752-fruit-thumb.webp',
    caption: SAMPLE_CAPTIONS['met-fruit'],
  }),
  Object.freeze({
    id: 'met-irises',
    name: 'アイリス',
    hint: 'V. ファン・ゴッホ',
    kind: 'artwork',
    width: 2018,
    height: 1600,
    assetUrl: 'assets/artworks/met-436528-irises.webp',
    thumbUrl: 'assets/artworks/met-436528-irises-thumb.webp',
    caption: SAMPLE_CAPTIONS['met-irises'],
  }),
  Object.freeze({
    id: 'delaunay-lowpoly',
    name: 'クリスタル山脈の夕暮れ',
    hint: 'ドロネー低ポリゴン',
    kind: 'procedural',
    width: 960,
    height: 640,
    caption: null,
  }),
  Object.freeze({
    id: 'bauhaus-quadtree',
    name: '黄金四分木バウハウス',
    hint: '再帰分割ジオメトリ',
    kind: 'procedural',
    width: 960,
    height: 640,
    caption: null,
  }),
  Object.freeze({
    id: 'hexagon-pinwheel',
    name: '麻の葉ハニカム文様',
    hint: '正六角形重心分割',
    kind: 'procedural',
    width: 960,
    height: 640,
    caption: null,
  }),
  Object.freeze({
    id: 'starry',
    name: '星空の街',
    hint: '風景イラスト',
    kind: 'procedural',
    width: 960,
    height: 640,
    caption: null,
  }),
  Object.freeze({
    id: 'rainbow',
    name: '虹と街並み',
    hint: '風景イラスト',
    kind: 'procedural',
    width: 960,
    height: 640,
    caption: null,
  }),
]);

const artworkCache = new Map();

export function normalizeSampleImageId(sampleId) {
  return SAMPLE_IMAGE_PRESETS.some((p) => p.id === sampleId) ? sampleId : DEFAULT_SAMPLE_IMAGE_ID;
}

export function getSamplePreset(sampleId) {
  const id = normalizeSampleImageId(sampleId);
  return SAMPLE_IMAGE_PRESETS.find((p) => p.id === id) || SAMPLE_IMAGE_PRESETS[0];
}

export function getSampleCaption(sampleId) {
  return getSamplePreset(sampleId)?.caption || null;
}

function cloneCanvas(src) {
  const copy = document.createElement('canvas');
  copy.width = src.width;
  copy.height = src.height;
  copy.getContext('2d').drawImage(src, 0, 0);
  return copy;
}

/** Lightweight warm paper placeholder canvas used before deferred artwork loads. */
export function createPlaceholderSampleCanvas(
  width = PUZZLE_CONFIG.SAMPLE_IMAGE_WIDTH,
  height = PUZZLE_CONFIG.SAMPLE_IMAGE_HEIGHT,
) {
  const maxSide = PUZZLE_CONFIG.SAMPLE_IMAGE_WIDTH;
  const scale = Math.min(1, maxSide / Math.max(1, width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ebe5d8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Lazily loads artwork WebP presets on demand, falling back to procedural art on error. */
export async function loadSampleImageCanvas(sampleId = DEFAULT_SAMPLE_IMAGE_ID) {
  const preset = getSamplePreset(sampleId);
  if (preset.kind !== 'artwork' || !preset.assetUrl) {
    return generateSampleImageCanvas(undefined, undefined, preset.id);
  }
  const cached = artworkCache.get(preset.id);
  if (cached) {
    return cloneCanvas(cached);
  }

  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Failed to load ${preset.assetUrl}`));
      el.src = preset.assetUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || PUZZLE_CONFIG.SAMPLE_IMAGE_WIDTH;
    canvas.height = img.naturalHeight || PUZZLE_CONFIG.SAMPLE_IMAGE_HEIGHT;
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    artworkCache.set(preset.id, canvas);
    return cloneCanvas(canvas);
  } catch {
    return generateSampleImageCanvas(undefined, undefined, FALLBACK_PROCEDURAL_SAMPLE_ID);
  }
}

function drawSkyAndLand(ctx, width, height) {
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
}

function drawSun(ctx, width, height) {
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
}

function drawRainbow(ctx, width, height) {
  const rainbowColors = [
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#06b6d4',
    '#6366f1',
    '#ec4899',
  ];
  rainbowColors.forEach((col, i) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.56, 250 - i * 11, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
  });
}

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

function drawMountains(ctx, width, height) {
  drawPolygon(
    ctx,
    [
      [0, height * 0.58],
      [width * 0.22, height * 0.34],
      [width * 0.44, height * 0.58],
    ],
    '#4338ca',
  );
  drawPolygon(
    ctx,
    [
      [width * 0.3, height * 0.58],
      [width * 0.54, height * 0.27],
      [width * 0.78, height * 0.58],
    ],
    '#6d28d9',
  );
  drawPolygon(
    ctx,
    [
      [width * 0.62, height * 0.58],
      [width * 0.84, height * 0.32],
      [width, height * 0.58],
    ],
    '#312e81',
  );

  drawPolygon(
    ctx,
    [
      [width * 0.48, height * 0.34],
      [width * 0.54, height * 0.27],
      [width * 0.6, height * 0.34],
      [width * 0.54, height * 0.32],
    ],
    '#f8fafc',
  );
  drawPolygon(
    ctx,
    [
      [width * 0.79, height * 0.38],
      [width * 0.84, height * 0.32],
      [width * 0.89, height * 0.38],
      [width * 0.84, height * 0.36],
    ],
    '#e0f2fe',
  );
}

function drawHouse(ctx, hx, hy, roofCol, wallCol) {
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
}

function drawHillsAndHouses(ctx, width, height) {
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.ellipse(width * 0.22, height * 0.76, width * 0.32, height * 0.19, 0, 0, Math.PI * 2);
  ctx.fill();

  drawHouse(ctx, width * 0.16, height * 0.73, '#ef4444', '#fef3c7');
  drawHouse(ctx, width * 0.29, height * 0.78, '#f97316', '#fce7f3');
}

function drawWavesAndBoat(ctx, width, height) {
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
}

function drawRainbowSample(ctx, width, height) {
  // Drawing order matters: later layers overlap earlier ones.
  drawSkyAndLand(ctx, width, height);
  drawSun(ctx, width, height);
  drawRainbow(ctx, width, height);
  drawMountains(ctx, width, height);
  drawHillsAndHouses(ctx, width, height);
  drawWavesAndBoat(ctx, width, height);
}

/**
 * Generates a colorful, high-contrast illustration on an offscreen canvas
 * so users can play immediately without uploading an image.
 */
export function generateSampleImageCanvas(
  width = PUZZLE_CONFIG.SAMPLE_IMAGE_WIDTH,
  height = PUZZLE_CONFIG.SAMPLE_IMAGE_HEIGHT,
  sampleId = FALLBACK_PROCEDURAL_SAMPLE_ID,
) {
  const resolvedId = normalizeSampleImageId(sampleId);
  const cached = artworkCache.get(resolvedId);
  if (cached && width === PUZZLE_CONFIG.SAMPLE_IMAGE_WIDTH) {
    return cloneCanvas(cached);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (resolvedId === 'delaunay-lowpoly' || getSamplePreset(resolvedId).kind === 'artwork') {
    drawDelaunayLowPoly(ctx, width, height);
  } else if (resolvedId === 'bauhaus-quadtree') {
    drawBauhausQuadtree(ctx, width, height);
  } else if (resolvedId === 'hexagon-pinwheel') {
    drawHexagonPinwheel(ctx, width, height);
  } else if (resolvedId === 'starry') {
    drawStarrySample(ctx, width, height);
    gradeVivid(ctx, width, height);
  } else {
    drawRainbowSample(ctx, width, height);
    gradeVivid(ctx, width, height);
  }
  return canvas;
}
