import {
  collectVisiblePieces,
  drawLockBadgeStage,
  drawnAt,
  liftScaleOf,
  liftedGroups,
  pieceAlpha,
  resolveLodConfig,
  resolvePieceSprite,
} from '../canvas2d/renderStages.js';
import { drawZoneLabels, resolvePlayerColor } from '../canvas2d/canvasOverlayRenderer.js';
import { TableRendererBase } from '../tableRendererBase.js';
import {
  configureWebGPUCanvas,
  createTimestampProfiler,
  parseCssColor,
  requestWebGPUDevice,
} from './gpuContext.js';
import { MipmapPipeline } from './mipmapPipeline.js';
import { ParticleComputePipeline } from './particleComputePipeline.js';
import { FLOATS_PER_INSTANCE, PiecePipeline } from './piecePipeline.js';
import { POST_EFFECT_MODE, PostProcessPipeline } from './postProcessPipeline.js';
import { SpriteTexturesGpu } from './spriteTexturesGpu.js';
import { TableBakePipeline } from './tableBakePipeline.js';

const NO_OUTLINE = Object.freeze([0, 0, 0, 0]);
const SHADOW_OFFSET_PX = Object.freeze({ dx: 5, dy: 9, strength: 0.36 });

function resolveOutlineRgba(frame, piece, lockResolver) {
  const { room, draggingGroupId, hoveredPiece, pal } = frame;
  const lockOwner = lockResolver ? room.groupLocks.get(piece.groupId) : null;
  if (lockOwner && lockOwner !== room.myPlayerId) {
    const meta = room.getPlayerMeta(lockOwner);
    if (meta) return parseCssColor(resolvePlayerColor(meta.color, pal));
  }
  if (draggingGroupId !== null && piece.groupId === draggingGroupId) {
    return parseCssColor(pal.accent);
  }
  if (hoveredPiece && piece.groupId === hoveredPiece.groupId) {
    const [r, g, b, a] = parseCssColor(pal.secondary);
    return [r, g, b, a * 0.88];
  }
  return NO_OUTLINE;
}

function resolveShadowSprite(sprites, piece) {
  if (piece.isFake) return sprites.fakeSprite(piece);
  return piece.isFlipped ? sprites.backSprite(piece) : sprites.frontSprite(piece);
}

/**
 * WebGPU hybrid renderer:
 * - Bottom #puzzleCanvas is cleared once and left idle as the input target.
 * - WebGPU draws desk, baked board/frame, baked reference sheet, pieces (2.5D bevel,
 *   outlines, mipmap soft shadows), compute confetti particles, and optional post-process.
 * - Top Canvas 2D overlay draws Japanese zone labels, lock badges, cursors, and stamp effects.
 */
export class WebGPURenderer extends TableRendererBase {
  static async create(options) {
    const gpu = await requestWebGPUDevice({
      powerPreference: options.powerPreference,
      allowFallbackAdapter: options.allowFallbackAdapter ?? true,
    });
    const piecesCanvas = document.createElement('canvas');
    try {
      const { context, format } = configureWebGPUCanvas(piecesCanvas, gpu.device);
      return new WebGPURenderer({
        ...options,
        gpu: { ...gpu, context, format, piecesCanvas },
      });
    } catch (err) {
      gpu.device.destroy?.();
      piecesCanvas.remove();
      throw err;
    }
  }

