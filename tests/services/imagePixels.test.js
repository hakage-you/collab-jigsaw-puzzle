import { describe, expect, it } from 'vitest';
import { analyzeImageColors, computeImageSignature } from '../../src/services/imagePixels.js';
import { generateSampleImageCanvas } from '../../src/services/sampleImage.js';
import { mulberry32 } from '../../src/core/prng.js';

// The image signature is stored in save files and compared when an image is re-uploaded, so
// moving pixel reading out of core must not change a single bit. The legacy functions below are
// frozen copies of the code as it was before the move (core/prng.js, core/colorAnalysis.js).

function legacySignature(canvas) {
  const tmp = document.createElement('canvas');
  tmp.width = 32;
  tmp.height = 32;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(canvas, 0, 0, 32, 32);
  const data = ctx.getImageData(0, 0, 32, 32).data;
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 4) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
    hash ^= data[i + 1];
    hash = Math.imul(hash, 0x01000193);
    hash ^= data[i + 2];
    hash = Math.imul(hash, 0x01000193);
  }
  return `${canvas.width}x${canvas.height}_${(hash >>> 0).toString(16)}`;
}

/** Average rgb per cell, the way the legacy analyzer sampled it (buckets derive from these). */
function legacyCellColors(sourceCanvas, cols, rows) {
  const maxDim = Math.max(256, cols * 2, rows * 2);
  const scale = Math.min(1, maxDim / Math.max(1, sourceCanvas.width, sourceCanvas.height));
  const tmpW = Math.max(cols, Math.round(sourceCanvas.width * scale));
  const tmpH = Math.max(rows, Math.round(sourceCanvas.height * scale));
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = tmpW;
  tmpCanvas.height = tmpH;
  const tmpCtx = tmpCanvas.getContext('2d', { willReadFrequently: true });
  tmpCtx.drawImage(sourceCanvas, 0, 0, tmpW, tmpH);
  const data = tmpCtx.getImageData(0, 0, tmpW, tmpH).data;
  const cellW = tmpW / cols;
  const cellH = tmpH / rows;
  const out = [];
  for (let r = 0; r < rows; r++) {
    const y0 = Math.max(0, Math.floor(r * cellH));
    const y1 = Math.min(tmpH, Math.max(y0 + 1, Math.floor((r + 1) * cellH)));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.max(0, Math.floor(c * cellW));
      const x1 = Math.min(tmpW, Math.max(x0 + 1, Math.floor((c + 1) * cellW)));
      const sum = [0, 0, 0];
      let count = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const idx = (py * tmpW + px) * 4;
          sum[0] += data[idx];
          sum[1] += data[idx + 1];
          sum[2] += data[idx + 2];
          count++;
        }
      }
      const avg = sum.map((v) => Math.round(v / Math.max(1, count)));
      out.push(`rgb(${avg[0]}, ${avg[1]}, ${avg[2]})`);
    }
  }
  return out;
}

/** Seeded noise with some transparency: the worst case for any resampling difference. */
function noiseCanvas(width, height, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const rng = mulberry32(seed);
  for (let i = 0; i < img.data.length; i++) img.data[i] = Math.floor(rng() * 256);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const IMAGES = [
  ['sample image', () => generateSampleImageCanvas()],
  ['noise 333x217', () => noiseCanvas(333, 217, 7)],
  ['noise 1600x900', () => noiseCanvas(1600, 900, 11)],
  ['tiny 20x16', () => noiseCanvas(20, 16, 3)],
];

describe('pixel reading moved out of core', () => {
  it.each(IMAGES)('the image signature of the %s is unchanged', (_name, make) => {
    const canvas = make();
    expect(computeImageSignature(canvas)).toBe(legacySignature(canvas));
  });

  it.each(IMAGES)('the piece colors of the %s are unchanged', (_name, make) => {
    const canvas = make();
    for (const [cols, rows] of [
      [4, 3],
      [17, 11],
      [70, 43],
    ]) {
      const colors = analyzeImageColors(canvas, cols, rows).map((c) => c.rgb);
      expect(colors).toEqual(legacyCellColors(canvas, cols, rows));
    }
  });

  it('the sample image signature is pinned', () => {
    // Pinned so a change in the sample image or in signing is noticed, not silently accepted.
    expect(computeImageSignature(generateSampleImageCanvas())).toMatchSnapshot();
  });
});
