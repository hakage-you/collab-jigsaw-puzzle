/**
 * PeerJS WebRTC P2P Star Transport (Host <-> Guests 1..7).
 */
import { MULTIPLAYER_CONFIG } from '../config/constants.js';

// STUN only: never relay game data through a TURN server (see MULTIPLAYER_CONFIG.ICE_SERVERS).
const PEER_OPTIONS = { debug: 0, config: { iceServers: MULTIPLAYER_CONFIG.ICE_SERVERS } };

// Errors about the signaling server connection. After the room is open these are handled by
// re-registering (host) and must not reach the player as error toasts.
const SIGNALING_ERROR_TYPES = new Set([
  'network',
  'server-error',
  'socket-error',
  'socket-closed',
  'disconnected',
]);

/** Turns a PeerJS join failure into a message the guest can act on. */
export function describeJoinError(err) {
  if (err?.type === 'peer-unavailable') {
    return new Error('部屋に入れません。満席か募集停止中、または部屋が閉じられています');
  }
  if (SIGNALING_ERROR_TYPES.has(err?.type)) {
    return new Error('仲介サーバーに接続できません。時間をおいて再度お試しください');
  }
  return err instanceof Error ? err : new Error('接続に失敗しました');
}

export class PeerJsTransport {
  constructor() {
    this.peer = null;
    this.connections = new Map(); // connId -> DataConnection
    this.hostConn = null;
    this.isHost = false;

    this.onConnect = () => {};
    this.onDisconnect = () => {};
    this.onMessage = () => {};
    this.onError = () => {};
    // Host only: 'online' | 'paused' | 'reconnecting' | 'offline' | 'id_taken'.
    this.onSignalingChange = () => {};

    this.wantSignaling = false;
    this.hostReady = false;
    this.idTaken = false;
    this.retryIndex = 0;
    this.retryTimer = null;
  }

  _getPeerConstructor() {
    if (typeof window !== 'undefined' && typeof window.Peer === 'function') {
      return window.Peer;
    }
    if (typeof globalThis.Peer === 'function') {
      return globalThis.Peer;
    }
    throw new Error('PeerJSライブラリが読み込まれていません');
  }

