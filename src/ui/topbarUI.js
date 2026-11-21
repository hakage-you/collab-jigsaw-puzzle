export function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export class TopbarUI {
  constructor({ app, renderer, onOpenLobby }) {
    this.app = app;
    this.renderer = renderer;
    this.onOpenLobby = onOpenLobby;

    this.elProgressText = document.getElementById('progressText');
    this.elProgressBarFill = document.getElementById('progressBarFill');
    this.elTimerText = document.getElementById('timerText');
    this.elContributionCount = document.getElementById('contributionCount');
    this.elOjamaTotalCount = document.getElementById('ojamaTotalCount');
    this.elOjamaBreakdownText = document.getElementById('ojamaBreakdownText');
    this.elRoomRoleBadge = document.getElementById('roomRoleBadge');

    this.elToggleShowStats = document.getElementById('toggleShowStats');
    this.elToggleSound = document.getElementById('toggleSound');
    this.elToggleCompatRenderer = document.getElementById('toggleCompatRenderer');
    this.elRendererStatus = document.getElementById('rendererStatus');
    this.elBtnToggleTheme = document.getElementById('btnToggleTheme');
    this.elBtnOpenLobby = document.getElementById('btnOpenLobby');
    this.elBtnOpenSetupFromMenu = document.getElementById('btnOpenSetupFromMenu');

    this.elSideDrawer = document.getElementById('sideDrawer');
    this.elBtnOpenDrawer = document.getElementById('btnOpenDrawer');
    this.elBtnCloseDrawer = document.getElementById('btnCloseDrawer');

    this.elBtnOpenStreamModal = document.getElementById('btnOpenStreamModal');
    this.elBtnCloseStreamModal = document.getElementById('btnCloseStreamModal');
    this.elStreamModal = document.getElementById('streamOjamaModal');

    this.elBtnOpenMenuModal = document.getElementById('btnOpenMenuModal');
    this.elBtnCloseMenuModal = document.getElementById('btnCloseMenuModal');
    this.elMenuModal = document.getElementById('menuModal');

    this._lastRole = null;

    this.elKnockBanner = document.getElementById('knockBanner');
    this.elKnockBannerText = document.getElementById('knockBannerText');
    this.elBtnApproveKnock = document.getElementById('btnApproveKnock');
    this.elBtnRejectKnock = document.getElementById('btnRejectKnock');
    this.elToastContainer = document.getElementById('toastContainer');

    this._bindEvents();
    this._subscribeApp();
    this.syncSettings(this.app.getSettings());
    this.updateHUD();
  }

  setDrawerOpen(open, { immediate = false } = {}) {
    if (!this.elSideDrawer) return;
    this.elSideDrawer.classList.toggle('collapsed', !open);
    this.elBtnOpenDrawer?.classList.toggle('hidden', open);
    this.elBtnOpenDrawer?.setAttribute('aria-expanded', String(open));
    const syncCanvas = () => {
      this.renderer.resizeCanvas();
      this.renderer.requestRender();
    };
    if (immediate) syncCanvas();
    else setTimeout(syncCanvas, 220);
  }

  openStreamModal(tabName = null) {
    if (tabName) this.selectStreamTab(tabName);
    this.elStreamModal?.classList.remove('hidden');
  }

  closeStreamModal() {
    this.elStreamModal?.classList.add('hidden');
  }

  selectStreamTab(tabName) {
    document.querySelectorAll('#streamOjamaModal .modal-tab').forEach((tab) => {
      const active = tab.dataset.streamTab === tabName;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('#streamOjamaModal .modal-tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `stream-tab-${tabName}`);
    });
  }

  openMenuModal() {
    this.elMenuModal?.classList.remove('hidden');
  }

  closeMenuModal() {
    this.elMenuModal?.classList.add('hidden');
  }

  showToast(message, kind = 'info') {
    const div = document.createElement('div');
    div.className = `toast ${kind}`;
    div.textContent = message;
    this.elToastContainer.appendChild(div);
    setTimeout(() => div.remove(), 3200);
  }

  /** Shows which renderer draws the table, and why when WebGL2 could not be used. */
  updateRendererStatus() {
    if (!this.elRendererStatus) return;
    const { renderer: kind, mode, fallbackReason } = this.renderer.getStats();
    let text = '描画: WebGL2（高速）';
    if (kind !== 'webgl2') {
      text =
        mode === 'canvas2d'
          ? '描画: Canvas 2D（互換モード）'
          : '描画: Canvas 2D（この環境では WebGL2 を使えないため）';
    }
    this.elRendererStatus.textContent = text;
    this.elRendererStatus.title = fallbackReason || '';
  }

  updateTimer(elapsedMs) {
    this.elTimerText.textContent = formatDuration(elapsedMs);
  }

  applyTheme(theme) {
    const mode = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', mode);
    const label = mode === 'dark' ? 'テーマ: ダーク' : 'テーマ: ライト';
    if (this.elBtnToggleTheme) this.elBtnToggleTheme.textContent = label;
    this.renderer.requestRender();
  }

  syncSettings(settings) {
    this.applyTheme(settings.theme);
    if (this.elToggleShowStats) this.elToggleShowStats.checked = settings.showStats;
    if (this.elToggleSound) this.elToggleSound.checked = settings.soundEnabled;
    if (this.elToggleCompatRenderer) {
      this.elToggleCompatRenderer.checked = settings.rendererMode === 'canvas2d';
    }
    this.updateRendererStatus();
    if (!this.app.room.isGuest()) {
      document.body.classList.toggle('stats-hidden', !settings.showStats);
    }
  }

  updateRole({ role, isGuest, roomRules }) {
    document.body.classList.toggle('role-guest', isGuest);
    this.elRoomRoleBadge.textContent = role === 'host' ? 'ホスト' : isGuest ? 'ゲスト' : 'ソロ';
    if (isGuest && roomRules) {
      document.body.classList.toggle('stats-hidden', !roomRules.showStats);
    } else {
      document.body.classList.toggle('stats-hidden', !this.app.getSettings().showStats);
    }
    if (this._lastRole !== role) {
      this._lastRole = role;
      this.setDrawerOpen(!isGuest, { immediate: true });
    }
  }

  updateHUD() {
    const { engine } = this.app;
    const total = engine.pieces.length;
    const locked = engine.getLockedCount();
    this.elProgressText.textContent = `${locked} / ${total}`;
    const pct = total > 0 ? (locked / total) * 100 : 0;
    this.elProgressBarFill.style.width = `${pct.toFixed(1)}%`;
    this.elTimerText.textContent = formatDuration(engine.stats.elapsedMs);

    this.elContributionCount.textContent = String(this.app.getMyContribution());
    this.elOjamaTotalCount.textContent = String(engine.stats.ojamaTotal);
    const bd = engine.stats.ojamaBreakdown;
    this.elOjamaBreakdownText.textContent = `(落:${bd.drop} 視:${bd.visual} ス:${bd.superchat} 悪:${bd.prank} 偽:${bd.fake || 0} 重:${bd.heavy || 0} 逃:${bd.runaway || 0})`;
  }

  renderKnockBanner(knockQueue) {
    if (!knockQueue || knockQueue.length === 0) {
      this.elKnockBanner.classList.add('hidden');
      return;
    }
    const current = knockQueue[0];
    const extra = knockQueue.length > 1 ? ` (ほか${knockQueue.length - 1}名待機)` : '';
    this.elKnockBannerText.textContent = `${current.displayName} さんが参加を希望しています${extra}`;
    this.elKnockBanner.classList.remove('hidden');
  }

  _bindEvents() {
    this.elBtnToggleTheme?.addEventListener('click', () => this.app.toggleTheme());
    this.elToggleShowStats?.addEventListener('change', () => {
      this.app.patchSettings({ showStats: this.elToggleShowStats.checked });
    });
    this.elToggleCompatRenderer?.addEventListener('change', () => {
      const rendererMode = this.elToggleCompatRenderer.checked ? 'canvas2d' : 'auto';
      this.app.patchSettings({ rendererMode });
      this.renderer.setMode(rendererMode);
      this.updateRendererStatus();
    });
    this.elToggleSound?.addEventListener('change', () => {
      this.app.patchSettings({ soundEnabled: this.elToggleSound.checked });
    });

    this.elBtnOpenLobby?.addEventListener('click', () => {
      this.closeMenuModal();
      this.onOpenLobby();
    });
    this.elBtnOpenSetupFromMenu?.addEventListener('click', () => this.closeMenuModal());

    this.elBtnOpenDrawer?.addEventListener('click', () => this.setDrawerOpen(true));
    this.elBtnCloseDrawer?.addEventListener('click', () => this.setDrawerOpen(false));

    this.elBtnOpenStreamModal?.addEventListener('click', () => this.openStreamModal());
    this.elBtnCloseStreamModal?.addEventListener('click', () => this.closeStreamModal());
    this.elStreamModal?.addEventListener('click', (e) => {
      if (e.target === this.elStreamModal) this.closeStreamModal();
    });
    document.querySelectorAll('#streamOjamaModal .modal-tab').forEach((tab) => {
      tab.addEventListener('click', () => this.selectStreamTab(tab.dataset.streamTab));
    });

    this.elBtnOpenMenuModal?.addEventListener('click', () => this.openMenuModal());
    this.elBtnCloseMenuModal?.addEventListener('click', () => this.closeMenuModal());
    this.elMenuModal?.addEventListener('click', (e) => {
      if (e.target === this.elMenuModal) this.closeMenuModal();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (
        document.querySelector(
          '#ytGuideModal:not(.hidden), #puzzleSetupModal:not(.hidden), #termsModal:not(.hidden), #lobbyOverlay:not(.hidden)',
        )
      ) {
        return;
      }
      if (this.elMenuModal && !this.elMenuModal.classList.contains('hidden')) {
        this.closeMenuModal();
      } else if (this.elStreamModal && !this.elStreamModal.classList.contains('hidden')) {
        this.closeStreamModal();
      }
    });

    this.elBtnApproveKnock.addEventListener('click', () => this.app.approveNextKnock());
    this.elBtnRejectKnock.addEventListener('click', () => this.app.rejectNextKnock());
  }

  _subscribeApp() {
    this.app.on('toast', ({ message, kind }) => this.showToast(message, kind));
    this.app.on('hudUpdate', () => this.updateHUD());
    this.app.on('settingsChange', (s) => this.syncSettings(s));
    this.app.on('roleChange', (info) => this.updateRole(info));
    this.app.on('knockChange', (q) => this.renderKnockBanner(q));
  }
}
