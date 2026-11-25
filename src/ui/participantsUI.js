const SUCK_IN_MS = 220;
const BOUNCE_MS = 280;

export class ParticipantsUI {
  constructor({ app, showToast, onOpenCreateRoom = null }) {
    this.app = app;
    this.engine = app.engine;
    this.room = app.room;
    this.showToast = showToast;
    this.onOpenCreateRoom = onOpenCreateRoom;

    this.elBtnToggle = document.getElementById('btnToggleParticipants');
    this.elStatusLabel = document.getElementById('roomRoleBadge');
    this.elOnlineDot = document.getElementById('roomOnlineDot');
    this.elCaret = document.getElementById('roomCaret');
    this.elPopover = document.getElementById('participantsPopover');
    this.elHostRenameRow = document.getElementById('hostRenameRow');
    this.elInputPlayerName = document.getElementById('inputPlayerName');
    this.elList = document.getElementById('participantsList');
    this.elHostInviteSection = document.getElementById('hostInviteSection');

    this._lastRole = this.room.role;
    this._isClosing = false;
    this._closeTimer = null;
    this._bounceTimer = null;
    this._hasAutoClosedOnCopy = false;

    this._bindEvents();
    this._subscribeApp();
    this.syncSettings(this.app.getSettings());
    this.render();
  }

  syncSettings(settings) {
    const next = settings.playerName || 'ホスト（自分）';
    if (this.elInputPlayerName.value !== next) {
      this.elInputPlayerName.value = next;
    }
  }

  openPopover() {
    if (!this.room.isMultiplayer()) return;
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
    this._isClosing = false;
    this.elPopover.classList.remove('is-closing', 'hidden');
    this.elBtnToggle.classList.add('is-open');
    this.elBtnToggle.setAttribute('aria-expanded', 'true');
  }

  closePopover({ animate = true } = {}) {
    if (this.elPopover.classList.contains('hidden') || this._isClosing) return;
    this.elBtnToggle.classList.remove('is-open');
    this.elBtnToggle.setAttribute('aria-expanded', 'false');

    const reduced = document.body.classList.contains('effects-reduced');
    if (!animate || reduced) {
      this.elPopover.classList.remove('is-closing');
      this.elPopover.classList.add('hidden');
      return;
    }

    this._isClosing = true;
    this.elPopover.classList.add('is-closing');
    this._closeTimer = setTimeout(() => {
      this._closeTimer = null;
      this._isClosing = false;
      this.elPopover.classList.remove('is-closing');
      this.elPopover.classList.add('hidden');
      this._triggerBounce();
    }, SUCK_IN_MS);
  }

  _triggerBounce() {
    if (document.body.classList.contains('effects-reduced')) return;
    if (this._bounceTimer) clearTimeout(this._bounceTimer);
    this.elBtnToggle.classList.remove('is-bouncing');
    void this.elBtnToggle.offsetWidth;
    this.elBtnToggle.classList.add('is-bouncing');
    this._bounceTimer = setTimeout(() => {
      this._bounceTimer = null;
      this.elBtnToggle.classList.remove('is-bouncing');
    }, BOUNCE_MS);
  }

