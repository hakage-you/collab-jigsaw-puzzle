import { OJAMA_CONFIG, YOUTUBE_CONFIG } from '../config/constants.js';
import { decideCommentOjama, pickRandomOjama } from '../app/ojamaRules.js';
import { sound } from '../services/sound.js';
import { CpuAutoCommentController } from './cpuAutoCommentController.js';
import { SuperchatCard } from './superchatCard.js';
import { TimedOjamaController } from './timedOjamaController.js';

export class OjamaController {
  constructor({ app, updateHUD, requestRender, setGhostPiecesActive = null, showToast }) {
    this.app = app;
    this.engine = app.engine;
    this.room = app.room;
    this.canvas = document.getElementById('puzzleCanvas');
    this.getSettings = () => app.getSettings();
    this.updateHUD = updateHUD;
    this.requestRender = requestRender;
    this.setGhostPiecesActive = setGhostPiecesActive || (() => {});
    this.showToast = showToast;

    this.visualSabotageTimerId = null;
    this.visualSabotageRemaining = 0;
    this.fakeCleanupTimerId = null;
    this.lastOjamaTime = 0;
    this.commentCounter = 0;
    /** author -> when their keyword last set off an ojama (for the per-viewer wait). */
    this.viewerLastTimes = new Map();

    this.elVisualBanner = document.getElementById('visualSabotageBanner');
    this.elVisualLabel = document.getElementById('visualSabotageLabel');
    this.elVisualTimer = document.getElementById('visualSabotageTimer');
    this.elSpotlight = document.getElementById('spotlightOverlay');

    this.superchat = new SuperchatCard({ app, showToast });
    /** Heavy and runaway pieces: they last a while and wear down as pieces are placed. */
    this.timed = new TimedOjamaController({ app, showToast });

    this.elCommentTriggerCounter = document.getElementById('commentTriggerCounter');
    this.elMiniChatLog = document.getElementById('miniChatLog');
    this.autoComments = new CpuAutoCommentController({
      guardIfCompleted: () => this.guardIfCompleted(),
      onComment: (user, msg) => this.processIncomingComment(user, msg),
    });

    this._bindEvents();
    this._subscribeApp();
    this.syncSettings(this.getSettings());
  }

  get onAutoCommentsChange() {
    return this.autoComments.onChange;
  }

  set onAutoCommentsChange(fn) {
    this.autoComments.onChange = fn;
  }

  syncSettings() {
    this.updateCommentProgressUI();
  }

  _subscribeApp() {
    this.app.on('settingsChange', (s) => this.syncSettings(s));
    this.app.on('puzzleComplete', () => this.clearAllOnComplete());
    this.app.on('puzzleReset', () => this.clearAllOnComplete());
    this.app.on('remoteVisualOjama', ({ visualType, duration }) =>
      this.applyVisualEffect(visualType, duration),
    );
    this.app.on('remoteVisualClear', () => this.clearVisualSabotage(false));
  }

