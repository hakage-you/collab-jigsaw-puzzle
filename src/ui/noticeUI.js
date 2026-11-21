/**
 * Modal for notices the player must not miss (disconnects, being removed from a room).
 * Unlike toasts it never closes by itself, by Escape or by clicking outside: only its buttons
 * close it. Notices that arrive while one is open are queued and shown in order.
 */
export class NoticeUI {
  /**
   * @param {object} deps
   * @param {object} deps.app GameSession (emits 'notice')
   * @param {Record<string, () => void>} deps.actions handlers for notice action ids
   */
  constructor({ app, actions }) {
    this.actions = actions;
    this.queue = [];
    this.current = null;
    this.elModal = document.getElementById('noticeModal');
    this.elTitle = document.getElementById('noticeTitle');
    this.elMessage = document.getElementById('noticeMessage');
    this.elHint = document.getElementById('noticeHint');
    this.elBtnAction = document.getElementById('btnNoticeAction');
    this.elBtnClose = document.getElementById('btnNoticeClose');

    this.elBtnClose.addEventListener('click', () => this._next());
    this.elBtnAction.addEventListener('click', () => {
      const id = this.current?.action?.id;
      this._next();
      if (id) this.actions[id]?.();
    });
    app.on('notice', (notice) => this.push(notice));
  }

  push(notice) {
    this.queue.push(notice);
    if (!this.current) this._next();
  }

  _next() {
    this.current = this.queue.shift() || null;
    if (!this.current) {
      this.elModal.classList.add('hidden');
      return;
    }
    const { title, message, hint, action } = this.current;
    this.elTitle.textContent = title;
    this.elMessage.textContent = message || '';
    this.elHint.textContent = hint || '';
    this.elHint.classList.toggle('hidden', !hint);
    this.elBtnAction.classList.toggle('hidden', !action);
    this.elBtnAction.textContent = action?.label || '';
    this.elModal.classList.remove('hidden');
    (action ? this.elBtnAction : this.elBtnClose).focus();
  }
}
