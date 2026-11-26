// In-memory star network with the same interface as src/net/localChannelTransport.js, for Node
// tests of the real RoomController / HostSession / GuestSession (tests/net/*Session*.node.test.js).
// Messages are queued and delivered only when the test calls flush(), so a test decides what
// each side has heard: two guests can both act before the host hears either of them.
// Every message is copied with structuredClone, as it would be serialized on the wire.

/**
 * Creates one network. Tests install the shared one (memoryNetwork below) with vi.mock on
 * src/net/transport.js so createTransport() returns memoryNetwork.createTransport().
 */
function createMemoryNetwork() {
  /** roomId -> host transport */
  const hosts = new Map();
  /** Deliveries waiting for flush(), in send order. */
  const queue = [];
  let nextConnId = 1;
  /** Every message sent, in order: { from, to, msg } ('host' or a connId). For debugging. */
  const log = [];

  const send = (from, to, deliver, msg) => {
    const copy = structuredClone(msg);
    log.push({ from, to, msg: copy });
    queue.push(() => deliver(copy));
  };

  class MemoryTransport {
    constructor() {
      this.isHost = false;
      this.roomId = null;
      this.acceptingJoins = true;
      /** Host: connId -> guest transport. */
      this.peers = new Map();
      /** Guest: its connection id on the host, while connected. */
      this.connId = null;
      this.host = null;
      this.onConnect = () => {};
      this.onDisconnect = () => {};
      this.onMessage = () => {};
      this.onError = () => {};
      this.onSignalingChange = () => {};
    }

    openHost(roomId) {
      this.close();
      this.isHost = true;
      this.roomId = roomId;
      this.acceptingJoins = true;
      hosts.set(roomId, this);
      queueMicrotask(() => this.onSignalingChange('online'));
      return Promise.resolve(roomId);
    }

    setAcceptingJoins(accepting) {
      if (!this.isHost) return;
      this.acceptingJoins = accepting;
      this.onSignalingChange(accepting ? 'online' : 'paused');
    }

    retrySignaling() {
      this.setAcceptingJoins(true);
    }

    connectGuest(roomId) {
      this.close();
      this.roomId = roomId;
      const host = hosts.get(roomId);
      if (!host || !host.acceptingJoins) {
        return Promise.reject(new Error('部屋に入れません（テスト用の通信）'));
      }
      const connId = `conn-${nextConnId++}`;
      this.connId = connId;
      this.host = host;
      host.peers.set(connId, this);
      host.onConnect(connId);
      this.onConnect(roomId);
      return Promise.resolve(roomId);
    }

    sendTo(connId, msg) {
      const guest = this.peers.get(connId);
      if (!guest) return;
      send(
        'host',
        connId,
        (copy) => guest.connId === connId && guest.onMessage(this.roomId, copy),
        msg,
      );
    }

    broadcast(msg, excludeConnId = null) {
      for (const connId of this.peers.keys()) {
        if (connId !== excludeConnId) this.sendTo(connId, msg);
      }
    }

    sendToHost(msg) {
      const { host, connId } = this;
      if (!host || !connId) return;
      send(connId, 'host', (copy) => host.peers.has(connId) && host.onMessage(connId, copy), msg);
    }

    /** Host: closes one guest's connection; the guest hears it after the messages before it. */
    disconnect(connId) {
      const guest = this.peers.get(connId);
      if (!guest) return;
      this.peers.delete(connId);
      queue.push(() => guest._lost(connId));
      this.onDisconnect(connId);
    }

    /** Guest side of a closed connection. */
    _lost(connId) {
      if (this.connId !== connId) return;
      this.connId = null;
      this.host = null;
      this.onDisconnect(this.roomId);
    }

    close() {
      if (this.isHost) {
        if (hosts.get(this.roomId) === this) hosts.delete(this.roomId);
        for (const [connId, guest] of this.peers) queue.push(() => guest._lost(connId));
        this.peers.clear();
        this.isHost = false;
      } else if (this.host && this.connId) {
        const { host, connId } = this;
        queue.push(() => {
          if (host.peers.delete(connId)) host.onDisconnect(connId);
        });
      }
      this.connId = null;
      this.host = null;
    }
  }

  /**
   * Cuts a guest's link without either side saying goodbye (a dropped network). Both sides hear
   * the transport close on the next flush.
   */
  function dropLink(guestTransport) {
    const { host, connId } = guestTransport;
    if (!host || !connId) return;
    queue.push(() => {
      if (host.peers.delete(connId)) host.onDisconnect(connId);
      guestTransport._lost(connId);
    });
  }

  /**
   * Delivers queued messages, and the ones they cause, until nothing is left. Async handlers only
   * wait on promises here (crypto.subtle is removed in nodeRoom.js), so draining microtasks
   * between rounds is enough.
   */
  async function flush({ maxRounds = 1000 } = {}) {
    for (let round = 0; ; round++) {
      // eslint-disable-next-line no-await-in-loop -- let async handlers finish before the next round
      for (let i = 0; i < 20; i++) await Promise.resolve();
      if (queue.length === 0) return;
      if (round >= maxRounds) throw new Error('flush: messages keep coming');
      for (const deliver of queue.splice(0)) deliver();
    }
  }

  /** Delivers only the deliveries queued so far (one hop), without the ones they cause. */
  function deliverQueued() {
    for (const deliver of queue.splice(0)) deliver();
  }

  function reset() {
    hosts.clear();
    queue.length = 0;
    log.length = 0;
    nextConnId = 1;
  }

  return {
    createTransport: () => new MemoryTransport(),
    flush,
    deliverQueued,
    dropLink,
    reset,
    log,
    /** Messages of one type sent so far, as { from, to, msg }. */
    sentOf: (type) => log.filter((entry) => entry.msg.type === type),
    /** Number of deliveries waiting. */
    pending: () => queue.length,
  };
}

/** The network the node session tests share (vi.mock factories import it). */
export const memoryNetwork = createMemoryNetwork();
