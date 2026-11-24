import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompletionCelebration } from '../../src/ui/completionCelebration.js';

// Completion: the big sticker stays a moment, then the result card comes; a click goes on sooner.

let el;
beforeEach(() => {
  vi.useFakeTimers();
  el = document.createElement('div');
  el.id = 'completeCelebration';
  el.className = 'complete-celebration hidden';
  document.body.append(el);
});

afterEach(() => {
  vi.useRealTimers();
  el.remove();
});

const AT = { x: 300, y: 120 };

describe('CompletionCelebration', () => {
  it('shows the sticker where it is told, then goes on to the result by itself', () => {
    const c = new CompletionCelebration();
    const done = vi.fn();
    c.play(done, AT);
    expect(el.classList.contains('hidden')).toBe(false);
    expect(el.style.getPropertyValue('--x')).toBe('300px');
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(done).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(400);
    expect(el.classList.contains('hidden')).toBe(true);
  });

  it('with effects off, shows no sticker and goes on at once', () => {
    const c = new CompletionCelebration();
    const done = vi.fn();
    c.play(done, AT, 'off');
    expect(done).toHaveBeenCalledTimes(1);
    expect(el.classList.contains('hidden')).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('goes on at once on a click, and only once', () => {
    const c = new CompletionCelebration();
    const done = vi.fn();
    c.play(done, AT);
    el.click();
    el.click();
    vi.advanceTimersByTime(5000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('takes the sticker down without going on when the puzzle is reset', () => {
    const c = new CompletionCelebration();
    const done = vi.fn();
    c.play(done, AT);
    c.cancel();
    vi.advanceTimersByTime(5000);
    expect(done).not.toHaveBeenCalled();
    expect(el.classList.contains('hidden')).toBe(true);
  });
});
