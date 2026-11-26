import { OJAMA_CONFIG } from '../config/constants.js';
import { TimedOjamaClock } from './timedOjama.js';

const TICK_MS = 250;
/** While one lasts, the host resends its state this often, so late joiners and drift catch up. */
const RESEND_MS = 5000;

/**
 * Heavy and runaway pieces: ojama that last a while and wear down as pieces are placed. The host
 * (or a solo player) runs the countdown and sends it to the guests, who mirror it. While heavy
 * lasts, dragged pieces lag behind the cursor ('heavyChange'); while runaway lasts, the room makes
 * small groups hop away when grabbed (room.setRunaway).
 *
 * Events on the session: 'heavyChange' { level }, 'timedOjamaChange' { kind, active, announce,
 * author } when one starts or ends, and 'timedOjamaState' { active: [{ kind, remaining }] } each
 * time the time left changes. The UI shows them (banner, sticker, sound).
 */
export class TimedOjamaRunner {
  /** @param {object} session  GameSession (engine, room, getSettings, emit, on) */
  constructor(session) {
    this.session = session;
    this.clock = new TimedOjamaClock();
    this.placedSeen = 0;
    this.sinceResend = 0;
    this.timerId = null;

    session.on('puzzleComplete', () => this.stopAll());
    session.on('puzzleReset', () => this.stopAll());
  }

  get room() {
    return this.session.room;
  }

  get engine() {
    return this.session.engine;
  }

  /** Host or solo: starts `kind` ('heavy' or 'runaway') with the current settings. */
  start(kind, author = null) {
    const o = this.session.getSettings().ojama;
    const C = OJAMA_CONFIG;
    const wasActive = this.clock.isActive(kind);
    if (kind === 'heavy') {
      this.clock.start('heavy', {
        durationSec: o.heavyDuration ?? C.DEFAULT_HEAVY_DURATION_SEC,
        reduceSec: o.heavyReduceSec ?? C.DEFAULT_HEAVY_REDUCE_SEC,
        level: o.heavyLevel ?? C.DEFAULT_HEAVY_LEVEL,
      });
    } else {
      this.clock.start('runaway', {
        durationSec: o.runawayDuration ?? C.DEFAULT_RUNAWAY_DURATION_SEC,
        reduceSec: o.runawayReduceSec ?? C.DEFAULT_RUNAWAY_REDUCE_SEC,
      });
    }
    this.engine.recordTimedOjama(kind);
    this.placedSeen = this.engine.stats.placedCount;
    this._send(kind);
    this._apply(kind, true, !wasActive, author);
    this._ensureTimer();
  }

  /** Ends every timed ojama at once (completion, new puzzle, "すべて消す"), quietly. */
  stopAll() {
    for (const kind of this.clock.stopAll()) {
      this._send(kind);
      this._apply(kind, false, false);
    }
    this._emitState();
  }

  /** Guest: the host's state of one kind. */
  mirror({ kind, remaining, level }) {
    const wasActive = this.clock.isActive(kind);
    this.clock.mirror(kind, remaining, level);
    const active = this.clock.isActive(kind);
    if (active !== wasActive) this._apply(kind, active, true);
    else if (active && kind === 'heavy') this.session.emit('heavyChange', { level });
    if (active) this._ensureTimer();
    this._emitState();
  }

  _ensureTimer() {
    if (this.timerId) return;
    let last = performance.now();
    this.timerId = setInterval(() => {
      const now = performance.now();
      this._tick((now - last) / 1000);
      last = now;
    }, TICK_MS);
  }

  _tick(dtSec) {
    const owner = this.room.role !== 'guest';
    const ended = this.clock.tick(dtSec);
    if (owner) {
      const placed = this.engine.stats.placedCount - this.placedSeen;
      this.placedSeen = this.engine.stats.placedCount;
      const res = this.clock.onPlaced(placed);
      ended.push(...res.ended);
      for (const kind of res.changed) this._send(kind);
      this.sinceResend += dtSec * 1000;
      if (this.sinceResend >= RESEND_MS) {
        this.sinceResend = 0;
        for (const kind of this.clock.active.keys()) this._send(kind);
      }
    }
    for (const kind of ended) {
      if (owner) this._send(kind);
      this._apply(kind, false, true);
    }
    this._emitState();
    if (this.clock.active.size === 0) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /** Host: sends the state of `kind` (0 when it is over). */
  _send(kind) {
    const s = this.clock.get(kind);
    this.room.broadcastTimedOjama(kind, s?.remaining ?? 0, s?.level ?? null);
  }

  /** Turns the effect of `kind` on or off; `announce` asks the UI for its notice. */
  _apply(kind, on, announce, author = null) {
    if (kind === 'heavy') {
      this.session.emit('heavyChange', { level: on ? this.clock.get('heavy').level : null });
    } else if (this.room.role !== 'guest') {
      this.room.setRunaway(on ? this._runawayRules() : null);
    }
    this.session.emit('timedOjamaChange', { kind, active: on, announce, author });
    this._emitState();
  }

  _runawayRules() {
    const o = this.session.getSettings().ojama;
    const C = OJAMA_CONFIG;
    const gripMin = o.runawayGripMinSec ?? C.DEFAULT_RUNAWAY_GRIP_MIN_SEC;
    return {
      chance: (o.runawayChance ?? C.DEFAULT_RUNAWAY_CHANCE) / 100,
      gripMinSec: gripMin,
      gripMaxSec: Math.max(gripMin, o.runawayGripMaxSec ?? C.DEFAULT_RUNAWAY_GRIP_MAX_SEC),
    };
  }

  _emitState() {
    const active = [...this.clock.active].map(([kind, s]) => ({ kind, remaining: s.remaining }));
    this.session.emit('timedOjamaState', { active });
  }
}
