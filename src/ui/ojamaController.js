import { OJAMA_CONFIG, YOUTUBE_CONFIG } from '../config/constants.js';
import { sound } from '../services/sound.js';

export class OjamaController {
  constructor({ app, updateHUD, requestRender, setGhostPiecesActive = null, showToast }) {
    this.app = app;
    this.engine = app.engine;
    this.room = app.room;
    this.canvas = document.getElementById('puzzleCanvas');
    this.getSettings = () => app.getSettings();
    this.readSettingsFromUI = () => this._readOjamaInputsToApp();
    this.updateHUD = updateHUD;
    this.requestRender = requestRender;
    this.setGhostPiecesActive = setGhostPiecesActive || (() => {});
    this.showToast = showToast;

    this.visualSabotageTimerId = null;
    this.visualSabotageRemaining = 0;
    this.superchatTimerId = null;
    this.superchatRemaining = 0;
    this.fakeCleanupTimerId = null;
    this.superchatHp = OJAMA_CONFIG.SUPERCHAT_MAX_HP;
    this.superchatMaxHp = OJAMA_CONFIG.SUPERCHAT_MAX_HP;
    this.lastOjamaTime = 0;
    this.commentCounter = 0;
    this.autoCommentInterval = null;

    this.elVisualBanner = document.getElementById('visualSabotageBanner');
    this.elVisualLabel = document.getElementById('visualSabotageLabel');
    this.elVisualTimer = document.getElementById('visualSabotageTimer');
    this.elSpotlight = document.getElementById('spotlightOverlay');

    this.elSuperchatLayer = document.getElementById('superchatLayer');
    this.elSuperchatCard = document.getElementById('superchatCard');
    this.elSuperchatAuthor = document.getElementById('superchatAuthor');
    this.elSuperchatAmount = document.getElementById('superchatAmount');
    this.elSuperchatMessage = document.getElementById('superchatMessage');
    this.elSuperchatCountdown = document.getElementById('superchatCountdown');
    this.elSuperchatHpFill = document.getElementById('superchatHpFill');
    this.elSuperchatHpText = document.getElementById('superchatHpText');

    this.elOjamaCommentThreshold = document.getElementById('ojamaCommentThreshold');
    this.elOjamaCooldownSec = document.getElementById('ojamaCooldownSec');
    this.elOjamaDropCount = document.getElementById('ojamaDropCount');
    this.elOjamaVisualDuration = document.getElementById('ojamaVisualDuration');
    this.elOjamaVisualType = document.getElementById('ojamaVisualType');
    this.elOjamaFakeDuration = document.getElementById('ojamaFakeDuration');
    this.elOjamaFakeMaxCount = document.getElementById('ojamaFakeMaxCount');
    this.elOjamaTriggerWords = document.getElementById('ojamaTriggerWords');

    this.elCommentTriggerCounter = document.getElementById('commentTriggerCounter');
    this.elMiniChatLog = document.getElementById('miniChatLog');
    this.elBtnAutoComments = document.getElementById('btnToggleAutoComments');

    this._bindEvents();
    this._subscribeApp();
    this.syncSettings(this.getSettings());
  }

  _readOjamaInputsToApp() {
    const rawFakeDur = Number(this.elOjamaFakeDuration?.value);
    const fakeDuration = Number.isFinite(rawFakeDur)
      ? Math.max(0, Math.min(600, Math.floor(rawFakeDur)))
      : OJAMA_CONFIG.FAKE_PIECE_DURATION_SEC;
    const fakeMaxCount = Math.max(
      1,
      Math.min(16, Number(this.elOjamaFakeMaxCount?.value) || OJAMA_CONFIG.FAKE_PIECE_MAX_COUNT)
    );
    this.app.patchSettings({
      ojama: {
        commentThreshold: Math.max(1, Number(this.elOjamaCommentThreshold.value) || 5),
        cooldownSec: Math.max(0, Number(this.elOjamaCooldownSec.value) || 0),
        dropCount: Math.max(1, Number(this.elOjamaDropCount.value) || 2),
        visualDuration: Math.max(2, Number(this.elOjamaVisualDuration.value) || 8),
        visualType: this.elOjamaVisualType.value || 'random',
        fakeDuration,
        fakeMaxCount,
        triggerWords: this.elOjamaTriggerWords.value || '',
      },
    });
  }

  syncSettings(settings) {
    const o = settings.ojama;
    this.elOjamaCommentThreshold.value = o.commentThreshold;
    this.elOjamaCooldownSec.value = o.cooldownSec;
    this.elOjamaDropCount.value = o.dropCount;
    this.elOjamaVisualDuration.value = o.visualDuration;
    this.elOjamaVisualType.value = o.visualType;
    if (this.elOjamaFakeDuration) {
      this.elOjamaFakeDuration.value = o.fakeDuration ?? OJAMA_CONFIG.FAKE_PIECE_DURATION_SEC;
    }
    if (this.elOjamaFakeMaxCount) {
      this.elOjamaFakeMaxCount.value = o.fakeMaxCount ?? OJAMA_CONFIG.FAKE_PIECE_MAX_COUNT;
    }
    this.elOjamaTriggerWords.value = o.triggerWords;
    this.updateCommentProgressUI();
  }

