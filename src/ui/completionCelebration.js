/** How long the big sticker stays on the finished picture before the result card, and its peel (ms). */
const HOLD_MS = 2800;
const PEEL_MS = 350;

/**
 * The moment the puzzle is completed: a big "かんせい！" sticker slapped on over the finished
 * picture (styles: .complete-celebration), with the confetti and stars the renderer plays. The
 * only effect that holds play up: the board is covered for a moment (a click, Esc or Enter goes
 * straight on), then the sticker peels off and the result card comes.
 */
export class CompletionCelebration {
  constructor() {
    this.el = document.getElementById('completeCelebration');
    this.timer = null;
    /** What comes next (the result card) while the sticker is up, else null. */
    this.onDone = null;
    this.el?.addEventListener('click', () => this.finish());
    window.addEventListener('keydown', (e) => {
      if (!this.onDone || (e.key !== 'Escape' && e.key !== 'Enter')) return;
      e.preventDefault();
      this.finish();
    });
  }

  /**
   * Puts the sticker up with its middle at `at` (CSS px on the stage: the board's top edge), then
   * calls `onDone` after a moment (or sooner, on a click).
   */
  play(onDone, at) {
    this.cancel();
    if (!this.el) {
      onDone();
      return;
    }
    this.onDone = onDone;
    this.el.style.setProperty('--x', `${Math.round(at.x)}px`);
    this.el.style.setProperty('--y', `${Math.round(at.y)}px`);
    this.el.classList.remove('hidden', 'is-peeling');
    this.timer = setTimeout(() => this.finish(), HOLD_MS);
  }

  /** Peels the sticker off and goes on to what comes next. */
  finish() {
    const done = this.onDone;
    if (!done) return;
    this.onDone = null;
    clearTimeout(this.timer);
    this.el.classList.add('is-peeling');
    this.timer = setTimeout(() => this.el.classList.add('hidden'), PEEL_MS);
    done();
  }

  /** Takes the sticker down without going on (a new puzzle). */
  cancel() {
    clearTimeout(this.timer);
    this.onDone = null;
    this.el?.classList.add('hidden');
  }
}
