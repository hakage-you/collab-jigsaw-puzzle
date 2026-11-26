import { describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER_CONFIG } from '../../src/config/constants.js';
import { Recruitment, RECRUIT_STATE } from '../../src/net/recruitment.js';

/** Manual clock: timers fire only when the test advances time. */
function manualTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
  };
}

function setup({ capacity = 3, online = 1 } = {}) {
  const timers = manualTimers();
  const room = { online, capacity, pending: false, accepting: [], states: [] };
  const recruitment = new Recruitment({
    getOnlineCount: () => room.online,
    getCapacity: () => room.capacity,
    hasPendingJoins: () => room.pending,
    setAccepting: (a) => room.accepting.push(a),
    onChange: (s) => room.states.push(s),
    timers,
    promptAfterMs: 1000,
    graceMs: 100,
  });
  recruitment.start();
  return { timers, room, recruitment };
}

describe('Recruitment: full room', () => {
  it('stops accepting while full and reopens when a seat frees up', () => {
    const { room, recruitment } = setup({ capacity: 2 });
    expect(recruitment.state).toBe(RECRUIT_STATE.OPEN);

    room.online = 2;
    recruitment.update();
    expect(recruitment.state).toBe(RECRUIT_STATE.FULL);
    expect(room.accepting).toEqual([false]);

    room.online = 1;
    recruitment.update();
    expect(recruitment.state).toBe(RECRUIT_STATE.OPEN);
    expect(room.accepting).toEqual([false, true]);
  });
});

describe('Recruitment: idle host', () => {
  it('asks first, keeps accepting while asking, then stops when nobody answers', () => {
    const { timers, room, recruitment } = setup();
    timers.advance(999);
    expect(recruitment.state).toBe(RECRUIT_STATE.OPEN);

    timers.advance(1);
    expect(recruitment.state).toBe(RECRUIT_STATE.IDLE_PROMPT);
    expect(room.accepting).toEqual([]);

    timers.advance(100);
    expect(recruitment.state).toBe(RECRUIT_STATE.IDLE_STOPPED);
    expect(room.accepting).toEqual([false]);
  });

  it('answering the prompt keeps recruiting and restarts the wait', () => {
    const { timers, room, recruitment } = setup();
    timers.advance(1000);
    recruitment.keepRecruiting();
    expect(recruitment.state).toBe(RECRUIT_STATE.OPEN);

    timers.advance(1099);
    expect(recruitment.state).toBe(RECRUIT_STATE.IDLE_PROMPT);
    expect(room.accepting).toEqual([]);
  });

  it('resume reopens a stopped room', () => {
    const { timers, room, recruitment } = setup();
    timers.advance(1100);
    expect(recruitment.state).toBe(RECRUIT_STATE.IDLE_STOPPED);

    recruitment.resume();
    expect(recruitment.state).toBe(RECRUIT_STATE.OPEN);
    expect(room.accepting).toEqual([false, true]);
  });

  it('a guest arriving cancels the prompt; the wait starts over when they leave', () => {
    const { timers, room, recruitment } = setup();
    timers.advance(1000);
    room.online = 2;
    recruitment.update();
    expect(recruitment.state).toBe(RECRUIT_STATE.OPEN);

    timers.advance(5000);
    expect(recruitment.state).toBe(RECRUIT_STATE.OPEN);

    room.online = 1;
    recruitment.update();
    timers.advance(1100);
    expect(recruitment.state).toBe(RECRUIT_STATE.IDLE_STOPPED);
  });

  it('does not stop while someone is waiting for approval', () => {
    const { timers, room, recruitment } = setup();
    timers.advance(1000);
    room.pending = true;
    timers.advance(100);
    expect(recruitment.state).toBe(RECRUIT_STATE.OPEN);
    expect(room.accepting).toEqual([]);
  });

  it('stop() cancels pending timers', () => {
    const { timers, room, recruitment } = setup();
    recruitment.stop();
    timers.advance(5000);
    expect(room.states).toEqual([]);
    expect(room.accepting).toEqual([]);
  });
});

