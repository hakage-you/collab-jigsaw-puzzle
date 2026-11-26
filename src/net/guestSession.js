import { NET_LIMITS } from '../config/constants.js';
import {
  generateSampleImageCanvas,
  getSamplePreset,
  loadSampleImageCanvas,
  normalizeSampleImageId,
} from '../services/sampleImage.js';
import { validateSaveData } from '../core/saveValidation.js';
import { recordDiagnostic } from '../services/diagnostics.js';
import { MSG, computeChallengeHash } from './protocol.js';
import { HOST_TRANSFER_TYPES, sanitizeHostMessage } from './hostMessageGuard.js';
import { decodeBase64ToCanvas } from './imageTransfer.js';
import { REALTIME_HANDLERS, isRollbackFor } from './guestSyncHandlers.js';
import { PeerLiveness } from './heartbeat.js';

const HOST_LOST_REASON = 'ホストからの応答が途絶えたため切断しました';
const IMAGE_REJECTED_REASON = 'ホストから受信した画像が不正なため切断しました';
const FULL_STATE_REJECTED_REASON = 'ホストの盤面データが不正なため切断しました';
const FULL_STATE_TYPES = new Set([MSG.FULL_STATE, MSG.FULL_STATE_CHUNK]);

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
  [MSG.PING, (session) => session.room.transport?.sendToHost({ type: MSG.PONG })],
  [MSG.PONG, () => {}],
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
    this.welcomeSeq = 0;
    this.pendingGroupOpSeq = new Map();
    // A host that stops answering pings is treated as gone.
    this.liveness = new PeerLiveness({
      ping: () => this.room.transport?.sendToHost({ type: MSG.PING }),
      onLost: () => this._onHostLost(),
      listPeers: () => (this.room.role === 'guest' && this.room.transport ? ['host'] : []),
    });
  }

  startHeartbeat() {
    this.liveness.start();
  }

  _onHostLost() {
    const room = this.room;
    if (room.role !== 'guest') return;
    recordDiagnostic('p2p', 'host_timed_out', { reason: 'no_heartbeat' }, 'warn');
    room.close();
    room.cb.onDisconnected(HOST_LOST_REASON);
  }

  reset() {
    this.liveness.stop();
    this.optimisticRollback = null;
    this.incomingImage = null;
    this.pendingFullState = null;
    this.guestPasscode = '';
    this.guestDisplayName = '';
    this.localOpSeq = 0;
    this.welcomeSeq += 1;
    this.pendingGroupOpSeq.clear();
  }

  configure({ displayName, passcode = '' }) {
    this.guestDisplayName = displayName.trim() || 'ゲスト';
    this.guestPasscode = passcode;
    this.incomingImage = null;
    this.pendingFullState = null;
    this.optimisticRollback = null;
    this.localOpSeq = 0;
    this.welcomeSeq += 1;
    this.pendingGroupOpSeq.clear();
  }

  /** Every host message passes the guard first; handlers only ever see the sanitized copy. */
  async onMessage(msg) {
    this.liveness.seen('host');
    const clean = sanitizeHostMessage(msg);
    if (!clean) {
      if (HOST_TRANSFER_TYPES.has(msg?.type)) this._failTransfer(msg.type, 'invalid_message');
      return;
    }
    const handler = GUEST_HANDLERS.get(clean.type);
    if (handler) await handler(this, clean);
  }

  /**
   * A broken or hostile host transfer ends the join: discard the partial transfer, leave the
   * room and report it. Only the type and a short reason are logged.
   */
  _failTransfer(type, reason) {
    const room = this.room;
    if (room.role !== 'guest') return;
    recordDiagnostic('p2p', 'host_transfer_rejected', { type, reason }, 'warn');
    const message = FULL_STATE_TYPES.has(type) ? FULL_STATE_REJECTED_REASON : IMAGE_REJECTED_REASON;
    this.incomingImage = null;
    this.pendingFullState = null;
    room.close();
    room.cb.onDisconnected(message);
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
    room.cb.onAuthRejected(reason, { kicked: msg.type === MSG.KICKED });
  }

  _handleImageStart(msg) {
    this.incomingImage = {
      totalChunks: msg.totalChunks,
      chunks: new Array(msg.totalChunks),
      received: 0,
      mimeType: msg.mimeType,
    };
    this.room.cb.onImageProgress(0, msg.totalChunks);
  }

  _handleFullState(msg) {
    if (msg.totalPieceChunks && msg.totalPieceChunks > 1) {
      this.pendingFullState = {
        msg,
        chunks: new Array(msg.totalPieceChunks),
        received: 0,
        pieceCount: 0,
      };
      return;
    }
    this._applyFullState(msg, msg.saveData);
  }

  _handleFullStateChunk(msg) {
    const pending = this.pendingFullState;
    if (!pending) return;
    if (msg.chunkIndex >= pending.msg.totalPieceChunks) {
      this._failTransfer(MSG.FULL_STATE_CHUNK, 'index_out_of_range');
      return;
    }
    if (pending.chunks[msg.chunkIndex] === undefined) {
      pending.chunks[msg.chunkIndex] = msg.pieces;
      pending.received += 1;
      pending.pieceCount += msg.pieces.length;
    }
    if (pending.pieceCount > NET_LIMITS.MAX_PIECES) {
      this._failTransfer(MSG.FULL_STATE_CHUNK, 'too_many_pieces');
      return;
    }
    if (pending.received >= pending.msg.totalPieceChunks) {
      const mergedPieces = [].concat(...pending.chunks);
      const fullSaveData = { ...pending.msg.saveData, pieces: mergedPieces };
      const headerMsg = pending.msg;
      this.pendingFullState = null;
      this._applyFullState(headerMsg, fullSaveData);
    }
  }

  _applyFullState(msg, rawSaveData) {
    const room = this.room;
    const { sourceCanvas, isSampleImage } = room.getSourceState();
    if (!sourceCanvas) return;
    const checked = validateSaveData(rawSaveData);
    if (!checked.ok) {
      // A host state we cannot trust is treated as a failed sync: leave the room and report it.
      recordDiagnostic('p2p', 'guest_invalid_full_state', { reason: checked.error }, 'warn');
      room.close();
      room.cb.onDisconnected(FULL_STATE_REJECTED_REASON);
      return;
    }
    const saveData = checked.data;
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
    const seq = ++this.welcomeSeq;
    this.incomingImage = null;
    this.pendingFullState = null;
    this.optimisticRollback = null;
    this.pendingGroupOpSeq.clear();
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
      const sampleId = normalizeSampleImageId(msg.sampleImageId);
      const preset = getSamplePreset(sampleId);
      if (preset.kind === 'artwork') {
        loadSampleImageCanvas(sampleId).then((sampleCanvas) => {
          if (room.role !== 'guest' || this.welcomeSeq !== seq) return;
          room.cb.onReceiveImage(sampleCanvas, preset.name, true, sampleId);
          room.transport.sendToHost({ type: MSG.IMAGE_ACK, needImage: false });
        });
      } else {
        const sampleCanvas = generateSampleImageCanvas(undefined, undefined, sampleId);
        room.cb.onReceiveImage(sampleCanvas, preset.name, true, sampleId);
        room.transport.sendToHost({ type: MSG.IMAGE_ACK, needImage: false });
      }
      return;
    }

    const { sourceCanvas, isSampleImage } = room.getSourceState();
    const sameHash = !isSampleImage && sourceCanvas && room.engine.imageHash === msg.imageHash;
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
    const image = this.incomingImage;
    if (msg.index >= image.totalChunks) {
      this._failTransfer(MSG.IMAGE_CHUNK, 'index_out_of_range');
      return;
    }
    if (image.chunks[msg.index] === undefined) {
      image.chunks[msg.index] = msg.data;
      image.received += 1;
      room.cb.onImageProgress(image.received, image.totalChunks);
    }
    if (image.received >= image.totalChunks) {
      const fullBase64 = image.chunks.join('');
      this.incomingImage = null;
      let decodedCanvas;
      try {
        decodedCanvas = await decodeBase64ToCanvas(fullBase64, image.mimeType);
      } catch (err) {
        this._failTransfer(MSG.IMAGE_CHUNK, err?.reason || 'decode_failed');
        return;
      }
      room.cb.onReceiveImage(decodedCanvas, 'ホスト共有画像', false);
      room.transport.sendToHost({ type: MSG.IMAGE_ACK, needImage: false });
    }
  }

  requestLock(groupId, from = null) {
    const group = this.room.engine.getGroupPieces(groupId);
    this.optimisticRollback = {
      groupId,
      snapshot: group.map((p) => ({ id: p.id, x: p.x, y: p.y })),
    };
    this.room.groupLocks.set(groupId, this.room.myPlayerId);
    const msg = { type: MSG.LOCK_REQUEST, groupId };
    if (from) Object.assign(msg, { x: from.x, y: from.y });
    this.room.transport?.sendToHost(msg);
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

  hasSavedSession(roomId) {
    return Boolean(this._readSession(roomId)?.reconnectToken);
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
