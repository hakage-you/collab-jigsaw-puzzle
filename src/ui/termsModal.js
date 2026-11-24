/**
 * A dialog opened from the lobby: the terms (default), the credits, or "演出と音". Closes with
 * its button, a click on the backdrop, or Escape.
 */
export class TermsModal {
  constructor({ modalId = 'termsModal', openId = 'btnOpenTerms', closeId = 'btnCloseTerms' } = {}) {
    this.elModal = document.getElementById(modalId);
    this.elBtnOpen = document.getElementById(openId);
    this.elBtnClose = document.getElementById(closeId);

    this._bindEvents();
  }

  _bindEvents() {
    if (this.elBtnOpen) {
      this.elBtnOpen.addEventListener('click', () => this.show());
    }
    if (this.elBtnClose) {
      this.elBtnClose.addEventListener('click', () => this.hide());
    }
    if (this.elModal) {
      this.elModal.addEventListener('click', (e) => {
        if (e.target === this.elModal) {
          this.hide();
        }
      });
    }
    // In the capture phase, so the lobby under it (which closes on an Escape nobody took) sees
    // the key already taken.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && this.elModal && !this.elModal.classList.contains('hidden')) {
          e.preventDefault();
          this.hide();
        }
      },
      true,
    );
  }

  show() {
    this.elModal?.classList.remove('hidden');
  }

  hide() {
    this.elModal?.classList.add('hidden');
  }
}
