import { generateSampleImageCanvas } from '../core/sampleImage.js';
import { recordDiagnostic } from '../services/diagnostics.js';
import { MSG, computeChallengeHash, isValidMessage } from './protocol.js';
import { decodeBase64ToCanvas } from './imageTransfer.js';
import { REALTIME_HANDLERS, isRollbackFor } from './guestSyncHandlers.js';

/** Handlers for session-level messages (auth, welcome, image and full state transfer). */
const SESSION_HANDLERS = new Map([
  [MSG.AUTH_CHALLENGE, (session, msg) => session._handleAuthChallenge(msg)],
  [MSG.AUTH_ERROR, (session, msg) => session._handleRejection(msg)],
  [MSG.JOIN_REJECTED, (session, msg) => session._handleRejection(msg)],
  [MSG.KICKED, (session, msg) => session._handleRejection(msg)],
  [
    MSG.KNOCK_PENDING,
    (session) => session.room.cb.onGuestStatus('ホストの入室承認を待っています...'),
  ],
  [MSG.WELCOME, (session, msg) => session._handleWelcome(msg)],
  [MSG.IMAGE_START, (session, msg) => session._handleImageStart(msg)],
  [
    MSG.IMAGE_CHUNK,
    (session, msg) => (session.incomingImage ? session._handleImageChunk(msg) : null),
  ],
  [MSG.FULL_STATE, (session, msg) => session._handleFullState(msg)],
  [MSG.FULL_STATE_CHUNK, (session, msg) => session._handleFullStateChunk(msg)],
]);

const GUEST_HANDLERS = new Map([...SESSION_HANDLERS, ...REALTIME_HANDLERS]);

export class GuestSession {
  constructor(room) {
    this.room = room;
    this.optimisticRollback = null;
    this.incomingImage = null;
    this.pendingFullState = null;
    this.guestPasscode = '';
    this.guestDisplayName = '';
    this.localOpSeq = 0;
    this.pendingGroupOpSeq = new Map();
  }

  reset() {
    this.optimisticRollback = null;
    this.incomingImage = null;
    this.pendingFullState = null;
    this.guestPasscode = '';
    this.guestDisplayName = '';
    this.localOpSeq = 0;
    this.pendingGroupOpSeq.clear();
  }

  configure({ displayName, passcode = '' }) {
    this.guestDisplayName = displayName.trim() || 'ゲスト';
    this.guestPasscode = passcode;
    this.incomingImage = null;
    this.pendingFullState = null;
    this.optimisticRollback = null;
    this.localOpSeq = 0;
    this.pendingGroupOpSeq.clear();
  }

  async onMessage(msg) {
    if (!isValidMessage(msg)) return;
    const handler = GUEST_HANDLERS.get(msg.type);
    if (handler) await handler(this, msg);
  }

  async _handleAuthChallenge(msg) {
    const room = this.room;
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
  }

  _handleRejection(msg) {
    const room = this.room;
    if (msg.type === MSG.KICKED || msg.reason?.includes('トークン')) {
      this._clearSession(room.roomId);
    }
    const reason = msg.reason || '接続が拒否されました';
    recordDiagnostic('p2p', 'guest_rejected', { type: msg.type, reason }, 'warn');
    room.close();
    room.cb.onAuthRejected(reason);
  }

  _handleImageStart(msg) {
    this.incomingImage = {
      totalChunks: msg.totalChunks,
      chunks: new Array(msg.totalChunks),
      received: 0,
      mimeType: msg.mimeType || 'image/webp',
    };
    this.room.cb.onImageProgress(0, msg.totalChunks);
  }

  _handleFullState(msg) {
    if (msg.totalPieceChunks && msg.totalPieceChunks > 1) {
      this.pendingFullState = {
        msg,
        chunks: new Array(msg.totalPieceChunks),
        received: 0,
      };
      return;
    }
    this._applyFullState(msg, msg.saveData);
  }

  _handleFullStateChunk(msg) {
    const pending = this.pendingFullState;
    if (!pending) return;
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
    if (Array.isArray(msg.fakePieces) && msg.fakePieces.length > 0) {
      room.engine.syncFakePiecesFromSpecs(msg.fakePieces);
      room.cb.onRenderNeeded();
    }
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
    if (isRollbackFor(this, groupId)) {
      this.optimisticRollback = null;
    }
    this.room.groupLocks.delete(groupId);
    this.room.transport?.sendToHost({ type: MSG.DROP_REQUEST, groupId, positions });
    return { type: 'pending' };
  }

  submitRotate(piece, allowRotationSetting = true) {
    if (!this.room.engine.rotateGroup(piece, allowRotationSetting)) {
      return false;
    }
    const opSeq = ++this.localOpSeq;
    this.pendingGroupOpSeq.set(piece.groupId, opSeq);
    this.room.transport?.sendToHost({
      type: MSG.ROTATE_REQUEST,
      pieceId: piece.id,
      opSeq,
    });
    return true;
  }

  submitFlip(piece, allowFlipSetting = true) {
    if (!this.room.engine.flipPiece(piece, allowFlipSetting)) {
      return false;
    }
    const opSeq = ++this.localOpSeq;
    this.pendingGroupOpSeq.set(piece.groupId, opSeq);
    this.room.transport?.sendToHost({
      type: MSG.FLIP_REQUEST,
      pieceId: piece.id,
      opSeq,
    });
    return true;
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
