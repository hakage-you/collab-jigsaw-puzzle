import { VIEWPORT_CONFIG } from '../../config/constants.js';
import { drawBoardFrame, drawReferenceSheet } from '../canvas2d/canvasOverlayRenderer.js';
import { deskTextureSpec } from '../deskTextures.js';
import { referenceModeOf, refSheetFrame } from '../viewState.js';
import { parseCssColor } from './gpuContext.js';

const DESK_TEXTURE_PX = 512;
const MAX_BAKE_PX = 2048;
const MAX_SHEET_BAKE_PX = 2048;
const DESK_UNIFORM_BYTES = 64;
const QUAD_UNIFORM_BYTES = 48;

const DESK_WGSL = /* wgsl */ `
struct DeskUniforms {
  view: vec3f,
  isTextured: f32,
  viewport: vec2f,
  tileScreen: f32,
  _pad0: f32,
  baseColor: vec4f,
  gridColor: vec4f,
};

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) cssPos: vec2f,
};

@group(0) @binding(0) var<uniform> uDesk: DeskUniforms;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var uDeskTex: texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  var out: VsOut;
  out.pos = vec4f(x, y, 0.0, 1.0);
  let uv = vec2f(x * 0.5 + 0.5, 0.5 - y * 0.5);
  out.cssPos = uv * uDesk.viewport;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let worldCss = in.cssPos - uDesk.viewport * 0.5 + uDesk.view.xy * uDesk.view.z;
  let uv = worldCss / max(uDesk.tileScreen, 1.0);
  let texSample = textureSample(uDeskTex, uSampler, uv);
  if (uDesk.isTextured > 0.5) {
    return vec4f(texSample.rgb, 1.0);
  }
  let gx = abs(fract(worldCss.x / max(uDesk.tileScreen, 1.0) + 0.5) - 0.5) * uDesk.tileScreen;
  let gy = abs(fract(worldCss.y / max(uDesk.tileScreen, 1.0) + 0.5) - 0.5) * uDesk.tileScreen;
  let lineOn = (gx < 0.5 || gy < 0.5) && uDesk.tileScreen >= 16.0;
  let ga = select(0.0, uDesk.gridColor.a, lineOn);
  let rgb = mix(uDesk.baseColor.rgb, uDesk.gridColor.rgb, ga);
  return vec4f(rgb, 1.0);
}
`;

const QUAD_WGSL = /* wgsl */ `
struct QuadUniforms {
  view: vec3f,
  _pad0: f32,
  viewport: vec2f,
  _pad1: vec2f,
  worldRect: vec4f,
};

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var<uniform> uQuad: QuadUniforms;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var uTex: texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
  let corners = array<vec2f, 4>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
  );
  let c = corners[vid];
  let world = uQuad.worldRect.xy + c * uQuad.worldRect.zw;
  let screen = (world - uQuad.view.xy) * uQuad.view.z + uQuad.viewport * 0.5;
  let clip = screen / uQuad.viewport * 2.0 - 1.0;
  var out: VsOut;
  out.pos = vec4f(clip.x, -clip.y, 0.0, 1.0);
  out.uv = c;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  return textureSample(uTex, uSampler, in.uv);
}
`;

