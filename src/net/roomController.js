import { MULTIPLAYER_CONFIG } from '../config/constants.js';
import { MSG, generateRoomId } from './protocol.js';
import { createTransport, getTransportModeFromUrl } from './transport.js';
import { HostSession } from './hostSession.js';
import { GuestSession } from './guestSession.js';

export class RoomController {
  constructor({ engine, getSettings, getSourceState, callbacks }) {
    this.engine = engine;
    this.getSettings = getSettings;
    this.getSourceState = getSourceState;
    this.cb = callbacks;

    this.role = 'solo'; // 'solo' | 'host' | 'guest'
    this.roomId = null;
    this.transport = null;
    this.transportMode = getTransportModeFromUrl();

    this.myPlayerId = 'host';
    this.myColor = 'var(--accent)';
    this.groupLocks = new Map();
    this.remoteCursors = new Map();
    this.remoteDragTargets = new Map();
    this.roster = [];
    this.roomRules = null;

    this.lastCursorSentAt = 0;
    this.lastCursorPos = { x: 0, y: 0 };
    this.lastDragSentAt = 0;
    this.sharedSuperchatHp = 0;
    this.sharedSuperchatMaxHp = MULTIPLAYER_CONFIG.SUPERCHAT_BASE_HP;

    this.hostSession = new HostSession(this);
    this.guestSession = new GuestSession(this);
  }

  get optimisticRollback() {
    return this.guestSession.optimisticRollback;
  }

  set optimisticRollback(val) {
    this.guestSession.optimisticRollback = val;
  }

  isMultiplayer() {
    return this.role === 'host' || this.role === 'guest';
  }

  isHost() {
    return this.role === 'host' || this.role === 'solo';
  }

  isGuest() {
    return this.role === 'guest';
  }

  getLockedGroupIds() {
    return new Set(this.groupLocks.keys());
  }

  getOnlineCount() {
    if (this.role === 'solo') return 1;
    if (this.role === 'host') return this.hostSession.getOnlineCount();
    return Math.max(1, this.roster.filter((m) => m.online).length);
  }

  getPlayerMeta(playerId) {
    if (playerId === 'host') {
      const s = this.getSettings();
      return { id: 'host', name: s.playerName || 'ホスト（自分）', color: 'var(--accent)' };
    }
    const g = this.hostSession.guests.get(playerId) || this.roster.find((m) => m.id === playerId);
    if (g) return { id: g.id, name: g.name, color: g.color };
    return { id: playerId, name: '参加者', color: '#64748b' };
  }

  buildInviteUrl() {
    if (!this.roomId) return '';
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', this.roomId);
    if (this.transportMode === 'local') {
      url.searchParams.set('transport', 'local');
    }
    return url.toString();
  }

  shouldWarnBeforeUnload() {
    return this.role === 'host';
  }

  applyPositionsOnly(positions) {
    const map = new Map(positions.map((pos) => [pos.id, pos]));
    for (const p of this.engine.pieces) {
      const upd = map.get(p.id);
      if (upd && !p.isLocked) {
        p.x = upd.x;
        p.y = upd.y;
      }
    }
  }

  async startHostRoom({ passcode = '', requireApproval = true, capacity = 8, roomId = null }) {
    this.close();
    this.role = 'host';
    this.myPlayerId = 'host';
    this.myColor = 'var(--accent)';
    this.roomId = roomId || generateRoomId();
    this.hostSession.configure({ passcode, requireApproval, capacity });

    this.transport = createTransport(this.transportMode);
    this.transport.onConnect = (connId) => this.hostSession.onConnect(connId);
    this.transport.onDisconnect = (connId) => this.hostSession.onDisconnect(connId);
    this.transport.onMessage = (connId, msg) => this.hostSession.onMessage(connId, msg);
    this.transport.onError = (err) => this.cb.onError(err?.message || '通信エラーが発生しました');

    await this.transport.openHost(this.roomId);
    this.hostSession.syncRoster();
    this.hostSession.scheduleAutoBackup();
    return { roomId: this.roomId, inviteUrl: this.buildInviteUrl() };
  }