  constructor(options) {
    const { gpu, onContextLost, onGpuError } = options;
    if (!gpu?.device || !gpu?.context || !gpu?.piecesCanvas) {
      throw new Error(
        'WebGPURenderer requires initialized GPU context via WebGPURenderer.create()',
      );
    }
    super({ ...options, bakeBevel: false });
    this.kind = 'webgpu';
    this.ctx = this.canvas.getContext('2d');
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.device = gpu.device;
    this.context = gpu.context;
    this.format = gpu.format;
    this.isFallbackAdapter = Boolean(gpu.isFallbackAdapter);
    this.piecesCanvas = gpu.piecesCanvas;
    this.piecesCanvas.className = 'webgpu-pieces-canvas';
    this.piecesCanvas.setAttribute('aria-hidden', 'true');
    this.canvas.after(this.piecesCanvas);

    this.data = new Float32Array(1024 * FLOATS_PER_INSTANCE);
    this.lost = false;
    this._disposed = false;
    this._lastPostMode = POST_EFFECT_MODE.NONE;
    this._lastAnimatedMist = false;
    this._lastNow = performance.now();
    this._dtSec = 0.016;
    this._pointer = { x: -9999, y: -9999, vx: 0, vy: 0, lastAt: 0 };

    this.mipmapPipeline = new MipmapPipeline(this.device, 'rgba8unorm');
    this.textures = new SpriteTexturesGpu(this.device, this.mipmapPipeline);
    this.tableBakePipeline = new TableBakePipeline(this.device, this.format, this.mipmapPipeline);
    this.piecePipeline = new PiecePipeline(this.device, this.format);
    this.particlePipeline = new ParticleComputePipeline(this.device, this.format);
    this.postProcessPipeline = new PostProcessPipeline(this.device, this.format);
    this.profiler = createTimestampProfiler(this.device);
    this.sprites.onRegionDrawn = (sprite) => this.textures.queueRegion(sprite);

    this._onPointerMove = (e) => this._trackPointer(e);
    this.canvas.addEventListener('pointermove', this._onPointerMove);

    this._onUncapturedError = (event) => {
      if (this._disposed || this.lost) return;
      this.lost = true;
      onGpuError?.(event?.error || event);
    };
    this.device.addEventListener?.('uncapturederror', this._onUncapturedError);

    this.device.lost.then((info) => {
      if (this._disposed || info?.reason === 'destroyed') return;
      this.lost = true;
      onContextLost?.(info);
    });
  }

  _trackPointer(e) {
    const rect = this.canvasStage.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const now = performance.now();
    const dt = (now - this._pointer.lastAt) / 1000;
    if (this._pointer.lastAt > 0 && dt > 0.001 && dt < 0.25) {
      this._pointer.vx = Math.max(-1800, Math.min(1800, (x - this._pointer.x) / dt));
      this._pointer.vy = Math.max(-1800, Math.min(1800, (y - this._pointer.y) / dt));
    }
    this._pointer.x = x;
    this._pointer.y = y;
    this._pointer.lastAt = now;
  }

  _resizeLayers(width, height) {
    if (this.piecesCanvas.width === width && this.piecesCanvas.height === height) return false;
    this.piecesCanvas.width = width;
    this.piecesCanvas.height = height;
    return true;
  }

  getStats() {
    const gpuBytes = this.lost ? 0 : this.textures.bytes + this.tableBakePipeline.bytes;
    return {
      ...super.getStats(),
      gpuTextureBytes: gpuBytes,
      lastGpuMs: this.profiler?.lastMs ?? null,
      isFallbackAdapter: this.isFallbackAdapter,
      activeParticles: this.particlePipeline.activeCount,
    };
  }

  launchConfetti() {
    const intensity = this.viewState.effectIntensity;
    if (intensity === 'off') return;
    const rect = this.canvasStage.getBoundingClientRect();
    this.particlePipeline.burst({
      intensity,
      cssWidth: rect.width || 800,
      cssHeight: rect.height || 600,
    });
    this.viewState.requestRender();
  }

  _resolvePostMode() {
    const explicit = this.viewState.visualSabotage;
    const cl = this.canvas.classList;
    if (explicit === 'mist' || cl.contains('sabotage-mist')) {
      return POST_EFFECT_MODE.MIST;
    }
    if (explicit === 'grayscale' || cl.contains('sabotage-grayscale')) {
      return POST_EFFECT_MODE.GRAYSCALE;
    }
    if (explicit === 'sepia' || cl.contains('sabotage-sepia')) {
      return POST_EFFECT_MODE.SEPIA;
    }
    if (explicit === 'hue' || cl.contains('sabotage-hue')) {
      return POST_EFFECT_MODE.HUE;
    }
    return POST_EFFECT_MODE.NONE;
  }

