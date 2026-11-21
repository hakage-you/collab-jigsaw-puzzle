import { afterEach, describe, expect, it } from 'vitest';
import { PuzzleLoading } from '../../src/ui/puzzleLoading.js';

// The overlay must be on screen before the slow work starts, and stay until the table is drawn.

const frame = () =>
  new Promise((r) => {
    requestAnimationFrame(() => r());
  });
let el = null;
afterEach(() => el?.remove());

function setup() {
  el = document.createElement('div');
  el.id = 'puzzleLoading';
  el.className = 'hidden';
  document.body.appendChild(el);
  const queued = [];
  const viewState = { afterNextRender: (cb) => queued.push(cb) };
  const drawTable = () => queued.splice(0).forEach((cb) => cb());
  return { loading: new PuzzleLoading(viewState), drawTable };
}

describe('puzzle loading overlay', () => {
  it('shows first, runs the work after it was painted, and hides once the table is drawn', async () => {
    const { loading, drawTable } = setup();
    const seen = [];
    expect(loading.run(() => seen.push(el.classList.contains('hidden')))).toBe(true);
    expect(el.classList.contains('hidden')).toBe(false);
    expect(seen).toEqual([]);

    await frame();
    await frame();
    await frame();
    expect(seen).toEqual([false]);
    expect(el.classList.contains('hidden')).toBe(false);

    drawTable();
    expect(el.classList.contains('hidden')).toBe(true);
  });

  it('ignores a second start while one is running, and hides even if the work fails', async () => {
    const { loading, drawTable } = setup();
    let runs = 0;
    loading.run(() => {
      runs++;
      throw new Error('cut failed');
    });
    expect(loading.run(() => runs++)).toBe(false);
    const errors = [];
    const onError = (e) => {
      errors.push(e.message);
      e.preventDefault();
    };
    window.addEventListener('error', onError);
    await frame();
    await frame();
    await frame();
    window.removeEventListener('error', onError);
    drawTable();
    expect(runs).toBe(1);
    expect(el.classList.contains('hidden')).toBe(true);
    expect(loading.run(() => runs++)).toBe(true);
  });
});
