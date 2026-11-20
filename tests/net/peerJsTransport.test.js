import { afterEach, describe, expect, it } from 'vitest';
import { PeerJsTransport } from '../../src/net/peerJsTransport.js';

// Fake PeerJS constructor that records the options it is given; no network is touched.
class FakePeer {
  static created = [];

  constructor(idOrOptions, maybeOptions) {
    this.options = typeof idOrOptions === 'object' ? idOrOptions : maybeOptions;
    this.handlers = {};
    FakePeer.created.push(this);
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  destroy() {}
}

const originalPeer = window.Peer;

afterEach(() => {
  window.Peer = originalPeer;
  FakePeer.created = [];
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