  async joinGuestRoom({ roomId, displayName, passcode = '' }) {
    this.close();
    this.role = 'guest';
    this.roomId = roomId.trim();
    this.guestSession.configure({ displayName, passcode });

    this.transport = createTransport(this.transportMode);
    this.transport.onMessage = (_, msg) => this.guestSession.onMessage(msg);
    this.transport.onDisconnect = () => {
      if (this.role === 'guest') {
        this.cb.onDisconnected('ホストとの接続が切れました');
      }
    };
    this.transport.onError = (err) => this.cb.onError(err?.message || '通信エラーが発生しました');

    await this.transport.connectGuest(this.roomId);
  }

  approveKnock(connId) {
    this.hostSession.approveKnock(connId);
  }

  rejectKnock(connId) {
    this.hostSession.rejectKnock(connId);
  }

  kickGuest(playerId) {
    if (this.role === 'host') this.hostSession.kickGuest(playerId);
  }

  broadcastFullState() {
    if (this.role === 'host') this.hostSession.broadcastFullState();
  }

  _buildRosterList() {
    return this.hostSession.buildRosterList();
  }

  updateHostName() {
    if (this.role === 'host') this.hostSession.syncRoster();
  }

  canInteractWithGroup(groupId) {
    if (this.role === 'solo') return true;
    const owner = this.groupLocks.get(groupId);
    return !owner || owner === this.myPlayerId;
  }

  requestLock(groupId) {
    if (this.role === 'solo') return { allowed: true };
    const currentOwner = this.groupLocks.get(groupId);
    if (currentOwner && currentOwner !== this.myPlayerId) {
      return { allowed: false, ownerName: this.getPlayerMeta(currentOwner).name };
    }
    if (this.role === 'host') return this.hostSession.requestLock(groupId);
    return this.guestSession.requestLock(groupId);
  }

  sendCursorMove(wx, wy) {
    if (!this.isMultiplayer()) return;
    const now = performance.now();
    if (now - this.lastCursorSentAt < MULTIPLAYER_CONFIG.CURSOR_THROTTLE_MS) return;
    if (Math.hypot(wx - this.lastCursorPos.x, wy - this.lastCursorPos.y) < MULTIPLAYER_CONFIG.CURSOR_MIN_MOVE_PX) {
      return;
    }
    this.lastCursorSentAt = now;
    this.lastCursorPos = { x: wx, y: wy };
    const x = Math.round(wx * 10) / 10;
    const y = Math.round(wy * 10) / 10;

    if (this.role === 'host') {
      const meta = this.getPlayerMeta('host');
      this.transport?.broadcast({
        type: MSG.CURSOR_MOVE,
        playerId: 'host',
        x,
        y,
        name: meta.name,
        color: meta.color,
      });
    } else if (this.role === 'guest') {
      this.transport?.sendToHost({ type: MSG.CURSOR_MOVE, x, y });
    }
  }

