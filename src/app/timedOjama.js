/**
 * Ojama that last a while (heavy pieces, runaway pieces): how long each has left. Placing pieces
 * wears them down, so players can fight back (_plan/open_issues.md section 9). No DOM, no timers:
 * the caller advances it with tick() and reports placed pieces with onPlaced().
 *
 * The host (or a solo player) owns the real countdown; guests mirror what the host sends.
 */
export class TimedOjamaClock {
  constructor() {
    /** kind -> { remaining (seconds), reduceSec, level } */
    this.active = new Map();
  }

  /** Starts (or restarts) `kind` for `durationSec`, losing `reduceSec` per placed piece. */
  start(kind, { durationSec, reduceSec = 0, level = null }) {
    this.active.set(kind, { remaining: Math.max(0, durationSec), reduceSec, level });
  }

  /** Mirrors the host's state (a guest): `remaining` 0 or less ends it. */
  mirror(kind, remaining, level = null) {
    if (remaining > 0) this.active.set(kind, { remaining, reduceSec: 0, level });
    else this.active.delete(kind);
  }

  stop(kind) {
    return this.active.delete(kind);
  }

  stopAll() {
    const kinds = [...this.active.keys()];
    this.active.clear();
    return kinds;
  }

  isActive(kind) {
    return this.active.has(kind);
  }

  get(kind) {
    return this.active.get(kind) ?? null;
  }

  /** Advances every countdown by `dtSec`; returns the kinds that ran out (and were removed). */
  tick(dtSec) {
    const ended = [];
    for (const [kind, s] of this.active) {
      s.remaining -= dtSec;
      if (s.remaining <= 0) ended.push(kind);
    }
    for (const kind of ended) this.active.delete(kind);
    return ended;
  }

  /**
   * `count` pieces were placed: each running kind loses count x its reduceSec. Returns
   * { changed, ended }: kinds whose time went down, and those that ran out (and were removed).
   */
  onPlaced(count) {
    const changed = [];
    const ended = [];
    if (count <= 0) return { changed, ended };
    for (const [kind, s] of this.active) {
      if (s.reduceSec <= 0) continue;
      s.remaining -= count * s.reduceSec;
      (s.remaining <= 0 ? ended : changed).push(kind);
    }
    for (const kind of ended) this.active.delete(kind);
    return { changed, ended };
  }
}
