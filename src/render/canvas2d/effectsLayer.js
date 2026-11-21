import { EFFECTS } from '../effects/effectRecipes.js';
import {
  advanceParticles,
  dropLaterWaves,
  sampleParticle,
  SLOW_FRAME_SEC,
  SLOW_FRAMES_IN_A_ROW,
  StampCache,
} from '../effects/effectPlayer.js';
import { drawAllCursors } from './canvasOverlayRenderer.js';

/** Snap flashes fade out over about a third of a second. */
const FLASH_FADE_PER_SEC = 2.7;

/**
 * Transparent canvas over the table for things that move on their own: other players'
 * cursors, snap flashes and confetti. Drawing them here means the table (every piece) is not
 * redrawn just because a cursor moved or an effect is playing. All motion is per second, so
 * effects run at the same speed on 60 Hz and 144 Hz screens.
 */
export class EffectsLayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stamps = new StampCache();
    /** Frames in a row slower than SLOW_FRAME_SEC (a struggling PC thins big effects out). */
    this.slowFrames = 0;
    /** True when the last frame drew effects: one more frame is needed to clear their traces. */
    this.dirty = false;
  }

  resize(cssWidth, cssHeight, dpr) {
    const w = Math.max(1, Math.floor(cssWidth * dpr));
    const h = Math.max(1, Math.floor(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      return true;
    }
    return false;
  }

  /**
   * Draws one frame. `f`: { viewState, room, pal, rect, dpr, dtSec, drawWorld }.
   * `drawWorld(ctx)`, when given, draws renderer-specific things in world space first
   * (outlines and lock badges over WebGL pieces).
   */
  render(f) {
    const { ctx } = this;
    const { rect, dpr, viewState: vs } = f;
    this.dirty = vs.hasEffects;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.translate(rect.width / 2, rect.height / 2);
    ctx.scale(vs.camera.scale, vs.camera.scale);
    ctx.translate(-vs.camera.x, -vs.camera.y);
    f.drawWorld?.(ctx);
    this._drawSnapFlashes(vs, f.pal, f.dtSec);
    drawAllCursors(ctx, { room: f.room, scale: vs.camera.scale, pal: f.pal });
    ctx.restore();

    this._drawParticles(vs, f.pal, rect, f.dtSec);
  }

  /** Stamp effects: at world points or screen points (confetti), drawn at a fixed screen size. */
  _drawParticles(vs, pal, rect, dtSec) {
    const { ctx } = this;
    const cam = vs.camera;
    for (const p of vs.particles) {
      const s = sampleParticle(p);
      const size = s.sizePx * s.scale;
      if (size <= 0) continue;
      const stamp = this.stamps.get(EFFECTS[p.name].shape, p.color, pal.fx, s.mirror);
      const x = p.screen ? p.x : (p.x - cam.x) * cam.scale + rect.width / 2;
      const y = p.screen ? p.y : (p.y - cam.y) * cam.scale + rect.height / 2;
      ctx.save();
      ctx.translate(x + s.dx, y + s.dy);
      ctx.rotate(s.rotation);
      ctx.scale(s.flip, 1);
      ctx.drawImage(stamp, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    this.slowFrames = dtSec > SLOW_FRAME_SEC ? this.slowFrames + 1 : 0;
    if (this.slowFrames >= SLOW_FRAMES_IN_A_ROW) dropLaterWaves(vs.particles);
    advanceParticles(vs.particles, dtSec);
  }

  _drawSnapFlashes(vs, pal, dtSec) {
    const { ctx } = this;
    const flashes = vs.snapFlashes;
    for (let i = flashes.length - 1; i >= 0; i--) {
      const fl = flashes[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, fl.alpha);
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 4 / vs.camera.scale;
      ctx.strokeRect(fl.x - fl.w / 2, fl.y - fl.h / 2, fl.w, fl.h);
      ctx.restore();
      fl.alpha -= FLASH_FADE_PER_SEC * dtSec;
      if (fl.alpha <= 0) flashes.splice(i, 1);
    }
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dirty = false;
  }
}
