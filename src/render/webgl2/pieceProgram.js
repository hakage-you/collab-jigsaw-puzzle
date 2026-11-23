/**
 * WebGL2 program that draws pieces as instanced quads, one draw call per frame.
 * Each instance: world position, quarter-turn rotation, mirror flag, the sprite's rectangle in
 * piece-local units, its UV rectangle, which texture it lives in (atlas / zoom / fake), the layer
 * of that texture array, opacity, and a shadow strength (0 for the piece itself; above 0 draws
 * the sprite's shape in black at that opacity, for a lifted piece's shadow).
 */

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aCorner;   // 0..1 quad corner
layout(location = 1) in vec4 aPlace;    // world x, y, quarter turns, flip (1 or -1)
layout(location = 2) in vec4 aRect;     // local left, top, width, height
layout(location = 3) in vec4 aUv;       // u0, v0, u1, v1
layout(location = 4) in vec4 aMisc;     // texture (0 atlas, 1 zoom, 2 fake), layer, alpha, shadow
uniform vec3 uView;      // camera x, y, scale
uniform vec2 uViewport;  // stage size in CSS px
out vec3 vUv;
flat out int vTex;
out float vAlpha;
out float vShadow;
void main() {
  vec2 local = aRect.xy + aCorner * aRect.zw;
  local.x *= aPlace.w;
  float a = aPlace.z * 1.5707963267948966;
  float c = cos(a);
  float s = sin(a);
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 screen = (aPlace.xy + rotated - uView.xy) * uView.z + uViewport * 0.5;
  vec2 clip = screen / uViewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUv = vec3(mix(aUv.xy, aUv.zw, aCorner), aMisc.y);
  vTex = int(aMisc.x + 0.5);
  vAlpha = aMisc.z;
  vShadow = aMisc.w;
}`;

// All three textures are sampled and one is picked, so mipmap selection stays well defined.
const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
precision mediump sampler2DArray;
uniform sampler2DArray uAtlas;
uniform sampler2DArray uZoom;
uniform sampler2DArray uFake;
in vec3 vUv;
flat in int vTex;
in float vAlpha;
in float vShadow;
out vec4 outColor;
void main() {
  vec4 atlas = texture(uAtlas, vUv);
  vec4 zoom = texture(uZoom, vUv);
  vec4 fake = texture(uFake, vUv);
  vec4 color = vTex == 1 ? zoom : (vTex == 2 ? fake : atlas);
  // Premultiplied alpha: a shadow is black with the sprite's coverage.
  outColor = vShadow > 0.0 ? vec4(0.0, 0.0, 0.0, color.a) * (vShadow * vAlpha) : color * vAlpha;
}`;

export const FLOATS_PER_INSTANCE = 16;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

/** Compiles the program and sets up the quad and instance buffers. */
export function createPieceProgram(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const instances = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  const stride = FLOATS_PER_INSTANCE * 4;
  for (let i = 0; i < 4; i++) {
    gl.enableVertexAttribArray(i + 1);
    gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, stride, i * 16);
    gl.vertexAttribDivisor(i + 1, 1);
  }
  gl.bindVertexArray(null);

  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'uAtlas'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'uZoom'), 1);
  gl.uniform1i(gl.getUniformLocation(program, 'uFake'), 2);
  return {
    program,
    vao,
    instances,
    capacity: 0,
    uView: gl.getUniformLocation(program, 'uView'),
    uViewport: gl.getUniformLocation(program, 'uViewport'),
  };
}

/** Draws `count` instances from `data` (Float32Array) with the given camera. */
export function drawPieces(gl, prog, { data, count, camera, cssWidth, cssHeight }) {
  gl.useProgram(prog.program);
  gl.bindVertexArray(prog.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, prog.instances);
  const needed = count * FLOATS_PER_INSTANCE;
  if (needed > prog.capacity) {
    prog.capacity = Math.max(needed, prog.capacity * 2, 1024 * FLOATS_PER_INSTANCE);
    gl.bufferData(gl.ARRAY_BUFFER, prog.capacity * 4, gl.DYNAMIC_DRAW);
  }
  if (count > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, needed);
  gl.uniform3f(prog.uView, camera.x, camera.y, camera.scale);
  gl.uniform2f(prog.uViewport, cssWidth, cssHeight);
  if (count > 0) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  gl.bindVertexArray(null);
}
