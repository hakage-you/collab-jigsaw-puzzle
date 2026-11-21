/**
 * The ojama test palette ("動作確認"): a button per ojama in use, "すべて消す", the test comment
 * box and the comment log, floating over the board so what a test does stays in view. It opens
 * from the ojama rules list (closing the modal) and closes whenever the stream modal opens again,
 * by its "設定に戻る" or by the header's stream button; it is moved by its header and stays
 * inside the board area.
 */
export class TestPalette {
  /**
   * @param {object} deps
   * @param {object} deps.app  GameSession (getSettings, on)
   * @param {() => void} deps.closeStreamModal
   * @param {() => void} deps.openRules  opens the stream modal on the ojama rules
   */
  constructor({ app, closeStreamModal, openRules }) {
    this.app = app;
    this.closeStreamModal = closeStreamModal;
    this.openRules = openRules;
    this.el = document.getElementById('ojamaTestPalette');
    this.elHandle = document.getElementById('testPaletteHandle');
    this.drag = null;

    document.getElementById('btnCloseTestPalette').addEventListener('click', () => this.close());
    document.getElementById('btnTestPaletteBack').addEventListener('click', () => {
      this.close();
      this.openRules();
    });
    this.app.on('settingsChange', (s) => this._showTypesInUse(s));
    this._showTypesInUse(this.app.getSettings());
    this.elHandle.addEventListener('pointerdown', (e) => this._startDrag(e));
    this.elHandle.addEventListener('pointermove', (e) => this._moveDrag(e));
    this.elHandle.addEventListener('pointerup', () => this._endDrag());
    this.elHandle.addEventListener('pointercancel', () => this._endDrag());
    window.addEventListener('resize', () => this._keepInside());
  }

  open() {
    this.closeStreamModal();
    this.el.classList.remove('hidden');
    this._keepInside();
  }

  close() {
    this.el.classList.add('hidden');
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }

  /** Only the ojama in use get a button. */
  _showTypesInUse(settings) {
    for (const btn of this.el.querySelectorAll('[data-ojama-test]')) {
      btn.classList.toggle('hidden', settings.ojama.enabled?.[btn.dataset.ojamaTest] === false);
    }
  }

  _startDrag(e) {
    if (e.button !== 0 || e.target.closest('button')) return;
    const box = this.el.getBoundingClientRect();
    this.drag = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    this.elHandle.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  _moveDrag(e) {
    if (!this.drag) return;
    const stage = this.el.parentElement.getBoundingClientRect();
    this._placeAt(e.clientX - this.drag.dx - stage.left, e.clientY - this.drag.dy - stage.top);
  }

  _endDrag() {
    this.drag = null;
  }

  /** Puts the palette's top left at (x, y) px in the board area, kept fully inside it. */
  _placeAt(x, y) {
    const stage = this.el.parentElement.getBoundingClientRect();
    const box = this.el.getBoundingClientRect();
    const left = Math.min(Math.max(0, x), Math.max(0, stage.width - box.width));
    const top = Math.min(Math.max(0, y), Math.max(0, stage.height - box.height));
    Object.assign(this.el.style, { left: `${left}px`, top: `${top}px`, right: 'auto' });
  }

  /** After the board area shrinks, pulls a moved palette back inside it. */
  _keepInside() {
    if (this.el.classList.contains('hidden') || !this.el.style.left) return;
    this._placeAt(parseFloat(this.el.style.left), parseFloat(this.el.style.top));
  }
}
