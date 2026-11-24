/**
 * WebGPU instanced piece pipeline:
 * - Single instanced draw call for all visible pieces (and lifted soft shadows).
 * - 2.5D cardboard cross-section bevel lighting from alpha gradient transformed by rotation & flip
 *   so the light always stays fixed at top-left in screen space.
 * - Shader-drawn hover / drag / remote-lock outline from per-instance RGBA color.
 * - Single-pass mipmapped soft shadow for lifted pieces (no 64-piece cap).
 */

export const FLOATS_PER_INSTANCE = 20;
const INITIAL_INSTANCE_CAPACITY = 1024;
const UNIFORM_BYTES = 32;

const PIECE_WGSL = /* wgsl */ `
struct FrameUniforms {
  view: vec3f,
  dpr: f32,
  viewport: vec2f,
  _pad1: vec2f,
};

struct InstanceIn {
  @location(0) place: vec4f,    // world x, y, quarter turns, flip (1 or -1)
  @location(1) rect: vec4f,     // local left, top, width, height
  @location(2) uvRect: vec4f,   // u0, v0, u1, v1
  @location(3) misc: vec4f,     // texKind (0 atlas, 1 zoom, 2 fake), layer, alpha, shadow
  @location(4) outline: vec4f,  // r, g, b, a
};

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) uvRect: vec4f,
  @location(2) @interpolate(flat) texKind: i32,
  @location(3) @interpolate(flat) layer: i32,
  @location(4) alpha: f32,
  @location(5) shadow: f32,
  @location(6) @interpolate(flat) rotFlip: vec2f,
  @location(7) outline: vec4f,
};

@group(0) @binding(0) var<uniform> uFrame: FrameUniforms;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var uAtlas: texture_2d_array<f32>;
@group(0) @binding(3) var uZoom: texture_2d_array<f32>;
@group(0) @binding(4) var uFake: texture_2d_array<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, inst: InstanceIn) -> VsOut {
  let corners = array<vec2f, 4>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
  );
  let corner = corners[vid];
  let outlinePad = select(0.0, 5.0 / max(uFrame.view.z, 1e-4), inst.outline.w > 0.0);
  let shadowPad = select(0.0, 14.0 / max(uFrame.view.z, 1e-4), inst.misc.w > 0.0);
  let expand = max(outlinePad, shadowPad);
  let rect = vec4f(inst.rect.xy - vec2f(expand), inst.rect.zw + vec2f(expand * 2.0));
  var local = rect.xy + corner * rect.zw;
  let uvNorm = (local - inst.rect.xy) / max(inst.rect.zw, vec2f(1e-5));
  let uv = mix(inst.uvRect.xy, inst.uvRect.zw, uvNorm);

  local.x *= inst.place.w;
  let angle = inst.place.z * 1.5707963267948966;
  let c = cos(angle);
  let s = sin(angle);
  let rotated = vec2f(local.x * c - local.y * s, local.x * s + local.y * c);
  let screen = (inst.place.xy + rotated - uFrame.view.xy) * uFrame.view.z + uFrame.viewport * 0.5;
  let clip = screen / uFrame.viewport * 2.0 - 1.0;

  var out: VsOut;
  out.pos = vec4f(clip.x, -clip.y, 0.0, 1.0);
  out.uv = uv;
  out.uvRect = inst.uvRect;
  out.texKind = i32(inst.misc.x + 0.5);
  out.layer = i32(inst.misc.y + 0.5);
  out.alpha = inst.misc.z;
  out.shadow = inst.misc.w;
  out.rotFlip = vec2f(inst.place.z, inst.place.w);
  out.outline = inst.outline;
  return out;
}

fn texDims(texKind: i32) -> vec2f {
  if (texKind == 1) { return vec2f(textureDimensions(uZoom)); }
  if (texKind == 2) { return vec2f(textureDimensions(uFake)); }
  return vec2f(textureDimensions(uAtlas));
}

fn sampleTexLevel(
  texKind: i32,
  uv: vec2f,
  uvRect: vec4f,
  layer: i32,
  lod: f32,
  texel: vec2f,
) -> vec4f {
  let inset = texel * max(0.75, exp2(lod) * 0.75);
  if (
    uv.x <= uvRect.x + inset.x ||
    uv.x >= uvRect.z - inset.x ||
    uv.y <= uvRect.y + inset.y ||
    uv.y >= uvRect.w - inset.y
  ) {
    return vec4f(0.0);
  }
  if (texKind == 1) { return textureSampleLevel(uZoom, uSampler, uv, layer, lod); }
  if (texKind == 2) { return textureSampleLevel(uFake, uSampler, uv, layer, lod); }
  return textureSampleLevel(uAtlas, uSampler, uv, layer, lod);
}

fn sampleSoftShadow(texKind: i32, uv: vec2f, uvRect: vec4f, layer: i32, texel: vec2f) -> f32 {
  let r = texel * 2.5;
  let a0 = sampleTexLevel(texKind, uv, uvRect, layer, 2.6, texel).a;
  let a1 = sampleTexLevel(texKind, uv + vec2f(r.x, r.y), uvRect, layer, 2.2, texel).a;
  let a2 = sampleTexLevel(texKind, uv + vec2f(-r.x, r.y), uvRect, layer, 2.2, texel).a;
  let a3 = sampleTexLevel(texKind, uv + vec2f(r.x, -r.y), uvRect, layer, 2.2, texel).a;
  let a4 = sampleTexLevel(texKind, uv + vec2f(-r.x, -r.y), uvRect, layer, 2.2, texel).a;
  return (a0 * 1.4 + a1 + a2 + a3 + a4) / 5.4;
}

fn applyBevel25D(
  center: vec4f,
  in: VsOut,
  uvPerPx: vec2f,
  texel: vec2f,
  bevelLod: f32,
) -> vec3f {
  var rgb = center.rgb;
  if (center.a <= 0.002) {
    return rgb;
  }
  let stepUv = clamp(uvPerPx * 1.4, texel, texel * 3.0);
  let aR = sampleTexLevel(in.texKind, in.uv + vec2f(stepUv.x, 0.0), in.uvRect, in.layer, bevelLod, texel).a;
  let aL = sampleTexLevel(in.texKind, in.uv - vec2f(stepUv.x, 0.0), in.uvRect, in.layer, bevelLod, texel).a;
  let aD = sampleTexLevel(in.texKind, in.uv + vec2f(0.0, stepUv.y), in.uvRect, in.layer, bevelLod, texel).a;
  let aU = sampleTexLevel(in.texKind, in.uv - vec2f(0.0, stepUv.y), in.uvRect, in.layer, bevelLod, texel).a;
  let nUv = vec2f(aL - aR, aU - aD);
  let gradLen = length(nUv);
  if (gradLen > 0.01) {
    let nLocal = vec2f(nUv.x * in.rotFlip.y, nUv.y);
    let angle = in.rotFlip.x * 1.5707963267948966;
    let c = cos(angle);
    let s = sin(angle);
    let nScreen = vec2f(nLocal.x * c - nLocal.y * s, nLocal.x * s + nLocal.y * c);
    let lightDir = normalize(vec2f(-0.75, -1.0));
    let nDotL = dot(normalize(nScreen), lightDir);
    let edgeMask = smoothstep(0.04, 0.55, gradLen);
    if (nDotL > 0.0) {
      rgb += vec3f(1.0, 0.99, 0.96) * (nDotL * edgeMask * 0.36 * center.a);
    } else {
      rgb *= 1.0 - (-nDotL) * edgeMask * 0.42;
    }
    rgb *= 1.0 - edgeMask * 0.15;
    rgb = clamp(rgb, vec3f(0.0), vec3f(center.a));
  }
  return rgb;
}

fn sampleOutlineAlpha(in: VsOut, cssPx: vec2f, lod: f32, texel: vec2f) -> f32 {
  let r = cssPx * 3.2;
  let d = r * 0.70710678;
  let h = cssPx * 1.6;
  var m = 0.0;
  m = max(m, sampleTexLevel(in.texKind, in.uv + vec2f(r.x, 0.0), in.uvRect, in.layer, lod, texel).a);
  m = max(m, sampleTexLevel(in.texKind, in.uv - vec2f(r.x, 0.0), in.uvRect, in.layer, lod, texel).a);
  m = max(m, sampleTexLevel(in.texKind, in.uv + vec2f(0.0, r.y), in.uvRect, in.layer, lod, texel).a);
  m = max(m, sampleTexLevel(in.texKind, in.uv - vec2f(0.0, r.y), in.uvRect, in.layer, lod, texel).a);
  m = max(m, sampleTexLevel(in.texKind, in.uv + vec2f(d.x, d.y), in.uvRect, in.layer, lod, texel).a);
  m = max(m, sampleTexLevel(in.texKind, in.uv + vec2f(-d.x, d.y), in.uvRect, in.layer, lod, texel).a);
  m = max(m, sampleTexLevel(in.texKind, in.uv + vec2f(d.x, -d.y), in.uvRect, in.layer, lod, texel).a);
  m = max(m, sampleTexLevel(in.texKind, in.uv + vec2f(-d.x, -d.y), in.uvRect, in.layer, lod, texel).a);
  m = max(m, sampleTexLevel(in.texKind, in.uv + vec2f(h.x, 0.0), in.uvRect, in.layer, lod, texel).a);
  m = max(m, sampleTexLevel(in.texKind, in.uv - vec2f(h.x, 0.0), in.uvRect, in.layer, lod, texel).a);
  m = max(m, sampleTexLevel(in.texKind, in.uv + vec2f(0.0, h.y), in.uvRect, in.layer, lod, texel).a);
  m = max(m, sampleTexLevel(in.texKind, in.uv - vec2f(0.0, h.y), in.uvRect, in.layer, lod, texel).a);
  return smoothstep(0.04, 0.45, m);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let dx = dpdx(in.uv);
  let dy = dpdy(in.uv);
  let uvPerPx = vec2f(length(vec2f(dx.x, dy.x)), length(vec2f(dx.y, dy.y)));
  let cssPx = uvPerPx * max(uFrame.dpr, 1.0);
  let dim = texDims(in.texKind);
  let texel = 1.0 / dim;
  let rho = max(dot(dx * dim, dx * dim), dot(dy * dim, dy * dim));
  let lod = max(0.0, 0.5 * log2(max(rho, 1e-8)));

  if (in.shadow > 0.0) {
    let softA = sampleSoftShadow(in.texKind, in.uv, in.uvRect, in.layer, texel);
    let sa = softA * in.shadow * in.alpha;
    return vec4f(0.059 * sa, 0.090 * sa, 0.165 * sa, sa);
  }

  let center = sampleTexLevel(in.texKind, in.uv, in.uvRect, in.layer, lod, texel);
  let bevelLod = min(lod, 1.0);
  let rgb = applyBevel25D(center, in, cssPx, texel, bevelLod);
  var pieceOut = vec4f(rgb, center.a) * in.alpha;

  if (in.outline.a > 0.0) {
    let outCov = sampleOutlineAlpha(in, cssPx, 0.0, texel);
    let outAlpha = outCov * in.outline.a * in.alpha;
    let outPremul = vec4f(in.outline.rgb * outAlpha, outAlpha);
    pieceOut = pieceOut + outPremul * (1.0 - pieceOut.a);
  }
  return pieceOut;
}
`;

