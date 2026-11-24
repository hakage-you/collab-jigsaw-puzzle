/**
 * Lightweight WebGPU mipmap generator for 2d-array rgba8unorm textures.
 * Draws a vertex-buffer-free fullscreen triangle per mip level to downsample level-1 -> level.
 */

const MIPMAP_WGSL = /* wgsl */ `
struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  var out: VsOut;
  out.pos = vec4f(x, y, 0.0, 1.0);
  out.uv = vec2f(x * 0.5 + 0.5, 0.5 - y * 0.5);
  return out;
}

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  return textureSample(srcTex, srcSampler, in.uv);
}
`;

export class MipmapPipeline {
  constructor(device, format = 'rgba8unorm') {
    this.device = device;
    const module = device.createShaderModule({ code: MIPMAP_WGSL });
    this.sampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.bindGroupLayout = this.pipeline.getBindGroupLayout(0);
  }

  /**
   * Encodes mipmap downsampling passes for the given 2d-array texture.
   * @param {GPUCommandEncoder} encoder
   * @param {GPUTexture} texture
   * @param {object} opts
   * @param {number} opts.mipLevelCount
   * @param {number} opts.layerCount
   * @param {Iterable<number>|null} [opts.layers] dirty layer indices, or null for all layers
   */
  generate(encoder, texture, { mipLevelCount, layerCount, layers = null }) {
    if (mipLevelCount <= 1 || layerCount <= 0) return;
    const targetLayers = layers ?? Array.from({ length: layerCount }, (_, i) => i);
    for (const layer of targetLayers) {
      if (layer < 0 || layer >= layerCount) continue;
      this._downsampleLayer(encoder, texture, layer, mipLevelCount);
    }
  }

  _downsampleLayer(encoder, texture, layer, mipLevelCount) {
    for (let mip = 1; mip < mipLevelCount; mip++) {
      const srcView = texture.createView({
        dimension: '2d',
        baseArrayLayer: layer,
        arrayLayerCount: 1,
        baseMipLevel: mip - 1,
        mipLevelCount: 1,
      });
      const dstView = texture.createView({
        dimension: '2d',
        baseArrayLayer: layer,
        arrayLayerCount: 1,
        baseMipLevel: mip,
        mipLevelCount: 1,
      });
      const bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: srcView },
          { binding: 1, resource: this.sampler },
        ],
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: dstView,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    }
  }

  dispose() {
    // RenderPipeline and Sampler are released with the device.
  }
}
