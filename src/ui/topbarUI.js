export function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Makes a number that just went up pop (styles/app.css .hud-pop), restarting a pop in progress. */
function popNumber(el) {
  el.classList.remove('hud-pop');
  requestAnimationFrame(() => el.classList.add('hud-pop'));
}

/** Marks the chosen button of a group of choice buttons (active class and aria-pressed). */
function markChoice(buttons, isChosen) {
  for (const btn of buttons) {
    const on = isChosen(btn);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
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
    /** The counts last shown ({ total, locked, mine }), to pop a number that went up. */
    this.lastHud = null;

    this.elToggleShowStats = document.getElementById('toggleShowStats');
    this.elSelectRendererMode = document.getElementById('selectRendererMode');
    this.elRendererStatus = document.getElementById('rendererStatus');
    this.elThemeButtons = document.querySelectorAll('#themeModeGroup [data-theme-mode]');
    this.elDeskButtons = document.querySelectorAll('#deskStyleGroup [data-desk-style]');
    this.elBoardButtons = document.querySelectorAll('#boardStyleGroup [data-board-style]');
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
    /** Set by main: called as the stream modal opens; may return the tab to show. */
    this.onStreamModalOpen = null;

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
    const tab = this.onStreamModalOpen?.({ requestedTab: tabName }) ?? tabName;
    if (tab) this.selectStreamTab(tab);
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

  /** Shows which renderer draws the table, and why if a fallback occurred. */
  updateRendererStatus() {
    if (!this.elRendererStatus) return;
    const { renderer: kind, mode, fallbackReason } = this.renderer.getStats();
    let text = '描画: 互換モード（Canvas 2D）';
    if (kind === 'webgpu') {
      text = '描画: 最高速（WebGPU）';
    } else if (kind === 'webgl2') {
      text =
        mode === 'webgpu' ? '描画: 高速（WebGL2・WebGPUフォールバック）' : '描画: 高速（WebGL2）';
    } else if (mode !== 'canvas2d') {
      text = '描画: 互換モード（Canvas 2D・フォールバック）';
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
    for (const btn of this.elThemeButtons) {
      const on = btn.dataset.themeMode === mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    this.renderer.requestRender();
  }

  syncSettings(settings) {
    this.applyTheme(settings.theme);
    markChoice(this.elDeskButtons, (btn) => btn.dataset.deskStyle === settings.deskStyle);
    markChoice(this.elBoardButtons, (btn) => btn.dataset.boardStyle === settings.boardStyle);
    if (this.elToggleShowStats) this.elToggleShowStats.checked = settings.showStats;
    if (this.elSelectRendererMode) {
      this.elSelectRendererMode.value = settings.rendererMode || 'auto';
    }
    this.updateRendererStatus();
    if (!this.app.room.isGuest()) {
      document.body.classList.toggle('stats-hidden', !settings.showStats);
    }
  }

  updateRole({ role, isGuest, roomRules }) {
    document.body.classList.toggle('role-guest', isGuest);
    if (isGuest && roomRules) {
      document.body.classList.toggle('stats-hidden', !roomRules.showStats);
    } else {
      document.body.classList.toggle('stats-hidden', !this.app.getSettings().showStats);
    }
    if (this._lastRole !== role) {
      this._lastRole = role;
      this.setDrawerOpen(false, { immediate: true });
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

    const mine = this.app.getMyContribution();
    this.elContributionCount.textContent = String(mine);
    // Only a rise in the same puzzle pops (not a new puzzle, nor a piece knocked off).
    const last = this.lastHud;
    if (last?.total === total) {
      if (locked > last.locked) popNumber(this.elProgressText);
      if (mine > last.mine) popNumber(this.elContributionCount);
    }
    this.lastHud = { total, locked, mine };
  }

  renderKnockBanner(knockQueue) {
    if (!knockQueue || knockQueue.length === 0) {
      this.elKnockBanner.classList.add('hidden');
      return;
    }
    const current = knockQueue[0];
    const extra = knockQueue.length > 1 ? `（ほか${knockQueue.length - 1}名待機）` : '';
    this.elKnockBannerText.textContent = `${current.displayName} さんが参加を希望しています${extra}`;
    this.elKnockBanner.classList.remove('hidden');
  }

  /** The stream button in the header, and its copy in the menu (small screens). */
  _bindStreamButtons() {
    this.elBtnOpenStreamModal?.addEventListener('click', () => this.openStreamModal());
    document.getElementById('btnOpenStreamFromMenu')?.addEventListener('click', () => {
      this.closeMenuModal();
      this.openStreamModal();
    });
  }

  /** The menu's "表示・サウンド" settings (and the compatibility renderer switch). */
  _bindDisplaySettings() {
    for (const btn of this.elThemeButtons) {
      btn.addEventListener('click', () => this.app.patchSettings({ theme: btn.dataset.themeMode }));
    }
    // Applied at once: the menu's backdrop is see-through, so the new desk shows around it.
    for (const btn of this.elDeskButtons) {
      btn.addEventListener('click', () =>
        this.app.patchSettings({ deskStyle: btn.dataset.deskStyle }),
      );
    }
    for (const btn of this.elBoardButtons) {
      btn.addEventListener('click', () =>
        this.app.patchSettings({ boardStyle: btn.dataset.boardStyle }),
      );
    }
    this.elToggleShowStats?.addEventListener('change', () => {
      this.app.patchSettings({ showStats: this.elToggleShowStats.checked });
    });
    this.elSelectRendererMode?.addEventListener('change', () => {
      const rendererMode = this.elSelectRendererMode.value;
      this.app.patchSettings({ rendererMode });
      this.renderer.setMode(rendererMode);
      this.updateRendererStatus();
    });
  }

  _bindEvents() {
    this._bindDisplaySettings();

    this.elBtnOpenLobby?.addEventListener('click', () => {
      this.closeMenuModal();
      this.onOpenLobby();
    });
    this.elBtnOpenSetupFromMenu?.addEventListener('click', () => this.closeMenuModal());

    this.elBtnOpenDrawer?.addEventListener('click', () => this.setDrawerOpen(true));
    this.elBtnCloseDrawer?.addEventListener('click', () => this.setDrawerOpen(false));

    this._bindStreamButtons();
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
