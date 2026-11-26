import { describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER_CONFIG } from '../../src/config/constants.js';
import { PeerLiveness } from '../../src/net/heartbeat.js';

const TIMEOUT = MULTIPLAYER_CONFIG.HEARTBEAT_TIMEOUT_MS;

function setup(peers = ['a']) {
  const clock = { now: 0 };
  const log = { pings: [], lost: [] };
  const liveness = new PeerLiveness({
    ping: (id) => log.pings.push(id),
    onLost: (id) => log.lost.push(id),
    listPeers: () => peers,
    now: () => clock.now,
  });
  return { clock, log, liveness, peers };
}

describe('PeerLiveness', () => {
  it('pings, and keeps a peer that answers', () => {
    const { clock, log, liveness } = setup();
    liveness.tick();
    expect(log.pings).toEqual(['a']);
    liveness.seen('a');
    clock.now += TIMEOUT * 3;
    liveness.tick();
    expect(log.pings).toEqual(['a', 'a']);
    expect(log.lost).toEqual([]);
  });

  it('gives up on a peer that has not answered a ping for the timeout', () => {
    const { clock, log, liveness } = setup();
    liveness.tick();
    clock.now += TIMEOUT;
    liveness.tick();
    expect(log.lost).toEqual([]);
    // No second ping while still waiting for the first answer.
    expect(log.pings).toEqual(['a']);

    clock.now += 1;
    liveness.tick();
    expect(log.lost).toEqual(['a']);
  });

  it('a throttled timer (long gap between ticks) does not drop a live peer', () => {
    const { clock, log, liveness } = setup();
    for (let i = 0; i < 3; i++) {
      liveness.tick();
      liveness.seen('a'); // answered right away
      clock.now += 60_000; // next tick a minute later
    }
    expect(log.lost).toEqual([]);
  });

  it('forgets peers that left the list', () => {
    const { clock, log, liveness, peers } = setup(['a', 'b']);
    liveness.tick();
    peers.splice(peers.indexOf('b'), 1);
    clock.now += TIMEOUT + 1;
    liveness.tick();
    expect(log.lost).toEqual(['a']);
  });
});

describe('PeerLiveness details', () => {
  it('starts the clock from the first unanswered ping, whatever the time', () => {
    const { clock, log, liveness } = setup();
    clock.now = 1_000_000;
    liveness.tick();
    clock.now += 1;
    liveness.tick();
    expect(log.lost).toEqual([]);
  });

  it('pings a lost peer afresh if it is still listed', () => {
    const { clock, log, liveness } = setup();
    liveness.tick();
    clock.now += TIMEOUT + 1;
    liveness.tick();
    liveness.tick();
    expect(log.lost).toEqual(['a']);
    expect(log.pings).toEqual(['a', 'a']);
  });

  it('starts over for a peer that left and came back', () => {
    const { clock, log, liveness, peers } = setup(['a']);
    liveness.tick();
    peers.length = 0;
    liveness.tick();
    peers.push('a');
    clock.now += TIMEOUT + 1;
    liveness.tick();
    expect(log.lost).toEqual([]);
    expect(log.pings).toEqual(['a', 'a']);
  });

  it('forgets a peer on request, so it is pinged again rather than lost', () => {
    const { clock, log, liveness } = setup();
    liveness.tick();
    liveness.forget('a');
    clock.now += TIMEOUT + 1;
    liveness.tick();
    expect(log.lost).toEqual([]);
    expect(log.pings).toEqual(['a', 'a']);
  });

  it('ticks on a timer once started, only once, until stopped', () => {
    vi.useFakeTimers();
    try {
      const { log, liveness } = setup();
      liveness.start();
      liveness.start();
      vi.advanceTimersByTime(MULTIPLAYER_CONFIG.HEARTBEAT_INTERVAL_MS);
      expect(log.pings).toEqual(['a']);
      liveness.stop();
      expect(liveness.awaitingSince.size).toBe(0);
      vi.advanceTimersByTime(MULTIPLAYER_CONFIG.HEARTBEAT_INTERVAL_MS * 5);
      expect(log.pings).toEqual(['a']);
      liveness.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses performance.now when no clock is given', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const lost = [];
    const liveness = new PeerLiveness({
      ping: () => {},
      onLost: (id) => lost.push(id),
      listPeers: () => ['a'],
    });
    liveness.tick();
    now.mockReturnValue(TIMEOUT + 1);
    liveness.tick();
    expect(lost).toEqual(['a']);
    now.mockRestore();
  });
});
