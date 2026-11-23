/**
 * A text dialog opened from the lobby footer: the terms (default) or the credits. Closes with
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
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.elModal && !this.elModal.classList.contains('hidden')) {
        e.preventDefault();
        this.hide();
      }
    });
  }

  show() {
    this.elModal?.classList.remove('hidden');
  }

  hide() {
    this.elModal?.classList.add('hidden');
  }
}
