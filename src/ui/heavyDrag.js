import { OJAMA_CONFIG } from '../config/constants.js';

/** Dust puffs under a moving heavy piece at most this often (seconds). */
const DUST_EVERY_SEC = 0.12;
/** Below this speed (world units per second) the piece counts as standing still: no dust. */
const DUST_MIN_SPEED = 40;

/**
 * Dragging while pieces are heavy: the group trails behind the cursor (closing about 63% of the
 * gap every `HEAVY_LEVELS[level]` seconds) with a line to the cursor and dust under it. Letting
 * go stops it where it is. The moves go out as ordinary drag previews, so nothing extra is sent.
 */
export class HeavyDrag {
  constructor({ app, vs }) {
    this.app = app;
    this.vs = vs;
    this.groupId = null;
    this.rafId = 0;
  }

  get active() {
    return this.groupId !== null;
  }

  /** Starts trailing `groupId`, grabbed at world point `grab` on `piece`. */
  begin(groupId, grab, piece) {
    this.end();
    this.groupId = groupId;
    this.anchorId = piece.id;
    this.grabOffset = { x: grab.x - piece.x, y: grab.y - piece.y };
    this.cursor = { ...grab };
    this.pending = { x: 0, y: 0 };
    this.sinceDust = 0;
    this.last = performance.now();
    const loop = (now) => {
      this._step(Math.min(0.1, (now - this.last) / 1000));
      this.last = now;
      if (this.active) this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /** The cursor moved by (dx, dy) world units, to world point `cursor`. */
  move(dx, dy, cursor) {
    this.pending.x += dx;
    this.pending.y += dy;
    this.cursor = cursor;
  }

  /** Stops trailing; the group stays where it is now. */
  end() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.groupId = null;
    this.vs.motion.tether = null;
  }

  /** Heavy ended mid-drag: the group catches up with the cursor at once and drags as usual. */
  catchUp() {
    if (!this.active) return;
    this.app.moveGroup(this.groupId, this.pending.x, this.pending.y);
    this.app.sendDragPreview(this.groupId, true);
    this.end();
    this.vs.requestRender();
  }

  _step(dt) {
    const tau = OJAMA_CONFIG.HEAVY_LEVELS[this.vs.heavyLevel];
    if (!tau) return;
    const k = 1 - Math.exp(-dt / tau);
    const mx = this.pending.x * k;
    const my = this.pending.y * k;
    this.pending.x -= mx;
    this.pending.y -= my;
    if (Math.abs(mx) + Math.abs(my) > 1e-3) {
      this.app.moveGroup(this.groupId, mx, my);
      this.app.sendDragPreview(this.groupId);
    }
    const piece = this.app.engine.getPieceById(this.anchorId);
    if (!piece) {
      this.end();
      return;
    }
    this.vs.motion.tether = {
      from: { x: piece.x + this.grabOffset.x, y: piece.y + this.grabOffset.y },
      to: this.cursor,
    };
    this.sinceDust += dt;
    const speed = dt > 0 ? Math.hypot(mx, my) / dt : 0;
    if (speed > DUST_MIN_SPEED && this.sinceDust >= DUST_EVERY_SEC) {
      this.sinceDust = 0;
      this.vs.playEffect('heavyDust', piece.x, piece.y + this.app.engine.pieceH * 0.45);
    }
    this.vs.requestRender();
  }
}
