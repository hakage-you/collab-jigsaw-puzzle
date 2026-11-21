/**
 * Host-only banner and status line for recruiting (whether new players can join).
 * States come from RoomController.getRecruitStatus(): recruit is one of
 * open / idle_prompt / full / idle_stopped, signaling one of
 * online / paused / reconnecting / offline / id_taken.
 */

const BANNERS = {
  id_taken: {
    text: 'この部屋IDが他の接続に使われたため、新しい参加を受け付けられません',
    action: 'resume',
    label: '再試行',
  },
  offline: {
    text: '仲介サーバーにつながらないため、新しい参加を受け付けられません（参加中のメンバーはそのまま遊べます）',
    action: 'resume',
    label: '再接続',
  },
  idle_stopped: {
    text: '参加者がいない状態が続いたため、募集を停止しました',
    action: 'resume',
    label: '募集を再開',
  },
  idle_prompt: {
    text: '参加者がいない状態が続いています。1分後に募集を停止します',
    action: 'keep',
    label: '募集を続ける',
  },
};

/** Returns { banner, statusText } for a recruit status, or null when not hosting. */
function describeRecruitStatus(status) {
  if (!status) return null;
  const { recruit, signaling } = status;
  const banner = BANNERS[signaling] || BANNERS[recruit] || null;
  return { banner, statusText: statusTextFor(recruit, signaling) };
}

function statusTextFor(recruit, signaling) {
  if (recruit === 'idle_stopped') return '募集停止中';
  if (recruit === 'full') return '満席のため新しい参加の受付を一時停止中';
  if (signaling === 'reconnecting') return '仲介サーバーに再接続中…';
  if (signaling === 'offline' || signaling === 'id_taken') return '新しい参加を受付できません';
  return '募集中';
}

export class RecruitUI {
  constructor({ app }) {
    this.app = app;
    this.action = null;
    this.elBanner = document.getElementById('recruitBanner');
    this.elBannerText = document.getElementById('recruitBannerText');
    this.elBtnAction = document.getElementById('btnRecruitAction');
    this.elStatus = document.getElementById('recruitStatus');

    this.elBtnAction.addEventListener('click', () => {
      if (this.action === 'keep') this.app.keepRecruiting();
      else if (this.action === 'resume') this.app.resumeRecruiting();
    });
    this.app.on('recruitChange', (status) => this.render(status));
    this.app.on('roleChange', () => {
      if (!this.app.room.isMultiplayer() || this.app.room.isGuest()) this.render(null);
    });
    this.render(null);
  }

  render(status) {
    const view = describeRecruitStatus(status);
    this.elStatus.textContent = view ? view.statusText : '';
    this.elStatus.classList.toggle('hidden', !view);
    if (!view?.banner) {
      this.action = null;
      this.elBanner.classList.add('hidden');
      return;
    }
    this.action = view.banner.action;
    this.elBannerText.textContent = view.banner.text;
    this.elBtnAction.textContent = view.banner.label;
    this.elBanner.classList.remove('hidden');
  }
}
