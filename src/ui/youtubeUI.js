import { STORAGE_KEYS, YOUTUBE_CONFIG } from '../config/constants.js';
import { YouTubeLiveClient } from '../services/youtubeLiveClient.js';

export class YouTubeUI {
  constructor({ app, ojama, showToast }) {
    this.app = app;
    this.engine = app.engine;
    this.ojama = ojama;
    this.showToast = showToast;

    this.elApiKey = document.getElementById('ytApiKeyInput');
    this.elBtnToggleKeyVisibility = document.getElementById('btnYtToggleKeyVisibility');
    this.elBtnClearKey = document.getElementById('btnYtClearKey');
    this.elRememberKeyToggle = document.getElementById('ytRememberKeyToggle');
    this.elRememberKeyConsent = document.getElementById('ytRememberKeyConsent');
    this.elBtnConfirmRememberKey = document.getElementById('btnConfirmYtRememberKey');
    this.elBtnCancelRememberKey = document.getElementById('btnCancelYtRememberKey');
    this.elKeyStorageHint = document.getElementById('ytKeyStorageHint');
    this.elVideoUrl = document.getElementById('ytVideoUrlInput');
    this.elPollInterval = document.getElementById('ytPollInterval');
    this.elBtnVerify = document.getElementById('btnYtVerify');
    this.elBtnTogglePoll = document.getElementById('btnYtTogglePoll');
    this.elPreview = document.getElementById('ytBroadcastPreview');
    this.elPreviewTitle = document.getElementById('ytPreviewTitle');
    this.elPreviewMeta = document.getElementById('ytPreviewMeta');
    this.elStatusText = document.getElementById('ytStatusText');
    this.elQuotaReadout = document.getElementById('ytQuotaReadout');
    /** The live dots: on the stream button, and on the menu (small screens) and its button. */
    this.elLiveIndicators = document.querySelectorAll('.yt-live-indicator');

    this.elGuideModal = document.getElementById('ytGuideModal');
    this.elBtnOpenGuide = document.getElementById('btnOpenYtGuide');
    this.elBtnCloseGuide = document.getElementById('btnCloseYtGuide');

    this.client = new YouTubeLiveClient({
      onComments: (comments) => {
        for (const c of comments) {
          this.ojama.processIncomingComment(c.author, c.text);
        }
      },
      onSuperchat: (sc) => {
        this.ojama.processYouTubeSuperchat(sc);
      },
      onStatusChange: ({ isPolling, message }) => {
        this._syncPollButton(isPolling);
        this.setStatus(message, false);
      },
      onQuotaUpdate: (units) => {
        this._updateQuotaUI(units);
      },
      onError: (msg) => {
        this._syncPollButton(false);
        this.setStatus(msg, true);
        this.showToast(msg, 'ojama');
      },
    });

    /** Called with { youtube, autoComments } whenever comments start or stop coming in. */
    this.onLiveChange = null;
    this.isLocalSaveEnabled = false;
    this.isApiKeyVisible = false;
    this._initStoredKey();
    this._syncKeyVisibilityUI();
    this._bindEvents();
    this._subscribeApp();
    this._updateQuotaUI(0);
    this.syncLiveIndicators();
  }

  shouldPreferYoutubeTab() {
    return this.client.isPolling || Boolean((this.elApiKey?.value || '').trim());
  }

  _syncKeyVisibilityUI() {
    if (this.elApiKey) {
      this.elApiKey.classList.toggle('api-key-masked', !this.isApiKeyVisible);
    }
    if (this.elBtnToggleKeyVisibility) {
      this.elBtnToggleKeyVisibility.textContent = this.isApiKeyVisible ? '隠す' : '表示';
      this.elBtnToggleKeyVisibility.setAttribute('aria-pressed', String(this.isApiKeyVisible));
    }
  }

  _subscribeApp() {
    this.app.on('stopYoutubePolling', ({ reason }) => this.stopIfPolling(reason));
  }

  _clearStorageKeys() {
    try {
      sessionStorage.removeItem(STORAGE_KEYS.YOUTUBE_API_KEY);
      localStorage.removeItem(STORAGE_KEYS.YOUTUBE_API_KEY);
      localStorage.removeItem(STORAGE_KEYS.YOUTUBE_STORAGE_MODE);
    } catch {
      // Ignore storage restrictions
    }
  }