  _subscribeApp() {
    this.app.on('settingsChange', (s) => this.syncSettings(s));
    this.app.on('puzzleComplete', () => this.clearAllOnComplete());
    this.app.on('puzzleReset', () => this.clearAllOnComplete());
    this.app.on('remoteVisualOjama', ({ visualType, duration }) =>
      this.applyVisualEffect(visualType, duration)
    );
    this.app.on('remoteVisualClear', () => this.clearVisualSabotage(false));
    this.app.on('remoteSuperchat', (msg) => this.showSuperchatOverlay(msg));
    this.app.on('remoteSuperchatHp', ({ hp, maxHp }) => this.applySuperchatHp(hp, maxHp));
    this.app.on('remoteSuperchatDismiss', () => this.dismissSuperchat());
  }

  _bindEvents() {
    [
      this.elOjamaCommentThreshold,
      this.elOjamaCooldownSec,
      this.elOjamaDropCount,
      this.elOjamaVisualDuration,
      this.elOjamaVisualType,
      this.elOjamaFakeDuration,
      this.elOjamaFakeMaxCount,
      this.elOjamaTriggerWords,
    ].forEach((el) => {
      el?.addEventListener('change', () => this._readOjamaInputsToApp());
    });

    document.getElementById('btnTestDrop').addEventListener('click', () => this.triggerDropOjama());
    document.getElementById('btnTestVisual').addEventListener('click', () => this.triggerVisualOjama());
    document.getElementById('btnTestSuperchat').addEventListener('click', () => this.triggerSuperchatOjama());
    document.getElementById('btnTestPrank').addEventListener('click', () => this.triggerPrankOjama());
    document.getElementById('btnTestFake')?.addEventListener('click', () => this.triggerFakePiecesOjama());

    document.getElementById('btnHitSuperchat').addEventListener('click', () => {
      this.elSuperchatCard.classList.remove('hit-shake');
      void this.elSuperchatCard.offsetWidth;
      this.elSuperchatCard.classList.add('hit-shake');
      sound.playTick();

      if (this.room.isGuest()) {
        this.room.submitSuperchatHit();
        return;
      }

      const nextHp = this.room.submitSuperchatHit();
      if (nextHp !== null) {
        this.applySuperchatHp(nextHp, this.superchatMaxHp);
      }
    });

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
        const user = `リスナー${Math.floor(10 + Math.random() * 90)}`;
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
    const threshold = Math.max(1, settings.ojama.commentThreshold || OJAMA_CONFIG.DEFAULT_COMMENT_THRESHOLD);
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

  dismissSuperchat() {
    if (this.superchatTimerId) {
      clearInterval(this.superchatTimerId);
      this.superchatTimerId = null;
    }
    this.elSuperchatLayer.classList.add('hidden');
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
    this.dismissSuperchat();
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
    const count = Math.max(1, Number(this.elOjamaDropCount.value) || OJAMA_CONFIG.DEFAULT_DROP_COUNT);
    const dropped = this.engine.dropLockedPieces(count, this.app.getAllowRotation());
    if (dropped === 0) {
      this.showToast('台紙にはまっているピースがまだありません', 'info');
      return false;
    }
    sound.playOjama();
    this.updateHUD();
    this.requestRender();
    const msg = `お邪魔発動：${dropped}個のピースが台紙から落ちました`;
    this.showToast(msg, 'ojama');
    this.room.broadcastPhysicalOjama(msg);
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
    this.showToast(`お邪魔発動：${labelMap[chosen]} (${durationSec}秒)`, 'ojama');

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

  applySuperchatHp(hp, maxHp) {
    this.superchatHp = hp;
    this.superchatMaxHp = maxHp;
    this.elSuperchatHpText.textContent = String(hp);
    const pct = maxHp > 0 ? (hp / maxHp) * 100 : 0;
    this.elSuperchatHpFill.style.width = `${pct}%`;
    if (hp <= 0) {
      this.dismissSuperchat();
      this.showToast('巨大スパチャを撃退しました', 'success');
    }
  }

  showSuperchatOverlay({ maxHp, duration, author, message, amountDisplay }) {
    this.dismissSuperchat();
    this.elSuperchatAuthor.textContent = author || 'リスナー（お邪魔枠）';
    this.elSuperchatAmount.textContent = amountDisplay || '¥10,000';
    this.elSuperchatMessage.textContent = message || '完成させるな！中央をブロック中';

    this.superchatRemaining = duration || OJAMA_CONFIG.SUPERCHAT_DURATION_SEC;
    this.applySuperchatHp(maxHp, maxHp);
    this.elSuperchatCountdown.textContent = `${this.superchatRemaining}s`;
    this.elSuperchatLayer.classList.remove('hidden');

    sound.playOjama();
    this.showToast('巨大スパチャが盤面をブロックしています', 'ojama');

    this.superchatTimerId = setInterval(() => {
      this.superchatRemaining -= 1;
      if (this.superchatRemaining <= 0) {
        this.dismissSuperchat();
      } else {
        this.elSuperchatCountdown.textContent = `${this.superchatRemaining}s`;
      }
    }, 1000);
  }

  triggerSuperchatOjama(customText = null, customAuthor = null, options = {}) {
    if (this.guardIfCompleted()) return false;
    const sampleMsgs = [
      '完成させるな！中央をブロック中',
      '赤スパで視界ジャック！クリック連打で退治してね',
      'そろそろピース外れちゃうかもよ？',
    ];
    const author = customAuthor || 'リスナー（お邪魔枠）';
    const message = customText || sampleMsgs[Math.floor(Math.random() * sampleMsgs.length)];
    const amountDisplay = options.amountDisplay || '¥10,000';
    let maxHp = this.room.computeSuperchatMaxHp();
    if (options.scaleHpWithTier && Number(options.tier) > 1) {
      const clampedTier = Math.min(7, Math.max(1, Number(options.tier)));
      maxHp += (clampedTier - 1) * YOUTUBE_CONFIG.SUPERCHAT_TIER_HP_BONUS;
    }
    const duration = OJAMA_CONFIG.SUPERCHAT_DURATION_SEC;

    this.engine.recordSuperchatOjama();
    this.updateHUD();
    this.room.broadcastSuperchatStart({ maxHp, duration, author, message, amountDisplay });
    this.showSuperchatOverlay({ maxHp, duration, author, message, amountDisplay });
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

    this.triggerSuperchatOjama(
      message || `${amountDisplay} スパチャでブロック中！`,
      author,
      { amountDisplay, tier, scaleHpWithTier }
    );
  }

  triggerPrankOjama() {
    if (this.guardIfCompleted()) return false;
    const excluded = this.room.getLockedGroupIds();
    const affected = this.engine.prankLoosePieces(OJAMA_CONFIG.PRANK_DEFAULT_COUNT, excluded);
    if (affected === 0) {
      this.showToast('動かせる未配置ピースがありません', 'info');
      return false;
    }
    sound.playOjama();
    this.updateHUD();
    this.requestRender();
    const msg = `お邪魔発動：未配置ピース ${affected}個が回転・裏返りました`;
    this.showToast(msg, 'ojama');
    this.room.broadcastPhysicalOjama(msg);
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
      maxCount
    );
    if (added.length === 0) return false;
    if (durationSec > 0) {
      this._ensureFakeCleanupTimer();
    }
    sound.playOjama();
    this.updateHUD();
    this.requestRender();
    const detail =
      durationSec > 0 ? `${durationSec}秒で消滅` : `消失なし・上限${maxCount}個`;
    const msg = `お邪魔発動：偽ピースを${added.length}個追加しました（${detail}）`;
    this.showToast(msg, 'ojama');
    this.room.broadcastFakePieces(msg);
    return true;
  }

  triggerRandomOjama() {
    const hasLocked = this.engine.getLockedCount() > 0;
    const options = ['visual', 'superchat', 'prank', 'fake'];
    if (hasLocked) options.push('drop');
    const pick = options[Math.floor(Math.random() * options.length)];
    if (pick === 'drop') this.triggerDropOjama();
    else if (pick === 'visual') this.triggerVisualOjama();
    else if (pick === 'superchat') this.triggerSuperchatOjama();
    else if (pick === 'fake') this.triggerFakePiecesOjama();
    else this.triggerPrankOjama();
  }

  processIncomingComment(author, text) {
    this.readSettingsFromUI();
    const settings = this.getSettings();
    const threshold = settings.ojama.commentThreshold;
    const cooldownMs = settings.ojama.cooldownSec * 1000;
    const now = Date.now();

    const words = settings.ojama.triggerWords
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    const lower = text.toLowerCase();
    const matchedWord = words.find((w) => lower.includes(w));

    let triggered = false;
    if (this.engine.isCompleted()) {
      if (matchedWord) {
        this.showToast('パズル完成済みのためお邪魔は発動しません', 'info');
      }
    } else {
      this.commentCounter += 1;
      const cooldownReady = now - this.lastOjamaTime >= cooldownMs;

      if (matchedWord && cooldownReady) {
        triggered = true;
        this.lastOjamaTime = now;
        if (matchedWord.includes('drop') || lower.includes('落と')) {
          this.triggerDropOjama();
        } else if (matchedWord.includes('ghost') || lower.includes('透明')) {
          this.triggerVisualOjama('ghost');
        } else if (matchedWord.includes('fake') || lower.includes('偽')) {
          this.triggerFakePiecesOjama();
        } else if (matchedWord.includes('color') || lower.includes('色')) {
          this.triggerVisualOjama();
        } else if (matchedWord.includes('spin') || lower.includes('回')) {
          this.triggerPrankOjama();
        } else if (matchedWord.includes('sp') || lower.includes('スパ')) {
          this.triggerSuperchatOjama(text, author);
        } else {
          this.triggerRandomOjama();
        }
      } else if (this.commentCounter >= threshold) {
        this.commentCounter = 0;
        if (cooldownReady) {
          triggered = true;
          this.lastOjamaTime = now;
          this.triggerRandomOjama();
        }
      }
    }

    this.updateCommentProgressUI();

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
