export class TermsModal {
  constructor() {
    this.elModal = document.getElementById('termsModal');
    this.elBtnOpen = document.getElementById('btnOpenTerms');
    this.elBtnClose = document.getElementById('btnCloseTerms');

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