  _bindEvents() {
    document
      .getElementById('btnClearOjamaEffects')
      ?.addEventListener('click', () => this.clearAllEffects());
    // The test palette's ojama buttons (data-ojama-test="drop" etc.).
    for (const btn of document.querySelectorAll('[data-ojama-test]')) {
      btn.addEventListener('click', () => this.runOjama(btn.dataset.ojamaTest));
    }

    document.getElementById('btnSendDummyComment').addEventListener('click', () => {
      const input = document.getElementById('dummyCommentInput');
      const text = input.value.trim();
      if (!text) return;
      this.processIncomingComment('視聴者テスト', text);
      input.value = '';
    });

    document.getElementById('dummyCommentInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('btnSendDummyComment').click();
      }
    });
  }

  isAutoCommentsRunning() {
    return this.autoComments.isRunning();
  }

  stopAutoComments() {
    this.autoComments.stop();
  }

  updateSpotlightPosition(sx, sy) {
    if (!this.elSpotlight.classList.contains('hidden')) {
      this.elSpotlight.style.setProperty('--spot-x', `${sx}px`);
      this.elSpotlight.style.setProperty('--spot-y', `${sy}px`);
    }
  }

  updateCommentProgressUI() {
    const settings = this.getSettings();
    const threshold = Math.max(
      1,
      settings.ojama.commentThreshold || OJAMA_CONFIG.DEFAULT_COMMENT_THRESHOLD,
    );
    this.elCommentTriggerCounter.textContent =
      settings.ojama.commentCountOn === false ? 'オフ' : `${this.commentCounter} / ${threshold}`;
  }

  clearVisualSabotage(broadcast = false) {
    if (this.visualSabotageTimerId) {
      clearInterval(this.visualSabotageTimerId);
      this.visualSabotageTimerId = null;
    }
    this.canvas.classList.remove('sabotage-grayscale', 'sabotage-sepia', 'sabotage-hue');
    this.setGhostPiecesActive(false);
    this.elSpotlight.classList.add('hidden');
    this.elVisualBanner.classList.add('hidden');
    if (broadcast && this.room.role === 'host') {
      this.room.broadcastVisualClear();
    }
  }

  _stopFakeCleanupTimer() {
    if (this.fakeCleanupTimerId) {
      clearInterval(this.fakeCleanupTimerId);
      this.fakeCleanupTimerId = null;
    }
  }

  _ensureFakeCleanupTimer() {
    if (this.fakeCleanupTimerId) return;
    this.fakeCleanupTimerId = setInterval(() => {
      if (this.engine.pruneExpiredFakePieces()) {
        this.requestRender();
        if (this.room.role === 'host') {
          this.room.broadcastFakePieces();
        }
      }
      if (!this.engine.fakePieces.some((fp) => fp.expiresAt > 0)) {
        this._stopFakeCleanupTimer();
      }
    }, 1000);
  }

  /** The test palette's "すべて消す": ends every ojama on the board now (also for the guests). */
  clearAllEffects() {
    this.clearVisualSabotage(true);
    this.superchat.dismiss();
    this.timed.stopAll();
    this._stopFakeCleanupTimer();
    if (this.engine.clearFakePieces()) {
      this.requestRender();
      if (this.room.role === 'host') this.room.broadcastFakePieces();
    }
    this.updateHUD();
  }

  clearAllOnComplete() {
    this.clearVisualSabotage(false);
    this.superchat.dismiss();
    this.stopAutoComments();
    this._stopFakeCleanupTimer();
    if (this.engine.clearFakePieces()) {
      this.requestRender();
    }
  }

  guardIfCompleted() {
    if (this.engine.isCompleted()) {
      this.showToast('パズル完成済みのためお邪魔は発動しません', 'info');
      return true;
    }
    return false;
  }

  triggerDropOjama() {
    if (this.guardIfCompleted()) return false;
    const count = Math.max(
      1,
      this.getSettings().ojama.dropCount || OJAMA_CONFIG.DEFAULT_DROP_COUNT,
    );
    const dropped = this.engine.dropLockedPieces(count, this.app.getAllowRotation());
    if (dropped.length === 0) {
      this.showToast('台紙にはまっているピースがまだありません', 'info');
      return false;
    }
    sound.playOjama();
    this.app.emit('ojamaDropEffect', { pieces: dropped });
    this.updateHUD();
    this.requestRender();
    const msg = `ピースが${dropped.length}個、ポロッと外れてしまった！`;
    this.showToast(msg, 'ojama');
    this.room.broadcastPhysicalOjama(msg, dropped, 'ojama_drop');
    return true;
  }

  applyVisualEffect(chosen, durationSec) {
    this.clearVisualSabotage(false);
    const labelMap = {
      grayscale: 'モノクロ視覚妨害',
      sepia: 'セピア視覚妨害',
      hue: '色相シャッフル妨害',
      spotlight: '暗闇スポットライト妨害',
      ghost: 'ピース透明化妨害',
    };
    const toastMap = {
      grayscale: '世界から色が消えてしまった！',
      sepia: '急にノスタルジックな気分になった！',
      hue: '色がごちゃまぜになってしまった！',
      spotlight: '明かりが消えた！手元しか見えない！',
      ghost: 'ピースたちが透けて見えなくなった！',
    };

    if (chosen === 'spotlight') {
      this.elSpotlight.classList.remove('hidden');
    } else if (chosen === 'ghost') {
      this.setGhostPiecesActive(true);
    } else {
      this.canvas.classList.add(`sabotage-${chosen}`);
    }

    this.visualSabotageRemaining = durationSec;
    this.elVisualLabel.textContent = `${labelMap[chosen]}中`;
    this.elVisualTimer.textContent = `${this.visualSabotageRemaining.toFixed(1)}s`;
    this.elVisualBanner.classList.remove('hidden');

    sound.playOjama();
    this.showToast(`${toastMap[chosen]}（${durationSec}秒）`, 'ojama');

    this.visualSabotageTimerId = setInterval(() => {
      this.visualSabotageRemaining -= 0.2;
      if (this.visualSabotageRemaining <= 0) {
        this.clearVisualSabotage(false);
      } else {
        this.elVisualTimer.textContent = `${this.visualSabotageRemaining.toFixed(1)}s`;
      }
    }, 200);
  }

  triggerVisualOjama(forcedType = null) {
    if (this.guardIfCompleted()) return false;
    const o = this.getSettings().ojama;
    // Ghost pieces are their own ojama now; the visual one picks among the colour/light kinds.
    const types = ['grayscale', 'sepia', 'hue', 'spotlight'];
    const wanted = forcedType || o.visualType;
    const chosen =
      wanted === 'ghost' && forcedType
        ? 'ghost'
        : types.includes(wanted)
          ? wanted
          : types[Math.floor(Math.random() * types.length)];

    const duration = chosen === 'ghost' ? (o.ghostDuration ?? o.visualDuration) : o.visualDuration;
    this.engine.recordVisualOjama();
    this.updateHUD();
    this.applyVisualEffect(chosen, duration);
    this.room.broadcastVisualOjama(chosen, duration);
    return true;
  }

  triggerSuperchatOjama(customText = null, customAuthor = null, options = {}) {
    if (this.guardIfCompleted()) return false;
    const sampleMsgs = [
      '完成させるな！中央をブロック中',
      '赤スパで視界ジャック！連打で退治してね',
      'そろそろピース外れちゃうかもよ？',
    ];
    const author = customAuthor || '視聴者（お邪魔枠）';
    const message = customText || sampleMsgs[Math.floor(Math.random() * sampleMsgs.length)];
    const amountDisplay = options.amountDisplay || '¥10,000';
    let maxHp = this.room.computeSuperchatMaxHp();
    if (options.scaleHpWithTier && Number(options.tier) > 1) {
      const clampedTier = Math.min(7, Math.max(1, Number(options.tier)));
      maxHp += (clampedTier - 1) * YOUTUBE_CONFIG.SUPERCHAT_TIER_HP_BONUS;
    }
    const duration =
      this.getSettings().ojama.superchatDuration ?? OJAMA_CONFIG.DEFAULT_SUPERCHAT_DURATION_SEC;

    this.engine.recordSuperchatOjama();
    this.updateHUD();
    this.room.broadcastSuperchatStart({ maxHp, duration, author, message, amountDisplay });
    this.superchat.show({ maxHp, duration, author, message, amountDisplay });
    return true;
  }

  processYouTubeSuperchat({ author, amountDisplay, message, tier }) {
    const o = this.getSettings().ojama;
    const on = o.enabled?.superchat !== false;
    const emptyEl = this.elMiniChatLog.querySelector('.chat-empty');
    if (emptyEl) emptyEl.remove();

    const line = document.createElement('div');
    line.className = 'chat-line triggered';
    const mark = on ? ' [発動]' : '（巨大スパチャはオフ）';
    line.textContent = `[SC ${amountDisplay}] ${author}: ${message || 'スパチャ！'}${mark}`;
    this.elMiniChatLog.appendChild(line);
    while (this.elMiniChatLog.children.length > 40) {
      this.elMiniChatLog.removeChild(this.elMiniChatLog.firstChild);
    }
    this.elMiniChatLog.scrollTop = this.elMiniChatLog.scrollHeight;
    if (!on) return;

    this.triggerSuperchatOjama(message || `${amountDisplay} スパチャでブロック中！`, author, {
      amountDisplay,
      tier,
      scaleHpWithTier: o.superchatScaleByTier !== false,
    });
  }

  triggerPrankOjama() {
    if (this.guardIfCompleted()) return false;
    const excluded = this.room.getLockedGroupIds();
    const before = this.engine.turnStates();
    const count = this.getSettings().ojama.prankCount ?? OJAMA_CONFIG.PRANK_DEFAULT_COUNT;
    const changed = this.engine.prankLoosePieces(count, excluded);
    if (changed.length === 0) {
      this.showToast('動かせる未配置ピースがありません', 'info');
      return false;
    }
    sound.playOjama();
    this.updateHUD();
    this.requestRender();
    this.app.emit('ojamaPrankEffect', { pieces: changed, before });
    const msg = `ピース${changed.length}個がくるりと回転した！`;
    this.showToast(msg, 'ojama');
    this.room.broadcastPhysicalOjama(msg, changed, 'ojama_prank');
    return true;
  }

  triggerFakePiecesOjama() {
    if (this.guardIfCompleted()) return false;
    const o = this.getSettings().ojama || {};
    const durationSec = o.fakeDuration ?? OJAMA_CONFIG.FAKE_PIECE_DURATION_SEC;
    const maxCount = o.fakeMaxCount ?? OJAMA_CONFIG.FAKE_PIECE_MAX_COUNT;
    const added = this.engine.addFakePieces(
      o.fakeAddCount ?? OJAMA_CONFIG.FAKE_PIECE_ADD_COUNT,
      durationSec,
      this.app.getAllowRotation(),
      this.app.getAllowFlip(),
      maxCount,
    );
    if (added.length === 0) return false;
    if (durationSec > 0) {
      this._ensureFakeCleanupTimer();
    }
    sound.playOjama();
    this.updateHUD();
    this.requestRender();
    const detail = durationSec > 0 ? `${durationSec}秒で消滅` : `消失なし・上限${maxCount}個`;
    const msg = `ニセモノのピースが${added.length}個まぎれ込んだ！（${detail}）`;
    this.showToast(msg, 'ojama');
    this.room.broadcastFakePieces(msg);
    return true;
  }

  /** Heavy ('heavy') or runaway ('runaway') pieces for a while (host or solo). */
  triggerTimedOjama(kind) {
    if (this.guardIfCompleted()) return false;
    this.timed.start(kind);
    this.updateHUD();
    return true;
  }

  /** A random ojama among the types in use and in the random pool (settings). */
  triggerRandomOjama() {
    const pick = pickRandomOjama({
      ojama: this.getSettings().ojama,
      hasLocked: this.engine.getLockedCount() > 0,
    });
    if (!pick) {
      this.showToast('ランダム発動の対象がありません', 'info');
      return false;
    }
    return this.runOjama(pick);
  }

  /** Sets off one ojama type now (keywords, random, the test palette, "今すぐ出す"). */
  runOjama(action, author = null, text = null) {
    switch (action) {
      case 'drop':
        return this.triggerDropOjama();
      case 'ghost':
        return this.triggerVisualOjama('ghost');
      case 'fake':
        return this.triggerFakePiecesOjama();
      case 'visual':
        return this.triggerVisualOjama();
      case 'prank':
        return this.triggerPrankOjama();
      case 'superchat':
        return this.triggerSuperchatOjama(text, author);
      case 'heavy':
      case 'runaway':
        return this.triggerTimedOjama(action);
      case 'random':
        return this.triggerRandomOjama();
      default:
        return false;
    }
  }

  processIncomingComment(author, text) {
    const now = Date.now();
    const { action, nextState, notice, viewerFired } = decideCommentOjama({
      text,
      settings: this.getSettings(),
      now,
      state: { commentCounter: this.commentCounter, lastOjamaTime: this.lastOjamaTime },
      isCompleted: this.engine.isCompleted(),
      viewerLastTime: this.viewerLastTimes.get(author) ?? null,
    });
    this.commentCounter = nextState.commentCounter;
    this.lastOjamaTime = nextState.lastOjamaTime;
    if (viewerFired) this.viewerLastTimes.set(author, now);
    if (action) this.runOjama(action, author, text);
    if (notice) this.showToast(notice, 'info');

    this.updateCommentProgressUI();

    const triggered = Boolean(action);
    const emptyEl = this.elMiniChatLog.querySelector('.chat-empty');
    if (emptyEl) emptyEl.remove();

    const line = document.createElement('div');
    line.className = `chat-line${triggered ? ' triggered' : ''}`;
    line.textContent = `${author}: ${text}${triggered ? ' [発動]' : ''}`;
    this.elMiniChatLog.appendChild(line);
    while (this.elMiniChatLog.children.length > 40) {
      this.elMiniChatLog.removeChild(this.elMiniChatLog.firstChild);
    }
    this.elMiniChatLog.scrollTop = this.elMiniChatLog.scrollHeight;
  }
}
