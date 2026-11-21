/**
 * Touch gestures on the board (phones): one finger works like the mouse's left button, two
 * fingers pinch to zoom and move the view, and a short tap on a piece rotates it (two quick taps
 * flip it). No DOM and no timers: the caller feeds pointer events and acts on what comes back.
 */

/** A tap moves less than this many screen pixels... */
export const TAP_MAX_MOVE_PX = 10;
/** ...and is released within this many milliseconds. */
export const TAP_MAX_MS = 300;
/** A second tap within this time (and near the first) makes a double tap. */
export const DOUBLE_TAP_MS = 280;
/** How near (screen pixels) the second tap of a double tap must land. */
const DOUBLE_TAP_MAX_PX = 30;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export class TouchGestures {
  constructor() {
    /** pointerId -> { x, y } */
    this.points = new Map();
    /** 'idle' | 'single' (one finger, mouse-like) | 'pinch' | 'lifting' (wait until all are up) */
    this.mode = 'idle';
    /** The finger that may still turn out to be a tap: { id, x, y, t, moved }. */
    this.tap = null;
    this.pinch = null;
  }

  get active() {
    return this.mode !== 'idle';
  }

  /**
   * A finger touched. Returns 'single' (handle it like a left-button press), 'pinch' (a second
   * finger: stop what the first finger was doing) or 'ignore'.
   */
  down(id, x, y, t) {
    this.points.set(id, { x, y });
    if (this.mode === 'idle' && this.points.size === 1) {
      this.mode = 'single';
      this.tap = { id, x, y, t, moved: false };
      return 'single';
    }
    if (this.mode === 'single' && this.points.size === 2) {
      this.mode = 'pinch';
      this.tap = null;
      const [a, b] = [...this.points.values()];
      this.pinch = { mid: mid(a, b), dist: Math.max(1, dist(a, b)) };
      return 'pinch';
    }
    this.mode = 'lifting';
    this.tap = null;
    return 'ignore';
  }

  /**
   * A finger moved. Returns 'single' (move like the mouse), { pan: {dx, dy}, zoom: {x, y, factor} }
   * while pinching, or 'ignore'.
   */
  move(id, x, y) {
    if (!this.points.has(id)) return 'ignore';
    this.points.set(id, { x, y });
    if (this.mode === 'single') {
      if (this.tap && dist(this.tap, { x, y }) > TAP_MAX_MOVE_PX) this.tap.moved = true;
      return 'single';
    }
    if (this.mode !== 'pinch' || this.points.size !== 2) return 'ignore';
    const [a, b] = [...this.points.values()];
    const m = mid(a, b);
    const d = Math.max(1, dist(a, b));
    const out = {
      pan: { dx: m.x - this.pinch.mid.x, dy: m.y - this.pinch.mid.y },
      zoom: { x: m.x, y: m.y, factor: d / this.pinch.dist },
    };
    this.pinch = { mid: m, dist: d };
    return out;
  }

  /**
   * A finger left (or was cancelled). Returns 'single' (release like the mouse), 'tap' (also a
   * release, and it was a tap), or 'ignore'.
   */
  up(id, t, cancelled = false) {
    if (!this.points.delete(id)) return 'ignore';
    const wasSingle = this.mode === 'single';
    const tap = this.tap;
    if (this.points.size === 0) {
      this.mode = 'idle';
      this.tap = null;
      this.pinch = null;
    } else {
      this.mode = 'lifting';
    }
    if (!wasSingle) return 'ignore';
    const isTap = !cancelled && tap && tap.id === id && !tap.moved && t - tap.t <= TAP_MAX_MS;
    return isTap ? 'tap' : 'single';
  }

  /** Forget the pending tap (the piece hopped away, the lock was refused...). */
  dropTap() {
    this.tap = null;
  }
}

/**
 * Decides whether taps are single (rotate) or double (flip). A first tap waits up to
 * DOUBLE_TAP_MS for a second; the caller runs a timer and calls expire() when it fires.
 */
export class TapSorter {
  constructor() {
    /** The tap ({ x, y, t, key, ... }) waiting for a possible second one. */
    this.pending = null;
  }

  /**
   * A tap at (x, y) on the piece `key` (null: not on a piece); other fields are kept as given.
   * `waitForDouble` false acts at once.
   * Returns { action, flushed }: action is 'single' (rotate now), 'double' (flip now), 'wait'
   * (start the timer) or 'none'; `flushed` is an earlier waiting tap that turned out to be a
   * single one (rotate it now), or null.
   */
  tap(tap, waitForDouble = true) {
    const { x, y, t, key } = tap;
    const p = this.pending;
    this.pending = null;
    const near = p && t - p.t <= DOUBLE_TAP_MS && dist(p, { x, y }) <= DOUBLE_TAP_MAX_PX;
    if (near && key !== null && p.key === key) return { action: 'double', flushed: null };
    if (key === null) return { action: 'none', flushed: p };
    if (!waitForDouble) return { action: 'single', flushed: p };
    this.pending = tap;
    return { action: 'wait', flushed: p };
  }

  /** The timer fired: the pending tap was a single one. Returns it (or null). */
  expire() {
    const p = this.pending;
    this.pending = null;
    return p;
  }

  clear() {
    this.pending = null;
  }
}