  _initStoredKey() {
    try {
      sessionStorage.removeItem(STORAGE_KEYS.YOUTUBE_API_KEY);
      const mode = localStorage.getItem(STORAGE_KEYS.YOUTUBE_STORAGE_MODE);
      if (mode === 'local') {
        this.isLocalSaveEnabled = true;
        const savedKey = localStorage.getItem(STORAGE_KEYS.YOUTUBE_API_KEY) || '';
        if (savedKey && this.elApiKey) {
          this.elApiKey.value = savedKey;
        }
      } else {
        this.isLocalSaveEnabled = false;
        localStorage.removeItem(STORAGE_KEYS.YOUTUBE_API_KEY);
        localStorage.removeItem(STORAGE_KEYS.YOUTUBE_STORAGE_MODE);
      }
    } catch {
      this.isLocalSaveEnabled = false;
    }
    this._syncStorageUI();
  }

  _syncStorageUI() {
    if (this.elRememberKeyToggle) {
      this.elRememberKeyToggle.checked = this.isLocalSaveEnabled;
    }
    if (this.elKeyStorageHint) {
      if (this.isLocalSaveEnabled) {
        this.elKeyStorageHint.textContent =
          'このブラウザ（localStorage）にキーを保存しています。共有PCではオフにし、必ず「YouTube Data API v3 のみ」に制限したキーをご使用ください。';
        this.elKeyStorageHint.classList.add('is-warning');
      } else {
        this.elKeyStorageHint.textContent =
          '初期設定ではブラウザのメモリ上のみで扱い、リロードやタブを閉じると消去されます。';
        this.elKeyStorageHint.classList.remove('is-warning');
      }
    }
  }

  _persistKeyIfEnabled() {
    if (!this.isLocalSaveEnabled) return true;
    try {
      const value = (this.elApiKey?.value || '').trim();
      localStorage.setItem(STORAGE_KEYS.YOUTUBE_STORAGE_MODE, 'local');
      if (value) {
        localStorage.setItem(STORAGE_KEYS.YOUTUBE_API_KEY, value);
      } else {
        localStorage.removeItem(STORAGE_KEYS.YOUTUBE_API_KEY);
      }
      return true;
    } catch {
      return false;
    }
  }

  _enableLocalSave() {
    this.isLocalSaveEnabled = true;
    const ok = this._persistKeyIfEnabled();
    this.elRememberKeyConsent?.classList.add('hidden');
    if (!ok) {
      this.isLocalSaveEnabled = false;
      this._syncStorageUI();
      this.showToast('ブラウザの制限によりキーを保存できませんでした', 'ojama');
      return;
    }
    this._syncStorageUI();
    this.showToast('APIキーのブラウザ保存を有効にしました', 'info');
  }

  _disableLocalSave({ silent = false } = {}) {
    this.isLocalSaveEnabled = false;
    this._clearStorageKeys();
    this.elRememberKeyConsent?.classList.add('hidden');
    this._syncStorageUI();
    if (!silent) {
      this.showToast('ブラウザ保存をオフにし、保存済みキーを削除しました', 'info');
    }
  }

  _clearApiKey() {
    this.client.stopPolling();
    this.client.apiKey = '';
    this.client.activeLiveChatId = null;
    this.elApiKey.value = '';
    this.isApiKeyVisible = false;
    this._syncKeyVisibilityUI();
    this.elBtnTogglePoll.disabled = true;
    this.elPreview.classList.add('hidden');
    this._disableLocalSave({ silent: true });
    this.syncLiveIndicators();
    this.setStatus('入力されていたAPIキーを消去しました', false);
    this.showToast('APIキーを消去しました', 'info');
  }

  _resetVerification() {
    if (this.client.isPolling) {
      this.client.stopPolling();
    }
    this.client.activeLiveChatId = null;
    this.elBtnTogglePoll.disabled = true;
    this._syncPollButton(false);
    this.elPreview.classList.add('hidden');
  }

  /** Where comments come in from now: YouTube, the CPU's comments (either one is "live"). */
  liveState() {
    return {
      youtube: Boolean(this.client.isPolling),
      autoComments: Boolean(this.ojama.isAutoCommentsRunning?.()),
    };
  }

  /** The live dots, and whoever follows the live state (onLiveChange). */
  syncLiveIndicators() {
    const live = this.liveState();
    const active = live.youtube || live.autoComments;
    for (const el of this.elLiveIndicators) el.classList.toggle('hidden', !active);
    this.onLiveChange?.(live);
  }

  _syncPollButton(isPolling) {
    this.elBtnTogglePoll.textContent = isPolling ? '連動を停止' : 'コメント連動を開始';
    this.elBtnTogglePoll.classList.toggle('btn-danger', isPolling);
    this.elBtnTogglePoll.classList.toggle('btn-primary', !isPolling);
    this.syncLiveIndicators();
  }

  _updateQuotaUI(units) {
    this.elQuotaReadout.textContent = `セッション消費: ${units}ユニット（無料枠 ${YOUTUBE_CONFIG.QUOTA_DAILY_LIMIT.toLocaleString()}/日）`;
  }

