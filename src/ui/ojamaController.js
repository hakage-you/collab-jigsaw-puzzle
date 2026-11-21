import { OJAMA_CONFIG, YOUTUBE_CONFIG } from '../config/constants.js';
import { decideCommentOjama } from '../app/ojamaRules.js';
import { sound } from '../services/sound.js';
import { OjamaSettingsForm } from './ojamaSettingsForm.js';
import { SuperchatCard } from './superchatCard.js';
import { TimedOjamaController } from './timedOjamaController.js';

export class OjamaController {
  constructor({ app, updateHUD, requestRender, setGhostPiecesActive = null, showToast }) {
    this.app = app;
    this.engine = app.engine;
    this.room = app.room;
    this.canvas = document.getElementById('puzzleCanvas');
    this.getSettings = () => app.getSettings();
    this.readSettingsFromUI = () => this.form.read();
    this.updateHUD = updateHUD;
    this.requestRender = requestRender;
    this.setGhostPiecesActive = setGhostPiecesActive || (() => {});
    this.showToast = showToast;

    this.visualSabotageTimerId = null;
    this.visualSabotageRemaining = 0;
    this.fakeCleanupTimerId = null;
    this.lastOjamaTime = 0;
    this.commentCounter = 0;
    this.autoCommentInterval = null;

    this.elVisualBanner = document.getElementById('visualSabotageBanner');
    this.elVisualLabel = document.getElementById('visualSabotageLabel');
    this.elVisualTimer = document.getElementById('visualSabotageTimer');
    this.elSpotlight = document.getElementById('spotlightOverlay');

    this.superchat = new SuperchatCard({ app, showToast });
    /** Heavy and runaway pieces: they last a while and wear down as pieces are placed. */
    this.timed = new TimedOjamaController({ app, showToast });

    this.form = new OjamaSettingsForm(app);

    this.elCommentTriggerCounter = document.getElementById('commentTriggerCounter');
    this.elMiniChatLog = document.getElementById('miniChatLog');
    this.elBtnAutoComments = document.getElementById('btnToggleAutoComments');

    this._bindEvents();
    this._subscribeApp();
    this.syncSettings(this.getSettings());
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
    document.getElementById('btnTestDrop').addEventListener('click', () => this.triggerDropOjama());
    document
      .getElementById('btnTestVisual')
      .addEventListener('click', () => this.triggerVisualOjama());
    document
      .getElementById('btnTestSuperchat')
      .addEventListener('click', () => this.triggerSuperchatOjama());
    document
      .getElementById('btnTestPrank')
      .addEventListener('click', () => this.triggerPrankOjama());
    document
      .getElementById('btnTestFake')
      ?.addEventListener('click', () => this.triggerFakePiecesOjama());
    for (const kind of ['heavy', 'runaway']) {
      const id = kind === 'heavy' ? 'btnTestHeavy' : 'btnTestRunaway';
      document.getElementById(id)?.addEventListener('click', () => this.triggerTimedOjama(kind));
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

    this.elBtnAutoComments.addEventListener('click', () => {
      if (this.autoCommentInterval) {
        this.stopAutoComments();
        return;
      }

      const samples = [
        'がんばえー！',
        'そこ右上の角じゃない？',
        '!drop お邪魔いれちゃうぞｗ',
        'きれいな色だね〜',
        '!color 見づらくなれ！',
        '!spin 回しちゃえ〜',
        '!ghost 透明になっちゃえ！',
        '!fake 偽ピース混ぜちゃうぞ！',
      ];
      this.elBtnAutoComments.textContent = '自動コメント停止';
      this.autoCommentInterval = setInterval(() => {
        const msg = samples[Math.floor(Math.random() * samples.length)];
        const user = `視聴者${Math.floor(10 + Math.random() * 90)}`;
        this.processIncomingComment(user, msg);
      }, OJAMA_CONFIG.AUTO_COMMENT_INTERVAL_MS);
    });
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
    this.elCommentTriggerCounter.textContent = `${this.commentCounter} / ${threshold}`;
  }

  stopAutoComments() {
    if (this.autoCommentInterval) {
      clearInterval(this.autoCommentInterval);
      this.autoCommentInterval = null;
    }
    this.elBtnAutoComments.textContent = '自動コメント開始';
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
    this.readSettingsFromUI();

    const settings = this.getSettings();
    const types = ['grayscale', 'sepia', 'hue', 'spotlight', 'ghost'];
    let chosen = forcedType || settings.ojama.visualType;
    if (chosen === 'random' || !types.includes(chosen)) {
      chosen = types[Math.floor(Math.random() * types.length)];
    }

    const duration = settings.ojama.visualDuration;
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

  processYouTubeSuperchat({ author, amountDisplay, message, tier, scaleHpWithTier }) {
    const emptyEl = this.elMiniChatLog.querySelector('.chat-empty');
    if (emptyEl) emptyEl.remove();

    const line = document.createElement('div');
    line.className = 'chat-line triggered';
    line.textContent = `[SC ${amountDisplay}] ${author}: ${message || 'スパチャ！'} [発動]`;
    this.elMiniChatLog.appendChild(line);
    while (this.elMiniChatLog.children.length > 40) {
      this.elMiniChatLog.removeChild(this.elMiniChatLog.firstChild);
    }
    this.elMiniChatLog.scrollTop = this.elMiniChatLog.scrollHeight;

    this.triggerSuperchatOjama(message || `${amountDisplay} スパチャでブロック中！`, author, {
      amountDisplay,
      tier,
      scaleHpWithTier,
    });
  }

  triggerPrankOjama() {
    if (this.guardIfCompleted()) return false;
    const excluded = this.room.getLockedGroupIds();
    const before = this.engine.turnStates();
    const changed = this.engine.prankLoosePieces(OJAMA_CONFIG.PRANK_DEFAULT_COUNT, excluded);
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
      OJAMA_CONFIG.FAKE_PIECE_ADD_COUNT,
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

  triggerRandomOjama() {
    const hasLocked = this.engine.getLockedCount() > 0;
    const options = ['visual', 'superchat', 'prank', 'fake', 'heavy', 'runaway'];
    if (hasLocked) options.push('drop');
    const pick = options[Math.floor(Math.random() * options.length)];
    if (pick === 'heavy' || pick === 'runaway') this.triggerTimedOjama(pick);
    else if (pick === 'drop') this.triggerDropOjama();
    else if (pick === 'visual') this.triggerVisualOjama();
    else if (pick === 'superchat') this.triggerSuperchatOjama();
    else if (pick === 'fake') this.triggerFakePiecesOjama();
    else this.triggerPrankOjama();
  }

  _runCommentOjama(action, author, text) {
    switch (action) {
      case 'drop':
        this.triggerDropOjama();
        break;
      case 'ghost':
        this.triggerVisualOjama('ghost');
        break;
      case 'fake':
        this.triggerFakePiecesOjama();
        break;
      case 'visual':
        this.triggerVisualOjama();
        break;
      case 'prank':
        this.triggerPrankOjama();
        break;
      case 'superchat':
        this.triggerSuperchatOjama(text, author);
        break;
      case 'heavy':
      case 'runaway':
        this.triggerTimedOjama(action);
        break;
      case 'random':
        this.triggerRandomOjama();
        break;
      default:
        break;
    }
  }

  processIncomingComment(author, text) {
    this.readSettingsFromUI();
    const { action, nextState, notice } = decideCommentOjama({
      text,
      settings: this.getSettings(),
      now: Date.now(),
      state: { commentCounter: this.commentCounter, lastOjamaTime: this.lastOjamaTime },
      isCompleted: this.engine.isCompleted(),
    });
    this.commentCounter = nextState.commentCounter;
    this.lastOjamaTime = nextState.lastOjamaTime;
    if (action) this._runCommentOjama(action, author, text);
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
