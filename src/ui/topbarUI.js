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
    this.elGuestToggleSound = document.getElementById('guestToggleSound');
    this.elBtnToggleTheme = document.getElementById('btnToggleTheme');
    this.elBtnGuestToggleTheme = document.getElementById('btnGuestToggleTheme');
    this.elBtnOpenLobby = document.getElementById('btnOpenLobby');
    this.elBtnGuestOpenLobby = document.getElementById('btnGuestOpenLobby');
    this.elSideDrawer = document.getElementById('sideDrawer');
    this.elBtnToggleDrawer = document.getElementById('btnToggleDrawer');

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

  showToast(message, kind = 'info') {
    const div = document.createElement('div');
    div.className = `toast ${kind}`;
    div.textContent = message;
    this.elToastContainer.appendChild(div);
    setTimeout(() => div.remove(), 3200);
  }

  updateTimer(elapsedMs) {
    this.elTimerText.textContent = formatDuration(elapsedMs);
  }

  applyTheme(theme) {
    const mode = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', mode);
    const label = mode === 'dark' ? 'テーマ: ダーク' : 'テーマ: ライト';
    if (this.elBtnToggleTheme) this.elBtnToggleTheme.textContent = label;
    if (this.elBtnGuestToggleTheme) this.elBtnGuestToggleTheme.textContent = label;
    this.renderer.requestRender();
  }

  syncSettings(settings) {
    this.applyTheme(settings.theme);
    if (this.elToggleShowStats) this.elToggleShowStats.checked = settings.showStats;
    if (this.elToggleSound) this.elToggleSound.checked = settings.soundEnabled;
    if (this.elGuestToggleSound) this.elGuestToggleSound.checked = settings.soundEnabled;
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
    this.elOjamaBreakdownText.textContent =
      `(落:${bd.drop} 視:${bd.visual} ス:${bd.superchat} 悪:${bd.prank} 偽:${bd.fake || 0})`;
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
    this.elBtnGuestToggleTheme?.addEventListener('click', () => this.app.toggleTheme());
    this.elToggleShowStats?.addEventListener('change', () => {
      this.app.patchSettings({ showStats: this.elToggleShowStats.checked });
    });
    this.elToggleSound?.addEventListener('change', () => {
      this.app.patchSettings({ soundEnabled: this.elToggleSound.checked });
    });
    this.elGuestToggleSound?.addEventListener('change', () => {
      this.app.patchSettings({ soundEnabled: this.elGuestToggleSound.checked });
    });
    this.elBtnOpenLobby?.addEventListener('click', () => this.onOpenLobby());
    this.elBtnGuestOpenLobby?.addEventListener('click', () => this.onOpenLobby());
    this.elBtnToggleDrawer.addEventListener('click', () => {
      const collapsed = this.elSideDrawer.classList.toggle('collapsed');
      this.elBtnToggleDrawer.setAttribute('aria-expanded', String(!collapsed));
      setTimeout(() => {
        this.renderer.resizeCanvas();
        this.renderer.requestRender();
      }, 220);
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