function createBakeSurface() {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

function createMipTexture(device, width, height) {
  const mipLevelCount = Math.floor(Math.log2(Math.max(width, height))) + 1;
  const texture = device.createTexture({
    size: { width, height, depthOrArrayLayers: 1 },
    mipLevelCount,
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const view = texture.createView({ dimension: '2d', baseMipLevel: 0, mipLevelCount });
  return { texture, view, width, height, mipLevelCount };
}

function uploadSurface(device, mipmapPipeline, encoder, texObj, source) {
  device.queue.copyExternalImageToTexture(
    { source, origin: { x: 0, y: 0 } },
    {
      texture: texObj.texture,
      mipLevel: 0,
      origin: { x: 0, y: 0, z: 0 },
      premultipliedAlpha: true,
    },
    { width: texObj.width, height: texObj.height, depthOrArrayLayers: 1 },
  );
  mipmapPipeline.generate(encoder, texObj.texture, {
    mipLevelCount: texObj.mipLevelCount,
    layerCount: 1,
    layers: [0],
  });
}

export function computeBoardBounds(engine) {
  const rim = Math.max(
    Math.min(engine.pieceW, engine.pieceH) * 0.18,
    Math.min(engine.boardW, engine.boardH) * 0.018,
  );
  const frameReach = rim * 2.1 + 16;
  const bottomExtra = Math.max(64, engine.boardH * 0.12);
  const estMax = Math.max(
    1,
    engine.boardW + frameReach * 2,
    engine.boardH + frameReach * 2 + bottomExtra,
  );
  const initScale = Math.max(1e-3, Math.min(6.0, (MAX_BAKE_PX - 96) / estMax));
  const margin = frameReach + 40 / initScale;
  const rawW = engine.boardW + margin * 2;
  const rawH = engine.boardH + margin * 2 + bottomExtra;
  const bakeScale = Math.max(1e-3, Math.min(initScale, MAX_BAKE_PX / Math.max(1, rawW, rawH)));
  const texW = Math.min(MAX_BAKE_PX, Math.max(16, Math.floor(rawW * bakeScale)));
  const texH = Math.min(MAX_BAKE_PX, Math.max(16, Math.floor(rawH * bakeScale)));
  const worldRect = {
    x: -engine.boardW / 2 - margin,
    y: -engine.boardH / 2 - margin,
    w: texW / bakeScale,
    h: texH / bakeScale,
  };
  return { worldRect, bakeScale, texW, texH };
}

export function computeSheetBounds(refSheet) {
  const { k, pad, header } = refSheetFrame(refSheet);
  const left = -refSheet.w / 2 - pad - 4 * k;
  const top = -refSheet.h / 2 - pad - header - 4 * k;
  const rawW = refSheet.w + pad * 2 + 12 * k;
  const rawH = refSheet.h + pad * 2 + header + 13 * k;
  const bakeScale = Math.max(1e-3, Math.min(6.0, MAX_SHEET_BAKE_PX / Math.max(1, rawW, rawH)));
  const texW = Math.min(MAX_SHEET_BAKE_PX, Math.max(16, Math.floor(rawW * bakeScale)));
  const texH = Math.min(MAX_SHEET_BAKE_PX, Math.max(16, Math.floor(rawH * bakeScale)));
  return {
    localRect: { x: left, y: top, w: texW / bakeScale, h: texH / bakeScale },
    bakeScale,
    texW,
    texH,
  };
}

/**
 * Hybrid WebGPU table background pipeline:
 * - Renders tiled photo desks or procedural grid directly on the GPU.
 * - Bakes board frames (wood/tray/gallery/classic) and reference sheet via existing Canvas 2D
 *   functions only when board settings/generation/theme change (zero re-bake on pan/zoom).
 */
export class TableBakePipeline {
  constructor(device, format, mipmapPipeline) {
    this.device = device;
    this.mipmapPipeline = mipmapPipeline;
    this.deskSampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
    });
    this.quadSampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.deskUniformBuf = device.createBuffer({
      size: DESK_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.deskUniformData = new Float32Array(DESK_UNIFORM_BYTES / 4);
    this.boardUniformBuf = device.createBuffer({
      size: QUAD_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sheetUniformBuf = device.createBuffer({
      size: QUAD_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.quadUniformData = new Float32Array(QUAD_UNIFORM_BYTES / 4);

    this.deskPipeline = this._createDeskPipeline(device, format);
    this.quadPipeline = this._createQuadPipeline(device, format);
    this.deskTex = createMipTexture(device, 1, 1);
    this._deskImg = null;
    this._deskBindGroup = null;

    this._boardSurface = createBakeSurface();
    this._boardKey = null;
    this._boardTex = null;
    this._boardWorldRect = null;
    this._boardBindGroup = null;

    this._sheetSurface = createBakeSurface();
    this._sheetKey = null;
    this._sheetTex = null;
    this._sheetLocalRect = null;
    this._sheetBindGroup = null;
  }

  _createDeskPipeline(device, format) {
    const module = device.createShaderModule({ code: DESK_WGSL });
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  _createQuadPipeline(device, format) {
    const module = device.createShaderModule({ code: QUAD_WGSL });
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-strip' },
    });
  }

  _prepareDesk(frame, encoder) {
    const { view, rect, pal, settings } = frame;
    const d = this.deskUniformData;
    d[0] = view.x;
    d[1] = view.y;
    d[2] = view.scale;
    d[4] = rect.width;
    d[5] = rect.height;

    const spec = deskTextureSpec(settings?.deskStyle, frame.requestRender);
    if (spec?.img) {
      if (this._deskImg !== spec.img) {
        this._deskImg = spec.img;
        const w = spec.img.naturalWidth || DESK_TEXTURE_PX;
        const h = spec.img.naturalHeight || DESK_TEXTURE_PX;
        this.deskTex.texture.destroy();
        this.deskTex = createMipTexture(this.device, w, h);
        uploadSurface(this.device, this.mipmapPipeline, encoder, this.deskTex, spec.img);
        this._deskBindGroup = null;
      }
      const level = 2 ** Math.round(Math.log2(Math.max(1e-3, view.scale)));
      d[3] = 1;
      d[6] = DESK_TEXTURE_PX * (view.scale / level);
    } else {
      let step = VIEWPORT_CONFIG.DESK_GRID_STEP * view.scale;
      while (step > 0 && step < 22) step *= 2;
      const base = parseCssColor(spec ? spec.base : pal.deskBg);
      const grid = parseCssColor(pal.deskGrid);
      d[3] = 0;
      d[6] = step;
      d.set(base, 8);
      d.set(spec ? [0, 0, 0, 0] : grid, 12);
    }
    this.device.queue.writeBuffer(this.deskUniformBuf, 0, d);
    if (!this._deskBindGroup) {
      this._deskBindGroup = this.device.createBindGroup({
        layout: this.deskPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.deskUniformBuf } },
          { binding: 1, resource: this.deskSampler },
          { binding: 2, resource: this.deskTex.view },
        ],
      });
    }
  }

  _bakeAndUpload(encoder, { surface, prevTex, rect, bakeScale, texW, texH, drawFn }) {
    const { canvas, ctx } = surface;
    if (canvas.width !== texW || canvas.height !== texH) {
      canvas.width = texW;
      canvas.height = texH;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, texW, texH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(bakeScale, 0, 0, bakeScale, -rect.x * bakeScale, -rect.y * bakeScale);
    drawFn(ctx);
    let tex = prevTex;
    let resized = false;
    if (!tex || tex.width !== texW || tex.height !== texH) {
      tex?.texture.destroy();
      tex = createMipTexture(this.device, texW, texH);
      resized = true;
    }
    uploadSurface(this.device, this.mipmapPipeline, encoder, tex, canvas);
    return { tex, resized };
  }

  _prepareBoard(frame, encoder) {
    const { engine, settings, isDark, pal } = frame;
    const s = settings || {};
    const key = [
      engine.puzzleGeneration,
      engine.boardW,
      engine.boardH,
      isDark ? 1 : 0,
      s.boardStyle || '',
      s.deskStyle || '',
      engine.isSampleImage ? engine.sampleImageId : 'custom',
      referenceModeOf(s),
      s.guideOpacity ?? '',
    ].join('|');

    if (key !== this._boardKey || !this._boardTex) {
      this._boardKey = key;
      const { worldRect, bakeScale, texW, texH } = computeBoardBounds(engine);
      this._boardWorldRect = worldRect;
      const { tex, resized } = this._bakeAndUpload(encoder, {
        surface: this._boardSurface,
        prevTex: this._boardTex,
        rect: worldRect,
        bakeScale,
        texW,
        texH,
        drawFn: (ctx) =>
          drawBoardFrame(ctx, {
            engine,
            scale: bakeScale,
            settings: s,
            isDark,
            pal,
            board: s.boardStyle,
            dpr: 1,
            requestRender: () => {
              this._boardKey = null;
              frame.requestRender();
            },
          }),
      });
      this._boardTex = tex;
      if (resized) this._boardBindGroup = null;
    }

    this._writeQuadUniform(this.boardUniformBuf, frame, this._boardWorldRect);
    if (!this._boardBindGroup) {
      this._boardBindGroup = this._createQuadBindGroup(this.boardUniformBuf, this._boardTex.view);
    }
  }

  _prepareSheet(frame, encoder) {
    const { engine, settings, isDark, pal, refSheet } = frame;
    if (referenceModeOf(settings) !== 'sheet' || !engine.sourceCanvas?.width) {
      return false;
    }
    const key = [engine.puzzleGeneration, refSheet.w, refSheet.h, isDark ? 1 : 0].join('|');
    if (key !== this._sheetKey || !this._sheetTex) {
      this._sheetKey = key;
      const { localRect, bakeScale, texW, texH } = computeSheetBounds(refSheet);
      this._sheetLocalRect = localRect;
      const { tex, resized } = this._bakeAndUpload(encoder, {
        surface: this._sheetSurface,
        prevTex: this._sheetTex,
        rect: localRect,
        bakeScale,
        texW,
        texH,
        drawFn: (ctx) =>
          drawReferenceSheet(ctx, {
            settings,
            sourceCanvas: engine.sourceCanvas,
            refSheet: { x: 0, y: 0, w: refSheet.w, h: refSheet.h },
            pal,
          }),
      });
      this._sheetTex = tex;
      if (resized) this._sheetBindGroup = null;
    }

    const r = this._sheetLocalRect;
    this._writeQuadUniform(this.sheetUniformBuf, frame, {
      x: refSheet.x + r.x,
      y: refSheet.y + r.y,
      w: r.w,
      h: r.h,
    });
    if (!this._sheetBindGroup) {
      this._sheetBindGroup = this._createQuadBindGroup(this.sheetUniformBuf, this._sheetTex.view);
    }
    return true;
  }

  _writeQuadUniform(buffer, frame, rect) {
    const d = this.quadUniformData;
    d[0] = frame.view.x;
    d[1] = frame.view.y;
    d[2] = frame.view.scale;
    d[4] = frame.rect.width;
    d[5] = frame.rect.height;
    d[8] = rect.x;
    d[9] = rect.y;
    d[10] = rect.w;
    d[11] = rect.h;
    this.device.queue.writeBuffer(buffer, 0, d);
  }

  _createQuadBindGroup(buffer, view) {
    return this.device.createBindGroup({
      layout: this.quadPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: this.quadSampler },
        { binding: 2, resource: view },
      ],
    });
  }

  encodePass(encoder, targetView, frame, { timestampWrites = null } = {}) {
    this._prepareDesk(frame, encoder);
    this._prepareBoard(frame, encoder);
    const hasSheet = this._prepareSheet(frame, encoder);

    const passDesc = {
      colorAttachments: [
        {
          view: targetView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    };
    if (timestampWrites) passDesc.timestampWrites = timestampWrites;

    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(this.deskPipeline);
    pass.setBindGroup(0, this._deskBindGroup);
    pass.draw(3);

    pass.setPipeline(this.quadPipeline);
    pass.setBindGroup(0, this._boardBindGroup);
    pass.draw(4);

    if (hasSheet) {
      pass.setBindGroup(0, this._sheetBindGroup);
      pass.draw(4);
    }
    pass.end();
  }

  get bytes() {
    let total = 0;
    for (const t of [this.deskTex, this._boardTex, this._sheetTex]) {
      if (t) total += t.width * t.height * 4 * (t.mipLevelCount > 1 ? 4 / 3 : 1);
    }
    return Math.round(total);
  }

  dispose() {
    this.deskUniformBuf.destroy();
    this.boardUniformBuf.destroy();
    this.sheetUniformBuf.destroy();
    this.deskTex?.texture.destroy();
    this._boardTex?.texture.destroy();
    this._sheetTex?.texture.destroy();
    this._deskBindGroup = null;
    this._boardBindGroup = null;
    this._sheetBindGroup = null;
  }
}
