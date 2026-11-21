import { describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_MS,
  TAP_MAX_MOVE_PX,
  TAP_MAX_MS,
  TapSorter,
  TouchGestures,
} from '../../src/ui/touchGestures.js';

describe('TouchGestures', () => {
  it('treats one finger like the mouse and reports a short, still touch as a tap', () => {
    const g = new TouchGestures();
    expect(g.down(1, 100, 100, 0)).toBe('single');
    expect(g.move(1, 103, 102)).toBe('single');
    expect(g.up(1, 120)).toBe('tap');
    expect(g.active).toBe(false);
  });

  it('is not a tap when the finger moved or stayed down too long', () => {
    const moved = new TouchGestures();
    moved.down(1, 0, 0, 0);
    moved.move(1, TAP_MAX_MOVE_PX + 1, 0);
    moved.move(1, 0, 0); // coming back does not make it a tap again
    expect(moved.up(1, 50)).toBe('single');

    const slow = new TouchGestures();
    slow.down(1, 0, 0, 0);
    expect(slow.up(1, TAP_MAX_MS + 1)).toBe('single');
  });

  it('is not a tap when the touch was cancelled', () => {
    const g = new TouchGestures();
    g.down(1, 0, 0, 0);
    expect(g.up(1, 10, true)).toBe('single');
  });

  it('pinches with two fingers: moves by the middle point and zooms by the spread', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100, 0);
    expect(g.down(2, 200, 100, 10)).toBe('pinch');
    const r = g.move(2, 300, 100);
    expect(r.pan).toEqual({ dx: 50, dy: 0 });
    expect(r.zoom).toEqual({ x: 200, y: 100, factor: 2 });
    // The next move is measured from the last one, not from the start.
    const r2 = g.move(1, 100, 140);
    expect(r2.pan).toEqual({ dx: 0, dy: 20 });
  });

  it('ignores the fingers left after a pinch until all of them are up', () => {
    const g = new TouchGestures();
    g.down(1, 0, 0, 0);
    g.down(2, 50, 0, 0);
    expect(g.up(2, 100)).toBe('ignore');
    expect(g.move(1, 30, 30)).toBe('ignore');
    expect(g.up(1, 120)).toBe('ignore');
    expect(g.active).toBe(false);
    expect(g.down(3, 0, 0, 200)).toBe('single');
  });

  it('ignores a third finger and anything after it', () => {
    const g = new TouchGestures();
    g.down(1, 0, 0, 0);
    g.down(2, 50, 0, 0);
    expect(g.down(3, 90, 0, 0)).toBe('ignore');
    expect(g.move(1, 10, 0)).toBe('ignore');
  });

  it('forgets the tap when told to (the piece hopped away)', () => {
    const g = new TouchGestures();
    g.down(1, 0, 0, 0);
    g.dropTap();
    expect(g.up(1, 10)).toBe('single');
  });

  it('ignores pointers it never saw go down', () => {
    const g = new TouchGestures();
    expect(g.move(9, 0, 0)).toBe('ignore');
    expect(g.up(9, 0)).toBe('ignore');
  });
});

describe('TapSorter', () => {
  const at = (t, key = 7, x = 10, y = 10) => ({ x, y, t, key });

  it('waits after a tap on a piece, then the timer makes it a single tap', () => {
    const s = new TapSorter();
    expect(s.tap(at(0))).toEqual({ action: 'wait', flushed: null });
    expect(s.expire()).toMatchObject({ key: 7 });
    expect(s.expire()).toBeNull();
  });

  it('makes a double tap from two quick taps on the same piece', () => {
    const s = new TapSorter();
    s.tap(at(0));
    expect(s.tap(at(DOUBLE_TAP_MS - 1, 7, 14, 12))).toEqual({ action: 'double', flushed: null });
    expect(s.expire()).toBeNull();
  });

  it('hands back the waiting tap when the next one is too late, too far or on another piece', () => {
    for (const second of [at(DOUBLE_TAP_MS + 1), at(10, 7, 200, 10), at(10, 8)]) {
      const s = new TapSorter();
      const first = at(0);
      s.tap(first);
      const r = s.tap(second);
      expect(r.flushed).toBe(first);
      expect(r.action).toBe('wait');
    }
  });

  it('does nothing for a tap off the pieces, but still hands back a waiting one', () => {
    const s = new TapSorter();
    expect(s.tap(at(0, null))).toEqual({ action: 'none', flushed: null });
    const first = at(0);
    s.tap(first);
    expect(s.tap(at(10, null, 300, 300))).toEqual({ action: 'none', flushed: first });
  });

  it('acts at once when double taps are not wanted (flipping is off)', () => {
    const s = new TapSorter();
    expect(s.tap(at(0), false)).toEqual({ action: 'single', flushed: null });
    expect(s.expire()).toBeNull();
  });

  it('keeps the fields it was given, so the caller gets its piece back', () => {
    const s = new TapSorter();
    const piece = { id: 7 };
    s.tap({ ...at(0), piece });
    expect(s.expire().piece).toBe(piece);
  });
});
