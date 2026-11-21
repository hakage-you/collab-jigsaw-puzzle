import {
  collectVisiblePieces,
  drawBoardStage,
  drawDeskStage,
  drawLockBadgeStage,
  drawOutlinesStage,
  enterWorld,
  leaveWorld,
  pieceAlpha,
  prepareCanvas,
  resolveLodConfig,
  resolvePieceSprite,
} from '../canvas2d/renderStages.js';
import { TableRendererBase } from '../tableRendererBase.js';
import { FLOATS_PER_INSTANCE, createPieceProgram, drawPieces } from './pieceProgram.js';
import { SpriteTextures } from './spriteTextures.js';

/** Context options: refuse software-emulated WebGL, which is slower than Canvas 2D. */
const CONTEXT_OPTIONS = Object.freeze({
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  failIfMajorPerformanceCaveat: true,
});

/**
 * WebGL2 renderer: the desk, board and reference image are drawn with Canvas 2D on the bottom
 * canvas (they only change with the view); every piece is drawn in one instanced WebGL2 draw
 * call on a canvas above it, from the same sprites as the Canvas 2D renderer; outlines, lock
 * badges, cursors and effects go on the effects layer on top.
 * Throws when WebGL2 is not available, so the caller can fall back to CanvasRenderer.
 */
export class WebGL2Renderer extends TableRendererBase {
  /**
   * @param {object} options TableRendererBase options, plus
   * @param {() => void} [options.onContextLost] the GPU context was lost (it may come back)
   * @param {() => void} [options.onContextRestored] it came back and has been rebuilt
   */
  constructor(options) {
    const piecesCanvas = document.createElement('canvas');
    const gl = piecesCanvas.getContext('webgl2', CONTEXT_OPTIONS);
    if (!gl) throw new Error('WebGL2 is not available (or only in a slow software mode)');
    super(options);
    this.kind = 'webgl2';
    this.ctx = this.canvas.getContext('2d');
    this.gl = gl;
    this.piecesCanvas = piecesCanvas;
    piecesCanvas.className = 'webgl-pieces-canvas';
    piecesCanvas.setAttribute('aria-hidden', 'true');
    this.canvas.after(piecesCanvas);
    this.data = new Float32Array(1024 * FLOATS_PER_INSTANCE);
    this.lost = false;
    this._bindContextEvents(options);
    this._createGpuResources();
  }

  _createGpuResources() {
    this.program = createPieceProgram(this.gl);
    this.textures = new SpriteTextures(this.gl);
    this.sprites.onRegionDrawn = (sprite) => this.textures.queueRegion(sprite);
  }

  _bindContextEvents({ onContextLost, onContextRestored }) {
    this._onLost = (e) => {
      e.preventDefault();
      this.lost = true;
      onContextLost?.();
    };
    this._onRestored = () => {
      this._createGpuResources();
      this.lost = false;
      this.viewState.requestRender();
      onContextRestored?.();
    };
    this.piecesCanvas.addEventListener('webglcontextlost', this._onLost);
    this.piecesCanvas.addEventListener('webglcontextrestored', this._onRestored);
  }

  _resizeLayers(width, height) {
    if (this.piecesCanvas.width === width && this.piecesCanvas.height === height) return false;
    this.piecesCanvas.width = width;
    this.piecesCanvas.height = height;
    return true;
  }

  getStats() {
    return { ...super.getStats(), gpuTextureBytes: this.lost ? 0 : this.textures.bytes };
  }

  _buildFrame() {
    const settings = this.getSettings();
    const vs = this.viewState;
    return {
      ctx: this.ctx,
      engine: this.engine,
      room: this.room,
      view: vs.camera,
      refSheet: vs.refSheet,
      settings,
      isDark: settings.theme === 'dark',
      pal: this._getThemePalette(),
      rect: this.canvasStage.getBoundingClientRect(),
      dpr: window.devicePixelRatio || 1,
      highlightFilter: vs.highlightFilter,
      ghostPiecesActive: vs.ghostPiecesActive,
      draggingGroupId: vs.draggingGroupId,
      hoveredPiece: vs.hoveredPiece,
      sprites: this.sprites,
    };
  }

