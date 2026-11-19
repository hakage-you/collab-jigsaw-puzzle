import { MULTIPLAYER_CONFIG } from '../config/constants.js';
import { recordDiagnostic } from '../services/diagnostics.js';
import { saveAutoBackup } from '../services/storage.js';
import { MSG, generateToken, computeChallengeHash, isValidMessage } from './protocol.js';
import {
  serializePieces,
  sendWelcomeToGuest,
  sendImageToGuest,
  sendFullStateToGuest,
  broadcastPiecesPatch,
} from './hostSyncHelper.js';

export class HostSession {
  constructor(room) {
    this.room = room;
    this.passcode = '';
    this.requireApproval = true;
    this.capacity = MULTIPLAYER_CONFIG.DEFAULT_CAPACITY;
    this.pendingAuth = new Map();
    this.pendingKnocks = new Map();
    this.guests = new Map();
    this.connToPlayer = new Map();
    this.hostContrib = 0;
    this.autoBackupTimer = null;
  }

  reset() {
    if (this.autoBackupTimer) {
      clearTimeout(this.autoBackupTimer);
      this.autoBackupTimer = null;
    }
    this.pendingAuth.clear();
    this.pendingKnocks.clear();
    this.guests.clear();
    this.connToPlayer.clear();
    this.hostContrib = 0;
  }

  getOnlineCount() {
    let count = 1;
    for (const g of this.guests.values()) {
      if (g.online) count++;
    }
    return count;
  }

  configure({ passcode = '', requireApproval = true, capacity = 8 }) {
    this.passcode = passcode.trim();
    this.requireApproval = !!requireApproval;
    this.capacity = Math.max(
      MULTIPLAYER_CONFIG.MIN_CAPACITY,
      Math.min(
        MULTIPLAYER_CONFIG.MAX_CAPACITY,
        Number(capacity) || MULTIPLAYER_CONFIG.DEFAULT_CAPACITY
      )
    );
    this.hostContrib = this.room.engine.stats.placedCount;
  }

  scheduleAutoBackup() {
    if (this.room.role !== 'host') return;
    if (this.autoBackupTimer) clearTimeout(this.autoBackupTimer);
    this.autoBackupTimer = setTimeout(() => {
      this.autoBackupTimer = null;
      if (this.room.role !== 'host' || this.room.engine.pieces.length === 0) return;
      const payload = this.room.engine.exportSaveData(this.room.getSettings());
      payload.completed = this.room.engine.isCompleted();
      saveAutoBackup(payload);
    }, MULTIPLAYER_CONFIG.AUTO_BACKUP_DEBOUNCE_MS);
  }

  onConnect(connId) {
    const nonce = generateToken();
    this.pendingAuth.set(connId, { nonce });
    this.room.transport.sendTo(connId, {
      type: MSG.AUTH_CHALLENGE,
      nonce,
      requirePasscode: Boolean(this.passcode),
    });
  }

  onDisconnect(connId) {
    this.pendingAuth.delete(connId);
    if (this.pendingKnocks.has(connId)) {
      this.pendingKnocks.delete(connId);
      this.room.cb.onKnockResolved(connId);
    }
    const playerId = this.connToPlayer.get(connId);
    if (!playerId) return;
    this.connToPlayer.delete(connId);

    const guest = this.guests.get(playerId);
    if (guest) {
      guest.online = false;
      guest.connId = null;
    }

    for (const [groupId, ownerId] of this.room.groupLocks.entries()) {
      if (ownerId === playerId) {
        this.room.groupLocks.delete(groupId);
        this.room.remoteDragTargets.delete(groupId);
        this.room.transport?.broadcast({ type: MSG.LOCK_RELEASE, groupId });
      }
    }
    this.room.remoteCursors.delete(playerId);
    this.syncRoster();
    this.room.cb.onRenderNeeded();
  }

