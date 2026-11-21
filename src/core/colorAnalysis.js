/**
 * Computes average RGB / HSL per piece cell from already-read pixels and classifies pieces into color buckets
 * for cluster sorting and color-based highlight filtering.
 */

function rgbToHsl(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function classifyBucket(h, s, l) {
  if (s < 0.14 || l < 0.12 || l > 0.92) {
    return 'neutral';
  }
  if (h < 22 || h >= 330) return 'red';
  if (h < 68) return 'orange';
  if (h < 155) return 'green';
  if (h < 200) return 'cyan';
  if (h < 258) return 'blue';
  return 'purple';
}

/**
 * Size the source image is downscaled to before its colors are read: about 256 px on the long
 * side, and at least 2 px per cell so every piece gets its own pixels.
 */
export function colorSampleSize(sourceWidth, sourceHeight, cols, rows) {
  const maxDim = Math.max(256, cols * 2, rows * 2);
  const scale = Math.min(1, maxDim / Math.max(1, sourceWidth, sourceHeight));
  return {
    width: Math.max(cols, Math.round(sourceWidth * scale)),
    height: Math.max(rows, Math.round(sourceHeight * scale)),
  };
}

/**
 * Average color and color bucket of every piece cell, row by row.
 * `pixels` is the RGBA data of the source image downscaled to colorSampleSize().
 */
export function analyzePieceColors(pixels, cols, rows) {
  const { width: tmpW, height: tmpH, data } = pixels;
  const cellW = tmpW / cols;
  const cellH = tmpH / rows;
  const results = [];

  for (let r = 0; r < rows; r++) {
    const y0 = Math.max(0, Math.floor(r * cellH));
    const y1 = Math.min(tmpH, Math.max(y0 + 1, Math.floor((r + 1) * cellH)));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.max(0, Math.floor(c * cellW));
      const x1 = Math.min(tmpW, Math.max(x0 + 1, Math.floor((c + 1) * cellW)));

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;
      for (let py = y0; py < y1; py++) {
        const rowOff = py * tmpW;
        for (let px = x0; px < x1; px++) {
          const idx = (rowOff + px) * 4;
          sumR += data[idx];
          sumG += data[idx + 1];
          sumB += data[idx + 2];
          count++;
        }
      }

      const avgR = Math.round(sumR / Math.max(1, count));
      const avgG = Math.round(sumG / Math.max(1, count));
      const avgB = Math.round(sumB / Math.max(1, count));
      const { h, s, l } = rgbToHsl(avgR, avgG, avgB);
      const bucket = classifyBucket(h, s, l);

      results.push({
        h,
        s,
        l,
        bucket,
        rgb: `rgb(${avgR}, ${avgG}, ${avgB})`,
      });
    }
  }
  return results;
}
