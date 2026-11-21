/**
 * Throwaway WebGL2 prototype of the piece layer, for the renderer comparison
 * (_plan/20261121_1014_webgl_comparison.md). Not part of the game.
 *
 * Draws every piece as one instanced quad from the existing sprite atlas pages, uploaded as a
 * texture array, in a single draw call. Draws pieces only: no board, outlines, cursors or text.
 */

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aCorner;      // 0..1 quad corner
layout(location = 1) in vec4 aPlace;       // world x, y, rotation quarter turns, flip (1 or -1)
layout(location = 2) in vec4 aRect;        // local left, top, width, height
layout(location = 3) in vec4 aUv;          // u0, v0, u1, v1
layout(location = 4) in vec2 aLayerAlpha;  // atlas page, alpha
uniform vec3 uView;      // view x, view y, scale
uniform vec2 uViewport;  // css width, height
out vec3 vUv;
out float vAlpha;
void main() {
  vec2 local = aRect.xy + aCorner * aRect.zw;
  local.x *= aPlace.w;
  float a = aPlace.z * 1.5707963;
  vec2 rotated = vec2(local.x * cos(a) - local.y * sin(a), local.x * sin(a) + local.y * cos(a));
  vec2 screen = (aPlace.xy + rotated - uView.xy) * uView.z + uViewport * 0.5;
  gl_Position = vec4(screen / uViewport * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  vUv = vec3(mix(aUv.xy, aUv.zw, aCorner), aLayerAlpha.x);
  vAlpha = aLayerAlpha.y;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
precision mediump sampler2DArray;
uniform sampler2DArray uAtlas;
in vec3 vUv;
in float vAlpha;
out vec4 outColor;
void main() {
  outColor = texture(uAtlas, vUv) * vAlpha;
}`;

const FLOATS_PER_INSTANCE = 14;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
  }
  return shader;
}

function createProgram(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
  }
  return program;
}

/** Uploads all atlas pages (same size) into one texture array with mipmaps. */
function uploadAtlases(gl, canvases) {
  const size = canvases[0].width;
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage3D(
    gl.TEXTURE_2D_ARRAY,
    0,
    gl.RGBA8,
    size,
    size,
    canvases.length,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  canvases.forEach((canvas, layer) => {
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layer,
      size,
      size,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      canvas,
    );
  });
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { texture, size };
}

function setupGeometry(gl, maxInstances) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const instances = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  gl.bufferData(gl.ARRAY_BUFFER, maxInstances * FLOATS_PER_INSTANCE * 4, gl.DYNAMIC_DRAW);
  const stride = FLOATS_PER_INSTANCE * 4;
  [4, 4, 4, 2].forEach((size, i) => {
    const loc = i + 1;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, i * 16);
    gl.vertexAttribDivisor(loc, 1);
  });
  return { vao, instances };
}

export class WebGL2PiecePrototype {
  /** @param {HTMLCanvasElement} canvas a canvas no other context has been created on */
  constructor(canvas, engine) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.engine = engine;
    this.program = createProgram(gl);
    for (const p of engine.pieces) if (p.isFlipped) engine.ensureBackSprite(p);
    this.atlas = uploadAtlases(gl, engine.spriteAtlases);
    this.layerOf = new Map(engine.spriteAtlases.map((c, i) => [c, i]));
    this.geometry = setupGeometry(gl, engine.pieces.length);
    this.data = new Float32Array(engine.pieces.length * FLOATS_PER_INSTANCE);
    this.uView = gl.getUniformLocation(this.program, 'uView');
    this.uViewport = gl.getUniformLocation(this.program, 'uViewport');
  }

  _fillInstance(offset, p) {
    const sprite = p.isFlipped ? p.backSprite : p.frontSprite;
    const size = this.atlas.size;
    const d = this.data;
    d[offset] = p.x;
    d[offset + 1] = p.y;
    d[offset + 2] = p.rotation;
    d[offset + 3] = p.isFlipped ? -1 : 1;
    d[offset + 4] = -p.spriteHalfW;
    d[offset + 5] = -p.spriteHalfH;
    d[offset + 6] = p.spriteLogicalW || sprite.sw;
    d[offset + 7] = p.spriteLogicalH || sprite.sh;
    d[offset + 8] = sprite.sx / size;
    d[offset + 9] = sprite.sy / size;
    d[offset + 10] = (sprite.sx + sprite.sw) / size;
    d[offset + 11] = (sprite.sy + sprite.sh) / size;
    d[offset + 12] = this.layerOf.get(sprite.canvas) ?? 0;
    d[offset + 13] = 1;
  }

  /** Draws all pieces: locked ones first, then loose ones in z order (one draw call). */
  render(view, cssWidth, cssHeight, dpr) {
    const { gl, engine } = this;
    const w = Math.max(1, Math.floor(cssWidth * dpr));
    const h = Math.max(1, Math.floor(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    let n = 0;
    for (const p of engine.pieces) {
      if (p.isLocked) this._fillInstance(n++ * FLOATS_PER_INSTANCE, p);
    }
    for (const p of engine.getSortedLoosePieces()) {
      if (!p.isFake) this._fillInstance(n++ * FLOATS_PER_INSTANCE, p);
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.uniform3f(this.uView, view.x, view.y, view.scale);
    gl.uniform2f(this.uViewport, cssWidth, cssHeight);
    gl.bindVertexArray(this.geometry.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.geometry.instances);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, n * FLOATS_PER_INSTANCE);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas.texture);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
  }

  /** GPU name for the report (null when the browser hides it). */
  gpuName() {
    const info = this.gl.getExtension('WEBGL_debug_renderer_info');
    return info ? this.gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
  }
}
