import { describe, expect, it } from 'vitest';
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
