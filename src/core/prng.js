/**
 * Seeded PRNG (Mulberry32) and lightweight image signature helpers.
 */

export function mulberry32(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Computes a lightweight deterministic FNV-1a hash from sampled pixels
 * of a source canvas so save files can verify the re-uploaded image matches.
 */
export function computeImageSignature(canvas) {
  const sampleW = 32;
  const sampleH = 32;
  const tmp = document.createElement('canvas');
  tmp.width = sampleW;
  tmp.height = sampleH;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(canvas, 0, 0, sampleW, sampleH);
  const data = ctx.getImageData(0, 0, sampleW, sampleH).data;

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
