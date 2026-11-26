import { describe, expect, it } from 'vitest';
import { imageSignatureFromPixels, mulberry32 } from '../../src/core/prng.js';

// The seeded random behind every cut (its exact stream is pinned by the shape golden test in
// jigsawPath.node.test.js) and the image signature stored in save files.

const pixels = (...values) => ({ data: new Uint8ClampedArray(values) });

describe('mulberry32', () => {
  it('repeats its stream for the same seed and changes with the seed', () => {
    const take = (seed) => Array.from({ length: 5 }, mulberry32(seed));
    expect(take(42)).toEqual(take(42));
    expect(take(42)).not.toEqual(take(43));
    expect(take('42')).toEqual(take(42));
  });

  it('treats a missing or zero seed as 1', () => {
    const first = (seed) => mulberry32(seed)();
    expect(first(0)).toBe(first(1));
    expect(first(undefined)).toBe(first(1));
    expect(first('x')).toBe(first(1));
  });

  it('returns numbers from 0 up to, not including, 1', () => {
    const next = mulberry32(7);
    const values = Array.from({ length: 1000 }, next);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(new Set(values).size).toBe(1000);
  });
});

describe('imageSignatureFromPixels', () => {
  it('keeps the format stored in save files', () => {
    // Saves compare this string with the re-opened image: it must never change.
    expect(imageSignatureFromPixels(pixels(1, 2, 3, 255, 4, 5, 6, 255), 10, 20)).toBe(
      '10x20_3d252aa',
    );
    expect(imageSignatureFromPixels(pixels(), 10, 20)).toBe('10x20_811c9dc5');
  });

  it('reads red, green and blue of every pixel but not alpha', () => {
    const base = [1, 2, 3, 255, 4, 5, 6, 255];
    const signature = (values) => imageSignatureFromPixels(pixels(...values), 10, 20);
    const original = signature(base);
    for (const i of [4, 5, 6]) {
      const changed = [...base];
      changed[i] += 1;
      expect(signature(changed), `byte ${i}`).not.toBe(original);
    }
    const alpha = [...base];
    alpha[7] = 0;
    expect(signature(alpha)).toBe(original);
  });

  it('includes the size of the source image', () => {
    const data = pixels(1, 2, 3, 255);
    expect(imageSignatureFromPixels(data, 10, 20)).not.toBe(imageSignatureFromPixels(data, 20, 10));
  });
});
