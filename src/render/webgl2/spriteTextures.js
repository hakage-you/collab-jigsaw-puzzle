import { LOD_ATLAS_SIZE, MAX_LOD_CANVASES } from '../pieceLodCache.js';

/** Which texture a sprite lives in (matches the shader's texture index). */
const TEX_ATLAS = 0;
const TEX_ZOOM = 1;
const TEX_FAKE = 2;

/** Multiplies RGB by alpha in place (RGBA bytes), matching what the shader blends with. */
function premultiply(data) {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 255) continue;
    data[i] = Math.round((data[i] * a) / 255);
    data[i + 1] = Math.round((data[i + 1] * a) / 255);
    data[i + 2] = Math.round((data[i + 2] * a) / 255);
  }
}

/**
 * GPU copies of the sprite store's canvases, as texture arrays (one layer per canvas page):
 * the main atlas (with mipmaps, for zoomed-out views), the zoom (LOD) pages and the fake-piece
 * atlas. Whole canvases are uploaded when the puzzle or the page count changes; afterwards only
 * the sprites drawn since (back sprites, zoom sprites, fakes) are uploaded, region by region.
 */
export class SpriteTextures {
  constructor(gl) {
    this.gl = gl;
    this.textures = [null, null, null];
    this.layerOf = new Map();
    this.generation = null;
    this.atlasPageCount = 0;
    this.pending = [];
    this.mipmapsStale = new Set();
    this._placeholders();
  }

  /** 1x1 transparent layers so every sampler is bound to something valid. */
  _placeholders() {
    for (const kind of [TEX_ATLAS, TEX_ZOOM, TEX_FAKE]) {
      this._createArray(kind, 1, 1, false);
    }
  }

  _createArray(kind, size, layers, mipmaps) {
    const { gl } = this;
    if (this.textures[kind]) gl.deleteTexture(this.textures[kind].texture);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    const levels = mipmaps ? Math.floor(Math.log2(size)) + 1 : 1;
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, size, size, layers);
    gl.texParameteri(
      gl.TEXTURE_2D_ARRAY,
      gl.TEXTURE_MIN_FILTER,
      mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures[kind] = { texture, size, layers, mipmaps };
  }

  _uploadCanvas(kind, layer, canvas) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures[kind].texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layer,
      canvas.width,
      canvas.height,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      canvas,
    );
    this.layerOf.set(canvas, { kind, layer });
    if (this.textures[kind].mipmaps) this.mipmapsStale.add(kind);
  }

  /** Uploads whole pages that are new or changed wholesale (new puzzle, new page). */
  _syncWholePages(store) {
    const pages = store.atlasPages.map((p) => p.canvas);
    if (store.generation !== this.generation || pages.length !== this.atlasPageCount) {
      this.generation = store.generation;
      this.atlasPageCount = pages.length;
      for (const [canvas, loc] of this.layerOf) {
        if (loc.kind === TEX_ATLAS) this.layerOf.delete(canvas);
      }
      if (pages.length > 0) {
        const size = Math.max(...pages.map((c) => Math.max(c.width, c.height)));
        this._createArray(TEX_ATLAS, size, pages.length, true);
        pages.forEach((canvas, i) => this._uploadCanvas(TEX_ATLAS, i, canvas));
      }
    }
    const zoomPages = store.lodCache.pageCanvases;
    if (zoomPages.length > 0 && this.textures[TEX_ZOOM].size !== LOD_ATLAS_SIZE) {
      this._createArray(TEX_ZOOM, LOD_ATLAS_SIZE, MAX_LOD_CANVASES, false);
    }
    zoomPages.forEach((canvas, i) => {
      if (!this.layerOf.has(canvas)) this._uploadCanvas(TEX_ZOOM, i, canvas);
    });
    const fake = store.fakeAtlas?.canvas;
    if (fake && !this.layerOf.has(fake)) {
      this._createArray(TEX_FAKE, fake.width, 1, true);
      this._uploadCanvas(TEX_FAKE, 0, fake);
    }
  }

  /** Remembers a sprite drawn since the last upload (PieceSpriteStore.onRegionDrawn). */
  queueRegion(sprite) {
    this.pending.push(sprite);
  }

  /**
   * Uploads one sprite's pixels. WebGL2 refuses UNPACK_PREMULTIPLY_ALPHA for typed-array uploads
   * into texture arrays (INVALID_OPERATION), so the alpha is premultiplied here instead.
   */
  _uploadRegion({ canvas, sx, sy, sw, sh }) {
    const loc = this.layerOf.get(canvas);
    if (!loc) return;
    const { gl } = this;
    const pixels = canvas.getContext('2d').getImageData(sx, sy, sw, sh);
    premultiply(pixels.data);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures[loc.kind].texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      sx,
      sy,
      loc.layer,
      sw,
      sh,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels.data,
    );
    if (this.textures[loc.kind].mipmaps) this.mipmapsStale.add(loc.kind);
  }

  /** Brings the GPU copies up to date with the store, then binds the textures for drawing. */
  update(store) {
    const { gl } = this;
    this._syncWholePages(store);
    for (const region of this.pending.splice(0)) this._uploadRegion(region);
    for (const kind of this.mipmapsStale) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures[kind].texture);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    }
    this.mipmapsStale.clear();
    for (const kind of [TEX_ATLAS, TEX_ZOOM, TEX_FAKE]) {
      gl.activeTexture(gl.TEXTURE0 + kind);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures[kind].texture);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Texture index, layer and size for a sprite's canvas (null until it has been uploaded). */
  locate(canvas) {
    const loc = this.layerOf.get(canvas);
    return loc ? { ...loc, size: this.textures[loc.kind].size } : null;
  }

  /** GPU memory held, roughly (bytes), for diagnostics. */
  get bytes() {
    let total = 0;
    for (const t of this.textures) {
      if (t) total += t.size * t.size * 4 * t.layers * (t.mipmaps ? 4 / 3 : 1);
    }
    return Math.round(total);
  }
}
