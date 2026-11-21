import { afterEach, describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER_CONFIG } from '../../src/config/constants.js';
import { describeJoinError, PeerJsTransport } from '../../src/net/peerJsTransport.js';

// Fake PeerJS constructor that records the options it is given; no network is touched.
class FakePeer {
  static created = [];

  constructor(idOrOptions, maybeOptions) {
    this.options = typeof idOrOptions === 'object' ? idOrOptions : maybeOptions;
    this.handlers = {};
    this.disconnected = false;
    this.destroyed = false;
    this.calls = [];
    this.conn = null;
    FakePeer.created.push(this);
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  emit(event, ...args) {
    this.handlers[event]?.(...args);
  }

  // Mirrors PeerJS: disconnect() drops only the signaling socket and emits 'disconnected'.
  disconnect() {
    if (this.disconnected) return;
    this.calls.push('disconnect');
    this.disconnected = true;
    this.emit('disconnected');
  }

  reconnect() {
    this.calls.push('reconnect');
    this.disconnected = false;
  }

  connect() {
    this.conn = new FakeConn();
    return this.conn;
  }

  destroy() {
    this.destroyed = true;
  }
}

class FakeConn {
  constructor() {
    this.handlers = {};
    this.open = false;
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  emit(event, ...args) {
    this.handlers[event]?.(...args);
  }

  close() {}
}

/** Opens a host on a FakePeer and returns { transport, peer, states, errors }. */
async function openFakeHost() {
  window.Peer = FakePeer;
  const transport = new PeerJsTransport();
  const states = [];
  const errors = [];
  transport.onSignalingChange = (s) => states.push(s);
  transport.onError = (e) => errors.push(e);
  const opened = transport.openHost('room-a');
  const peer = FakePeer.created.at(-1);
  peer.emit('open', 'room-a');
  await opened;
  return { transport, peer, states, errors };
}

const originalPeer = window.Peer;

afterEach(() => {
  window.Peer = originalPeer;
  FakePeer.created = [];
  vi.useRealTimers();
});

function iceUrls(peer) {
  return peer.options.config.iceServers.flatMap((s) => [s.urls].flat());
}

describe('PeerJsTransport ICE configuration', () => {
  it('host and guest use STUN only and never a TURN relay', () => {
    window.Peer = FakePeer;
    new PeerJsTransport().openHost('room-a');
    new PeerJsTransport().connectGuest('room-a').catch(() => {});

    expect(FakePeer.created).toHaveLength(2);
    for (const peer of FakePeer.created) {
      const urls = iceUrls(peer);
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((u) => u.startsWith('stun:'))).toBe(true);
    }
  });
});

describe('PeerJsTransport signaling (host)', () => {
  it('leaving and rejoining the signaling server keeps the room object alive', async () => {
    const { transport, peer, states } = await openFakeHost();
    expect(states).toEqual(['online']);

    transport.setAcceptingJoins(false);
    expect(peer.calls).toEqual(['disconnect']);
    expect(peer.destroyed).toBe(false);
    expect(states.at(-1)).toBe('paused');

    transport.setAcceptingJoins(true);
    expect(peer.calls).toEqual(['disconnect', 'reconnect']);
    expect(states.at(-1)).toBe('reconnecting');
    peer.emit('open', 'room-a');
    expect(states.at(-1)).toBe('online');
  });

  it('an unexpected drop is retried with backoff, then reported as offline', async () => {
    vi.useFakeTimers();
    const { peer, states, errors } = await openFakeHost();
    const delays = MULTIPLAYER_CONFIG.SIGNALING_RETRY_DELAYS_MS;

    peer.emit('error', { type: 'network' });
    peer.disconnect();
    for (const delay of delays) {
      expect(states.at(-1)).toBe('reconnecting');
      vi.advanceTimersByTime(delay);
      // The retry fails the same way.
      peer.emit('error', { type: 'network' });
      peer.disconnect();
    }
    expect(states.at(-1)).toBe('offline');
    expect(peer.calls.filter((c) => c === 'reconnect')).toHaveLength(delays.length);
    // Signaling trouble is shown by the recruit banner, not as error toasts.
    expect(errors).toEqual([]);
  });

  it('a successful retry resets the backoff', async () => {
    vi.useFakeTimers();
    const { peer, states } = await openFakeHost();
    peer.disconnect();
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.SIGNALING_RETRY_DELAYS_MS[0]);
    peer.emit('open', 'room-a');
    expect(states.at(-1)).toBe('online');

    peer.disconnect();
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.SIGNALING_RETRY_DELAYS_MS[0]);
    expect(peer.calls.filter((c) => c === 'reconnect')).toHaveLength(2);
  });

  it('stops retrying when someone else took the room id', async () => {
    vi.useFakeTimers();
    const { peer, states } = await openFakeHost();
    peer.disconnect();
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.SIGNALING_RETRY_DELAYS_MS[0]);
    peer.emit('error', { type: 'unavailable-id' });
    peer.disconnect();
    expect(states.at(-1)).toBe('id_taken');

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(peer.calls.filter((c) => c === 'reconnect')).toHaveLength(1);
  });

  it('other errors after opening still reach onError', async () => {
    const { peer, errors } = await openFakeHost();
    peer.emit('error', { type: 'browser-incompatible', message: 'x' });
    expect(errors).toHaveLength(1);
  });
});

describe('PeerJsTransport signaling (guest)', () => {
  it('leaves the signaling server once connected to the host', async () => {
    window.Peer = FakePeer;
    const transport = new PeerJsTransport();
    const joined = transport.connectGuest('room-a');
    const peer = FakePeer.created.at(-1);
    peer.emit('open');
    peer.conn.emit('open');
    await joined;
    expect(peer.calls).toEqual(['disconnect']);
    expect(peer.destroyed).toBe(false);
  });

  it('a missing room explains that recruiting may be stopped', async () => {
    window.Peer = FakePeer;
    const joined = new PeerJsTransport().connectGuest('room-a');
    FakePeer.created.at(-1).emit('error', { type: 'peer-unavailable' });
    await expect(joined).rejects.toThrow('募集停止中');
  });

  it('describeJoinError maps signaling failures and keeps other errors', () => {
    expect(describeJoinError({ type: 'network' }).message).toContain('仲介サーバー');
    const other = new Error('boom');
    expect(describeJoinError(other)).toBe(other);
  });
});