  sendDragPreview(groupId) {
    if (!this.isMultiplayer()) return;
    const now = performance.now();
    if (now - this.lastDragSentAt < MULTIPLAYER_CONFIG.CURSOR_THROTTLE_MS) return;
    this.lastDragSentAt = now;

    const positions = this.engine
      .getGroupPieces(groupId)
      .map((p) => ({ id: p.id, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));

    if (this.role === 'host') {
      this.transport?.broadcast({ type: MSG.DRAG_PREVIEW, groupId, ownerId: 'host', positions });
    } else if (this.role === 'guest') {
      this.transport?.sendToHost({ type: MSG.DRAG_PREVIEW, groupId, positions });
    }
  }

  submitDrop(groupId) {
    if (this.role === 'solo') return this.engine.resolveDrop(groupId);
    if (this.role === 'host') return this.hostSession.submitDrop(groupId);
    return this.guestSession.submitDrop(groupId);
  }

  submitRotate(piece, allowRotationSetting) {
    if (!piece || !this.canInteractWithGroup(piece.groupId)) return false;
    if (this.role === 'solo') return this.engine.rotateGroup(piece, allowRotationSetting);
    if (this.role === 'host') return this.hostSession.submitRotate(piece, allowRotationSetting);
    return this.guestSession.submitRotate(piece);
  }

  submitFlip(piece, allowFlipSetting) {
    if (!piece || !this.canInteractWithGroup(piece.groupId)) return false;
    if (this.role === 'solo') return this.engine.flipPiece(piece, allowFlipSetting);
    if (this.role === 'host') return this.hostSession.submitFlip(piece, allowFlipSetting);
    return this.guestSession.submitFlip(piece);
  }

  broadcastVisualOjama(visualType, duration) {
    if (this.role === 'host') {
      this.transport?.broadcast({ type: MSG.OJAMA_VISUAL, visualType, duration });
    }
  }

  broadcastVisualClear() {
    if (this.role === 'host') this.transport?.broadcast({ type: MSG.OJAMA_VISUAL_CLEAR });
  }

  computeSuperchatMaxHp() {
    const online = this.getOnlineCount();
    return (
      MULTIPLAYER_CONFIG.SUPERCHAT_BASE_HP +
      Math.max(0, online - 1) * MULTIPLAYER_CONFIG.SUPERCHAT_HP_PER_GUEST
    );
  }

  broadcastSuperchatStart({ maxHp, duration, author, message, amountDisplay }) {
    this.sharedSuperchatHp = maxHp;
    this.sharedSuperchatMaxHp = maxHp;
    if (this.role === 'host') {
      this.transport?.broadcast({
        type: MSG.OJAMA_SUPERCHAT,
        maxHp,
        duration,
        author,
        message,
        amountDisplay,
      });
    }
  }

  submitSuperchatHit() {
    if (this.role === 'guest') return this.guestSession.submitSuperchatHit();
    return this.hostSession.handleSuperchatHit();
  }

  broadcastPhysicalOjama(noticeText) {
    if (this.role === 'host') this.hostSession.broadcastPhysicalOjama(noticeText);
  }

  broadcastSortResult() {
    if (this.role === 'host') this.hostSession.broadcastSortResult();
  }

  broadcastCompletion() {
    if (this.role === 'host') {
      this.transport?.broadcast({ type: MSG.PUZZLE_COMPLETED });
      this.hostSession.scheduleAutoBackup();
    }
  }

  stepInterpolation() {
    let moved = false;
    for (const cur of this.remoteCursors.values()) {
      const dx = cur.targetX - cur.x;
      const dy = cur.targetY - cur.y;
      if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
        cur.x += dx * 0.32;
        cur.y += dy * 0.32;
        moved = true;
      } else {
        cur.x = cur.targetX;
        cur.y = cur.targetY;
      }
    }

    for (const [groupId, targetMap] of this.remoteDragTargets.entries()) {
      for (const p of this.engine.getGroupPieces(groupId)) {
        const tgt = targetMap.get(p.id);
        if (!tgt || p.isLocked) continue;
        const dx = tgt.x - p.x;
        const dy = tgt.y - p.y;
        if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
          p.x += dx * 0.4;
          p.y += dy * 0.4;
          moved = true;
        } else {
          p.x = tgt.x;
          p.y = tgt.y;
        }
      }
    }
    return moved;
  }

  close() {
    this.hostSession.reset();
    this.guestSession.reset();
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    this.role = 'solo';
    this.roomId = null;
    this.myPlayerId = 'host';
    this.groupLocks.clear();
    this.remoteCursors.clear();
    this.remoteDragTargets.clear();
    this.roster = [];
  }
}