  async onMessage(connId, msg) {
    if (!isValidMessage(msg)) return;
    const room = this.room;

    if (msg.type === MSG.AUTH_RESPONSE) {
      await this._handleAuthResponse(connId, msg);
      return;
    }
    if (msg.type === MSG.REJOIN) {
      this._handleRejoin(connId, msg);
      return;
    }

    const playerId = this.connToPlayer.get(connId);
    if (!playerId) return;
    const guest = this.guests.get(playerId);
    if (!guest) return;

    if (msg.type === MSG.IMAGE_ACK) {
      if (msg.needImage) this._sendImageToGuest(connId);
      else this._sendFullStateToGuest(connId);
      return;
    }
    if (msg.type === MSG.CURSOR_MOVE) {
      const cursor = {
        playerId,
        x: Number(msg.x) || 0,
        y: Number(msg.y) || 0,
        name: guest.name,
        color: guest.color,
      };
      room.remoteCursors.set(playerId, { ...cursor, targetX: cursor.x, targetY: cursor.y });
      room.transport.broadcast({ type: MSG.CURSOR_MOVE, ...cursor }, connId);
      room.cb.onRenderNeeded();
      return;
    }
    if (msg.type === MSG.LOCK_REQUEST) {
      this._handleLockRequest(connId, playerId, Number(msg.groupId));
      return;
    }
    if (msg.type === MSG.DRAG_PREVIEW) {
      const groupId = Number(msg.groupId);
      if (room.groupLocks.get(groupId) !== playerId || !Array.isArray(msg.positions)) return;
      room.applyPositionsOnly(msg.positions);
      room.transport.broadcast(
        { type: MSG.DRAG_PREVIEW, groupId, ownerId: playerId, positions: msg.positions },
        connId
      );
      room.cb.onRenderNeeded();
      return;
    }
    if (msg.type === MSG.DROP_REQUEST) {
      this._handleDropRequest(connId, playerId, guest, msg);
      return;
    }
    if (msg.type === MSG.ROTATE_REQUEST || msg.type === MSG.FLIP_REQUEST) {
      this._handleRotateOrFlip(playerId, msg);
      return;
    }
    if (msg.type === MSG.SUPERCHAT_HIT) {
      this.handleSuperchatHit();
    }
  }

  async _handleAuthResponse(connId, msg) {
    const auth = this.pendingAuth.get(connId);
    if (!auth) return;
    const expected = await computeChallengeHash(auth.nonce, this.passcode);
    if (msg.hash !== expected) {
      recordDiagnostic('p2p', 'host_auth_failed', { reason: 'passcode_mismatch' }, 'warn');
      this.room.transport.sendTo(connId, { type: MSG.AUTH_ERROR, reason: '合言葉が一致しません' });
      this.pendingAuth.delete(connId);
      setTimeout(() => this.room.transport?.disconnect(connId), 100);
      return;
    }
    if (this.getOnlineCount() >= this.capacity) {
      this.room.transport.sendTo(connId, { type: MSG.AUTH_ERROR, reason: '部屋が満員です' });
      this.pendingAuth.delete(connId);
      setTimeout(() => this.room.transport?.disconnect(connId), 100);
      return;
    }

    this.pendingAuth.delete(connId);
    const displayName = String(msg.displayName || 'ゲスト').trim().slice(0, 20) || 'ゲスト';
    if (this.requireApproval) {
      this.pendingKnocks.set(connId, { connId, displayName });
      this.room.transport.sendTo(connId, { type: MSG.KNOCK_PENDING });
      this.room.cb.onKnockRequest({ connId, displayName });
    } else {
      this._admitNewGuest(connId, displayName);
    }
  }

  _handleRejoin(connId, msg) {
    this.pendingAuth.delete(connId);
    const existing = this.guests.get(msg.playerId);
    if (!existing || existing.online || existing.reconnectToken !== msg.reconnectToken) {
      this.room.transport.sendTo(connId, {
        type: MSG.AUTH_ERROR,
        reason: '再接続トークンが無効です。新しく参加してください',
      });
      setTimeout(() => this.room.transport?.disconnect(connId), 100);
      return;
    }
    if (this.getOnlineCount() >= this.capacity) {
      this.room.transport.sendTo(connId, { type: MSG.AUTH_ERROR, reason: '部屋が満員です' });
      return;
    }

    existing.connId = connId;
    existing.online = true;
    if (msg.displayName) {
      existing.name = String(msg.displayName).trim().slice(0, 20) || existing.name;
    }
    this.connToPlayer.set(connId, existing.id);
    this._sendWelcomeToGuest(existing);
    this.syncRoster();
  }

  _handleLockRequest(connId, playerId, groupId) {
    const room = this.room;
    const group = room.engine.getGroupPieces(groupId);
    if (group.length === 0 || group.some((p) => p.isLocked)) {
      room.transport.sendTo(connId, {
        type: MSG.LOCK_DENIED,
        groupId,
        ownerId: null,
        pieces: this._serializePieces(group),
      });
      return;
    }
    const currentOwner = room.groupLocks.get(groupId);
    if (currentOwner && currentOwner !== playerId) {
      room.transport.sendTo(connId, {
        type: MSG.LOCK_DENIED,
        groupId,
        ownerId: currentOwner,
        pieces: this._serializePieces(group),
      });
      return;
    }
    for (const [heldGid, owner] of room.groupLocks.entries()) {
      if (owner === playerId && heldGid !== groupId) {
        room.groupLocks.delete(heldGid);
        room.transport.broadcast({ type: MSG.LOCK_RELEASE, groupId: heldGid });
      }
    }
    room.groupLocks.set(groupId, playerId);
    room.engine.bringGroupToFront(groupId);
    const zOrder = group[0]?.zOrder || 1;
    room.transport.broadcast({ type: MSG.LOCK_GRANTED, groupId, ownerId: playerId, zOrder });
    room.cb.onRenderNeeded();
  }

