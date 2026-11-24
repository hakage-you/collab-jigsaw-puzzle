/**
 * WebGPU fullscreen post-process pipeline for color sabotage & non-distorting patchy mist.
 * Zero overhead when inactive: offscreen color target is only allocated and bound when mode != NONE.
 */

export const POST_EFFECT_MODE = Object.freeze({
  NONE: 0,
  GRAYSCALE: 1,
  SEPIA: 2,
  HUE: 3,
  MIST: 4,
});

const UNIFORM_BYTES = 16;

const POST_WGSL = /* wgsl */ `
struct PostUniforms {
  mode: u32,
  time: f32,
  intensity: f32,
  animated: u32,
};

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var<uniform> uPost: PostUniforms;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var uSrcTex: texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  var out: VsOut;
  out.pos = vec4f(x, y, 0.0, 1.0);
  out.uv = vec2f(x * 0.5 + 0.5, 0.5 - y * 0.5);
  return out;
}

fn applyGrayscale(rgb: vec3f) -> vec3f {
  let lum = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
  return (vec3f(lum) - 0.5) * 1.1 + 0.5;
}

fn applySepia(rgb: vec3f) -> vec3f {
  let r = dot(rgb, vec3f(0.393, 0.769, 0.189));
  let g = dot(rgb, vec3f(0.349, 0.686, 0.168));
  let b = dot(rgb, vec3f(0.272, 0.534, 0.131));
  return (vec3f(r, g, b) - 0.5) * 1.05 + 0.5;
}

fn applyHue165(rgb: vec3f) -> vec3f {
  let c = -0.96592583;
  let s = 0.25881905;
  let m0 = vec3f(0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928);
  let m1 = vec3f(0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283);
  let m2 = vec3f(0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072);
  let rotated = vec3f(dot(rgb, m0), dot(rgb, m1), dot(rgb, m2));
  let lum = dot(rotated, vec3f(0.2126, 0.7152, 0.0722));
  return mix(vec3f(lum), rotated, 1.8);
}

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn valueNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbmMist(p: vec2f) -> f32 {
  var v = 0.0;
  var amp = 0.55;
  var q = p;
  for (var i = 0; i < 3; i++) {
    v += amp * valueNoise(q);
    q = q * 2.07 + vec2f(17.3, 9.2);
    amp *= 0.5;
  }
  return v;
}

fn sampleMist(uv: vec2f) -> vec4f {
  // Zero coordinate distortion on pieces/board: patchy drifting clouds with blur only inside dense banks.
  let t = select(0.0, uPost.time, uPost.animated == 1u);
  let fogLarge = fbmMist(uv * vec2f(2.6, 2.2) + vec2f(-t * 0.28, t * 0.07));
  let fogMid = fbmMist(uv * vec2f(5.8, 5.2) + vec2f(-t * 0.48, t * 0.13) + vec2f(4.2, 1.7));
  let cloud = fogLarge * 0.62 + fogMid * 0.38;
  let dense = smoothstep(0.36, 0.72, cloud);

  let dim = vec2f(textureDimensions(uSrcTex));
  let step = vec2f(3.5 * dense) / max(dim, vec2f(1.0));
  let c0 = textureSampleLevel(uSrcTex, uSampler, uv, 0.0);
  let c1 = textureSampleLevel(uSrcTex, uSampler, clamp(uv + vec2f(step.x, step.y), vec2f(0.0), vec2f(1.0)), 0.0);
  let c2 = textureSampleLevel(uSrcTex, uSampler, clamp(uv + vec2f(-step.x, step.y), vec2f(0.0), vec2f(1.0)), 0.0);
  let c3 = textureSampleLevel(uSrcTex, uSampler, clamp(uv + vec2f(step.x, -step.y), vec2f(0.0), vec2f(1.0)), 0.0);
  let c4 = textureSampleLevel(uSrcTex, uSampler, clamp(uv + vec2f(-step.x, -step.y), vec2f(0.0), vec2f(1.0)), 0.0);
  let blurred = (c0 + c1 + c2 + c3 + c4) * 0.2;

  let fogAlpha = mix(0.06, 0.88, dense) * uPost.intensity;
  let mistColor = vec3f(0.95, 0.96, 0.98);
  let misted = mix(blurred.rgb, mistColor * blurred.a, fogAlpha);
  return vec4f(clamp(misted, vec3f(0.0), vec3f(blurred.a)), blurred.a);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  if (uPost.mode == 4u) {
    return sampleMist(in.uv);
  }
  let c = textureSampleLevel(uSrcTex, uSampler, in.uv, 0.0);
  let orig = c.rgb / max(c.a, 1e-5);
  var filtered = orig;
  if (uPost.mode == 1u) {
    filtered = applyGrayscale(orig);
  } else if (uPost.mode == 2u) {
    filtered = applySepia(orig);
  } else if (uPost.mode == 3u) {
    filtered = applyHue165(orig);
  }
  let rgb = clamp(mix(orig, filtered, uPost.intensity), vec3f(0.0), vec3f(1.0));
  return vec4f(rgb * c.a, c.a);
}
`;

export class PostProcessPipeline {
  constructor(device, format) {
    this.device = device;
    this.format = format;
    const module = device.createShaderModule({ code: POST_WGSL });
    this.sampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.uniformBuf = device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._uniformRaw = new ArrayBuffer(UNIFORM_BYTES);
    this._uniformU32 = new Uint32Array(this._uniformRaw);
    this._uniformF32 = new Float32Array(this._uniformRaw);
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.offscreenTex = null;
    this.offscreenView = null;
    this._texW = 0;
    this._texH = 0;
    this._bindGroup = null;
  }

  ensureOffscreenTarget(width, height) {
    if (this.offscreenTex && this._texW === width && this._texH === height) {
      return this.offscreenView;
    }
    this.offscreenTex?.destroy();
    this._texW = width;
    this._texH = height;
    this.offscreenTex = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.offscreenView = this.offscreenTex.createView({ dimension: '2d' });
    this._bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.offscreenView },
      ],
    });
    return this.offscreenView;
  }

  encodePass(
    encoder,
    swapchainView,
    { mode, time = 0, intensity = 1, animated = false, timestampWrites = null },
  ) {
    this._uniformU32[0] = mode;
    this._uniformF32[1] = time;
    this._uniformF32[2] = intensity;
    this._uniformU32[3] = animated ? 1 : 0;
    this.device.queue.writeBuffer(this.uniformBuf, 0, this._uniformRaw);

    const passDesc = {
      colorAttachments: [
        {
          view: swapchainView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    };
    if (timestampWrites) passDesc.timestampWrites = timestampWrites;

    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.draw(3);
    pass.end();
  }

  dispose() {
    this.uniformBuf.destroy();
    this.offscreenTex?.destroy();
    this.offscreenTex = null;
    this.offscreenView = null;
    this._bindGroup = null;
  }
}
