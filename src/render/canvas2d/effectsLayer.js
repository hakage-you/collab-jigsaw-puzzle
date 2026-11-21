import { drawAllCursors } from './canvasOverlayRenderer.js';

/** Snap flashes fade out over about a third of a second. */
const FLASH_FADE_PER_SEC = 2.7;
const CONFETTI_GRAVITY = 504; // px/s²

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

  /** Draws one frame. `f`: { viewState, room, pal, rect, dpr, dtSec }. */
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
    this._drawSnapFlashes(vs, f.pal, f.dtSec);
    drawAllCursors(ctx, { room: f.room, scale: vs.camera.scale, pal: f.pal });
    ctx.restore();

    this._drawConfetti(vs, rect, f.dtSec);
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

  _drawConfetti(vs, rect, dtSec) {
    const { ctx } = this;
    const confetti = vs.confetti;
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.x += c.vx * dtSec;
      c.y += c.vy * dtSec;
      c.vy += CONFETTI_GRAVITY * dtSec;
      c.rot += c.vr * dtSec;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.6);
      ctx.restore();
      if (c.y > rect.height + 30) confetti.splice(i, 1);
    }
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dirty = false;
  }
}