  /** Pieces to draw this frame with their sprite and opacity (locked first, then by z order). */
  _collectInstances(frame, visible, lodConfig) {
    const list = [];
    for (const piece of [...visible.visibleLocked, ...visible.visibleLoose]) {
      const sprite = resolvePieceSprite(frame, piece, lodConfig);
      if (sprite) list.push({ piece, sprite, alpha: pieceAlpha(frame, piece) });
    }
    return list;
  }

  _fillInstances(list) {
    if (this.data.length < list.length * FLOATS_PER_INSTANCE) {
      this.data = new Float32Array(list.length * 2 * FLOATS_PER_INSTANCE);
    }
    const m = this.sprites.metrics;
    const d = this.data;
    let n = 0;
    for (const { piece, sprite, alpha } of list) {
      const loc = this.textures.locate(sprite.canvas);
      if (!loc) continue;
      const o = n * FLOATS_PER_INSTANCE;
      d[o] = piece.x;
      d[o + 1] = piece.y;
      d[o + 2] = piece.rotation;
      d[o + 3] = piece.isFlipped ? -1 : 1;
      d[o + 4] = -m.halfW;
      d[o + 5] = -m.halfH;
      d[o + 6] = m.logicalW;
      d[o + 7] = m.logicalH;
      d[o + 8] = sprite.sx / loc.size;
      d[o + 9] = sprite.sy / loc.size;
      d[o + 10] = (sprite.sx + sprite.sw) / loc.size;
      d[o + 11] = (sprite.sy + sprite.sh) / loc.size;
      d[o + 12] = loc.kind;
      d[o + 13] = loc.layer;
      d[o + 14] = alpha;
      d[o + 15] = 0;
      n++;
    }
    return n;
  }

  _drawGpuPieces(frame, list) {
    const { gl } = this;
    this.textures.update(this.sprites);
    const count = this._fillInstances(list);
    gl.viewport(0, 0, this.piecesCanvas.width, this.piecesCanvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    drawPieces(gl, this.program, {
      data: this.data,
      count,
      camera: this.viewState.camera,
      cssWidth: frame.rect.width,
      cssHeight: frame.rect.height,
    });
  }

  _drawTable() {
    this.sprites.sync(this.engine);
    const frame = this._buildFrame();
    prepareCanvas(frame);
    drawDeskStage(frame);
    enterWorld(frame);
    drawBoardStage(frame);
    leaveWorld(frame);

    const visible = collectVisiblePieces(frame);
    const count = visible.visibleLocked.length + visible.visibleLoose.length;
    const lodConfig = resolveLodConfig(frame, count);
    if (lodConfig) {
      this.sprites.lodCache.beginFrame(
        this.engine.puzzleGeneration,
        lodConfig.bucket,
        lodConfig.slotStep,
      );
    }
    if (!this.lost && this.sprites.metrics) {
      this._drawGpuPieces(frame, this._collectInstances(frame, visible, lodConfig));
    }
    this._finishTable(lodConfig);
    return { ...frame, visibleLoose: visible.visibleLoose };
  }

  /** Outlines and lock badges over the WebGL pieces, on the effects layer. */
  _drawOverlay(ctx, frame) {
    const f = { ...frame, ctx };
    drawOutlinesStage(f, frame.visibleLoose);
    drawLockBadgeStage(f);
  }

  dispose() {
    super.dispose();
    this.piecesCanvas.removeEventListener('webglcontextlost', this._onLost);
    this.piecesCanvas.removeEventListener('webglcontextrestored', this._onRestored);
    this.sprites.onRegionDrawn = null;
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.piecesCanvas.remove();
  }
}