describe('Recruitment: details', () => {
  /** setup() plus the number of timers still pending. */
  function counted(options) {
    const s = setup(options);
    const { setTimeout: set, clearTimeout: clear } = s.timers;
    const live = new Set();
    s.timers.setTimeout = (fn, ms) => {
      const id = set((...args) => {
        live.delete(id);
        fn(...args);
      }, ms);
      live.add(id);
      return id;
    };
    s.timers.clearTimeout = (id) => {
      live.delete(id);
      clear(id);
    };
    return { ...s, pendingTimers: () => live.size };
  }

  it('names its states', () => {
    expect(RECRUIT_STATE).toEqual({
      OPEN: 'open',
      IDLE_PROMPT: 'idle_prompt',
      FULL: 'full',
      IDLE_STOPPED: 'idle_stopped',
    });
  });

  it('does nothing before start or after stop', () => {
    const timers = manualTimers();
    const calls = [];
    const recruitment = new Recruitment({
      getOnlineCount: () => 1,
      getCapacity: () => 1,
      hasPendingJoins: () => false,
      setAccepting: (a) => calls.push(a),
      onChange: (s) => calls.push(s),
      timers,
      promptAfterMs: 10,
      graceMs: 10,
    });
    recruitment.update();
    recruitment.resume();
    timers.advance(100);
    expect(calls).toEqual([]);
    recruitment.start();
    expect(calls).toEqual([false, RECRUIT_STATE.FULL]);
    recruitment.stop();
    calls.length = 0;
    recruitment.update();
    recruitment.resume();
    timers.advance(100);
    expect(calls).toEqual([]);
  });

  it('keeps one idle wait however often it is re-evaluated', () => {
    const { timers, recruitment, pendingTimers } = counted();
    recruitment.update();
    recruitment.update();
    recruitment.update();
    expect(pendingTimers()).toBe(0); // setup's start() armed it before counting began
    timers.advance(1000);
    expect(pendingTimers()).toBe(1); // the grace timer
    recruitment.update();
    expect(pendingTimers()).toBe(1);
    timers.advance(100);
    expect(recruitment.state).toBe(RECRUIT_STATE.IDLE_STOPPED);
    recruitment.update();
    expect(pendingTimers()).toBe(0);
  });

  it('restarts the idle wait from scratch after a short visit', () => {
    const { timers, room, recruitment } = setup();
    timers.advance(900);
    room.online = 2;
    recruitment.update();
    timers.advance(50);
    room.online = 1;
    recruitment.update();
    timers.advance(500); // the first wait would have ended here
    expect(recruitment.state).toBe(RECRUIT_STATE.OPEN);
    timers.advance(500);
    expect(recruitment.state).toBe(RECRUIT_STATE.IDLE_PROMPT);
  });

  it('cancels the prompt when someone comes and goes during it', () => {
    const { timers, room, recruitment } = setup();
    timers.advance(1000);
    room.online = 2;
    recruitment.update();
    room.online = 1;
    recruitment.update();
    timers.advance(100); // the first grace period would have ended here
    expect(recruitment.state).toBe(RECRUIT_STATE.OPEN);
    expect(room.accepting).toEqual([]);
  });

  it('does not stop when someone joined during the prompt without an update', () => {
    const { timers, room, recruitment } = setup();
    timers.advance(1000);
    room.online = 2;
    timers.advance(100);
    expect(recruitment.state).toBe(RECRUIT_STATE.OPEN);
  });

  it('resume during the prompt starts the wait over', () => {
    const { timers, room, recruitment } = setup();
    timers.advance(1000);
    recruitment.resume();
    expect(recruitment.state).toBe(RECRUIT_STATE.OPEN);
    timers.advance(999);
    expect(recruitment.state).toBe(RECRUIT_STATE.OPEN);
    timers.advance(1);
    expect(room.states).toEqual([
      RECRUIT_STATE.IDLE_PROMPT,
      RECRUIT_STATE.OPEN,
      RECRUIT_STATE.IDLE_PROMPT,
    ]);
  });

  it('stop cancels a running prompt', () => {
    const { timers, room, recruitment } = setup();
    timers.advance(1000);
    recruitment.stop();
    timers.advance(1000);
    expect(room.states).toEqual([RECRUIT_STATE.IDLE_PROMPT]);
    expect(room.accepting).toEqual([]);
  });

  it('uses the configured times and the global timers by default', () => {
    vi.useFakeTimers();
    try {
      const states = [];
      const recruitment = new Recruitment({
        getOnlineCount: () => 1,
        getCapacity: () => 4,
        hasPendingJoins: () => false,
        setAccepting: () => {},
        onChange: (s) => states.push(s),
      });
      recruitment.start();
      vi.advanceTimersByTime(MULTIPLAYER_CONFIG.RECRUIT_IDLE_PROMPT_MS - 1);
      expect(states).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(states).toEqual([RECRUIT_STATE.IDLE_PROMPT]);
      vi.advanceTimersByTime(MULTIPLAYER_CONFIG.RECRUIT_IDLE_GRACE_MS);
      expect(states).toEqual([RECRUIT_STATE.IDLE_PROMPT, RECRUIT_STATE.IDLE_STOPPED]);
      recruitment.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
