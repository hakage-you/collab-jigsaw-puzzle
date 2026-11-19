/**
 * PeerJS WebRTC P2P Star Transport (Host <-> Guests 1..7).
 */

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
      const peer = new PeerCtor(roomId, { debug: 0 });
      this.peer = peer;
      let settled = false;

      peer.on('open', (id) => {
        settled = true;
        resolve(id);
      });

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
        } else {
          this.onError(err);
        }
      });
    });
  }

  connectGuest(roomId) {
    this.close();
    this.isHost = false;
    const PeerCtor = this._getPeerConstructor();

    return new Promise((resolve, reject) => {
      const peer = new PeerCtor({ debug: 0 });
      this.peer = peer;
      let settled = false;

      const fail = (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        } else {
          this.onError(err);
        }
      };

      peer.on('open', () => {
        const conn = peer.connect(roomId, { reliable: true });
        this.hostConn = conn;
        const timer = setTimeout(() => {
          fail(new Error('ホストへの接続がタイムアウトしました'));
        }, 12000);

        conn.on('open', () => {
          clearTimeout(timer);
          settled = true;
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
