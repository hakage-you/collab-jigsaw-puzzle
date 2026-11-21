export class ParticipantsUI {
  constructor({ app, showToast }) {
    this.app = app;
    this.engine = app.engine;
    this.room = app.room;
    this.showToast = showToast;

    this.elBtnToggle = document.getElementById('btnToggleParticipants');
    this.elCountBadge = document.getElementById('participantCountBadge');
    this.elPopover = document.getElementById('participantsPopover');
    this.elHostRenameRow = document.getElementById('hostRenameRow');
    this.elInputPlayerName = document.getElementById('inputPlayerName');
    this.elList = document.getElementById('participantsList');
    this.elHostInviteSection = document.getElementById('hostInviteSection');

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

  _bindEvents() {
    this.elBtnToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const hidden = this.elPopover.classList.toggle('hidden');
      this.elBtnToggle.setAttribute('aria-expanded', String(!hidden));
    });

    document.getElementById('btnCloseParticipants').addEventListener('click', () => {
      this.elPopover.classList.add('hidden');
      this.elBtnToggle.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('click', (e) => {
      if (
        !this.elPopover.classList.contains('hidden') &&
        !this.elPopover.contains(e.target) &&
        !this.elBtnToggle.contains(e.target)
      ) {
        this.elPopover.classList.add('hidden');
        this.elBtnToggle.setAttribute('aria-expanded', 'false');
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
        this.showToast('招待URLをクリップボードにコピーしました', 'success');
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
    this.app.on('roleChange', () => this.render());
    this.app.on('settingsChange', (s) => this.syncSettings(s));
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
    this.elCountBadge.textContent = String(onlineCount);
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
