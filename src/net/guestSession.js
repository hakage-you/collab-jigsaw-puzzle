import { generateSampleImageCanvas } from '../core/sampleImage.js';
import { recordDiagnostic } from '../services/diagnostics.js';
import { MSG, computeChallengeHash, isValidMessage } from './protocol.js';
import { decodeBase64ToCanvas } from './imageTransfer.js';

export class GuestSession {
  constructor(room) {
    this.room = room;
    this.optimisticRollback = null;
    this.incomingImage = null;
    this.pendingFullState = null;
    this.guestPasscode = '';
    this.guestDisplayName = '';
  }

  reset() {
    this.optimisticRollback = null;
    this.incomingImage = null;
    this.pendingFullState = null;
    this.guestPasscode = '';
    this.guestDisplayName = '';
  }

  configure({ displayName, passcode = '' }) {
    this.guestDisplayName = displayName.trim() || 'ゲスト';
    this.guestPasscode = passcode;
    this.incomingImage = null;
    this.pendingFullState = null;
    this.optimisticRollback = null;
  }

  async onMessage(msg) {
    if (!isValidMessage(msg)) return;
    const room = this.room;

    if (msg.type === MSG.AUTH_CHALLENGE) {
      const savedSession = this._readSession(room.roomId);
      if (savedSession?.playerId && savedSession?.reconnectToken) {
        room.transport.sendToHost({
          type: MSG.REJOIN,
          playerId: savedSession.playerId,
          reconnectToken: savedSession.reconnectToken,
          displayName: this.guestDisplayName,
        });
        return;
      }
      const hash = await computeChallengeHash(msg.nonce, this.guestPasscode);
      room.transport.sendToHost({
        type: MSG.AUTH_RESPONSE,
        hash,
        displayName: this.guestDisplayName,
      });
      return;
    }

    if (msg.type === MSG.AUTH_ERROR || msg.type === MSG.JOIN_REJECTED || msg.type === MSG.KICKED) {
      if (msg.type === MSG.KICKED || msg.reason?.includes('トークン')) {
        this._clearSession(room.roomId);
      }
      const reason = msg.reason || '接続が拒否されました';
      recordDiagnostic('p2p', 'guest_rejected', { type: msg.type, reason }, 'warn');
      room.close();
      room.cb.onAuthRejected(reason);
      return;
    }

    if (msg.type === MSG.KNOCK_PENDING) {
      room.cb.onGuestStatus('ホストの入室承認を待っています...');
      return;
    }

    if (msg.type === MSG.WELCOME) {
      this._handleWelcome(msg);
      return;
    }

    if (msg.type === MSG.IMAGE_START) {
      this.incomingImage = {
        totalChunks: msg.totalChunks,
        chunks: new Array(msg.totalChunks),
        received: 0,
        mimeType: msg.mimeType || 'image/webp',
      };
      room.cb.onImageProgress(0, msg.totalChunks);
      return;
    }

    if (msg.type === MSG.IMAGE_CHUNK && this.incomingImage) {
      await this._handleImageChunk(msg);
      return;
    }

    if (msg.type === MSG.FULL_STATE) {
      if (msg.totalPieceChunks && msg.totalPieceChunks > 1) {
        this.pendingFullState = {
          msg,
          chunks: new Array(msg.totalPieceChunks),
          received: 0,
        };
        return;
      }
      this._applyFullState(msg, msg.saveData);
      return;
    }

    if (msg.type === MSG.FULL_STATE_CHUNK && this.pendingFullState) {
      const pending = this.pendingFullState;
      if (pending.chunks[msg.chunkIndex] === undefined && Array.isArray(msg.pieces)) {
        pending.chunks[msg.chunkIndex] = msg.pieces;
        pending.received += 1;
      }
      if (pending.received >= pending.msg.totalPieceChunks) {
        const mergedPieces = [].concat(...pending.chunks);
        const fullSaveData = { ...pending.msg.saveData, pieces: mergedPieces };
        const headerMsg = pending.msg;
        this.pendingFullState = null;
        this._applyFullState(headerMsg, fullSaveData);
      }
      return;
    }

    if (msg.type === MSG.ROSTER_UPDATE) {
      room.roster = msg.roster || [];
      room.cb.onRosterUpdate(room.roster);
      return;
    }

    this._handleRealtimeSyncMessage(msg);
  }