  _handleDropRequest(connId, playerId, guest, msg) {
    const room = this.room;
    const groupId = Number(msg.groupId);
    const currentOwner = room.groupLocks.get(groupId);
    if (currentOwner && currentOwner !== playerId) {
      room.transport.sendTo(connId, {
        type: MSG.LOCK_DENIED,
        groupId,
        ownerId: currentOwner,
        pieces: this._serializePieces(room.engine.getGroupPieces(groupId)),
      });
      return;
    }
    room.groupLocks.delete(groupId);
    if (Array.isArray(msg.positions)) {
      room.applyPositionsOnly(msg.positions);
    }
    const res = room.engine.resolveDrop(groupId);
    if (res.type === 'snap') {
      guest.contrib += res.count;
    }
    const affected = room.engine.getGroupPieces(groupId);
    this.syncRoster();
    this._broadcastPiecesPatch(affected, res, playerId);
    room.cb.onHostPatchApplied(affected, res, playerId);
    this.scheduleAutoBackup();
  }

  _handleRotateOrFlip(playerId, msg) {
    const room = this.room;
    const piece = room.engine.pieces.find((p) => p.id === msg.pieceId);
    if (!piece || piece.isLocked) return;
    const owner = room.groupLocks.get(piece.groupId);
    if (owner && owner !== playerId) return;
    const settings = room.getSettings();
    const isRotate = msg.type === MSG.ROTATE_REQUEST;
    const changed = isRotate
      ? room.engine.rotateGroup(piece, settings.allowRotation)
      : room.engine.flipPiece(piece, settings.allowFlip);
    if (changed) {
      const affected = room.engine.getGroupPieces(piece.groupId);
      this._broadcastPiecesPatch(affected, { type: isRotate ? 'rotate' : 'flip' }, playerId);
      room.cb.onRenderNeeded();
      this.scheduleAutoBackup();
    }
  }

  approveKnock(connId) {
    const req = this.pendingKnocks.get(connId);
    if (!req) return;
    this.pendingKnocks.delete(connId);
    this.room.cb.onKnockResolved(connId);
    if (this.getOnlineCount() >= this.capacity) {
      this.room.transport?.sendTo(connId, { type: MSG.JOIN_REJECTED, reason: '部屋が満員です' });
      this.room.transport?.disconnect(connId);
      return;
    }
    this._admitNewGuest(connId, req.displayName);
  }

  rejectKnock(connId) {
    if (!this.pendingKnocks.has(connId)) return;
    this.pendingKnocks.delete(connId);
    this.room.cb.onKnockResolved(connId);
    this.room.transport?.sendTo(connId, {
      type: MSG.JOIN_REJECTED,
      reason: 'ホストにより参加が拒否されました',
    });
    setTimeout(() => this.room.transport?.disconnect(connId), 100);
  }

  kickGuest(playerId) {
    const guest = this.guests.get(playerId);
    if (!guest) return;
    const connId = guest.connId;
    guest.online = false;
    guest.connId = null;
    if (connId) {
      this.room.transport?.sendTo(connId, { type: MSG.KICKED, reason: 'ホストにより退出されました' });
      this.connToPlayer.delete(connId);
      setTimeout(() => this.room.transport?.disconnect(connId), 80);
    }
    for (const [groupId, ownerId] of this.room.groupLocks.entries()) {
      if (ownerId === playerId) {
        this.room.groupLocks.delete(groupId);
        this.room.transport?.broadcast({ type: MSG.LOCK_RELEASE, groupId });
      }
    }
    this.room.remoteCursors.delete(playerId);
    this.guests.delete(playerId);
    this.syncRoster();
    this.room.cb.onRenderNeeded();
  }

  _admitNewGuest(connId, displayName) {
    const idx = this.guests.size;
    const playerId = `p-${generateToken().slice(0, 8)}`;
    const reconnectToken = generateToken();
    const color =
      MULTIPLAYER_CONFIG.PLAYER_COLORS[(idx + 1) % MULTIPLAYER_CONFIG.PLAYER_COLORS.length];

    const guest = {
      id: playerId,
      connId,
      name: displayName,
      color,
      role: 'guest',
      contrib: 0,
      online: true,
      reconnectToken,
    };
    this.guests.set(playerId, guest);
    this.connToPlayer.set(connId, playerId);
    this._sendWelcomeToGuest(guest);
    this.syncRoster();
  }

  _sendWelcomeToGuest(guest) {
    sendWelcomeToGuest(this.room, guest, this.buildRosterList());
  }

