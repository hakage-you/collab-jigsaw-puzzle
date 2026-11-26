import { describe, expect, it } from 'vitest';
import { analyzePieceColors, colorSampleSize } from '../../src/core/colorAnalysis.js';

// Piece colours for the colour sort (色別) and the colour highlight. The pixels come from
// services/imagePixels.js; here they are built by hand.

/** RGBA pixels of a width x height image; colorAt(x, y) returns [r, g, b]. */
function image(width, height, colorAt) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set([...colorAt(x, y), 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Colour info of a single pixel of the given colour. */
const colorOf = (r, g, b) =>
  analyzePieceColors(
    image(1, 1, () => [r, g, b]),
    1,
    1,
  )[0];

describe('colorSampleSize', () => {
  it.each([
    ['a large photo is scaled to 256 px on its long side', [960, 640, 4, 3], [256, 171]],
    ['a portrait photo the same way', [640, 960, 4, 3], [171, 256]],
    ['a small image keeps its size', [100, 50, 4, 3], [100, 50]],
    ['a fine grid gets 2 px per cell', [960, 640, 200, 10], [400, 267]],
    ['a fine grid of many rows the same way', [640, 960, 10, 200], [267, 400]],
    ['a tiny image still gets 1 px per cell', [10, 10, 40, 30], [40, 30]],
    ['an empty image does not divide by zero', [0, 0, 4, 3], [4, 3]],
  ])('%s', (_, [w, h, cols, rows], [width, height]) => {
    expect(colorSampleSize(w, h, cols, rows)).toEqual({ width, height });
  });
});

describe('analyzePieceColors: which pixels belong to which piece', () => {
  it('returns one result per cell, row by row', () => {
    const colors = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
    ];
    const pixels = image(4, 4, (x, y) => colors[(y < 2 ? 0 : 2) + (x < 2 ? 0 : 1)]);
    const result = analyzePieceColors(pixels, 2, 2);
    expect(result.map((c) => c.rgb)).toEqual(colors.map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`));
    expect(result.map((c) => c.bucket)).toEqual(['red', 'green', 'blue', 'orange']);
  });

  it('averages the pixels of a cell, rounding each channel', () => {
    const pixels = image(2, 1, (x) => (x === 0 ? [255, 0, 0] : [0, 0, 255]));
    expect(analyzePieceColors(pixels, 1, 1)[0].rgb).toBe('rgb(128, 0, 128)');
  });

  it('splits uneven sizes at whole pixels', () => {
    // 5 x 3 pixels into 2 x 2 cells: columns 0-1 | 2-4, rows 0 | 1-2. Red is 50 * x, green 60 * y.
    const pixels = image(5, 3, (x, y) => [50 * x, 60 * y, 0]);
    expect(analyzePieceColors(pixels, 2, 2).map((c) => c.rgb)).toEqual([
      'rgb(25, 0, 0)',
      'rgb(150, 0, 0)',
      'rgb(25, 90, 0)',
      'rgb(150, 90, 0)',
    ]);
  });

  it('gives every cell at least one pixel when the image is smaller than the grid', () => {
    const pixels = image(1, 1, () => [10, 20, 30]);
    const result = analyzePieceColors(pixels, 3, 2);
    expect(result).toHaveLength(6);
    expect(new Set(result.map((c) => c.rgb))).toEqual(new Set(['rgb(10, 20, 30)']));
  });
});

describe('analyzePieceColors: hue, saturation and lightness', () => {
  it.each([
    [[255, 0, 0], 0, 1, 0.5],
    [[255, 128, 0], 30.1176, 1, 0.5],
    [[0, 255, 0], 120, 1, 0.5],
    [[102, 153, 51], 90, 0.5, 0.4],
    [[0, 200, 255], 192.9412, 1, 0.5],
    [[51, 102, 153], 210, 0.5, 0.4],
    [[153, 51, 102], 330, 0.5, 0.4],
    [[255, 0, 255], 300, 1, 0.5],
    [[255, 200, 200], 0, 1, 0.8922],
    [[140, 120, 120], 0, 0.08, 0.5098],
    [[128, 128, 128], 0, 0, 0.502],
  ])('rgb%j has hue %f, saturation %f, lightness %f', ([r, g, b], h, s, l) => {
    const c = colorOf(r, g, b);
    expect(c.h).toBeCloseTo(h, 3);
    expect(c.s).toBeCloseTo(s, 3);
    expect(c.l).toBeCloseTo(l, 3);
  });
});

describe('analyzePieceColors: colour buckets', () => {
  it.each([
    // Hues near each boundary (22, 68, 155, 200, 258, 330).
    ['red', [255, 93, 0]],
    ['orange', [255, 94, 0]],
    ['orange', [230, 255, 0]],
    ['green', [200, 255, 0]],
    ['green', [0, 255, 140]],
    ['cyan', [0, 255, 150]],
    ['cyan', [0, 200, 255]],
    ['blue', [0, 150, 255]],
    ['blue', [60, 0, 255]],
    ['purple', [80, 0, 255]],
    ['purple', [255, 0, 140]],
    ['red', [153, 51, 102]],
    ['red', [255, 0, 60]],
    // Lightness and saturation limits (0.12, 0.92, 0.14).
    ['neutral', [60, 0, 0]],
    ['red', [62, 0, 0]],
    ['red', [255, 213, 213]],
    ['neutral', [255, 215, 215]],
    ['neutral', [149, 116, 116]],
    ['red', [150, 115, 115]],
    ['neutral', [0, 0, 0]],
    ['neutral', [255, 255, 255]],
  ])('puts %s rgb%j there', (bucket, [r, g, b]) => {
    expect(colorOf(r, g, b).bucket).toBe(bucket);
  });
});
