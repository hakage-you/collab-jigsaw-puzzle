import { OJAMA_CONFIG } from '../../config/constants.js';

/** How high a hopping piece rises at the top of its arc, in piece heights. */
const HOP_LIFT = 0.6;
/** Kick-off lines behind a hop fade out over this many seconds. */
const KICK_SEC = 0.4;

/** Opening deal drop constants: gentle staggered drop onto each piece's scattered spot. */
const DEAL_DROP_MS = 230;
const DEAL_MIN_SPREAD_MS = 220;
const DEAL_MAX_SPREAD_MS = 360;
const DEAL_FADE_END = 0.35;
const DEAL_SCALE_ADD = 0.14;
const DEAL_SLIDE_RATIO = 0.14;
const DEAL_MAX_DROP_WORLD = 72;

const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));

function dealHash(seed) {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function buildDealItems(loose, pieceW) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of loose) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const spread = Math.min(DEAL_MAX_SPREAD_MS, DEAL_MIN_SPREAD_MS + Math.sqrt(loose.length) * 3);
  const slideRange = pieceW * DEAL_SLIDE_RATIO;

  const items = loose.map((p) => {
    const nx = (p.x - minX) / spanX;
    const ny = (p.y - minY) / spanY;
    const wave = nx * 0.5 + ny * 0.5;
    const j1 = dealHash(p.id + 1);
    const j2 = dealHash(p.id * 3 + 17);
    const delay = (wave * 0.65 + j1 * 0.35) * spread;
    const slideX = (j2 - 0.5) * 2 * slideRange;
    return { id: p.id, delay, slideX };
  });

  return { items, endMs: spread + DEAL_DROP_MS };
}

/**
 * Motion drawn over the pieces' real positions: runaway hops (pieces already stand where they
 * landed; while a hop plays they are drawn back along an arc) with their kick-off lines, the
 * opening deal drop, and the tether from a heavy piece to the cursor that drags it.
 */
export class PieceMotion {
  constructor() {
    /** groupId -> { from: Map(id -> {x, y}), start (ms), dur (ms) } */
    this.hops = new Map();
    /** { start: number | null, pendingFrames: number, dropDur, dropHeight, endMs, items } | null */
    this.deal = null;
    /** pieceId -> { dx, dy, lift, scale?, alpha? } this frame, world units. */
    this.offsets = new Map();
    /** { x, y (world), dir (radians), age (s) } */
    this.kicks = [];
    /** { from: {x, y}, to: {x, y} } in world units while a heavy piece is dragged, else null. */
    this.tether = null;
  }

  get hasPieceMotion() {
    return this.hops.size > 0 || this.deal !== null;
  }

  get active() {
    return this.hasPieceMotion || this.kicks.length > 0;
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

  /**
   * Queues an opening staggered drop for all loose pieces on the table.
   * Starts on the frame after initial sprite build so large puzzles do not skip frames.
   */
  playDeal(pieces, pieceW, pieceH) {
    const loose = pieces.filter((p) => !p.isLocked);
    if (loose.length === 0) {
      this.deal = null;
      return;
    }
    const { items, endMs } = buildDealItems(loose, pieceW);
    this.deal = {
      start: null,
      pendingFrames: 1,
      dropDur: DEAL_DROP_MS,
      dropHeight: Math.min(pieceH * 0.95, DEAL_MAX_DROP_WORLD),
      endMs,
      items,
    };
  }

  cancelDeal() {
    if (!this.deal) return;
    this.deal = null;
    this.offsets.clear();
  }

  _stepDeal(now) {
    const deal = this.deal;
    if (!deal) return;
    if (deal.start === null) {
      if (deal.pendingFrames > 0) {
        deal.pendingFrames -= 1;
        this._applyDealWaiting(deal);
        return;
      }
      deal.start = now;
    }
    const elapsed = now - deal.start;
    if (elapsed >= deal.endMs) {
      this.deal = null;
      return;
    }
    this._applyDealFrame(deal, elapsed);
  }

  _applyDealWaiting(deal) {
    for (const item of deal.items) {
      if (this.offsets.has(item.id)) continue;
      this.offsets.set(item.id, {
        dx: item.slideX,
        dy: -deal.dropHeight,
        lift: deal.dropHeight,
        scale: 1 + DEAL_SCALE_ADD,
        alpha: 0,
      });
    }
  }

  _applyDealFrame(deal, elapsed) {
    for (const item of deal.items) {
      if (this.offsets.has(item.id)) continue;
      const local = elapsed - item.delay;
      if (local <= 0) {
        this.offsets.set(item.id, {
          dx: item.slideX,
          dy: -deal.dropHeight,
          lift: deal.dropHeight,
          scale: 1 + DEAL_SCALE_ADD,
          alpha: 0,
        });
        continue;
      }
      if (local < deal.dropDur) {
        const u = local / deal.dropDur;
        const inv = 1 - u;
        const rem = inv * inv * inv;
        const alpha = Math.min(1, u / DEAL_FADE_END);
        this.offsets.set(item.id, {
          dx: item.slideX * rem,
          dy: -deal.dropHeight * rem,
          lift: deal.dropHeight * rem,
          scale: 1 + DEAL_SCALE_ADD * rem,
          alpha,
        });
      }
    }
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
    this._stepDeal(now);
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
    this.deal = null;
    this.offsets.clear();
    this.kicks = [];
    this.tether = null;
  }
}