  _applyFullState(msg, saveData) {
    const room = this.room;
    const { sourceCanvas, isSampleImage } = room.getSourceState();
    if (!sourceCanvas) return;
    room.roomRules = msg.roomRules;
    room.groupLocks = new Map(msg.locks || []);
    room.remoteDragTargets.clear();
    room.roster = msg.roster || [];
    room.engine.restoreFromSave(saveData, sourceCanvas, isSampleImage);
    room.engine.zoneLabels = msg.zoneLabels || [];
    room.cb.onFullStateSynced({ roomRules: msg.roomRules, roster: room.roster });
  }

  _handleWelcome(msg) {
    const room = this.room;
    room.myPlayerId = msg.playerId;
    room.myColor = msg.color;
    room.roomRules = msg.roomRules;
    room.roster = msg.roster || [];
    this._saveSession(room.roomId, msg.playerId, msg.reconnectToken);
    room.cb.onGuestAdmitted({
      playerId: msg.playerId,
      color: msg.color,
      roomRules: msg.roomRules,
      roster: room.roster,
    });

    if (msg.isSampleImage) {
      const sampleCanvas = generateSampleImageCanvas();
      room.cb.onReceiveImage(sampleCanvas, 'サンプルテスト画像', true);
      room.transport.sendToHost({ type: MSG.IMAGE_ACK, needImage: false });
      return;
    }

    const { sourceCanvas } = room.getSourceState();
    const sameHash = sourceCanvas && room.engine.imageHash === msg.imageHash;
    if (sameHash) {
      room.transport.sendToHost({ type: MSG.IMAGE_ACK, needImage: false });
      return;
    }

    this.incomingImage = {
      totalChunks: msg.totalChunks || 0,
      chunks: [],
      received: 0,
      mimeType: 'image/webp',
    };
    room.cb.onGuestStatus('ホストから画像を受信中...');
    room.transport.sendToHost({ type: MSG.IMAGE_ACK, needImage: true });
  }

  async _handleImageChunk(msg) {
    const room = this.room;
    if (this.incomingImage.chunks[msg.index] === undefined) {
      this.incomingImage.chunks[msg.index] = msg.data;
      this.incomingImage.received += 1;
      room.cb.onImageProgress(this.incomingImage.received, this.incomingImage.totalChunks);
    }
    if (this.incomingImage.received >= this.incomingImage.totalChunks) {
      const fullBase64 = this.incomingImage.chunks.join('');
      const mimeType = this.incomingImage.mimeType;
      this.incomingImage = null;
      try {
        const decodedCanvas = await decodeBase64ToCanvas(fullBase64, mimeType);
        room.cb.onReceiveImage(decodedCanvas, 'ホスト共有画像', false);
        room.transport.sendToHost({ type: MSG.IMAGE_ACK, needImage: false });
      } catch (err) {
        room.cb.onError(err?.message || '画像受信に失敗しました');
      }
    }
  }