  renderFrame(now, onTimerTick) {
    this._dtSec = Math.min(0.05, Math.max(0.001, (now - this._lastNow) / 1000));
    this._lastNow = now;
    const decay = Math.exp(-8 * this._dtSec);
    this._pointer.vx *= decay;
    this._pointer.vy *= decay;

    const nextPost = this._resolvePostMode();
    const animatedMist =
      nextPost === POST_EFFECT_MODE.MIST && this.viewState.effectIntensity === 'normal';
    if (nextPost !== this._lastPostMode || animatedMist !== this._lastAnimatedMist) {
      this._lastPostMode = nextPost;
      this._lastAnimatedMist = animatedMist;
      this.viewState.requestRender();
    }
    if (this.particlePipeline.active && this.viewState.effectIntensity === 'off') {
      this.particlePipeline.clear();
      this.viewState.requestRender();
    }

    super.renderFrame(now, onTimerTick);

    if (animatedMist || this.particlePipeline.active) {
      this.viewState.requestRender();
    }
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
      zoneLabelAlpha: vs.zoneLabelAlpha,
      motionOffsets: vs.motion.offsets,
      draggingGroupId: vs.draggingGroupId,
      hoveredPiece: vs.hoveredPiece,
      sprites: this.sprites,
      lifted: liftedGroups({ viewState: vs, engine: this.engine, room: this.room }),
      requestRender: () => vs.requestRender(),
    };
  }

  _collectInstances(frame, visible, lodConfig) {
    const list = [];
    const lifted = [];
    const isMulti = Boolean(frame.room?.isMultiplayer());
    for (const piece of [...visible.visibleLocked, ...visible.visibleLoose]) {
      const alpha = pieceAlpha(frame, piece);
      if (alpha <= 0.001) continue;
      const sprite = resolvePieceSprite(frame, piece, lodConfig);
      if (!sprite) continue;
      const outline = piece.isLocked ? NO_OUTLINE : resolveOutlineRgba(frame, piece, isMulti);
      const entry = {
        piece,
        sprite,
        alpha,
        shadow: 0,
        dx: 0,
        dy: 0,
        outline,
      };
      if (frame.lifted?.has(piece.groupId)) lifted.push(entry);
      else list.push(entry);
    }
    if (frame.lifted && lifted.length > 0) {
      const s = Math.max(1e-4, frame.view.scale);
      const dx = Math.min(SHADOW_OFFSET_PX.dx / s, frame.engine.pieceW * 0.08);
      const dy = Math.min(SHADOW_OFFSET_PX.dy / s, frame.engine.pieceH * 0.13);
      for (const e of lifted) {
        const shadowSprite = resolveShadowSprite(frame.sprites, e.piece);
        if (!shadowSprite) continue;
        list.push({
          ...e,
          sprite: shadowSprite,
          shadow: SHADOW_OFFSET_PX.strength,
          dx,
          dy,
          outline: NO_OUTLINE,
        });
      }
    }
    list.push(...lifted);
    return list;
  }

  _fillInstances(frame, list) {
    if (this.data.length < list.length * FLOATS_PER_INSTANCE) {
      this.data = new Float32Array(list.length * 2 * FLOATS_PER_INSTANCE);
    }
    const m = this.sprites.metrics;
    const d = this.data;
    let n = 0;
    for (const item of list) {
      const loc = this.textures.locate(item.sprite.canvas);
      if (!loc) continue;
      const o = n * FLOATS_PER_INSTANCE;
      const at = drawnAt(frame, item.piece);
      const lift = liftScaleOf(frame, item.piece);
      d[o] = at.x + item.dx;
      d[o + 1] = at.y + item.dy;
      d[o + 2] = item.piece.rotation;
      d[o + 3] = item.piece.isFlipped ? -1 : 1;
      d[o + 4] = -m.halfW * lift;
      d[o + 5] = -m.halfH * lift;
      d[o + 6] = m.logicalW * lift;
      d[o + 7] = m.logicalH * lift;
      d[o + 8] = item.sprite.sx / loc.size;
      d[o + 9] = item.sprite.sy / loc.size;
      d[o + 10] = (item.sprite.sx + item.sprite.sw) / loc.size;
      d[o + 11] = (item.sprite.sy + item.sprite.sh) / loc.size;
      d[o + 12] = loc.kind;
      d[o + 13] = loc.layer;
      d[o + 14] = item.alpha;
      d[o + 15] = item.shadow;
      d[o + 16] = item.outline[0];
      d[o + 17] = item.outline[1];
      d[o + 18] = item.outline[2];
      d[o + 19] = item.outline[3];
      n++;
    }
    return n;
  }

  _encodePasses(encoder, frame, count) {
    const postMode = this._resolvePostMode();
    const hasPost = postMode !== POST_EFFECT_MODE.NONE;
    const particlesActive = this.particlePipeline.stepAndEncodeCompute(encoder, {
      cssWidth: frame.rect.width,
      cssHeight: frame.rect.height,
      dtSec: this._dtSec,
      timeSec: this._lastNow / 1000,
      pointer: this._pointer,
    });
    const swapView = this.context.getCurrentTexture().createView();
    const targetView = hasPost
      ? this.postProcessPipeline.ensureOffscreenTarget(
          this.piecesCanvas.width,
          this.piecesCanvas.height,
        )
      : swapView;
    const endWrites = this.profiler?.endPassWrites || null;

    this.tableBakePipeline.encodePass(encoder, targetView, frame, {
      timestampWrites: this.profiler?.beginPassWrites || null,
    });
    this.piecePipeline.encodePass(encoder, targetView, {
      data: this.data,
      count,
      camera: this.viewState.camera,
      cssWidth: frame.rect.width,
      cssHeight: frame.rect.height,
      dpr: frame.dpr,
      views: this.textures.getTextureViews(),
      loadOp: 'load',
      timestampWrites: !hasPost && !particlesActive ? endWrites : null,
    });
    if (particlesActive) {
      this.particlePipeline.encodeRenderPass(encoder, targetView, {
        cssWidth: frame.rect.width,
        cssHeight: frame.rect.height,
        timestampWrites: !hasPost ? endWrites : null,
      });
    }
    if (hasPost) {
      this.postProcessPipeline.encodePass(encoder, swapView, {
        mode: postMode,
        time: this._lastNow / 1000,
        intensity: 1,
        animated: this.viewState.effectIntensity === 'normal',
        timestampWrites: endWrites,
      });
    }
  }

  _drawGpuPieces(frame, list) {
    if (
      frame.rect.width <= 0 ||
      frame.rect.height <= 0 ||
      this.piecesCanvas.width <= 0 ||
      this.piecesCanvas.height <= 0
    ) {
      return;
    }
    const encoder = this.device.createCommandEncoder();
    this.textures.update(this.sprites, encoder);
    const count = this._fillInstances(frame, list);
    this._encodePasses(encoder, frame, count);
    this.profiler?.resolve(encoder);
    this.device.queue.submit([encoder.finish()]);
    this.profiler?.kickReadback();
  }

  _drawTable() {
    this.sprites.sync(this.engine);
    const frame = this._buildFrame();

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
    return frame;
  }

  /** Draws Japanese zone labels and remote lock badges on the top Canvas 2D overlay. */
  _drawOverlay(ctx, frame) {
    drawZoneLabels(
      ctx,
      this.engine.zoneLabels,
      frame.pal,
      frame.view.scale,
      frame.zoneLabelAlpha ?? 1,
    );
    drawLockBadgeStage({ ...frame, ctx });
  }

  dispose() {
    this._disposed = true;
    super.dispose();
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.device.removeEventListener?.('uncapturederror', this._onUncapturedError);
    this.sprites.onRegionDrawn = null;
    this.textures.dispose();
    this.tableBakePipeline.dispose();
    this.piecePipeline.dispose();
    this.particlePipeline.dispose();
    this.postProcessPipeline.dispose();
    this.profiler?.dispose();
    this.context.unconfigure?.();
    this.device.destroy?.();
    this.piecesCanvas.remove();
  }
}
