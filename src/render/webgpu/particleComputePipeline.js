/**
 * WebGPU Compute Shader confetti particle system (up to 2,400 paper particles):
 * - Compute pass (@workgroup_size(64)) simulates gravity, air drag, sinusoidal breeze,
 *   3D flip/spin, and pointer wind repulsion in a GPU storage buffer.
 * - Render pass draws instanced quads directly from the storage buffer.
 * - Responds to effectIntensity: 'normal' (2,400 + wind/pointer), 'reduced' (240 calm fall),
 *   'off' (0, fully skipped), and automatically goes idle once all particles expire.
 */

const MAX_PARTICLES = 2400;
const REDUCED_PARTICLES = 240;
const FLOATS_PER_PARTICLE = 16;
const PARTICLE_BYTES = FLOATS_PER_PARTICLE * 4;
const SIM_UNIFORM_BYTES = 48;
const RENDER_UNIFORM_BYTES = 16;
const MAX_LIFE_SEC = 4.4;

const CONFETTI_PALETTE = [
  [0.082, 0.396, 0.753, 0.95], // accent blue
  [0.427, 0.157, 0.851, 0.95], // purple
  [0.086, 0.396, 0.204, 0.95], // emerald
  [0.961, 0.702, 0.004, 0.98], // gold
  [0.957, 0.447, 0.714, 0.95], // rose
  [0.204, 0.827, 0.6, 0.95], // mint
  [0.055, 0.647, 0.914, 0.95], // sky
  [0.937, 0.267, 0.267, 0.95], // coral red
];

const COMPUTE_WGSL = /* wgsl */ `
struct Particle {
  pos: vec2f,
  vel: vec2f,
  color: vec4f,
  state: vec4f, // age, maxLife, rot, spinRate
  extra: vec4f, // size, flipPhase, seed, active
};

struct SimUniforms {
  viewport: vec2f,
  dt: f32,
  time: f32,
  pointer: vec2f,
  pointerVel: vec2f,
  activeCount: u32,
  windEnabled: u32,
  _pad0: vec2f,
};

@group(0) @binding(0) var<uniform> uSim: SimUniforms;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= uSim.activeCount) {
    return;
  }
  var p = particles[idx];
  if (p.extra.w <= 0.5) {
    return;
  }
  p.state.x += uSim.dt;
  if (p.state.x >= p.state.y) {
    p.extra.w = 0.0;
    particles[idx] = p;
    return;
  }

  let gravity = select(220.0, 390.0, uSim.windEnabled == 1u);
  p.vel.y += gravity * uSim.dt;
  p.vel *= exp(-1.55 * uSim.dt);

  if (uSim.windEnabled == 1u) {
    let breeze = sin(uSim.time * 2.3 + p.extra.z * 6.28318 + p.pos.y * 0.012) * 210.0;
    p.vel.x += breeze * uSim.dt;

    let d = p.pos - uSim.pointer;
    let dist = length(d);
    if (dist < 150.0 && dist > 1.0) {
      let falloff = 1.0 - dist / 150.0;
      let push = normalize(d) * (falloff * 960.0) + uSim.pointerVel * (falloff * 0.45);
      p.vel += push * uSim.dt;
    }
    p.state.z += p.state.w * uSim.dt;
    p.extra.y += (4.5 + p.extra.z * 3.5) * uSim.dt;
  }

  p.pos += p.vel * uSim.dt;
  particles[idx] = p;
}
`;

