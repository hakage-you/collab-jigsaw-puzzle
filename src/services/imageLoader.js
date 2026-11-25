import { PUZZLE_CONFIG } from '../config/constants.js';

export function drawCanvasFit(targetCanvas, sourceCanvas) {
  if (!targetCanvas || !sourceCanvas) return;
  const sw = sourceCanvas.naturalWidth || sourceCanvas.width;
  const sh = sourceCanvas.naturalHeight || sourceCanvas.height;
  if (!sw || !sh) return;
  const tCtx = targetCanvas.getContext('2d');
  tCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  const scale = Math.min(targetCanvas.width / sw, targetCanvas.height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (targetCanvas.width - dw) / 2;
  const dy = (targetCanvas.height - dh) / 2;
  tCtx.drawImage(sourceCanvas, dx, dy, dw, dh);
}

/** Draws `source` filling `targetCanvas` completely without letterboxing (object-fit: cover). */
export function drawCanvasCover(targetCanvas, source) {
  if (!targetCanvas || !source) return;
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  if (!sw || !sh) return;
  const tCtx = targetCanvas.getContext('2d');
  tCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  const scale = Math.max(targetCanvas.width / sw, targetCanvas.height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (targetCanvas.width - dw) / 2;
  const dy = (targetCanvas.height - dh) / 2;
  tCtx.drawImage(source, dx, dy, dw, dh);
}

export function loadImageFromFile(file, callback, onError = null) {
  if (!file || !file.type.startsWith('image/')) {
    if (onError) onError('画像ファイルを選択してください');
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const maxDim = PUZZLE_CONFIG.MAX_UPLOAD_IMAGE_DIM;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(16, Math.round(img.width * scale));
    c.height = Math.max(16, Math.round(img.height * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    callback(c, file.name);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    if (onError) onError('画像の読み込みに失敗しました');
  };
  img.src = url;
}
