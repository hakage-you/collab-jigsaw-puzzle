import { OJAMA_CONFIG, YOUTUBE_CONFIG } from '../config/constants.js';
import { COMPLETED_NOTICE, pickRandomOjama } from './ojamaRules.js';
import { TimedOjamaRunner } from './timedOjamaRunner.js';

/** The kinds a visual ojama picks among (ghost pieces are their own ojama). */
const VISUAL_TYPES = ['grayscale', 'sepia', 'hue', 'spotlight', 'mist'];
const SUPERCHAT_SAMPLE_MESSAGES = [
  '完成させるな！中央をブロック中',
  '赤スパで視界ジャック！連打で退治してね',
  'そろそろピース外れちゃうかもよ？',
];
const SUPERCHAT_DEFAULT_AUTHOR = '視聴者（お邪魔枠）';
const SUPERCHAT_DEFAULT_AMOUNT = '¥10,000';
const SUPERCHAT_MAX_TIER = 7;
const FAKE_CLEANUP_MS = 1000;

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * The ojama use cases: the host (or a solo player) changes the board, then tells the guests.
 * Each one that goes off emits 'ojamaTriggered' { type, author, ... } on the session; the UI
 * shows it (sound, sticker, effects). What stops one is said in a 'toast'.
 */
export class OjamaSession {
  /** @param {object} session  GameSession (engine, room, getSettings, emit, on) */
  constructor(session) {
    this.session = session;
    this.timed = new TimedOjamaRunner(session);
    this.fakeCleanupTimerId = null;

    session.on('puzzleComplete', () => this._dropFakesOnReset());
    session.on('puzzleReset', () => this._dropFakesOnReset());
  }

  get engine() {
    return this.session.engine;
  }

  get room() {
    return this.session.room;
  }

  _ojama() {
    return this.session.getSettings().ojama || {};
  }

  _emit(event, payload) {
    this.session.emit(event, payload);
  }

  _info(message) {
    this._emit('toast', { message, kind: 'info' });
  }

  /** True (with its notice) when the puzzle is done: no ojama then. */
  guardIfCompleted() {
    if (!this.engine.isCompleted()) return false;
    this._info(COMPLETED_NOTICE);
    return true;
  }

  /** Sets off one ojama type now (keywords, random, the test palette, "今すぐ出す"). */
  run(action, author = null, text = null, options = {}) {
    switch (action) {
      case 'drop':
        return this.drop(author);
      case 'ghost':
        return this.visual('ghost', author);
      case 'fake':
        return this.fake(author);
      case 'visual':
        return this.visual(null, author);
      case 'prank':
        return this.prank(author);
      case 'superchat':
        return this.superchat(text, author, options);
      case 'heavy':
      case 'runaway':
        return this.startTimed(action, author);
      case 'random':
        return this.random(author);
      default:
        return false;
    }
  }

  /** Knocks placed pieces off the board. */
  drop(author = null) {
    if (this.guardIfCompleted()) return false;
    const count = Math.max(1, this._ojama().dropCount || OJAMA_CONFIG.DEFAULT_DROP_COUNT);
    const dropped = this.engine.dropLockedPieces(count, this.session.getAllowRotation());
    if (dropped.length === 0) {
      this._info('台紙にはまっているピースがまだありません');
      return false;
    }
    this._emit('ojamaDropEffect', { pieces: dropped });
    this._boardChanged();
    const text = `ピースが${dropped.length}個、ポロッと外れてしまった！`;
    this._emit('ojamaTriggered', { type: 'drop', author, text, pieces: dropped });
    this.room.broadcastPhysicalOjama(text, dropped, 'ojama_drop', 'drop');
    return true;
  }

  /** Turns (and flips) loose pieces nobody is holding. */
  prank(author = null) {
    if (this.guardIfCompleted()) return false;
    const excluded = this.room.getLockedGroupIds();
    const before = this.engine.turnStates();
    const count = this._ojama().prankCount ?? OJAMA_CONFIG.PRANK_DEFAULT_COUNT;
    const changed = this.engine.prankLoosePieces(count, excluded);
    if (changed.length === 0) {
      this._info('動かせる未配置ピースがありません');
      return false;
    }
    this._boardChanged();
    this._emit('ojamaPrankEffect', { pieces: changed, before });
    const text = `ピース${changed.length}個がくるりと回転した！`;
    this._emit('ojamaTriggered', { type: 'prank', author, text, pieces: changed });
    this.room.broadcastPhysicalOjama(text, changed, 'ojama_prank', 'prank');
    return true;
  }

  /** Mixes fake pieces in; with a duration they vanish on their own. */
  fake(author = null) {
    if (this.guardIfCompleted()) return false;
    const o = this._ojama();
    const durationSec = o.fakeDuration ?? OJAMA_CONFIG.FAKE_PIECE_DURATION_SEC;
    const maxCount = o.fakeMaxCount ?? OJAMA_CONFIG.FAKE_PIECE_MAX_COUNT;
    const added = this.engine.addFakePieces(
      o.fakeAddCount ?? OJAMA_CONFIG.FAKE_PIECE_ADD_COUNT,
      durationSec,
      this.session.getAllowRotation(),
      this.session.getAllowFlip(),
      maxCount,
    );
    if (added.length === 0) return false;
    if (durationSec > 0) this._ensureFakeCleanupTimer();
    this._boardChanged();
    const detail = durationSec > 0 ? `${durationSec}秒で消滅` : `消失なし・上限${maxCount}個`;
    const text = `ニセモノのピースが${added.length}個まぎれ込んだ！（${detail}）`;
    this._emit('ojamaTriggered', { type: 'fake', author, text, pieces: added });
    this.room.broadcastFakePieces(text);
    return true;
  }

