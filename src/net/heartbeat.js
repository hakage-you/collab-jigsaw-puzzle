/**
 * Liveness check between host and guests (both directions).
 *
 * A peer that vanishes (tab killed, network lost, IP changed) may never close its WebRTC
 * connection cleanly, so each side pings the other on a timer and gives up on a peer that has
 * not answered a ping for HEARTBEAT_TIMEOUT_MS. Any message counts as an answer.
 *
 * The timeout runs from the first unanswered ping, not from the last message: a background tab
 * whose timers are throttled pings less often but is never mistaken for a lost peer.
 */
import { MULTIPLAYER_CONFIG } from '../config/constants.js';

export class PeerLiveness {
  /**
   * @param {object} deps
   * @param {(id: string) => void} deps.ping sends a ping to one peer
   * @param {(id: string) => void} deps.onLost called once for a peer that stopped answering
   * @param {() => string[]} deps.listPeers peers to watch right now
   * @param {() => number} [deps.now]
   */
  constructor(deps) {
    this.deps = deps;
    this.now = deps.now || (() => performance.now());
    this.awaitingSince = new Map();
    this.timer = null;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick(), MULTIPLAYER_CONFIG.HEARTBEAT_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.awaitingSince.clear();
  }

  /** Any message from the peer proves it is alive. */
  seen(id) {
    this.awaitingSince.delete(id);
  }

  forget(id) {
    this.awaitingSince.delete(id);
  }

  tick() {
    const now = this.now();
    const peers = this.deps.listPeers();
    for (const id of this.awaitingSince.keys()) {
      if (!peers.includes(id)) this.awaitingSince.delete(id);
    }
    for (const id of peers) {
      const since = this.awaitingSince.get(id);
      if (since === undefined) {
        this.awaitingSince.set(id, now);
        this.deps.ping(id);
      } else if (now - since > MULTIPLAYER_CONFIG.HEARTBEAT_TIMEOUT_MS) {
        this.awaitingSince.delete(id);
        this.deps.onLost(id);
      }
    }
  }
}
