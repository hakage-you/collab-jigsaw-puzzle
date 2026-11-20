/**
 * BroadcastChannel-based Star Transport for offline multi-tab E2E testing (?transport=local).
 */

function makeClientId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `lc-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export class LocalChannelTransport {
  constructor() {
    this.channel = null;
    this.clientId = makeClientId();
    this.roomId = null;
    this.isHost = false;
    this.connectedPeers = new Set();
    this._unloadHandler = null;

    this.onConnect = () => {};
    this.onDisconnect = () => {};
    this.onMessage = () => {};
    this.onError = () => {};
  }

  openHost(roomId) {
    this.close();
    this.isHost = true;
    this.roomId = roomId;
    this.channel = new BroadcastChannel(`collab_jigsaw_room_${roomId}`);

    this.channel.onmessage = (evt) => {
      const frame = evt.data;
      if (!frame || typeof frame !== 'object') return;
      if (frame.to && frame.to !== this.clientId && frame.to !== 'host') return;

      if (frame.kind === 'lc_connect') {
        this.connectedPeers.add(frame.from);
        this.channel.postMessage({ kind: 'lc_accept', from: this.clientId, to: frame.from });
        this.onConnect(frame.from);
      } else if (frame.kind === 'lc_bye') {
        if (this.connectedPeers.has(frame.from)) {
          this.connectedPeers.delete(frame.from);
          this.onDisconnect(frame.from);
        }
      } else if (frame.kind === 'lc_msg') {
        if (this.connectedPeers.has(frame.from)) {
          this.onMessage(frame.from, frame.payload);
        }
      }
    };

    this._unloadHandler = () => {
      if (this.channel) {
        this.channel.postMessage({ kind: 'lc_host_closed', from: this.clientId });
      }
    };
    window.addEventListener('pagehide', this._unloadHandler);

    return Promise.resolve(roomId);
  }

  connectGuest(roomId) {
    this.close();
    this.isHost = false;
    this.roomId = roomId;
    this.channel = new BroadcastChannel(`collab_jigsaw_room_${roomId}`);

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.close();
          reject(
            new Error('ローカル通信ホストが見つかりません（同一ブラウザで部屋を作成してください）'),
          );
        }
      }, 4000);

      this.channel.onmessage = (evt) => {
        const frame = evt.data;
        if (!frame || typeof frame !== 'object') return;
        if (frame.to && frame.to !== this.clientId) return;

        if (frame.kind === 'lc_accept' && !settled) {
          clearTimeout(timer);
          settled = true;
          this.onConnect(roomId);
          resolve(roomId);
        } else if (frame.kind === 'lc_host_closed' || frame.kind === 'lc_kick') {
          this.onDisconnect(roomId);
          this.close();
        } else if (frame.kind === 'lc_msg') {
          this.onMessage(roomId, frame.payload);
        }
      };

      this._unloadHandler = () => {
        if (this.channel) {
          this.channel.postMessage({ kind: 'lc_bye', from: this.clientId, to: 'host' });
        }
      };
      window.addEventListener('pagehide', this._unloadHandler);

      this.channel.postMessage({ kind: 'lc_connect', from: this.clientId, to: 'host' });
    });
  }

  sendTo(connId, msg) {
    if (!this.channel || !this.connectedPeers.has(connId)) return;
    this.channel.postMessage({ kind: 'lc_msg', from: this.clientId, to: connId, payload: msg });
  }

  broadcast(msg, excludeConnId = null) {
    if (!this.channel) return;
    for (const connId of this.connectedPeers) {
      if (connId !== excludeConnId) {
        this.channel.postMessage({ kind: 'lc_msg', from: this.clientId, to: connId, payload: msg });
      }
    }
  }

  sendToHost(msg) {
    if (!this.channel) return;
    this.channel.postMessage({ kind: 'lc_msg', from: this.clientId, to: 'host', payload: msg });
  }

  disconnect(connId) {
    if (this.connectedPeers.has(connId)) {
      this.connectedPeers.delete(connId);
      if (this.channel) {
        this.channel.postMessage({ kind: 'lc_kick', from: this.clientId, to: connId });
      }
      this.onDisconnect(connId);
    }
  }

  close() {
    if (this._unloadHandler) {
      window.removeEventListener('pagehide', this._unloadHandler);
      this._unloadHandler = null;
    }
    if (this.channel) {
      if (!this.isHost) {
        try {
          this.channel.postMessage({ kind: 'lc_bye', from: this.clientId, to: 'host' });
        } catch {
          // Ignore
        }
      }
      this.channel.close();
      this.channel = null;
    }
    this.connectedPeers.clear();
  }
}