  openHost(roomId) {
    this.close();
    this.isHost = true;
    const PeerCtor = this._getPeerConstructor();

    return new Promise((resolve, reject) => {
      const peer = new PeerCtor(roomId, PEER_OPTIONS);
      this.peer = peer;
      let settled = false;

      this.wantSignaling = true;
      this.hostReady = false;
      this.idTaken = false;
      this.retryIndex = 0;

      peer.on('open', (id) => {
        this.retryIndex = 0;
        this.hostReady = true;
        if (!settled) {
          settled = true;
          resolve(id);
        }
        this.onSignalingChange('online');
      });

      peer.on('disconnected', () => this._onSignalingLost(peer));

      peer.on('connection', (conn) => {
        const connId = conn.peer;
        conn.on('open', () => {
          this.connections.set(connId, conn);
          this.onConnect(connId);
        });
        conn.on('data', (data) => {
          this.onMessage(connId, data);
        });
        conn.on('close', () => {
          this.connections.delete(connId);
          this.onDisconnect(connId);
        });
        conn.on('error', (err) => {
          this.onError(err);
        });
      });

      peer.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        } else if (err?.type === 'unavailable-id') {
          // Someone else registered the room id while we were away: do not keep retrying.
          this.idTaken = true;
        } else if (!SIGNALING_ERROR_TYPES.has(err?.type)) {
          this.onError(err);
        }
      });
    });
  }

  /**
   * Host: registers on (true) or leaves (false) the signaling server. Players already in the
   * room are connected directly and are not affected either way.
   */
  setAcceptingJoins(accepting) {
    this.wantSignaling = accepting;
    const peer = this.peer;
    if (!this.isHost || !peer || peer.destroyed) return;
    this._clearRetry();
    if (!accepting) {
      if (peer.disconnected) this.onSignalingChange('paused');
      else peer.disconnect();
      return;
    }
    if (peer.disconnected) {
      this.idTaken = false;
      this.retryIndex = 0;
      this._reconnectSignaling(peer);
    }
  }

  /** Host: try to re-register right away (manual retry after giving up). */
  retrySignaling() {
    this.setAcceptingJoins(true);
  }

  _onSignalingLost(peer) {
    // Failures before the room first opened are reported by openHost() itself.
    if (peer !== this.peer || peer.destroyed || !this.hostReady) return;
    if (!this.wantSignaling) {
      this.onSignalingChange('paused');
      return;
    }
    if (this.idTaken) {
      this.onSignalingChange('id_taken');
      return;
    }
    const delays = MULTIPLAYER_CONFIG.SIGNALING_RETRY_DELAYS_MS;
    if (this.retryIndex >= delays.length) {
      this.onSignalingChange('offline');
      return;
    }
    this.onSignalingChange('reconnecting');
    this._clearRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._reconnectSignaling(peer);
    }, delays[this.retryIndex]);
    this.retryIndex += 1;
  }

  _reconnectSignaling(peer) {
    if (peer !== this.peer || peer.destroyed || !peer.disconnected) return;
    this.onSignalingChange('reconnecting');
    peer.reconnect();
  }

  _clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  connectGuest(roomId) {
    this.close();
    this.isHost = false;
    const PeerCtor = this._getPeerConstructor();

    return new Promise((resolve, reject) => {
      const peer = new PeerCtor(PEER_OPTIONS);
      this.peer = peer;
      let settled = false;

      const fail = (err) => {
        if (!settled) {
          settled = true;
          reject(describeJoinError(err));
        } else if (!SIGNALING_ERROR_TYPES.has(err?.type)) {
          this.onError(err);
        }
      };

      peer.on('open', () => {
        const conn = peer.connect(roomId, { reliable: true });
        this.hostConn = conn;
        const timer = setTimeout(() => {
          fail(
            new Error(
              'ホストへの接続がタイムアウトしました（回線の組み合わせによっては直接接続できないことがあります）',
            ),
          );
        }, 12000);

        conn.on('open', () => {
          clearTimeout(timer);
          settled = true;
          // Connected directly to the host: the signaling server is no longer needed.
          peer.disconnect();
          this.onConnect(roomId);
          resolve(roomId);
        });
        conn.on('data', (data) => {
          this.onMessage(roomId, data);
        });
        conn.on('close', () => {
          this.hostConn = null;
          this.onDisconnect(roomId);
        });
        conn.on('error', (err) => {
          clearTimeout(timer);
          fail(err);
        });
      });

      peer.on('error', fail);
    });
  }

  sendTo(connId, msg) {
    const conn = this.connections.get(connId);
    if (conn && conn.open) {
      conn.send(msg);
    }
  }

  broadcast(msg, excludeConnId = null) {
    for (const [connId, conn] of this.connections.entries()) {
      if (connId !== excludeConnId && conn.open) {
        conn.send(msg);
      }
    }
  }

  sendToHost(msg) {
    if (this.hostConn && this.hostConn.open) {
      this.hostConn.send(msg);
    }
  }

  disconnect(connId) {
    const conn = this.connections.get(connId);
    if (conn) {
      this.connections.delete(connId);
      try {
        conn.close();
      } catch {
        // Ignore close errors
      }
      this.onDisconnect(connId);
    }
  }

  close() {
    this.wantSignaling = false;
    this.hostReady = false;
    this._clearRetry();
    for (const conn of this.connections.values()) {
      try {
        conn.close();
      } catch {
        // Ignore
      }
    }
    this.connections.clear();
    if (this.hostConn) {
      try {
        this.hostConn.close();
      } catch {
        // Ignore
      }
      this.hostConn = null;
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // Ignore
      }
      this.peer = null;
    }
  }
}
