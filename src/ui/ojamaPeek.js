import { OJAMA_INFO } from './ojamaRulesSpec.js';

/**
 * "今すぐ出す" in the ojama rules: sets the ojama off, steps the stream modal aside so the board
 * shows it, and puts a bar at the bottom of the board. The modal comes back only with the bar's
 * "設定に戻る" or Escape, never by itself or by a click on the board (a superchat card is clicked
 * many times to drive it off).
 */
export class OjamaPeek {
  /**
   * @param {object} deps
   * @param {object} deps.ojama  OjamaController (runOjama)
   * @param {() => void} deps.closeStreamModal
   * @param {() => void} deps.openRules  opens the stream modal on the ojama rules
   */
  constructor({ ojama, closeStreamModal, openRules }) {
    this.ojama = ojama;
    this.closeStreamModal = closeStreamModal;
    this.openRules = openRules;
    this.el = document.getElementById('ojamaPeekBar');
    this.elText = document.getElementById('ojamaPeekText');
    document.getElementById('btnOjamaPeekBack')?.addEventListener('click', () => this.back());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isShown()) this.back();
    });
  }

  isShown() {
    return Boolean(this.el) && !this.el.classList.contains('hidden');
  }

  /**
   * When it cannot be set off (no placed piece to drop...), the modal still steps aside: the
   * reason is in a toast on the board, which the modal would hide.
   */
  show(type) {
    const name = OJAMA_INFO[type].name;
    const ok = this.ojama.runOjama(type, 'あなた');
    this.closeStreamModal();
    // A phone has no Escape key to mention.
    const esc = globalThis.matchMedia?.('(pointer: coarse)').matches ? '' : '（Escでも戻れます）';
    this.elText.textContent = ok
      ? `盤面で「${name}」を表示中${esc}`
      : `「${name}」は今は出せません（理由は通知に出ています）`;
    this.el.classList.remove('hidden');
  }

  back() {
    this.hide();
    this.openRules();
  }

  hide() {
    this.el?.classList.add('hidden');
  }
}
