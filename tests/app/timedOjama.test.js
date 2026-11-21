import { describe, expect, it } from 'vitest';
import { TimedOjamaClock } from '../../src/app/timedOjama.js';

// Heavy and runaway pieces last a while and wear down as pieces are placed.

describe('timed ojama clock', () => {
  it('counts down and reports a kind once it runs out', () => {
    const c = new TimedOjamaClock();
    c.start('heavy', { durationSec: 2, reduceSec: 3, level: 'heaviest' });
    expect(c.tick(1.5)).toEqual([]);
    expect(c.get('heavy')).toMatchObject({ remaining: 0.5, level: 'heaviest' });
    expect(c.tick(0.5)).toEqual(['heavy']);
    expect(c.isActive('heavy')).toBe(false);
  });

  it('placing pieces takes reduceSec off per piece, and can end it early', () => {
    const c = new TimedOjamaClock();
    c.start('heavy', { durationSec: 30, reduceSec: 3 });
    c.start('runaway', { durationSec: 5, reduceSec: 3 });
    expect(c.onPlaced(0)).toEqual({ changed: [], ended: [] });
    expect(c.onPlaced(2)).toEqual({ changed: ['heavy'], ended: ['runaway'] });
    expect(c.get('heavy').remaining).toBe(24);
    expect(c.isActive('runaway')).toBe(false);
  });

  it('a guest mirrors the host: a time sets it, 0 ends it', () => {
    const c = new TimedOjamaClock();
    c.mirror('runaway', 12);
    expect(c.get('runaway').remaining).toBe(12);
    expect(c.onPlaced(5).changed).toEqual([]);
    c.mirror('runaway', 0);
    expect(c.isActive('runaway')).toBe(false);
  });

  it('stopAll ends everything and says what was running', () => {
    const c = new TimedOjamaClock();
    c.start('heavy', { durationSec: 9 });
    c.start('runaway', { durationSec: 9 });
    expect(c.stopAll().sort()).toEqual(['heavy', 'runaway']);
    expect(c.active.size).toBe(0);
  });
});
