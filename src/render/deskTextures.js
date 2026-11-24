/**
 * The desk under the board: a tiled CC0 photo texture (assets/textures/*.webp, 512 px, seamless)
 * or, for 'grid', nothing here (the plain grid is drawn by canvasOverlayRenderer.js).
 *
 * The texture is fixed to the table, so it moves with the camera when panning. Its size on
 * screen is kept between about 0.7x and 1.4x of the image by rounding the zoom to a power of
 * two (like the grid), so it is neither blurry when zoomed in nor a busy noise when zoomed out.
 */

const TEXTURE_PX = 512;

/**
 * The textured desks (config DESK_CONFIG.STYLES, apart from 'grid'): the image, and its average
 * colour shown while it loads. Sources, all CC0: Poly Haven (oak_veneer_01, wood_table_001),
 * ambientCG (Fabric034, Cork004, Cork003); see the credits in the terms.
 */
export const DESK_TEXTURES = Object.freeze({
  'wood-b': { file: 'desk-wood-b', base: '#b48d63' },
  'wood-a': { file: 'desk-wood-a', base: '#3b1c12' },
  'felt-green': { file: 'desk-mat-felt-green', base: '#225c42' },
  'felt-navy': { file: 'desk-mat-felt-navy', base: '#1e2e54' },
  'cork-a': { file: 'desk-cork-a', base: '#b98a55' },
  'cork-b': { file: 'desk-cork-b', base: '#c4925c' },
});

/** file -> { img, ready, failed, waiting: Set<callback> } */
const images = new Map();
/** img -> CanvasPattern, per context */
const patterns = new WeakMap();

function textureImage(file, onReady) {
  let entry = images.get(file);
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false, failed: false, waiting: new Set() };
    images.set(file, entry);
    img.decoding = 'async';
    img.onload = () => {
      entry.ready = true;
      for (const cb of entry.waiting) cb();
      entry.waiting.clear();
    };
    img.onerror = () => {
      entry.failed = true;
      entry.waiting.clear();
    };
    img.src = new URL(`../../assets/textures/${file}.webp`, import.meta.url).href;
  }
  if (!entry.ready && !entry.failed && onReady) entry.waiting.add(onReady);
  return entry.ready ? entry.img : null;
}

function patternFor(ctx, img) {
  let byCtx = patterns.get(ctx);
  if (!byCtx) {
    byCtx = new Map();
    patterns.set(ctx, byCtx);
  }
  let pattern = byCtx.get(img);
  if (!pattern) {
    pattern = ctx.createPattern(img, 'repeat');
    byCtx.set(img, pattern);
  }
  return pattern;
}

/**
 * The repeating pattern of a desk texture for `ctx` (to set its own transform and fill with),
 * or null while the image loads (`onReady` is called once it can be drawn).
 */
export function deskTexturePattern(ctx, style, onReady) {
  const spec = DESK_TEXTURES[style];
  const img = spec ? textureImage(spec.file, onReady) : null;
  return img ? patternFor(ctx, img) : null;
}

/**
 * Returns `{ img, base }` for a textured desk style (`img` is null while loading, and
 * `onReady` is called once loaded), or null for `'grid'` / unknown styles.
 */
export function deskTextureSpec(style, onReady) {
  const spec = DESK_TEXTURES[style];
  if (!spec) return null;
  return { img: textureImage(spec.file, onReady), base: spec.base };
}

/**
 * Fills the stage with the desk texture of `style`. Returns false for 'grid' (or an unknown
 * style), so the caller draws the grid instead. While the image loads, the desk is filled
 * with its average colour and `onReady` is called once it can be drawn.
 */
export function drawTexturedDesk(ctx, { rect, view, style, onReady }) {
  const spec = DESK_TEXTURES[style];
  if (!spec) return false;
  ctx.save();
  const img = textureImage(spec.file, onReady);
  if (img) {
    const level = 2 ** Math.round(Math.log2(Math.max(1e-3, view.scale)));
    const k = view.scale / level;
    const ox = rect.width / 2 - view.x * view.scale;
    const oy = rect.height / 2 - view.y * view.scale;
    // The tile's world size changes only at a new level, so it stays put while panning.
    const tileScreen = TEXTURE_PX * k;
    const pattern = patternFor(ctx, img);
    pattern.setTransform(new DOMMatrix([k, 0, 0, k, mod(ox, tileScreen), mod(oy, tileScreen)]));
    ctx.fillStyle = pattern;
  } else {
    ctx.fillStyle = spec.base;
  }
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.restore();
  return true;
}

function mod(a, n) {
  return ((a % n) + n) % n;
}
