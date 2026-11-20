/**
 * Determinism helpers: seeded Math.random and canvas/data hashing.
 * Tests must not depend on real randomness or wall-clock time.
 */

/** Replaces Math.random with a seeded mulberry32 sequence. Returns a restore function. */
export function seedMathRandom(seed = 0x9e3779b9) {
  const original = Math.random;
  let s = seed | 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    Math.random = original;
  };
}

/** Short SHA-256 hex digest of bytes or of any JSON-serializable value. */
export async function hashOf(value) {
  const bytes =
    value instanceof Uint8Array || value instanceof Uint8ClampedArray
      ? value
      : new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/** Hash of a canvas' pixels. */
export function hashCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return hashOf(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}
