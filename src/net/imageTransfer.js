import { MULTIPLAYER_CONFIG } from '../config/constants.js';

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

export function decodeBase64ToCanvas(base64, mimeType = 'image/webp') {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error('受信画像のデコードに失敗しました'));
    img.src = `data:${mimeType};base64,${base64}`;
  });
}