  _handleRealtimeSyncMessage(msg) {
    const room = this.room;
    if (msg.type === MSG.CURSOR_MOVE) {
      if (msg.playerId === room.myPlayerId) return;
      const existing = room.remoteCursors.get(msg.playerId);
      if (existing) {
        existing.targetX = msg.x;
        existing.targetY = msg.y;
        existing.name = msg.name;
        existing.color = msg.color;
      } else {
        room.remoteCursors.set(msg.playerId, {
          playerId: msg.playerId,
          x: msg.x,
          y: msg.y,
          targetX: msg.x,
          targetY: msg.y,
          name: msg.name,
          color: msg.color,
        });
      }
      room.cb.onRenderNeeded();
      return;
    }

    if (msg.type === MSG.LOCK_GRANTED) {
      room.groupLocks.set(msg.groupId, msg.ownerId);
      if (typeof msg.zOrder === 'number') {
        for (const p of room.engine.getGroupPieces(msg.groupId)) {
          p.zOrder = msg.zOrder;
        }
        room.engine.maxZ = Math.max(room.engine.maxZ, msg.zOrder + 1);
        room.engine.bumpZVersion();
      }
      if (msg.ownerId === room.myPlayerId && this.optimisticRollback?.groupId === msg.groupId) {
        this.optimisticRollback = null;
      }
      room.cb.onRenderNeeded();
      return;
    }

    if (msg.type === MSG.LOCK_DENIED) {
      if (msg.ownerId) room.groupLocks.set(msg.groupId, msg.ownerId);
      else room.groupLocks.delete(msg.groupId);
      if (Array.isArray(msg.pieces)) {
        room.engine.applyPiecePatches(msg.pieces);
      } else if (this.optimisticRollback?.groupId === msg.groupId) {
        room.applyPositionsOnly(this.optimisticRollback.snapshot);
      }
      this.optimisticRollback = null;
      room.cb.onLockDenied(msg.groupId);
      return;
    }

    if (msg.type === MSG.LOCK_RELEASE) {
      room.groupLocks.delete(msg.groupId);
      room.remoteDragTargets.delete(msg.groupId);
      room.cb.onRenderNeeded();
      return;
    }

    if (msg.type === MSG.DRAG_PREVIEW) {
      if (msg.ownerId === room.myPlayerId || !Array.isArray(msg.positions)) return;
      let targetMap = room.remoteDragTargets.get(msg.groupId);
      if (!targetMap) {
        targetMap = new Map();
        room.remoteDragTargets.set(msg.groupId, targetMap);
      }
      for (const pos of msg.positions) {
        targetMap.set(pos.id, { x: pos.x, y: pos.y });
      }
      room.cb.onRenderNeeded();
      return;
    }

    if (msg.type === MSG.PIECES_PATCH) {
      if (Array.isArray(msg.locks)) room.groupLocks = new Map(msg.locks);
      if (Array.isArray(msg.pieces)) room.engine.applyPiecePatches(msg.pieces);
      if (msg.stats) room.engine.stats = msg.stats;
      if (Array.isArray(msg.zoneLabels)) room.engine.zoneLabels = msg.zoneLabels;
      if (msg.isFinalChunk !== false) {
        room.remoteDragTargets.clear();
        room.cb.onGuestPatchApplied(msg.pieces || [], msg.actionResult, msg.actorId);
      }
      return;
    }

    if (msg.type === MSG.OJAMA_VISUAL) room.cb.onRemoteVisualOjama(msg.visualType, msg.duration);
    else if (msg.type === MSG.OJAMA_VISUAL_CLEAR) room.cb.onRemoteVisualClear();
    else if (msg.type === MSG.OJAMA_SUPERCHAT) room.cb.onRemoteSuperchat(msg);
    else if (msg.type === MSG.SUPERCHAT_STATE) room.cb.onRemoteSuperchatState(msg.hp, msg.maxHp);
    else if (msg.type === MSG.SUPERCHAT_DISMISS) room.cb.onRemoteSuperchatDismiss();
    else if (msg.type === MSG.OJAMA_NOTICE) room.cb.onToast(msg.text, 'ojama');
    else if (msg.type === MSG.PUZZLE_COMPLETED) room.cb.onRemoteCompleted();
  }

  requestLock(groupId) {
    const group = this.room.engine.getGroupPieces(groupId);
    this.optimisticRollback = {
      groupId,
      snapshot: group.map((p) => ({ id: p.id, x: p.x, y: p.y })),
    };
    this.room.groupLocks.set(groupId, this.room.myPlayerId);
    this.room.transport?.sendToHost({ type: MSG.LOCK_REQUEST, groupId });
    return { allowed: true };
  }

  submitDrop(groupId) {
    const positions = this.room.engine
      .getGroupPieces(groupId)
      .map((p) => ({ id: p.id, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }));
    if (this.optimisticRollback?.groupId === groupId) {
      this.optimisticRollback = null;
    }
    this.room.groupLocks.delete(groupId);
    this.room.transport?.sendToHost({ type: MSG.DROP_REQUEST, groupId, positions });
    return { type: 'pending' };
  }

  submitRotate(piece) {
    this.room.transport?.sendToHost({ type: MSG.ROTATE_REQUEST, pieceId: piece.id });
    return false;
  }

  submitFlip(piece) {
    this.room.transport?.sendToHost({ type: MSG.FLIP_REQUEST, pieceId: piece.id });
    return false;
  }

  submitSuperchatHit() {
    this.room.transport?.sendToHost({ type: MSG.SUPERCHAT_HIT });
    return null;
  }

  _readSession(roomId) {
    try {
      const raw = sessionStorage.getItem(`cj_rejoin_${roomId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  _saveSession(roomId, playerId, reconnectToken) {
    try {
      sessionStorage.setItem(`cj_rejoin_${roomId}`, JSON.stringify({ playerId, reconnectToken }));
    } catch {
      // Ignore
    }
  }

  _clearSession(roomId) {
    try {
      sessionStorage.removeItem(`cj_rejoin_${roomId}`);
    } catch {
      // Ignore
    }
  }
}
