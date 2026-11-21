import { MULTIPLAYER_CONFIG } from '../config/constants.js';
import { loadAutoBackup, clearAutoBackup } from '../services/storage.js';
import { loadImageFromFile } from '../services/imageLoader.js';

export class LobbyUI {
  constructor({ app, showToast }) {
    this.app = app;
    this.showToast = showToast;

    this.activeTab = 'solo';
    this.hasStartedSession = false;
    this.pendingBackup = null;
    this.pendingBackupImageCanvas = null;

    this.elOverlay = document.getElementById('lobbyOverlay');
    this.elBtnClose = document.getElementById('btnCloseLobby');
    this.elHostName = document.getElementById('lobbyHostName');
    this.elHostPasscode = document.getElementById('lobbyHostPasscode');
    this.elRequireApproval = document.getElementById('lobbyRequireApproval');
    this.elCapacity = document.getElementById('lobbyCapacity');

    this.elBackupSection = document.getElementById('lobbyBackupSection');
    this.elBackupSummary = document.getElementById('lobbyBackupSummary');
    this.elBackupImageInput = document.getElementById('lobbyBackupImageInput');
    this.elBtnResumeBackupImage = document.getElementById('btnResumeBackupImage');
    this.elBtnResumeBackupSample = document.getElementById('btnResumeBackupSample');

    this.elGuestRoomId = document.getElementById('lobbyGuestRoomId');
    this.elGuestName = document.getElementById('lobbyGuestName');
    this.elGuestPasscode = document.getElementById('lobbyGuestPasscode');
    this.elGuestStatus = document.getElementById('lobbyGuestStatus');
    this.elTransferWrap = document.getElementById('lobbyTransferWrap');
    this.elTransferBar = document.getElementById('lobbyTransferBar');
    this.elTransferText = document.getElementById('lobbyTransferText');

    this._bindEvents();
    this._subscribeApp();
    this._checkInitialUrlParams();
  }

  show() {
    const s = this.app.getSettings();
    this.elHostName.value = s.playerName || 'ホスト（自分）';
    if (!this.elGuestName.value) {
      this.elGuestName.value = 'ゲスト';
    }
    this.elBtnClose?.classList.toggle('hidden', !this.hasStartedSession);
    this.refreshAutoBackup();
    this.elOverlay.classList.remove('hidden');
  }

  hide() {
    this.elOverlay.classList.add('hidden');
    this.elTransferWrap.classList.add('hidden');
    this.elGuestStatus.classList.add('hidden');
  }

  cancel() {
    if (!this.hasStartedSession) return;
    this.hide();
  }

  selectTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll('.lobby-tab').forEach((t) => {
      const active = t.dataset.lobbyTab === tabName;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.lobby-panel').forEach((p) => {
      p.classList.toggle('active', p.id === `lobby-panel-${tabName}`);
    });
  }

  _releasePendingBackupImage() {
    if (this.pendingBackupImageCanvas) {
      this.pendingBackupImageCanvas.width = 0;
      this.pendingBackupImageCanvas.height = 0;
      this.pendingBackupImageCanvas = null;
    }
  }

  refreshAutoBackup() {
    const backup = loadAutoBackup();
    this.pendingBackup = backup && !backup.completed ? backup : null;
    this._releasePendingBackupImage();
    this.elBtnResumeBackupImage.disabled = true;

    if (!this.pendingBackup) {
      this.elBackupSection.classList.add('hidden');
      return;
    }

    const puz = this.pendingBackup.puzzle;
    const locked = this.pendingBackup.pieces.filter((p) => p.isLocked).length;
    this.elBackupSummary.textContent = `前回の未完了データあり: ${puz.cols}×${puz.rows} (${locked}/${this.pendingBackup.pieces.length}ピース配置済み / ${
      puz.isSampleImage ? 'サンプル画像' : 'ローカル画像'
    })`;
    this.elBackupSection.classList.remove('hidden');
  }

  setGuestStatus(text, isError = false) {
    this.elGuestStatus.textContent = text;
    this.elGuestStatus.classList.remove('hidden', 'error');
    if (isError) this.elGuestStatus.classList.add('error');
  }

  setTransferProgress(received, total) {
    this.elTransferWrap.classList.remove('hidden');
    const pct = total > 0 ? Math.round((received / total) * 100) : 0;
    this.elTransferBar.style.width = `${pct}%`;
    this.elTransferText.textContent = `画像を受信中...（${received} / ${total} チャンク）`;
  }

  _bindEvents() {
    this._bindOverlayEvents();
    this._bindHostEvents();
    this._bindBackupEvents();
    this._bindGuestEvents();
  }

  _bindOverlayEvents() {
    document.querySelectorAll('.lobby-tab').forEach((tab) => {
      tab.addEventListener('click', () => this.selectTab(tab.dataset.lobbyTab));
    });

    this.elBtnClose?.addEventListener('click', () => this.cancel());
    this.elOverlay.addEventListener('click', (e) => {
      if (e.target === this.elOverlay) this.cancel();
    });
    window.addEventListener('keydown', (e) => {
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        !this.elOverlay.classList.contains('hidden')
      ) {
        this.cancel();
      }
    });
  }

  _bindHostEvents() {
    document.getElementById('btnStartSolo').addEventListener('click', () => {
      this.hasStartedSession = true;
      this.hide();
      this.app.startSolo();
    });

    document.getElementById('btnStartHostRoom').addEventListener('click', async () => {
      const btn = document.getElementById('btnStartHostRoom');
      btn.disabled = true;
      try {
        await this.app.startHostRoom({
          displayName: this.elHostName.value.trim() || 'ホスト（自分）',
          passcode: this.elHostPasscode.value,
          requireApproval: this.elRequireApproval.checked,
          capacity: Math.max(
            MULTIPLAYER_CONFIG.MIN_CAPACITY,
            Math.min(MULTIPLAYER_CONFIG.MAX_CAPACITY, Number(this.elCapacity.value) || 8),
          ),
        });
        this.hasStartedSession = true;
        this.hide();
      } catch (err) {
        this.showToast(err?.message || '部屋の作成に失敗しました', 'ojama');
      } finally {
        btn.disabled = false;
      }
    });
  }

  _bindBackupEvents() {
    this.elBackupImageInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      loadImageFromFile(
        file,
        (imgCanvas, name) => {
          if (this.pendingBackupImageCanvas && this.pendingBackupImageCanvas !== imgCanvas) {
            this._releasePendingBackupImage();
          }
          this.pendingBackupImageCanvas = imgCanvas;
          this.pendingBackupImageCanvas._fileName = name;
          this.elBtnResumeBackupImage.disabled = false;
        },
        (msg) => this.showToast(msg, 'ojama'),
      );
    });

    this.elBtnResumeBackupImage.addEventListener('click', async () => {
      if (!this.pendingBackup || !this.pendingBackupImageCanvas) return;
      const imgCanvas = this.pendingBackupImageCanvas;
      this.pendingBackupImageCanvas = null;
      await this.app.resumeHostFromBackup(this.pendingBackup, imgCanvas, false, {
        displayName: this.elHostName.value.trim() || 'ホスト（自分）',
        passcode: this.elHostPasscode.value,
        requireApproval: this.elRequireApproval.checked,
        capacity: Number(this.elCapacity.value) || 8,
      });
      this.hasStartedSession = true;
      this.hide();
    });

    this.elBtnResumeBackupSample.addEventListener('click', async () => {
      if (!this.pendingBackup) return;
      this._releasePendingBackupImage();
      await this.app.resumeHostFromBackup(this.pendingBackup, null, true, {
        displayName: this.elHostName.value.trim() || 'ホスト（自分）',
        passcode: this.elHostPasscode.value,
        requireApproval: this.elRequireApproval.checked,
        capacity: Number(this.elCapacity.value) || 8,
      });
      this.hasStartedSession = true;
      this.hide();
    });

    document.getElementById('btnClearAutoBackup').addEventListener('click', () => {
      clearAutoBackup();
      this.refreshAutoBackup();
    });
  }

  _bindGuestEvents() {
    document
      .getElementById('btnJoinGuestRoom')
      .addEventListener('click', () => this._joinFromForm());
  }

  async _joinFromForm() {
    const roomId = this.elGuestRoomId.value.trim();
    if (!roomId) {
      this.setGuestStatus('招待部屋IDを入力してください', true);
      return;
    }
    const btn = document.getElementById('btnJoinGuestRoom');
    btn.disabled = true;
    this.setGuestStatus('ホストへ接続中...', false);
    try {
      await this.app.joinGuestRoom({
        roomId,
        displayName: this.elGuestName.value.trim() || 'ゲスト',
        passcode: this.elGuestPasscode.value,
      });
    } catch (err) {
      this.setGuestStatus(err?.message || '接続に失敗しました', true);
    } finally {
      btn.disabled = false;
    }
  }

  /** Rejoins the room this tab last joined; the saved seat token brings back the same seat. */
  rejoinLastRoom() {
    const last = this.app.getLastGuestJoin();
    if (!last) return;
    this.show();
    this.selectTab('guest');
    this.elGuestRoomId.value = last.roomId;
    this.elGuestName.value = last.displayName;
    this._joinFromForm();
  }

  _subscribeApp() {
    this.app.on('guestStatus', ({ text, isError }) => this.setGuestStatus(text, isError));
    this.app.on('imageProgress', ({ received, total }) =>
      this.setTransferProgress(received, total),
    );
    this.app.on('fullStateSynced', () => {
      this.hasStartedSession = true;
      this.hide();
    });
    this.app.on('authRejected', ({ reason }) => {
      this.show();
      this.selectTab('guest');
      this.setGuestStatus(reason, true);
    });
    this.app.on('disconnected', ({ reason }) => {
      this.show();
      this.selectTab('guest');
      this.setGuestStatus(reason, true);
    });
  }

  _checkInitialUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      this.elGuestRoomId.value = room;
      this.selectTab('guest');
      params.delete('room');
      const remaining = params.toString();
      const nextUrl = window.location.pathname + (remaining ? `?${remaining}` : '');
      window.history.replaceState(null, '', nextUrl);
    }
  }
}
