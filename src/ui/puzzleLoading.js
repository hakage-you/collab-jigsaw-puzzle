/**
 * The "preparing the puzzle" overlay. Cutting a puzzle is quick, but the first frame after it
 * builds the piece images and can hold the page for about a second with thousands of pieces
 * (_plan/open_issues.md section 10). So the overlay is painted first, the work runs after that,
 * and the overlay goes away once the new table has been drawn. The spinner turns with a CSS
 * transform, which keeps moving while the page is busy.
 */
export class PuzzleLoading {
  /** @param {object} viewState renderer ViewState (afterNextRender) */
  constructor(viewState) {
    this.el = document.getElementById('puzzleLoading');
    this.viewState = viewState;
    this.busy = false;
  }

  /** Shows the overlay, runs `work` (sync or async) once it is on screen, and hides it after the next frame. */
  run(work) {
    if (this.busy) return false;
    this.busy = true;
    this.el.classList.remove('hidden');
    const finish = () => {
      this.viewState.afterNextRender(() => {
        this.el.classList.add('hidden');
        this.busy = false;
      });
    };
    // Two frames: the first one lays the overlay out, the second one has painted it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        let asyncWork = false;
        try {
          const result = work();
          if (result && typeof result.then === 'function') {
            asyncWork = true;
            Promise.resolve(result).finally(finish);
          }
        } finally {
          if (!asyncWork) finish();
        }
      }),
    );
    return true;
  }
}
