import { describe, expect, it } from 'vitest';
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
