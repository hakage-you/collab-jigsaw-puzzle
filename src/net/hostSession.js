import { MULTIPLAYER_CONFIG } from '../config/constants.js';
import { saveAutoBackup } from '../services/storage.js';
import { recordDiagnostic } from '../services/diagnostics.js';
import { MSG, generateToken } from './protocol.js';
import { createRateGate, sanitizeGuestMessage, RATE_OK, RATE_FLOOD } from './guestMessageGuard.js';
import {
  sendWelcomeToGuest,
  sendImageToGuest,
  sendFullStateToGuest,
  broadcastPiecesPatch,
} from './hostSyncHelper.js';
import { handleAuthResponse, handleRejoin, admitNewGuest } from './hostAdmission.js';
import {
  handleCursorMove,
  handleDragPreview,
  handleLockRequest,
  handleDropRequest,
  handleRotateOrFlip,
} from './hostBoardOps.js';

const FLOOD_KICK_REASON = '通信量が多すぎるため退出しました';

function handleImageAck(session, { connId, msg }) {
  if (msg.needImage) session._sendImageToGuest(connId);
  else session._sendFullStateToGuest(connId);
}

/** Handlers for messages from an authenticated guest, keyed by message type. */
const GUEST_MESSAGE_HANDLERS = new Map([
  [MSG.IMAGE_ACK, handleImageAck],
  [MSG.CURSOR_MOVE, handleCursorMove],
  [MSG.LOCK_REQUEST, handleLockRequest],
  [MSG.DRAG_PREVIEW, handleDragPreview],
  [MSG.DROP_REQUEST, handleDropRequest],
  [MSG.ROTATE_REQUEST, handleRotateOrFlip],
  [MSG.FLIP_REQUEST, handleRotateOrFlip],
  [MSG.SUPERCHAT_HIT, (session) => session.handleSuperchatHit()],
]);

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
    // Monotonic clock for rate limiting; tests replace it to drive time.
    this.now = () => performance.now();
    this.rateGates = new Map();
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
    this.rateGates.clear();
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
    this.requireApproval = Boolean(requireApproval);
    this.capacity = Math.max(
      MULTIPLAYER_CONFIG.MIN_CAPACITY,
      Math.min(
        MULTIPLAYER_CONFIG.MAX_CAPACITY,
        Number(capacity) || MULTIPLAYER_CONFIG.DEFAULT_CAPACITY,
      ),
    );
    this.hostContrib =
      this.room.savedHostContrib !== null
        ? this.room.savedHostContrib
        : this.room.engine.stats.placedCount;
  }

  resetContributions() {
    this.hostContrib = 0;
    for (const g of this.guests.values()) {
      g.contrib = 0;
    }
  }

  applySavedContributions(hostContrib, savedGuestContribs) {
    this.hostContrib = hostContrib;
    for (const g of this.guests.values()) {
      const idx = savedGuestContribs.findIndex((c) => c.name === g.name);
      if (idx !== -1) {
        g.contrib = savedGuestContribs[idx].contrib;
        savedGuestContribs.splice(idx, 1);
      } else {
        g.contrib = 0;
      }
    }
  }

  buildContributionsForSave() {
    const entries = this.buildRosterList().map(({ name, role, contrib, color }) => ({
      name,
      role,
      contrib,
      color,
    }));
    const existingGuestNames = new Set(
      entries.filter((e) => e.role === 'guest').map((e) => e.name),
    );
    for (const saved of this.room.savedGuestContribs) {
      if (!existingGuestNames.has(saved.name)) {
        entries.push({
          name: saved.name,
          role: 'guest',
          contrib: saved.contrib,
          color: saved.color || '#64748b',
        });
      }
    }
    return entries;
  }

  scheduleAutoBackup() {
    if (this.room.role !== 'host') return;
    if (this.autoBackupTimer) clearTimeout(this.autoBackupTimer);
    this.autoBackupTimer = setTimeout(() => {
      this.autoBackupTimer = null;
      if (this.room.role !== 'host' || this.room.engine.pieces.length === 0) return;
      const payload = this.room.engine.exportSaveData(
        this.room.getSettings(),
        this.room.buildContributionsList(),
      );
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
    this.rateGates.delete(connId);
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
    if (!this._admitRate(connId)) return;
    const clean = sanitizeGuestMessage(msg);
    if (!clean) return;

    if (clean.type === MSG.AUTH_RESPONSE) {
      await handleAuthResponse(this, connId, clean);
      return;
    }
    if (clean.type === MSG.REJOIN) {
      handleRejoin(this, connId, clean);
      return;
    }

    const playerId = this.connToPlayer.get(connId);
    if (!playerId) return;
    const guest = this.guests.get(playerId);
    if (!guest) return;

    const handler = GUEST_MESSAGE_HANDLERS.get(clean.type);
    if (handler) handler(this, { connId, playerId, guest, msg: clean });
  }

  /** Token-bucket check for one connection. Returns false when the message must be dropped. */
  _admitRate(connId) {
    let gate = this.rateGates.get(connId);
    if (!gate) {
      gate = createRateGate();
      this.rateGates.set(connId, gate);
    }
    const verdict = gate.admit(this.now());
    if (verdict === RATE_FLOOD) this._kickFlooder(connId);
    return verdict === RATE_OK;
  }

  _kickFlooder(connId) {
    const playerId = this.connToPlayer.get(connId);
    if (!playerId) return;
    recordDiagnostic('p2p', 'guest_flood_kicked', { reason: 'rate_limit' }, 'warn');
    this.kickGuest(playerId, FLOOD_KICK_REASON);
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
    admitNewGuest(this, connId, req.displayName);
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

  kickGuest(playerId, reason = 'ホストにより退出されました') {
    const guest = this.guests.get(playerId);
    if (!guest) return;
    const connId = guest.connId;
    guest.online = false;
    guest.connId = null;
    if (connId) {
      this.room.transport?.sendTo(connId, { type: MSG.KICKED, reason });
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
