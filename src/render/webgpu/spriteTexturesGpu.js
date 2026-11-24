import { LOD_ATLAS_SIZE, MAX_LOD_CANVASES } from '../pieceLodCache.js';

const TEX_ATLAS = 0;
const TEX_ZOOM = 1;
const TEX_FAKE = 2;
const TEX_KINDS = [TEX_ATLAS, TEX_ZOOM, TEX_FAKE];

/**
 * WebGPU 2d-array texture manager mirroring webgl2/spriteTextures.js.
 * Uses copyExternalImageToTexture (premultipliedAlpha: true) with zero CPU getImageData readback,
 * and regenerates mipmaps via MipmapPipeline only on layers that changed.
 */
export class SpriteTexturesGpu {
  constructor(device, mipmapPipeline) {
    this.device = device;
    this.mipmapPipeline = mipmapPipeline;
    this.textures = [null, null, null];
    this.layerOf = new Map();
    this.generation = null;
    this.atlasPageCount = 0;
    this.pending = [];
    this.dirtyMipLayers = [new Set(), new Set(), new Set()];
    this.viewRevision = 0;
    this._placeholders();
  }

  _placeholders() {
    for (const kind of TEX_KINDS) {
      this._createArray(kind, 1, 1, false);
    }
  }

  _createArray(kind, size, layers, mipmaps) {
    const prev = this.textures[kind];
    if (prev) prev.texture.destroy();
    const mipLevelCount = mipmaps ? Math.floor(Math.log2(size)) + 1 : 1;
    const texture = this.device.createTexture({
      size: { width: size, height: size, depthOrArrayLayers: layers },
      mipLevelCount,
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const view = texture.createView({
      dimension: '2d-array',
      baseArrayLayer: 0,
      arrayLayerCount: layers,
      baseMipLevel: 0,
      mipLevelCount,
    });
    this.textures[kind] = { texture, view, size, layers, mipmaps, mipLevelCount };
    this.dirtyMipLayers[kind].clear();
    this.viewRevision += 1;
  }

  _uploadCanvas(kind, layer, canvas) {
    const tex = this.textures[kind];
    if (!tex || canvas.width <= 0 || canvas.height <= 0) return;
    this.device.queue.copyExternalImageToTexture(
      { source: canvas, origin: { x: 0, y: 0 } },
      {
        texture: tex.texture,
        mipLevel: 0,
        origin: { x: 0, y: 0, z: layer },
        premultipliedAlpha: true,
      },
      { width: canvas.width, height: canvas.height, depthOrArrayLayers: 1 },
    );
    this.layerOf.set(canvas, { kind, layer });
    if (tex.mipmaps) this.dirtyMipLayers[kind].add(layer);
  }

  _syncWholePages(store, uploadedWhole) {
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
        pages.forEach((canvas, i) => {
          this._uploadCanvas(TEX_ATLAS, i, canvas);
          uploadedWhole.add(canvas);
        });
      }
    }
    this._syncZoomAndFakePages(store, uploadedWhole);
  }

  _syncZoomAndFakePages(store, uploadedWhole) {
    const zoomPages = store.lodCache.pageCanvases;
    if (zoomPages.length > 0 && this.textures[TEX_ZOOM].size !== LOD_ATLAS_SIZE) {
      this._createArray(TEX_ZOOM, LOD_ATLAS_SIZE, MAX_LOD_CANVASES, false);
    }
    zoomPages.forEach((canvas, i) => {
      if (!this.layerOf.has(canvas)) {
        this._uploadCanvas(TEX_ZOOM, i, canvas);
        uploadedWhole.add(canvas);
      }
    });
    const fake = store.fakeAtlas?.canvas;
    if (fake && !this.layerOf.has(fake)) {
      this._createArray(TEX_FAKE, fake.width, 1, true);
      this._uploadCanvas(TEX_FAKE, 0, fake);
      uploadedWhole.add(fake);
    }
  }

  queueRegion(sprite) {
    this.pending.push(sprite);
  }

  _uploadRegion({ canvas, sx, sy, sw, sh }) {
    if (sw <= 0 || sh <= 0) return;
    const loc = this.layerOf.get(canvas);
    if (!loc) return;
    const tex = this.textures[loc.kind];
    this.device.queue.copyExternalImageToTexture(
      { source: canvas, origin: { x: sx, y: sy } },
      {
        texture: tex.texture,
        mipLevel: 0,
        origin: { x: sx, y: sy, z: loc.layer },
        premultipliedAlpha: true,
      },
      { width: sw, height: sh, depthOrArrayLayers: 1 },
    );
    if (tex.mipmaps) this.dirtyMipLayers[loc.kind].add(loc.layer);
  }

  /** Syncs atlas/LOD/fake pages and queues mipmap passes on `encoder`. */
  update(store, encoder) {
    const uploadedWhole = new Set();
    this._syncWholePages(store, uploadedWhole);
    for (const region of this.pending.splice(0)) {
      if (!uploadedWhole.has(region.canvas)) this._uploadRegion(region);
    }
    for (const kind of [TEX_ATLAS, TEX_FAKE]) {
      const dirty = this.dirtyMipLayers[kind];
      const tex = this.textures[kind];
      if (dirty.size > 0 && tex?.mipmaps) {
        this.mipmapPipeline.generate(encoder, tex.texture, {
          mipLevelCount: tex.mipLevelCount,
          layerCount: tex.layers,
          layers: dirty,
        });
        dirty.clear();
      }
    }
  }

  getTextureViews() {
    return {
      atlas: this.textures[TEX_ATLAS].view,
      zoom: this.textures[TEX_ZOOM].view,
      fake: this.textures[TEX_FAKE].view,
      revision: this.viewRevision,
    };
  }

  locate(canvas) {
    const loc = this.layerOf.get(canvas);
    return loc ? { ...loc, size: this.textures[loc.kind].size } : null;
  }

  get bytes() {
    let total = 0;
    for (const t of this.textures) {
      if (t) total += t.size * t.size * 4 * t.layers * (t.mipmaps ? 4 / 3 : 1);
    }
    return Math.round(total);
  }

  dispose() {
    for (let i = 0; i < this.textures.length; i++) {
      this.textures[i]?.texture.destroy();
      this.textures[i] = null;
    }
    this.layerOf.clear();
    this.pending.length = 0;
  }
}