export class PiecePipeline {
  constructor(device, format) {
    this.device = device;
    const module = device.createShaderModule({ code: PIECE_WGSL });
    this.sampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.uniformBuffer = device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.uniformData = new Float32Array(UNIFORM_BYTES / 4);
    this.instanceCapacity = INITIAL_INSTANCE_CAPACITY;
    this.instanceBuffer = device.createBuffer({
      size: this.instanceCapacity * FLOATS_PER_INSTANCE * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.pipeline = this._buildPipeline(device, module, format);
    this.bindGroupLayout = this.pipeline.getBindGroupLayout(0);
    this._bindGroup = null;
    this._boundRevision = -1;
  }

  _buildPipeline(device, module, format) {
    const stride = FLOATS_PER_INSTANCE * 4;
    const attributes = [];
    for (let i = 0; i < 5; i++) {
      attributes.push({ shaderLocation: i, offset: i * 16, format: 'float32x4' });
    }
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs_main',
        buffers: [{ arrayStride: stride, stepMode: 'instance', attributes }],
      },
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

  _ensureBindGroup(views) {
    if (this._bindGroup && this._boundRevision === views.revision) {
      return this._bindGroup;
    }
    this._boundRevision = views.revision;
    this._bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: views.atlas },
        { binding: 3, resource: views.zoom },
        { binding: 4, resource: views.fake },
      ],
    });
    return this._bindGroup;
  }

  _ensureInstanceBuffer(count) {
    if (count <= this.instanceCapacity) return;
    this.instanceBuffer.destroy();
    this.instanceCapacity = Math.max(count, this.instanceCapacity * 2);
    this.instanceBuffer = this.device.createBuffer({
      size: this.instanceCapacity * FLOATS_PER_INSTANCE * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  encodePass(
    encoder,
    targetView,
    {
      data,
      count,
      camera,
      cssWidth,
      cssHeight,
      dpr = 1,
      views,
      loadOp = 'clear',
      timestampWrites = null,
      profiler = null,
    },
  ) {
    this.uniformData[0] = camera.x;
    this.uniformData[1] = camera.y;
    this.uniformData[2] = camera.scale;
    this.uniformData[3] = dpr;
    this.uniformData[4] = cssWidth;
    this.uniformData[5] = cssHeight;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    if (count > 0) {
      this._ensureInstanceBuffer(count);
      this.device.queue.writeBuffer(this.instanceBuffer, 0, data, 0, count * FLOATS_PER_INSTANCE);
    }

    const passDesc = {
      colorAttachments: [
        {
          view: targetView,
          loadOp,
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    };
    if (timestampWrites) {
      passDesc.timestampWrites = timestampWrites;
    } else if (profiler) {
      passDesc.timestampWrites = profiler.timestampWrites;
    }

    const pass = encoder.beginRenderPass(passDesc);
    if (count > 0) {
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this._ensureBindGroup(views));
      pass.setVertexBuffer(0, this.instanceBuffer);
      pass.draw(4, count);
    }
    pass.end();
    if (!timestampWrites) profiler?.resolve(encoder);
  }

  dispose() {
    this.uniformBuffer.destroy();
    this.instanceBuffer.destroy();
    this._bindGroup = null;
  }
}
