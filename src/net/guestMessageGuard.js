/**
 * Guard for messages a guest sends to the host. Every guest message is untrusted:
 * the host only acts on what sanitizeGuestMessage returns, and only after the rate gate admits it.
 */
import { NET_LIMITS } from '../config/constants.js';
import { recordDiagnostic } from '../services/diagnostics.js';
import { MSG, isValidMessage } from './protocol.js';

/** Outcomes of RateGate.admit: handle the message, drop it, or drop it and kick the sender. */
export const RATE_OK = 'ok';
export const RATE_DROPPED = 'dropped';
export const RATE_FLOOD = 'flood';

const TOKEN_MAX_LENGTH = 128;
const PLAYER_ID_MAX_LENGTH = 64;
// Real pieces and groups are positive and bounded by the group filter. Fake (ojama) pieces use
// negative ids from a counter, and guests can drag them, so both signs are allowed.
const MAX_ENTITY_ID = 1e6;

const isId = (v) => Number.isSafeInteger(v) && Math.abs(v) <= MAX_ENTITY_ID;
const isSeq = (v) => Number.isSafeInteger(v) && v >= 0;
const isCoord = (v) =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= NET_LIMITS.MAX_ABS_COORD;
const isShortString = (v, max) => typeof v === 'string' && v.length <= max;
const isOptionalName = (v) => v === undefined || typeof v === 'string';
const cleanName = (v) => (typeof v === 'string' ? v.slice(0, NET_LIMITS.MAX_NAME_LENGTH) : '');

function validateAuthResponse(m) {
  if (!isShortString(m.hash, TOKEN_MAX_LENGTH) || !isOptionalName(m.displayName)) return null;
  return { type: m.type, hash: m.hash, displayName: cleanName(m.displayName) };
}

function validateRejoin(m) {
  if (
    !isShortString(m.playerId, PLAYER_ID_MAX_LENGTH) ||
    !isShortString(m.reconnectToken, TOKEN_MAX_LENGTH) ||
    !isOptionalName(m.displayName)
  ) {
    return null;
  }
  return {
    type: m.type,
    playerId: m.playerId,
    reconnectToken: m.reconnectToken,
    displayName: cleanName(m.displayName),
  };
}

function validateImageAck(m) {
  return typeof m.needImage === 'boolean' ? { type: m.type, needImage: m.needImage } : null;
}

function validateCursor(m) {
  return isCoord(m.x) && isCoord(m.y) ? { type: m.type, x: m.x, y: m.y } : null;
}

function validateLockRequest(m) {
  return isId(m.groupId) ? { type: m.type, groupId: m.groupId } : null;
}

/** Entry of a positions list: a piece id with finite, bounded world coordinates. */
function isPositionEntry(p) {
  return Boolean(p) && typeof p === 'object' && isId(p.id) && isCoord(p.x) && isCoord(p.y);
}

/** Returns a copy of a positions list containing only known fields, or null when invalid. */
function readPositions(list) {
  if (!Array.isArray(list) || list.length > NET_LIMITS.MAX_PIECES) return null;
  if (!list.every(isPositionEntry)) return null;
  return list.map(({ id, x, y }) => ({ id, x, y }));
}

/** Drag preview and drop request: a group id plus the positions of its pieces. */
function validateGroupPositions(m) {
  const positions = readPositions(m.positions);
  if (!isId(m.groupId) || !positions) return null;
  return { type: m.type, groupId: m.groupId, positions };
}

/** Rotate and flip request: a piece id plus the client's operation sequence number. */
function validatePieceOp(m) {
  return isId(m.pieceId) && isSeq(m.opSeq)
    ? { type: m.type, pieceId: m.pieceId, opSeq: m.opSeq }
    : null;
}

/** Guest message types and their field validators. Unknown types are rejected. */
const GUEST_MESSAGE_VALIDATORS = new Map([
  [MSG.AUTH_RESPONSE, validateAuthResponse],
  [MSG.REJOIN, validateRejoin],
  [MSG.IMAGE_ACK, validateImageAck],
  [MSG.CURSOR_MOVE, validateCursor],
  [MSG.LOCK_REQUEST, validateLockRequest],
  [MSG.DRAG_PREVIEW, validateGroupPositions],
  [MSG.DROP_REQUEST, validateGroupPositions],
  [MSG.ROTATE_REQUEST, validatePieceOp],
  [MSG.FLIP_REQUEST, validatePieceOp],
  [MSG.SUPERCHAT_HIT, (m) => ({ type: m.type })],
]);

/** Logs only the message type and the reason, never the message contents. */
function rejectGuestMessage(type, reason) {
  recordDiagnostic('p2p', 'guest_message_rejected', { type: type ?? 'unknown', reason }, 'warn');
  return null;
}

/**
 * Returns a sanitized copy of a guest message containing only the fields the host reads,
 * or null (after recording a diagnostic) when the message must be ignored.
 */
export function sanitizeGuestMessage(msg) {
  if (!isValidMessage(msg)) return rejectGuestMessage(null, 'malformed');
  const validate = GUEST_MESSAGE_VALIDATORS.get(msg.type);
  if (!validate) return rejectGuestMessage(null, 'unknown_type');
  const clean = validate(msg);
  return clean || rejectGuestMessage(msg.type, 'invalid_fields');
}

/**
 * Per-guest token bucket with flood detection. `admit(now)` takes the current time from the
 * caller, so tests can drive it with a fake clock. Dropping continuously for
 * FLOOD_KICK_AFTER_MS returns RATE_FLOOD. The streak ends once the bucket is well refilled.
 */
export function createRateGate() {
  const capacity = NET_LIMITS.RATE_BURST;
  const refillPerSec = NET_LIMITS.RATE_TOKENS_PER_SEC;
  let tokens = capacity;
  let lastAt = null;
  let droppingSince = null;

  return {
    admit(now) {
      if (lastAt !== null) {
        const elapsedSec = Math.max(0, now - lastAt) / 1000;
        tokens = Math.min(capacity, tokens + elapsedSec * refillPerSec);
      }
      lastAt = now;

      if (tokens >= 1) {
        tokens -= 1;
        if (tokens >= capacity / 2) droppingSince = null;
        return RATE_OK;
      }
      if (droppingSince === null) droppingSince = now;
      return now - droppingSince >= NET_LIMITS.FLOOD_KICK_AFTER_MS ? RATE_FLOOD : RATE_DROPPED;
    },
  };
}