const RENDER_WGSL = /* wgsl */ `
struct Particle {
  pos: vec2f,
  vel: vec2f,
  color: vec4f,
  state: vec4f,
  extra: vec4f,
};

struct RenderUniforms {
  viewport: vec2f,
  flipEnabled: u32,
  _pad0: u32,
};

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
};

@group(0) @binding(0) var<uniform> uRender: RenderUniforms;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VsOut {
  var out: VsOut;
  let p = particles[iid];
  if (p.extra.w <= 0.5) {
    out.pos = vec4f(2.0, 2.0, 0.0, 1.0);
    out.uv = vec2f(0.0);
    out.color = vec4f(0.0);
    return out;
  }
  let corners = array<vec2f, 4>(
    vec2f(-0.5, -0.5),
    vec2f(0.5, -0.5),
    vec2f(-0.5, 0.5),
    vec2f(0.5, 0.5),
  );
  let corner = corners[vid];
  let flipScale = select(1.0, 0.22 + 0.78 * abs(cos(p.extra.y)), uRender.flipEnabled == 1u);
  let size = vec2f(p.extra.x * 1.15 * flipScale, p.extra.x * 0.65);
  let scaled = corner * size;
  let c = cos(p.state.z);
  let s = sin(p.state.z);
  let rotated = vec2f(scaled.x * c - scaled.y * s, scaled.x * s + scaled.y * c);
  let screen = p.pos + rotated;
  let clip = screen / max(uRender.viewport, vec2f(1.0)) * 2.0 - 1.0;

  let lifeFrac = clamp(p.state.x / max(p.state.y, 0.01), 0.0, 1.0);
  let fade = 1.0 - smoothstep(0.72, 1.0, lifeFrac);
  let shade = select(1.0, 0.72 + 0.28 * flipScale, uRender.flipEnabled == 1u);

  out.pos = vec4f(clip.x, -clip.y, 0.0, 1.0);
  out.uv = corner + 0.5;
  out.color = vec4f(p.color.rgb * shade, p.color.a * fade);
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let edge = smoothstep(0.0, 0.12, min(in.uv.x, 1.0 - in.uv.x))
    * smoothstep(0.0, 0.14, min(in.uv.y, 1.0 - in.uv.y));
  let a = in.color.a * edge;
  return vec4f(in.color.rgb * a, a);
}
`;

