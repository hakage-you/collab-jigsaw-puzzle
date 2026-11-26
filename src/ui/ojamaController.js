import { OJAMA_CONFIG } from '../config/constants.js';
import { withTriggerName } from '../app/ojamaNotice.js';
import { COMPLETED_NOTICE, decideCommentOjama } from '../app/ojamaRules.js';
import { sound } from '../services/sound.js';
import { CpuAutoCommentController } from './cpuAutoCommentController.js';
import { OjamaStickers } from './ojamaStickers.js';
import { SuperchatCard } from './superchatCard.js';
import { TimedOjamaController, syncOjamaVignette } from './timedOjamaController.js';

/**
 * How the ojama look and sound: visual effects over the board, stickers, the superchat card, the
 * comment log. Setting one off is GameSession's (runOjama / clearAllOjama); this shows what it
 * reports ('ojamaTriggered', 'ojamaCleared', and the guests' remote events).
 */
export class OjamaController {
  constructor({ app, setGhostPiecesActive = null, showToast }) {
    this.app = app;
    this.room = app.room;
    this.canvas = document.getElementById('puzzleCanvas');
    this.getSettings = () => app.getSettings();
    this.setGhostPiecesActive = setGhostPiecesActive || (() => {});
    this.showToast = showToast;

    this.visualSabotageTimerId = null;
    this.visualSabotageRemaining = 0;
    this.lastOjamaTime = 0;
    this.commentCounter = 0;
    /** author -> when their keyword last set off an ojama (for the per-viewer wait). */
    this.viewerLastTimes = new Map();

    this.elVisualBanner = document.getElementById('visualSabotageBanner');
    this.elVisualLabel = document.getElementById('visualSabotageLabel');
    this.elVisualTimer = document.getElementById('visualSabotageTimer');
    this.elSpotlight = document.getElementById('spotlightOverlay');

    this.superchat = new SuperchatCard({ app, showToast });
    /** Each ojama's notice: a sticker slapped on above the board. */
    this.stickers = new OjamaStickers();
    /** Heavy and runaway pieces: they last a while and wear down as pieces are placed. */
    this.timed = new TimedOjamaController({
      app,
      showToast,
      announce: (kind, text, author) => this._announce(kind, text, author),
    });

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
    this.app.on('ojamaTriggered', (e) => this._showTriggered(e));
    this.app.on('ojamaCleared', () => {
      this.clearVisualSabotage();
      this.superchat.dismiss();
    });
    this.app.on('remoteVisualOjama', ({ visualType, duration }) =>
      this.applyVisualEffect(visualType, duration),
    );
    this.app.on('remoteVisualClear', () => this.clearVisualSabotage());
    // A guest: the host's notice of an ojama it set off (never with a name).
    this.app.on('ojamaNotice', (notice) => this.stickers.show(notice));
  }

  /** An ojama set off on this screen: its sound and sticker, or its effect over the board. */
  _showTriggered({ type, author, text, visualType, duration, superchat }) {
    if (type === 'drop' || type === 'prank' || type === 'fake') {
      sound.playOjama();
      this._announce(type, text, author);
    } else if (type === 'visual' || type === 'ghost') {
      this.applyVisualEffect(visualType, duration, author);
    } else if (type === 'superchat') {
      this.superchat.show(superchat);
    }
    // Heavy and runaway: their notice comes with 'timedOjamaChange' (TimedOjamaController).
  }

  /**
   * Shows an ojama's sticker. The name of whoever set it off goes in front only when the streamer
   * turned that on (settings.ojama.showTriggerName), and only on this screen: what the guests are
   * sent never has it.
   */
  _announce(kind, text, author = null) {
    const showName = this.getSettings().ojama?.showTriggerName === true;
    this.stickers.show({ kind, text: showName ? withTriggerName(text, author) : text });
  }

  /** The N key: turns the names on the stickers on or off without opening the settings. */
  _bindNameKey() {
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (this.room.role === 'guest') return;
      const on = this.getSettings().ojama?.showTriggerName !== true;
      this.app.patchSettings({ ojama: { showTriggerName: on } });
      const state = on ? '出します' : '出しません';
      this.showToast(`お邪魔のステッカーに名前を${state}（N キー）`, 'info');
    });
  }

  _bindEvents() {
    this._bindNameKey();
    document
      .getElementById('btnClearOjamaEffects')
      ?.addEventListener('click', () => this.app.clearAllOjama());
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

  /** Takes the visual ojama off this screen (its own timer ran out, or it was cleared). */
  clearVisualSabotage() {
    if (this.visualSabotageTimerId) {
      clearInterval(this.visualSabotageTimerId);
      this.visualSabotageTimerId = null;
    }
    this.canvas.classList.remove(
      'sabotage-grayscale',
      'sabotage-sepia',
      'sabotage-hue',
      'sabotage-mist',
    );
    this.setGhostPiecesActive(false);
    this.elSpotlight.classList.add('hidden');
    this.elVisualBanner.classList.add('hidden');
    syncOjamaVignette({ visual: '' });
  }

  clearAllOnComplete() {
    this.clearVisualSabotage();
    this.superchat.dismiss();
    this.stopAutoComments();
  }

  /** Before the CPU's comments start: none once the puzzle is done. */
  guardIfCompleted() {
    if (this.app.engine.isCompleted()) {
      this.showToast(COMPLETED_NOTICE, 'info');
      return true;
    }
    return false;
  }

  /** Turns a visual ojama on; `author` set it off (null on a guest's screen). */
  applyVisualEffect(chosen, durationSec, author = null) {
    this.clearVisualSabotage();
    const labelMap = {
      grayscale: 'モノクロ視覚妨害',
      sepia: 'セピア視覚妨害',
      hue: '色相シャッフル妨害',
      spotlight: '暗闇スポットライト妨害',
      ghost: 'ピース透明化妨害',
      mist: '濃霧視覚妨害',
    };
    const toastMap = {
      grayscale: '世界から色が消えてしまった！',
      sepia: '急にノスタルジックな気分になった！',
      hue: '色がごちゃまぜになってしまった！',
      spotlight: '明かりが消えた！手元しか見えない！',
      ghost: 'ピースたちが透けて見えなくなった！',
      mist: '濃い霧が立ち込めてきた！',
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
    syncOjamaVignette({ visual: 'visual' });

    sound.playOjama();
    const kind = chosen === 'ghost' ? 'ghost' : 'visual';
    this._announce(kind, `${toastMap[chosen]}（${durationSec}秒）`, author);

    this.visualSabotageTimerId = setInterval(() => {
      this.visualSabotageRemaining -= 0.2;
      if (this.visualSabotageRemaining <= 0) {
        this.clearVisualSabotage();
      } else {
        this.elVisualTimer.textContent = `${this.visualSabotageRemaining.toFixed(1)}s`;
      }
    }, 200);
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

    this.app.runOjama('superchat', author, message || `${amountDisplay} スパチャでブロック中！`, {
      amountDisplay,
      tier,
      scaleHpWithTier: o.superchatScaleByTier !== false,
    });
  }

  /** Sets off one ojama type now (keywords, random, the test palette, "今すぐ出す"). */
  runOjama(action, author = null, text = null) {
    return this.app.runOjama(action, author, text);
  }

  processIncomingComment(author, text) {
    const now = Date.now();
    const { action, nextState, notice, viewerFired } = decideCommentOjama({
      text,
      settings: this.getSettings(),
      now,
      state: { commentCounter: this.commentCounter, lastOjamaTime: this.lastOjamaTime },
      isCompleted: this.app.engine.isCompleted(),
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
