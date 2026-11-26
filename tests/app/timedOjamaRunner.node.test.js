import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OJAMA_CONFIG } from '../../src/config/constants.js';
import { TimedOjamaRunner } from '../../src/app/timedOjamaRunner.js';
import { createFakeAppSession } from '../helpers/fakeAppSession.js';

// Heavy and runaway pieces over time: the host's countdown (and what it sends), wearing down as
// pieces are placed, the guests' mirror, and stopping everything at once.

const OJAMA = {
  heavyDuration: 10,
  heavyReduceSec: 3,
  heavyLevel: 'heavier',
  runawayDuration: 8,
  runawayReduceSec: 2,
  runawayChance: 40,
  runawayGripMinSec: 2,
  runawayGripMaxSec: 5,
};

function setup(options = {}) {
  const fake = createFakeAppSession({ ojama: OJAMA, ...options });
  const runner = new TimedOjamaRunner(fake.session);
  return { ...fake, runner, engine: fake.session.engine };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('starting (host or solo)', () => {
  it('starts heavy pieces with the settings, counts it, sends it and announces it', () => {
    const { runner, engine, sentOf, events } = setup();
    runner.start('heavy', '視聴者A');
    expect(engine.stats.ojamaBreakdown.heavy).toBe(1);
    expect(sentOf('timed')).toEqual([['heavy', 10, 'heavier']]);
    expect(events).toEqual([
      ['heavyChange', { level: 'heavier' }],
      ['timedOjamaChange', { kind: 'heavy', active: true, announce: true, author: '視聴者A' }],
      ['timedOjamaState', { active: [{ kind: 'heavy', remaining: 10 }] }],
    ]);
  });

  it('restarts quietly while it already lasts', () => {
    const { runner, eventsOf } = setup();
    runner.start('heavy');
    runner.start('heavy');
    expect(eventsOf('timedOjamaChange').map((e) => e.announce)).toEqual([true, false]);
  });

  it('starts runaway pieces with their rules on the room', () => {
    const { runner, sentOf } = setup();
    runner.start('runaway');
    expect(sentOf('timed')).toEqual([['runaway', 8, null]]);
    expect(sentOf('runaway')).toEqual([[{ chance: 0.4, gripMinSec: 2, gripMaxSec: 5 }]]);
  });

  it('falls back to the defaults and never lets the grip end before it starts', () => {
    const C = OJAMA_CONFIG;
    const defaults = setup({ ojama: {} });
    defaults.runner.start('heavy');
    defaults.runner.start('runaway');
    expect(defaults.sentOf('timed')).toEqual([
      ['heavy', C.DEFAULT_HEAVY_DURATION_SEC, C.DEFAULT_HEAVY_LEVEL],
      ['runaway', C.DEFAULT_RUNAWAY_DURATION_SEC, null],
    ]);
    expect(defaults.sentOf('runaway')).toEqual([
      [
        {
          chance: C.DEFAULT_RUNAWAY_CHANCE / 100,
          gripMinSec: C.DEFAULT_RUNAWAY_GRIP_MIN_SEC,
          gripMaxSec: C.DEFAULT_RUNAWAY_GRIP_MAX_SEC,
        },
      ],
    ]);

    const odd = setup({ ojama: { runawayGripMinSec: 6, runawayGripMaxSec: 3 } });
    odd.runner.start('runaway');
    expect(odd.sentOf('runaway')[0][0]).toMatchObject({ gripMinSec: 6, gripMaxSec: 6 });
  });
});

describe('counting down (host)', () => {
  it('ends after its time, sends 0 and turns the effect off', () => {
    const { runner, sentOf, eventsOf } = setup();
    runner.start('heavy');
    vi.advanceTimersByTime(9750);
    expect(eventsOf('heavyChange')).toEqual([{ level: 'heavier' }]);
    vi.advanceTimersByTime(250);
    expect(sentOf('timed').at(-1)).toEqual(['heavy', 0, null]);
    expect(eventsOf('heavyChange').at(-1)).toEqual({ level: null });
    expect(eventsOf('timedOjamaChange').at(-1)).toEqual({
      kind: 'heavy',
      active: false,
      announce: true,
      author: null,
    });
    const states = eventsOf('timedOjamaState').length;
    vi.advanceTimersByTime(5000);
    expect(eventsOf('timedOjamaState')).toHaveLength(states);
  });

  it('wears down by the pieces placed since the last tick and sends the new time', () => {
    const { runner, engine, sentOf } = setup();
    runner.start('heavy');
    engine.stats.placedCount += 2;
    vi.advanceTimersByTime(250);
    const [, remaining] = sentOf('timed').at(-1);
    expect(remaining).toBeCloseTo(10 - 0.25 - 6);
    engine.stats.placedCount += 2;
    vi.advanceTimersByTime(250);
    expect(sentOf('timed').at(-1)).toEqual(['heavy', 0, null]);
    expect(runner.clock.isActive('heavy')).toBe(false);
  });

  it('counts only the pieces placed after it started', () => {
    const { runner, engine, sentOf } = setup();
    engine.stats.placedCount = 5;
    runner.start('heavy');
    vi.advanceTimersByTime(250);
    expect(sentOf('timed')).toHaveLength(1);
  });

  it('resends its state every 5 seconds', () => {
    const { runner, sentOf } = setup({ ojama: { ...OJAMA, heavyDuration: 30 } });
    runner.start('heavy');
    vi.advanceTimersByTime(4750);
    expect(sentOf('timed')).toHaveLength(1);
    vi.advanceTimersByTime(250);
    expect(sentOf('timed')).toHaveLength(2);
    expect(sentOf('timed')[1][1]).toBeCloseTo(25);
  });

  it('turns runaway off on the room when it ends', () => {
    const { runner, sentOf } = setup();
    runner.start('runaway');
    vi.advanceTimersByTime(8000);
    expect(sentOf('runaway').at(-1)).toEqual([null]);
  });
});

describe('mirroring (guest)', () => {
  it('follows the host and announces starts and ends', () => {
    const { runner, sentOf, eventsOf } = setup({ role: 'guest' });
    runner.mirror({ kind: 'heavy', remaining: 10, level: 'strong' });
    expect(eventsOf('heavyChange')).toEqual([{ level: 'strong' }]);
    expect(eventsOf('timedOjamaChange')).toEqual([
      { kind: 'heavy', active: true, announce: true, author: null },
    ]);
    runner.mirror({ kind: 'heavy', remaining: 8, level: 'heaviest' });
    expect(eventsOf('heavyChange').at(-1)).toEqual({ level: 'heaviest' });
    expect(eventsOf('timedOjamaChange')).toHaveLength(1);
    runner.mirror({ kind: 'heavy', remaining: 0 });
    expect(eventsOf('timedOjamaChange').at(-1)).toMatchObject({ active: false, announce: true });
    expect(sentOf('timed')).toEqual([]);
  });

  it('counts down on its own without sending or setting the room rules', () => {
    const { runner, engine, sent, eventsOf } = setup({ role: 'guest' });
    runner.mirror({ kind: 'runaway', remaining: 1 });
    engine.stats.placedCount += 10;
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([]);
    expect(eventsOf('timedOjamaChange').at(-1)).toMatchObject({ kind: 'runaway', active: false });
  });

  it('only reports the state when the host ends one that is not running', () => {
    const { runner, eventsOf } = setup({ role: 'guest' });
    runner.mirror({ kind: 'runaway', remaining: 0 });
    expect(eventsOf('timedOjamaChange')).toEqual([]);
    expect(eventsOf('timedOjamaState')).toEqual([{ active: [] }]);
  });
});

describe('stopping everything', () => {
  it.each(['puzzleComplete', 'puzzleReset'])('stops quietly on %s', (event) => {
    const { runner, fire, sentOf, eventsOf } = setup();
    runner.start('heavy');
    runner.start('runaway');
    fire(event);
    expect(sentOf('timed').slice(-2)).toEqual([
      ['heavy', 0, null],
      ['runaway', 0, null],
    ]);
    expect(
      eventsOf('timedOjamaChange')
        .slice(-2)
        .map((e) => e.announce),
    ).toEqual([false, false]);
    expect(eventsOf('timedOjamaState').at(-1)).toEqual({ active: [] });
    expect(runner.clock.active.size).toBe(0);
  });
});