export class ParticleComputePipeline {
  constructor(device, format) {
    this.device = device;
    this.particleBuffer = device.createBuffer({
      size: MAX_PARTICLES * PARTICLE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.simUniformBuf = device.createBuffer({
      size: SIM_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.renderUniformBuf = device.createBuffer({
      size: RENDER_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._simRaw = new ArrayBuffer(SIM_UNIFORM_BYTES);
    this._simF32 = new Float32Array(this._simRaw);
    this._simU32 = new Uint32Array(this._simRaw);
    this._renderRaw = new ArrayBuffer(RENDER_UNIFORM_BYTES);
    this._renderF32 = new Float32Array(this._renderRaw);
    this._renderU32 = new Uint32Array(this._renderRaw);

    this.staging = new Float32Array(MAX_PARTICLES * FLOATS_PER_PARTICLE);
    this.activeCount = 0;
    this.remainingSec = 0;
    this.windEnabled = true;

    this._initPipelines(device, format);
  }

  _initPipelines(device, format) {
    const csMod = device.createShaderModule({ code: COMPUTE_WGSL });
    this.computePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: csMod, entryPoint: 'cs_main' },
    });
    this.computeBindGroup = device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.simUniformBuf } },
        { binding: 1, resource: { buffer: this.particleBuffer } },
      ],
    });

    const rsMod = device.createShaderModule({ code: RENDER_WGSL });
    this.renderPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: rsMod, entryPoint: 'vs_main' },
      fragment: {
        module: rsMod,
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
    this.renderBindGroup = device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuf } },
        { binding: 1, resource: { buffer: this.particleBuffer } },
      ],
    });
  }

  get active() {
    return this.activeCount > 0 && this.remainingSec > 0;
  }

  clear() {
    this.activeCount = 0;
    this.remainingSec = 0;
  }

  burst({ intensity, cssWidth, cssHeight }) {
    if (intensity === 'off') {
      this.clear();
      return 0;
    }
    const isNormal = intensity === 'normal';
    const count = isNormal ? MAX_PARTICLES : REDUCED_PARTICLES;
    this.activeCount = count;
    this.windEnabled = isNormal;
    this.remainingSec = MAX_LIFE_SEC;

    const w = Math.max(100, cssWidth);
    const h = Math.max(100, cssHeight);
    const d = this.staging;
    for (let i = 0; i < count; i++) {
      const o = i * FLOATS_PER_PARTICLE;
      const isFountain = isNormal && i % 3 === 0;
      const band = Math.floor(i / 3) % 3;
      const originX = isFountain
        ? w * (0.2 + 0.3 * band) + (Math.random() - 0.5) * w * 0.14
        : Math.random() * w;
      const originY = isFountain
        ? h * (0.55 + Math.random() * 0.3)
        : -10 - Math.random() * (h * 0.18);
      const vx = isFountain
        ? (Math.random() - 0.5) * 640
        : isNormal
          ? (Math.random() - 0.5) * 260
          : (Math.random() - 0.5) * 40;
      const vy = isFountain ? -(440 + Math.random() * 460) : 140 + Math.random() * 260;
      const col = CONFETTI_PALETTE[i % CONFETTI_PALETTE.length];

      d[o] = originX;
      d[o + 1] = originY;
      d[o + 2] = vx;
      d[o + 3] = vy;
      d[o + 4] = col[0];
      d[o + 5] = col[1];
      d[o + 6] = col[2];
      d[o + 7] = col[3];
      d[o + 8] = 0;
      d[o + 9] = 2.6 + Math.random() * 1.7;
      d[o + 10] = Math.random() * Math.PI * 2;
      d[o + 11] = isNormal ? (Math.random() - 0.5) * 10 : 0;
      d[o + 12] = 7 + Math.random() * 6;
      d[o + 13] = Math.random() * Math.PI * 2;
      d[o + 14] = Math.random();
      d[o + 15] = 1;
    }
    this.device.queue.writeBuffer(this.particleBuffer, 0, d, 0, count * FLOATS_PER_PARTICLE);
    return count;
  }

  stepAndEncodeCompute(encoder, { cssWidth, cssHeight, dtSec, timeSec, pointer }) {
    if (!this.active) return false;
    this.remainingSec = Math.max(0, this.remainingSec - dtSec);
    if (this.remainingSec <= 0) {
      this.activeCount = 0;
      return false;
    }
    this._simF32[0] = cssWidth;
    this._simF32[1] = cssHeight;
    this._simF32[2] = dtSec;
    this._simF32[3] = timeSec;
    this._simF32[4] = pointer.x;
    this._simF32[5] = pointer.y;
    this._simF32[6] = pointer.vx;
    this._simF32[7] = pointer.vy;
    this._simU32[8] = this.activeCount;
    this._simU32[9] = this.windEnabled ? 1 : 0;
    this.device.queue.writeBuffer(this.simUniformBuf, 0, this._simRaw);

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.computePipeline);
    pass.setBindGroup(0, this.computeBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.activeCount / 64));
    pass.end();
    return true;
  }

  encodeRenderPass(encoder, targetView, { cssWidth, cssHeight, timestampWrites = null }) {
    if (!this.active) return;
    this._renderF32[0] = cssWidth;
    this._renderF32[1] = cssHeight;
    this._renderU32[2] = this.windEnabled ? 1 : 0;
    this.device.queue.writeBuffer(this.renderUniformBuf, 0, this._renderRaw);

    const passDesc = {
      colorAttachments: [
        {
          view: targetView,
          loadOp: 'load',
          storeOp: 'store',
        },
      ],
    };
    if (timestampWrites) passDesc.timestampWrites = timestampWrites;

    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderBindGroup);
    pass.draw(4, this.activeCount);
    pass.end();
  }

  dispose() {
    this.clear();
    this.particleBuffer.destroy();
    this.simUniformBuf.destroy();
    this.renderUniformBuf.destroy();
  }
}