  _sendImageToGuest(connId) {
    sendImageToGuest(this.room, connId);
  }

  _sendFullStateToGuest(connId) {
    sendFullStateToGuest(this.room, connId, this.buildRosterList());
  }

  broadcastFullState() {
    const { isSampleImage } = this.room.getSourceState();
    this.hostContrib = this.room.engine.stats.placedCount;
    for (const guest of this.guests.values()) {
      if (!guest.online || !guest.connId) continue;
      if (!isSampleImage) this._sendWelcomeToGuest(guest);
      else this._sendFullStateToGuest(guest.connId);
    }
    this.syncRoster();
    this.scheduleAutoBackup();
  }

  buildRosterList() {
    const settings = this.room.getSettings();
    return [
      {
        id: 'host',
        name: settings.playerName || 'ホスト（自分）',
        color: 'var(--accent)',
        role: 'host',
        contrib: this.room.role === 'host' ? this.hostContrib : this.room.engine.stats.placedCount,
        online: true,
      },
      ...Array.from(this.guests.values()).map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        role: 'guest',
        contrib: g.contrib,
        online: g.online,
      })),
    ];
  }

  syncRoster() {
    this.room.roster = this.buildRosterList();
    this.room.transport?.broadcast({ type: MSG.ROSTER_UPDATE, roster: this.room.roster });
    this.room.cb.onRosterUpdate(this.room.roster);
  }

  _serializePieces(pieces) {
    return serializePieces(pieces);
  }

  _broadcastPiecesPatch(pieces, actionResult, actorId) {
    broadcastPiecesPatch(this.room, pieces, actionResult, actorId);
  }

  requestLock(groupId) {
    const room = this.room;
    for (const [heldGid, owner] of room.groupLocks.entries()) {
      if (owner === 'host' && heldGid !== groupId) {
        room.groupLocks.delete(heldGid);
        room.transport?.broadcast({ type: MSG.LOCK_RELEASE, groupId: heldGid });
      }
    }
    room.groupLocks.set(groupId, 'host');
    const group = room.engine.getGroupPieces(groupId);
    room.engine.bringGroupToFront(groupId);
    room.transport?.broadcast({
      type: MSG.LOCK_GRANTED,
      groupId,
      ownerId: 'host',
      zOrder: group[0]?.zOrder || 1,
    });
    return { allowed: true };
  }

  submitDrop(groupId) {
    const room = this.room;
    room.groupLocks.delete(groupId);
    const res = room.engine.resolveDrop(groupId);
    if (res.type === 'snap') {
      this.hostContrib += res.count;
    }
    const affected = room.engine.getGroupPieces(groupId);
    room.transport?.broadcast({ type: MSG.LOCK_RELEASE, groupId });
    this.syncRoster();
    this._broadcastPiecesPatch(affected, res, 'host');
    this.scheduleAutoBackup();
    return res;
  }

  submitRotate(piece, allowRotationSetting) {
    if (this.room.engine.rotateGroup(piece, allowRotationSetting)) {
      const affected = this.room.engine.getGroupPieces(piece.groupId);
      this._broadcastPiecesPatch(affected, { type: 'rotate' }, 'host');
      this.scheduleAutoBackup();
      return true;
    }
    return false;
  }

  submitFlip(piece, allowFlipSetting) {
    if (this.room.engine.flipPiece(piece, allowFlipSetting)) {
      const affected = this.room.engine.getGroupPieces(piece.groupId);
      this._broadcastPiecesPatch(affected, { type: 'flip' }, 'host');
      this.scheduleAutoBackup();
      return true;
    }
    return false;
  }

  handleSuperchatHit() {
    const room = this.room;
    room.sharedSuperchatHp = Math.max(0, room.sharedSuperchatHp - 1);
    if (room.role === 'host') {
      if (room.sharedSuperchatHp <= 0) {
        room.transport?.broadcast({ type: MSG.SUPERCHAT_DISMISS });
      } else {
        room.transport?.broadcast({
          type: MSG.SUPERCHAT_STATE,
          hp: room.sharedSuperchatHp,
          maxHp: room.sharedSuperchatMaxHp,
        });
      }
    }
    room.cb.onLocalSuperchatHp(room.sharedSuperchatHp, room.sharedSuperchatMaxHp);
    return room.sharedSuperchatHp;
  }

  broadcastPhysicalOjama(noticeText) {
    this._broadcastPiecesPatch(this.room.engine.pieces, { type: 'ojama' }, 'host');
    this.room.transport?.broadcast({ type: MSG.OJAMA_NOTICE, text: noticeText });
    this.scheduleAutoBackup();
  }

  broadcastSortResult() {
    this._broadcastPiecesPatch(this.room.engine.pieces, { type: 'sort' }, 'host');
    this.scheduleAutoBackup();
  }
}