  /** A visual ojama for a while: `forcedType` or the setting's type (or a random one). */
  visual(forcedType = null, author = null) {
    if (this.guardIfCompleted()) return false;
    const o = this._ojama();
    const wanted = forcedType || o.visualType;
    const visualType =
      wanted === 'ghost' && forcedType
        ? 'ghost'
        : VISUAL_TYPES.includes(wanted)
          ? wanted
          : pickOne(VISUAL_TYPES);
    const duration =
      visualType === 'ghost' ? (o.ghostDuration ?? o.visualDuration) : o.visualDuration;
    this.engine.recordVisualOjama();
    this._emit('hudUpdate');
    const type = visualType === 'ghost' ? 'ghost' : 'visual';
    this._emit('ojamaTriggered', { type, author, visualType, duration });
    this.room.broadcastVisualOjama(visualType, duration);
    return true;
  }

  /**
   * The giant superchat card, with `customText` / `customAuthor` (else a sample). Its HP grows
   * with the players online, and with the superchat's tier when `scaleHpWithTier`.
   */
  superchat(customText = null, customAuthor = null, options = {}) {
    if (this.guardIfCompleted()) return false;
    let maxHp = this.room.computeSuperchatMaxHp();
    if (options.scaleHpWithTier && Number(options.tier) > 1) {
      const clampedTier = Math.min(SUPERCHAT_MAX_TIER, Math.max(1, Number(options.tier)));
      maxHp += (clampedTier - 1) * YOUTUBE_CONFIG.SUPERCHAT_TIER_HP_BONUS;
    }
    const card = {
      maxHp,
      duration: this._ojama().superchatDuration ?? OJAMA_CONFIG.DEFAULT_SUPERCHAT_DURATION_SEC,
      author: customAuthor || SUPERCHAT_DEFAULT_AUTHOR,
      message: customText || pickOne(SUPERCHAT_SAMPLE_MESSAGES),
      amountDisplay: options.amountDisplay || SUPERCHAT_DEFAULT_AMOUNT,
    };
    this.engine.recordSuperchatOjama();
    this._emit('hudUpdate');
    this.room.broadcastSuperchatStart(card);
    this._emit('ojamaTriggered', { type: 'superchat', author: customAuthor, superchat: card });
    return true;
  }

  /** Heavy ('heavy') or runaway ('runaway') pieces for a while. */
  startTimed(kind, author = null) {
    if (this.guardIfCompleted()) return false;
    this.timed.start(kind, author);
    this._emit('hudUpdate');
    this._emit('ojamaTriggered', { type: kind, author });
    return true;
  }

  /** A random ojama among the types in use and in the random pool (settings). */
  random(author = null) {
    const pick = pickRandomOjama({
      ojama: this._ojama(),
      hasLocked: this.engine.getLockedCount() > 0,
    });
    if (!pick) {
      this._info('ランダム発動の対象がありません');
      return false;
    }
    return this.run(pick, author);
  }

  /** The test palette's "すべて消す": ends every ojama on the board now (also for the guests). */
  clearAll() {
    this._emit('ojamaCleared');
    if (this.room.role === 'host') this.room.broadcastVisualClear();
    this.timed.stopAll();
    this._stopFakeCleanupTimer();
    if (this.engine.clearFakePieces()) {
      this._emit('renderNeeded');
      if (this.room.role === 'host') this.room.broadcastFakePieces();
    }
    this._emit('hudUpdate');
  }

  /** Guest: the host's state of a timed ojama. */
  mirrorTimed(msg) {
    this.timed.mirror(msg);
  }

  _boardChanged() {
    this._emit('hudUpdate');
    this._emit('renderNeeded');
  }

  /** Completion or a new puzzle: fake pieces go (nothing is sent; every screen does this). */
  _dropFakesOnReset() {
    this._stopFakeCleanupTimer();
    if (this.engine.clearFakePieces()) this._emit('renderNeeded');
  }

  _ensureFakeCleanupTimer() {
    if (this.fakeCleanupTimerId) return;
    this.fakeCleanupTimerId = setInterval(() => this._pruneFakes(), FAKE_CLEANUP_MS);
  }

  _pruneFakes() {
    if (this.engine.pruneExpiredFakePieces()) {
      this._emit('renderNeeded');
      if (this.room.role === 'host') this.room.broadcastFakePieces();
    }
    if (!this.engine.fakePieces.some((fp) => fp.expiresAt > 0)) this._stopFakeCleanupTimer();
  }

  _stopFakeCleanupTimer() {
    if (this.fakeCleanupTimerId) {
      clearInterval(this.fakeCleanupTimerId);
      this.fakeCleanupTimerId = null;
    }
  }
}
