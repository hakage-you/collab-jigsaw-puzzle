import { canRunAway, hopGroup } from '../core/runawayOps.js';
import { MSG } from './protocol.js';

/**
 * The host's (or solo player's) side of runaway pieces. While the rules are set, grabbing a loose
 * piece or small group may make it hop away instead (the first grab always does), and a group that
 * was taken slips out of the hand after a few seconds. Every hop is sent as one PIECE_HOP with the
 * new positions; each screen animates the hop itself.
 */
export class RunawayHost {
  /** @param {object} room RoomController (engine, role, groupLocks, transport, cb) */
  constructor(room, random = Math.random) {
    this.room = room;
    this.random = random;
    /** { chance (0..1), gripMinSec, gripMaxSec } while runaway lasts, else null. */
    this.rules = null;
    this.firstPending = false;
    /** groupId -> { playerId, timer } for groups held now that will slip out. */
    this.held = new Map();
  }

  set(rules) {
    this.rules = rules;
    this.firstPending = Boolean(rules);
    if (!rules) this.clear();
  }

  clear() {
    for (const { timer } of this.held.values()) clearTimeout(timer);
    this.held.clear();
  }

  /**
   * `playerId` grabs the group at world point `from` (or null). Returns true when the group hopped
   * away instead, so the grab must not be granted.
   */
  onGrab(groupId, playerId, from = null) {
    this.onRelease(groupId);
    if (!this.rules || !canRunAway(this.room.engine, groupId)) return false;
    if (this.firstPending || this.random() < this.rules.chance) {
      this.firstPending = false;
      this.hop(groupId, playerId, from);
      return true;
    }
    const { gripMinSec, gripMaxSec } = this.rules;
    const sec = gripMinSec + this.random() * (gripMaxSec - gripMinSec);
    const timer = setTimeout(() => this._slip(groupId, playerId), sec * 1000);
    this.held.set(groupId, { playerId, timer });
    return false;
  }

  /** The group was dropped (or the grab ended): it no longer slips out. */
  onRelease(groupId) {
    const h = this.held.get(groupId);
    if (!h) return;
    clearTimeout(h.timer);
    this.held.delete(groupId);
  }

  _slip(groupId, playerId) {
    this.held.delete(groupId);
    const room = this.room;
    const stillHeld = room.role === 'solo' || room.groupLocks.get(groupId) === playerId;
    if (!this.rules || !stillHeld || !canRunAway(room.engine, groupId)) return;
    this.hop(groupId, playerId, null);
  }

  /** Hops the group away from `from`, frees it, and tells everyone (and this screen). */
  hop(groupId, playerId, from) {
    const room = this.room;
    const before = new Map(
      room.engine.getGroupPieces(groupId).map((p) => [p.id, { x: p.x, y: p.y }]),
    );
    const positions = hopGroup(room.engine, groupId, from, this.random);
    room.groupLocks.delete(groupId);
    room.transport?.broadcast({ type: MSG.PIECE_HOP, groupId, positions, byPlayerId: playerId });
    room.cb.onPieceHop({ groupId, from: before, byPlayerId: playerId });
  }
}
