import { OJAMA_CONFIG } from '../../config/constants.js';

/** How high a hopping piece rises at the top of its arc, in piece heights. */
const HOP_LIFT = 0.6;
/** Kick-off lines behind a hop fade out over this many seconds. */
const KICK_SEC = 0.4;

const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));

/**
 * Motion drawn over the pieces' real positions: runaway hops (pieces already stand where they
 * landed; while a hop plays they are drawn back along an arc) with their kick-off lines, and the
 * tether from a heavy piece to the cursor that drags it.
 */
export class PieceMotion {
  constructor() {
    /** groupId -> { from: Map(id -> {x, y}), start (ms), dur (ms) } */
    this.hops = new Map();
    /** pieceId -> { dx, dy, lift } this frame, world units. */
    this.offsets = new Map();
    /** { x, y (world), dir (radians), age (s) } */
    this.kicks = [];
    /** { from: {x, y}, to: {x, y} } in world units while a heavy piece is dragged, else null. */
    this.tether = null;
  }

  get active() {
    return this.hops.size > 0 || this.kicks.length > 0;
  }

  /**
   * Plays a hop of the pieces in `pieces` (as they stand now, where they landed) from the
   * positions in `from`. `kick` adds the kick-off lines.
   */
  playHop(pieces, from, now, kick = true) {
    const moved = pieces.filter((p) => from.has(p.id));
    if (moved.length === 0) return;
    const groupId = moved[0].groupId;
    this.hops.set(groupId, { from, start: now, dur: OJAMA_CONFIG.RUNAWAY_HOP_SEC * 1000 });
    if (!kick) return;
    const avg = (list, key) => list.reduce((s, v) => s + v[key], 0) / list.length;
    const starts = moved.map((p) => from.get(p.id));
    const sx = avg(starts, 'x');
    const sy = avg(starts, 'y');
    this.kicks.push({
      x: sx,
      y: sy,
      dir: Math.atan2(avg(moved, 'y') - sy, avg(moved, 'x') - sx),
      age: 0,
    });
  }

  /** Works out this frame's offsets; returns true while something still moves. */
  step(now, engine, dtSec) {
    this.offsets.clear();
    for (const [groupId, hop] of this.hops) {
      const u = Math.min(1, (now - hop.start) / hop.dur);
      if (u >= 1) {
        this.hops.delete(groupId);
        continue;
      }
      const back = 1 - ease(u);
      const lift = Math.sin(u * Math.PI) * engine.pieceH * HOP_LIFT;
      for (const p of engine.getGroupPieces(groupId)) {
        const f = hop.from.get(p.id);
        if (!f) continue;
        this.offsets.set(p.id, { dx: (f.x - p.x) * back, dy: (f.y - p.y) * back - lift, lift });
      }
    }
    for (const k of this.kicks) k.age += dtSec;
    this.kicks = this.kicks.filter((k) => k.age < KICK_SEC);
    return this.active;
  }

  /** Kick-off lines' opacity (1 to 0) and how far out they have moved (0 to 1). */
  static kickPhase(k) {
    const u = k.age / KICK_SEC;
    return { alpha: Math.max(0, 1 - u), out: u };
  }

  clear() {
    this.hops.clear();
    this.offsets.clear();
    this.kicks = [];
    this.tether = null;
  }
}
