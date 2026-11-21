import { analyzePieceColors, colorSampleSize } from '../core/colorAnalysis.js';
import { IMAGE_SIGNATURE_SAMPLE_SIZE, imageSignatureFromPixels } from '../core/prng.js';

/**
 * Reads the pixels of an image (canvas, image or bitmap) downscaled to width x height.
 * The core layer never touches canvases; it receives the returned { width, height, data }.
 *
 * The canvas setup (fresh 2D context, default smoothing, `willReadFrequently` as given) is part
 * of the result: the image signature is stored in save files, so keep it exactly as it is.
 */
function readImagePixels(image, width, height, { willReadFrequently = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext(
    '2d',
    willReadFrequently ? { willReadFrequently: true } : undefined,
  );
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  canvas.width = 0;
  canvas.height = 0;
  return { width, height, data };
}

/** Signature used to check that a re-uploaded image matches a save file. */
export function computeImageSignature(image) {
  const size = IMAGE_SIGNATURE_SAMPLE_SIZE;
  return imageSignatureFromPixels(readImagePixels(image, size, size), image.width, image.height);
}

/** Average color and color bucket of every piece cell of a cols x rows grid over the image. */
export function analyzeImageColors(image, cols, rows) {
  const { width, height } = colorSampleSize(image.width, image.height, cols, rows);
  const pixels = readImagePixels(image, width, height, { willReadFrequently: true });
  return analyzePieceColors(pixels, cols, rows);
}

/** What PuzzleEngine needs to read from the source image (injected so core stays canvas-free). */
export const imageAnalyzer = Object.freeze({
  signature: computeImageSignature,
  pieceColors: analyzeImageColors,
});
