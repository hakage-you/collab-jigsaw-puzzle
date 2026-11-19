import { STORAGE_KEYS, YOUTUBE_CONFIG } from '../config/constants.js';
import { YouTubeLiveClient } from '../services/youtubeLiveClient.js';

export class YouTubeUI {
  constructor({ app, ojama, showToast }) {
    this.app = app;
    this.engine = app.engine;
    this.ojama = ojama;
    this.showToast = showToast;

    this.elApiKey = document.getElementById('ytApiKeyInput');
    this.elBtnClearKey = document.getElementById('btnYtClearKey');
    this.elVideoUrl = document.getElementById('ytVideoUrlInput');
    this.elPollInterval = document.getElementById('ytPollInterval');
    this.elScaleTier = document.getElementById('ytScaleSuperchatTier');
    this.elBtnVerify = document.getElementById('btnYtVerify');
    this.elBtnTogglePoll = document.getElementById('btnYtTogglePoll');
    this.elPreview = document.getElementById('ytBroadcastPreview');
    this.elPreviewTitle = document.getElementById('ytPreviewTitle');
    this.elPreviewMeta = document.getElementById('ytPreviewMeta');
    this.elStatusText = document.getElementById('ytStatusText');
    this.elQuotaReadout = document.getElementById('ytQuotaReadout');

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
        this.ojama.processYouTubeSuperchat({
          ...sc,
          scaleHpWithTier: Boolean(this.elScaleTier?.checked),
        });
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

    this._cleanupLegacyStoredKeys();
    this._bindEvents();
    this._subscribeApp();
    this._updateQuotaUI(0);
  }

  _subscribeApp() {
    this.app.on('stopYoutubePolling', ({ reason }) => this.stopIfPolling(reason));
  }

  _cleanupLegacyStoredKeys() {
    try {
      sessionStorage.removeItem(STORAGE_KEYS.YOUTUBE_API_KEY);
      localStorage.removeItem(STORAGE_KEYS.YOUTUBE_API_KEY);
      localStorage.removeItem(STORAGE_KEYS.YOUTUBE_STORAGE_MODE);
    } catch {
      // Ignore storage restrictions
    }
  }

  _clearApiKey() {
    this.client.stopPolling();
    this.client.apiKey = '';
    this.client.activeLiveChatId = null;
    this.elApiKey.value = '';
    this.elBtnTogglePoll.disabled = true;
    this.elPreview.classList.add('hidden');
    this._cleanupLegacyStoredKeys();
    this.setStatus('入力されていた API キーを消去しました', false);
    this.showToast('API キーを消去しました', 'info');
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

  _syncPollButton(isPolling) {
    this.elBtnTogglePoll.textContent = isPolling ? '連動を停止' : 'コメント連動を開始';
    this.elBtnTogglePoll.classList.toggle('btn-danger', isPolling);
    this.elBtnTogglePoll.classList.toggle('btn-primary', !isPolling);
  }

  _updateQuotaUI(units) {
    this.elQuotaReadout.textContent =
      `セッション消費: ${units} ユニット（無料枠 ${YOUTUBE_CONFIG.QUOTA_DAILY_LIMIT.toLocaleString()}/日）`;
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

  _bindEvents() {
    this.elBtnOpenGuide?.addEventListener('click', () => this.openGuideModal());
    this.elBtnCloseGuide?.addEventListener('click', () => this.closeGuideModal());
    this.elGuideModal?.addEventListener('click', (e) => {
      if (e.target === this.elGuideModal) {
        this.closeGuideModal();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.elGuideModal && !this.elGuideModal.classList.contains('hidden')) {
        this.closeGuideModal();
      }
    });

    this.elApiKey.addEventListener('input', () => {
      this._resetVerification();
    });

    this.elBtnClearKey.addEventListener('click', () => {
      this._clearApiKey();
    });

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
        const res = await this.client.verifyBroadcast(
          this.elApiKey.value,
          this.elVideoUrl.value
        );
        this.elPreviewTitle.textContent = res.title;
        const chatState = res.hasActiveChat ? 'チャット有効' : 'チャット無効 / 取得不可';
        this.elPreviewMeta.textContent = `${res.channelTitle || 'チャンネル不明'} — ${chatState}`;
        this.elPreview.classList.remove('hidden');

        if (res.hasActiveChat) {
          this.elBtnTogglePoll.disabled = false;
          this.setStatus('確認完了。「コメント連動を開始」を押すと新着コメントの取得が始まります', false);
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
        const intervalMs = Number(this.elPollInterval.value) || YOUTUBE_CONFIG.DEFAULT_POLL_INTERVAL_MS;
        this.client.startPolling(intervalMs);
      } catch (err) {
        this.setStatus(err?.message || '連動を開始できませんでした', true);
      }
    });
  }
}