  _bindEvents() {
    this.elBtnToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.room.isMultiplayer()) {
        this.onOpenCreateRoom?.();
        return;
      }
      if (this.elPopover.classList.contains('hidden') || this._isClosing) {
        this.openPopover();
      } else {
        this.closePopover({ animate: true });
      }
    });

    document.getElementById('btnCloseParticipants').addEventListener('click', () => {
      this.closePopover({ animate: true });
    });

    document.addEventListener('click', (e) => {
      if (
        !this.elPopover.classList.contains('hidden') &&
        !this._isClosing &&
        !this.elPopover.contains(e.target) &&
        !this.elBtnToggle.contains(e.target)
      ) {
        this.closePopover({ animate: true });
      }
    });

    this.elInputPlayerName.addEventListener('input', () => {
      this.app.patchSettings({
        playerName: this.elInputPlayerName.value.trim() || 'ホスト（自分）',
      });
      this.room.updateHostName();
    });

    document.getElementById('btnCopyInviteUrl').addEventListener('click', async () => {
      const url = this.room.buildInviteUrl();
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        this.showToast('招待URLをコピーしました', 'success');
        if (!this._hasAutoClosedOnCopy) {
          this._hasAutoClosedOnCopy = true;
          setTimeout(() => this.closePopover({ animate: true }), 180);
        }
      } catch {
        this.showToast('招待URLをコピーできませんでした', 'ojama');
      }
    });

    document.getElementById('btnCopyRoomId').addEventListener('click', async () => {
      if (!this.room.roomId) return;
      try {
        await navigator.clipboard.writeText(this.room.roomId);
        this.showToast('部屋IDをコピーしました', 'success');
      } catch {
        this.showToast('部屋IDをコピーできませんでした', 'ojama');
      }
    });
  }

  _subscribeApp() {
    this.app.on('hudUpdate', () => this.render());
    this.app.on('roleChange', () => {
      const prev = this._lastRole;
      this._lastRole = this.room.role;
      if (prev !== 'host' && this.room.role === 'host') {
        this._hasAutoClosedOnCopy = false;
        this.openPopover();
      } else if (!this.room.isMultiplayer()) {
        this.closePopover({ animate: false });
      }
      this.render();
    });
    this.app.on('settingsChange', (s) => this.syncSettings(s));
  }

  _renderStatusButton(isMp, onlineCount) {
    if (isMp) {
      const capacity = this.room.getCapacity();
      this.elStatusLabel.textContent = `参加 ${onlineCount}/${capacity}`;
      this.elOnlineDot?.classList.remove('hidden');
      this.elCaret?.classList.remove('hidden');
      this.elBtnToggle.classList.remove('is-solo');
      this.elBtnToggle.classList.add('is-multiplayer');
      this.elBtnToggle.title = '参加メンバーと招待リンクを表示';
      return;
    }
    this.elStatusLabel.textContent = 'ソロ';
    this.elOnlineDot?.classList.add('hidden');
    this.elCaret?.classList.add('hidden');
    this.elBtnToggle.classList.add('is-solo');
    this.elBtnToggle.classList.remove('is-multiplayer', 'is-open');
    this.elBtnToggle.setAttribute('aria-expanded', 'false');
    this.elBtnToggle.title = 'クリックしてマルチプレイの部屋を作成';
  }

  render() {
    const isMp = this.room.isMultiplayer();
    const isHostMp = this.room.role === 'host';
    const isGuestMp = this.room.role === 'guest';

    this.elHostInviteSection.classList.toggle('hidden', !isHostMp);
    this.elHostRenameRow.classList.toggle('hidden', isGuestMp);

    let allMembers;
    if (isMp) {
      allMembers = this.room.roster;
    } else {
      const settings = this.app.getSettings();
      const hostName = settings.playerName || 'ホスト（自分）';
      allMembers = [
        {
          id: 'host',
          name: hostName,
          color: 'var(--accent)',
          role: 'host',
          contrib: this.engine.stats.placedCount,
          online: true,
        },
      ];
    }

    const onlineCount = allMembers.filter((m) => m.online !== false).length;
    this._renderStatusButton(isMp, onlineCount);
    this.elList.replaceChildren();

    for (const m of allMembers) {
      const li = document.createElement('li');
      li.className = 'participant-item';

      const avatar = document.createElement('div');
      avatar.className = 'participant-avatar';
      avatar.style.background = m.color;
      avatar.style.color = m.role === 'host' ? 'var(--accent-text)' : 'var(--sc-text)';
      avatar.textContent = m.name.slice(0, 1).toUpperCase();

      if (m.online !== false) {
        const dot = document.createElement('span');
        dot.className = 'online-dot';
        dot.title = 'オンライン';
        avatar.appendChild(dot);
      }

      const meta = document.createElement('div');
      meta.className = 'participant-meta';

      const nameRow = document.createElement('div');
      nameRow.className = 'participant-name-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'participant-name';
      nameSpan.textContent = m.name;

      const badge = document.createElement('span');
      badge.className = `role-badge ${m.role === 'host' ? '' : 'guest'}`;
      badge.textContent = m.role === 'host' ? 'ホスト' : m.online === false ? '切断中' : 'メンバー';
      nameRow.append(nameSpan, badge);

      const contrib = document.createElement('div');
      contrib.className = 'participant-contrib';
      contrib.textContent = `貢献度: ${m.contrib} ピース`;

      meta.append(nameRow, contrib);
      li.append(avatar, meta);

      if (isHostMp && m.role === 'guest') {
        const kickBtn = document.createElement('button');
        kickBtn.type = 'button';
        kickBtn.className = 'btn btn-xs btn-ghost';
        kickBtn.textContent = '退出';
        kickBtn.addEventListener('click', () => {
          this.room.kickGuest(m.id);
        });
        li.appendChild(kickBtn);
      }

      this.elList.appendChild(li);
    }
  }
}