  openGuideModal() {
    this.elGuideModal?.classList.remove('hidden');
  }

  closeGuideModal() {
    this.elGuideModal?.classList.add('hidden');
  }

  setStatus(text, isError = false) {
    if (!text) {
      this.elStatusText.classList.add('hidden');
      this.elStatusText.textContent = '';
      return;
    }
    this.elStatusText.textContent = text;
    this.elStatusText.classList.remove('hidden', 'error');
    if (isError) this.elStatusText.classList.add('error');
  }

  stopIfPolling(reason = null) {
    if (this.client.isPolling) {
      this.client.stopPolling(reason);
      this._syncPollButton(false);
    }
  }

  _bindKeyStorageEvents() {
    this.elApiKey.addEventListener('input', () => {
      this._resetVerification();
      this._persistKeyIfEnabled();
    });

    this.elBtnToggleKeyVisibility?.addEventListener('click', () => {
      this.isApiKeyVisible = !this.isApiKeyVisible;
      this._syncKeyVisibilityUI();
    });

    this.elBtnClearKey.addEventListener('click', () => {
      this._clearApiKey();
    });

    this.elRememberKeyToggle?.addEventListener('change', () => {
      if (this.elRememberKeyToggle.checked) {
        if (!this.isLocalSaveEnabled) {
          this.elRememberKeyToggle.checked = false;
          this.elRememberKeyConsent?.classList.remove('hidden');
        }
      } else {
        this._disableLocalSave();
      }
    });

    this.elBtnConfirmRememberKey?.addEventListener('click', () => {
      this._enableLocalSave();
    });

    this.elBtnCancelRememberKey?.addEventListener('click', () => {
      this.elRememberKeyConsent?.classList.add('hidden');
      this._syncStorageUI();
    });
  }

  _bindEvents() {
    this.elBtnOpenGuide?.addEventListener('click', () => this.openGuideModal());
    this.elBtnCloseGuide?.addEventListener('click', () => this.closeGuideModal());
    this.elGuideModal?.addEventListener('click', (e) => {
      if (e.target === this.elGuideModal) {
        this.closeGuideModal();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (
        e.key === 'Escape' &&
        this.elGuideModal &&
        !this.elGuideModal.classList.contains('hidden')
      ) {
        this.closeGuideModal();
      }
    });

    this._bindKeyStorageEvents();

    this.elVideoUrl.addEventListener('input', () => {
      this._resetVerification();
    });

    this.elBtnVerify.addEventListener('click', async () => {
      if (this.engine.isCompleted()) {
        this.showToast('パズル完成済みのため連動を開始できません', 'info');
        return;
      }
      this.elBtnVerify.disabled = true;
      this.elBtnTogglePoll.disabled = true;
      this.setStatus('配信情報を確認しています...', false);

      try {
        const res = await this.client.verifyBroadcast(this.elApiKey.value, this.elVideoUrl.value);
        this.elPreviewTitle.textContent = res.title;
        const chatState = res.hasActiveChat ? 'チャット有効' : 'チャット無効 / 取得不可';
        this.elPreviewMeta.textContent = `${res.channelTitle || 'チャンネル不明'} — ${chatState}`;
        this.elPreview.classList.remove('hidden');

        if (res.hasActiveChat) {
          this.elBtnTogglePoll.disabled = false;
          this.setStatus(
            '確認完了。「コメント連動を開始」を押すと新着コメントの取得が始まります',
            false,
          );
          this.showToast('ライブ配信を確認しました（1ユニット消費）', 'success');
        } else {
          this.elBtnTogglePoll.disabled = true;
          this.setStatus(res.chatDisabledReason, true);
          this.showToast('ライブチャットが取得できない配信です', 'ojama');
        }
      } catch (err) {
        this.elPreview.classList.add('hidden');
        this.elBtnTogglePoll.disabled = true;
        const msg = err?.message || '配信の確認に失敗しました';
        this.setStatus(msg, true);
        this.showToast(msg, 'ojama');
      } finally {
        this.elBtnVerify.disabled = false;
      }
    });

    this.elBtnTogglePoll.addEventListener('click', () => {
      if (this.client.isPolling) {
        this.client.stopPolling();
        return;
      }
      if (this.engine.isCompleted()) {
        this.showToast('パズル完成済みのため連動を開始できません', 'info');
        return;
      }
      try {
        const intervalMs =
          Number(this.elPollInterval.value) || YOUTUBE_CONFIG.DEFAULT_POLL_INTERVAL_MS;
        this.client.startPolling(intervalMs);
      } catch (err) {
        this.setStatus(err?.message || '連動を開始できませんでした', true);
      }
    });
  }
}
