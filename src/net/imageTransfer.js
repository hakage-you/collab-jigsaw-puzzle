import { MULTIPLAYER_CONFIG, NET_LIMITS } from '../config/constants.js';

function canvasToDataUrlAsync(canvas, mimeType, quality) {
  return canvas.toDataURL(mimeType, quality);
}

/**
 * Encodes a source canvas into WebP (quality 0.85, stepping down quality/scale if > 2MB).
 */
export function encodeCanvasToWebP(sourceCanvas) {
  const maxBytes = MULTIPLAYER_CONFIG.IMAGE_MAX_BYTES;
  const qualities = [MULTIPLAYER_CONFIG.IMAGE_DEFAULT_QUALITY, 0.72, 0.58, 0.45];

  let workCanvas = sourceCanvas;
  let mimeType = 'image/webp';

  // Detect WebP encoding support
  const testProbe = canvasToDataUrlAsync(sourceCanvas, 'image/webp', 0.85);
  if (!testProbe.startsWith('data:image/webp')) {
    mimeType = 'image/jpeg';
  }

  for (let scaleStep = 0; scaleStep < 3; scaleStep++) {
    for (const q of qualities) {
      const dataUrl = canvasToDataUrlAsync(workCanvas, mimeType, q);
      const base64 = dataUrl.split(',')[1] || '';
      const approxBytes = Math.floor((base64.length * 3) / 4);
      if (approxBytes <= maxBytes) {
        return {
          base64,
          byteLength: approxBytes,
          width: workCanvas.width,
          height: workCanvas.height,
          mimeType,
        };
      }
    }
    const nextW = Math.max(240, Math.round(workCanvas.width * 0.75));
    const nextH = Math.max(160, Math.round(workCanvas.height * 0.75));
    const scaled = document.createElement('canvas');
    scaled.width = nextW;
    scaled.height = nextH;
    scaled.getContext('2d').drawImage(workCanvas, 0, 0, nextW, nextH);
    workCanvas = scaled;
  }

  const fallbackUrl = canvasToDataUrlAsync(workCanvas, mimeType, 0.4);
  const base64 = fallbackUrl.split(',')[1] || '';
  return {
    base64,
    byteLength: Math.floor((base64.length * 3) / 4),
    width: workCanvas.width,
    height: workCanvas.height,
    mimeType,
  };
}

export function chunkBase64(base64, chunkSize = MULTIPLAYER_CONFIG.IMAGE_CHUNK_BYTES) {
  const chunks = [];
  for (let i = 0; i < base64.length; i += chunkSize) {
    chunks.push(base64.slice(i, i + chunkSize));
  }
  return chunks;
}

/** A received image that is refused. `reason` is a short code for diagnostics, never contents. */
export class ImageRejectedError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const isDimension = (v) => Number.isSafeInteger(v) && v >= 1 && v <= NET_LIMITS.MAX_IMAGE_DIM;

/** True when both pixel sides are integers in [1, MAX_IMAGE_DIM]. */
export function isImageSizeAllowed(width, height) {
  return isDimension(width) && isDimension(height);
}

const ascii = (b, i, text) => [...text].every((ch, k) => b[i + k] === ch.charCodeAt(0));
const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

function readPngSize(b) {
  if (b.length < 24 || !ascii(b, 12, 'IHDR')) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/** Scans the marker segments up to the first frame header (SOFn, excluding DHT/JPG/DAC). */
function readJpegSize(b) {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1;
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return i + 9 <= b.length ? { height: u16be(b, i + 5), width: u16be(b, i + 7) } : null;
    } else if (marker === 0xd9) {
      return null;
    } else if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
    } else {
      i += 2 + u16be(b, i + 2);
    }
  }
  return null;
}

/** Simple lossy (VP8), lossless (VP8L) and extended (VP8X) WebP headers. */
function readWebpSize(b) {
  if (b.length < 30) return null;
  if (ascii(b, 12, 'VP8 ')) return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (ascii(b, 12, 'VP8L') && b[20] === 0x2f) {
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(b, 12, 'VP8X')) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return null;
}

/** Pixel size from the header of PNG, JPEG or WebP bytes, without decoding. Null if unknown. */
export function readImageHeaderSize(bytes) {
  if (bytes[0] === 0x89 && ascii(bytes, 1, 'PNG')) return readPngSize(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return readJpegSize(bytes);
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return readWebpSize(bytes);
  return null;
}

/**
 * Checks the image header before the browser decodes it: a small file can still declare a huge
 * canvas, and decoding it would allocate that memory. Returns the refusal reason or null.
 */
function headerRefusal(base64) {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  const size = readImageHeaderSize(bytes);
  if (!size) return 'unknown_format';
  return isImageSizeAllowed(size.width, size.height) ? null : 'size_exceeded';
}

/**
 * Decodes a received base64 image. The header is checked first, then the decoded size, so no
 * canvas larger than MAX_IMAGE_DIM is ever allocated. Refusals reject with ImageRejectedError.
 */
export function decodeBase64ToCanvas(base64, mimeType = 'image/webp') {
  return new Promise((resolve, reject) => {
    const refusal = headerRefusal(base64);
    if (refusal) {
      reject(new ImageRejectedError(refusal));
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (!isImageSizeAllowed(img.naturalWidth, img.naturalHeight)) {
        reject(new ImageRejectedError('size_exceeded'));
        return;
      }
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new ImageRejectedError('decode_failed'));
    img.src = `data:${mimeType};base64,${base64}`;
  });
}
