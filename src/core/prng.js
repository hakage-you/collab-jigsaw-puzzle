/**
 * Seeded PRNG (Mulberry32) and the image signature computed from already-read pixels.
 */

export function mulberry32(seed) {
  let a = Number(seed) >>> 0 || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Width and height of the downscaled image the signature is computed from. */
export const IMAGE_SIGNATURE_SAMPLE_SIZE = 32;

/**
 * Lightweight deterministic FNV-1a hash of an image, so save files can verify that a
 * re-uploaded image matches. `pixels` is the RGBA data of the image downscaled to
 * IMAGE_SIGNATURE_SAMPLE_SIZE square (read by services/imagePixels.js); the source size is
 * part of the signature. The format is stored in save files: never change it.
 */
export function imageSignatureFromPixels(pixels, sourceWidth, sourceHeight) {
  const { data } = pixels;
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 4) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
    hash ^= data[i + 1];
    hash = Math.imul(hash, 0x01000193);
    hash ^= data[i + 2];
    hash = Math.imul(hash, 0x01000193);
  }
  return `${sourceWidth}x${sourceHeight}_${(hash >>> 0).toString(16)}`;
}
