/**
 * Guard for messages a guest receives from the host (security S7). The host is untrusted too: a
 * hostile or impersonated host must not make a guest allocate unbounded memory or freeze.
 * GuestSession acts only on the sanitized copy returned here, never on the raw message.
 * An invalid image or full-state transfer ends the join (see HOST_TRANSFER_TYPES); any other
 * invalid message is dropped and logged with its type and reason only.
 */
import { MULTIPLAYER_CONFIG, NET_LIMITS } from '../config/constants.js';
import { recordDiagnostic } from '../services/diagnostics.js';
import { MSG, isValidMessage } from './protocol.js';
import {
  MAX_PLAYER_ID_LENGTH,
  MAX_TOKEN_LENGTH,
  isCoord,
  isEntityId,
  isNonNegInt,
  isShortString,
} from './messageFieldChecks.js';

/** Transfers whose invalid messages end the join. Every other invalid message is dropped. */
export const HOST_TRANSFER_TYPES = new Set([
  MSG.IMAGE_START,
  MSG.IMAGE_CHUNK,
  MSG.FULL_STATE,
  MSG.FULL_STATE_CHUNK,
]);

// Visual sabotage types applied by ojamaController.applyVisualEffect.
const VISUAL_TYPES = ['grayscale', 'sepia', 'hue', 'spotlight', 'ghost'];
// Largest ojamaFakeMaxCount offered in the settings (index.html) and the engine's fake slot count.
const MAX_FAKE_SPECS = 16;
const MAX_ROSTER = MULTIPLAYER_CONFIG.MAX_CAPACITY;
const MAX_PIECES = NET_LIMITS.MAX_PIECES;
const MAX_TEXT = NET_LIMITS.MAX_TEXT_LENGTH;
const MAX_NAME = NET_LIMITS.MAX_NAME_LENGTH;
const MAX_ROTATION = 3;
const MAX_Z_ORDER = 1e9;
const MAX_COUNTER = 1e12;
const MAX_TIMESTAMP = 1e13;
const MAX_ACTION_TEXT = 32;
const MAX_LOGGED_TYPE = 40;
const NEUTRAL_COLOR = '#888888';
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const BASE64_TEXT = /^[A-Za-z0-9+/]*={0,2}$/;
const ROSTER_ROLES = ['host', 'guest'];
const COUNTER_KEYS = ['elapsedMs', 'placedCount', 'ojamaTotal'];
const BREAKDOWN_KEYS = ['drop', 'visual', 'superchat', 'prank', 'fake'];

/** Thrown by a field check. Every validator turns it into a rejected message. */
class FieldError extends Error {}

function need(condition) {
  if (!condition) throw new FieldError();
}

// Field checks: each returns its value when valid and throws FieldError otherwise.
const object = (v) => {
  need(v !== null && typeof v === 'object' && !Array.isArray(v));
  return v;
};
const bool = (v) => {
  need(typeof v === 'boolean');
  return v;
};
const token = (v) => {
  need(isShortString(v, MAX_TOKEN_LENGTH));
  return v;
};
const playerId = (v) => {
  need(isShortString(v, MAX_PLAYER_ID_LENGTH));
  return v;
};
const entityId = (v) => {
  need(isEntityId(v));
  return v;
};
const coord = (v) => {
  need(isCoord(v));
  return v;
};
const count = (v, max = Number.MAX_SAFE_INTEGER) => {
  need(isNonNegInt(v, max));
  return v;
};
const positive = (v, max) => {
  need(Number.isSafeInteger(v) && v >= 1 && v <= max);
  return v;
};
/** Finite number in [0, max]: durations, hit points, timestamps and counters. */
const bounded = (v, max) => {
  need(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max);
  return v;
};
const oneOf = (v, allowed) => {
  need(allowed.includes(v));
  return v;
};
const text = (v, max) => {
  need(typeof v === 'string');
  return v.slice(0, max);
};
/** Absent stays absent; present must pass `check`. */
const optional = (v, check) => (v === undefined ? undefined : check(v));
const list = (v, max, mapper) => {
  need(Array.isArray(v) && v.length <= max);
  return v.map(mapper);
};

/** Colors are only ever used as '#hex' or the accent variable. Anything else becomes neutral. */
function sanitizeColor(value) {
  const known = typeof value === 'string' && (HEX_COLOR.test(value) || value === 'var(--accent)');
  return known ? value : NEUTRAL_COLOR;
}

function sanitizeRoomRules(value) {
  const rules = object(value);
  return {
    cols: count(rules.cols, MAX_PIECES),
    rows: count(rules.rows, MAX_PIECES),
    cutComplexity: text(rules.cutComplexity, MAX_ACTION_TEXT),
    allowRotation: bool(rules.allowRotation),
    allowFlip: bool(rules.allowFlip),
    showStats: optional(rules.showStats, bool),
  };
}

function rosterEntry(value) {
  const entry = object(value);
  return {
    id: playerId(entry.id),
    name: text(entry.name, MAX_NAME),
    color: sanitizeColor(entry.color),
    role: oneOf(entry.role, ROSTER_ROLES),
    contrib: count(entry.contrib),
    online: bool(entry.online),
  };
}

/**
 * The host lists offline guests too, so an honest roster can be longer than MAX_CAPACITY. The
 * extra entries at the end are dropped instead of rejecting the whole message.
 */
function sanitizeRoster(value) {
  if (value === undefined) return [];
  need(Array.isArray(value));
  return value.slice(0, MAX_ROSTER).map(rosterEntry);
}

function sanitizeStats(value) {
  const stats = object(value);
  const breakdown = object(stats.ojamaBreakdown);
  return {
    ...Object.fromEntries(COUNTER_KEYS.map((key) => [key, bounded(stats[key], MAX_COUNTER)])),
    ojamaBreakdown: Object.fromEntries(
      BREAKDOWN_KEYS.map((key) => [key, bounded(breakdown[key], MAX_COUNTER)]),
    ),
  };
}

function sanitizeActionResult(value) {
  if (value === undefined) return undefined;
  const result = object(value);
  const clean = { type: text(result.type, MAX_ACTION_TEXT) };
  if (result.opSeq !== undefined) clean.opSeq = count(result.opSeq);
  if (result.count !== undefined) clean.count = count(result.count, MAX_PIECES);
  if (result.completed !== undefined) clean.completed = bool(result.completed);
  return clean;
}

/** A piece as serialized for patches and lock denials (serializePieces). */
function pieceEntry(value) {
  const piece = object(value);
  return {
    id: entityId(piece.id),
    x: coord(piece.x),
    y: coord(piece.y),
    rotation: count(piece.rotation, MAX_ROTATION),
    isFlipped: bool(piece.isFlipped),
    groupId: entityId(piece.groupId),
    isLocked: bool(piece.isLocked),
    zOrder: count(piece.zOrder, MAX_Z_ORDER),
  };
}

function positionEntry(value) {
  const position = object(value);
  return { id: entityId(position.id), x: coord(position.x), y: coord(position.y) };
}

/** [groupId, ownerId] pairs of the lock table. */
function lockEntry(value) {
  need(Array.isArray(value) && value.length === 2);
  return [entityId(value[0]), playerId(value[1])];
}

function zoneLabelEntry(value) {
  const label = object(value);
  return { text: text(label.text, MAX_TEXT), x: coord(label.x), y: coord(label.y) };
}

function fakeSpecEntry(value) {
  const spec = object(value);
  return {
    fakeId: entityId(spec.fakeId),
    sourcePieceId: entityId(spec.sourcePieceId),
    x: coord(spec.x),
    y: coord(spec.y),
    targetX: coord(spec.targetX),
    targetY: coord(spec.targetY),
    rotation: count(spec.rotation, MAX_ROTATION),
    isFlipped: bool(spec.isFlipped),
    expiresAt: bounded(spec.expiresAt, MAX_TIMESTAMP),
    zOrder: count(spec.zOrder, MAX_Z_ORDER),
  };
}

const pieceList = (v) => list(v, MAX_PIECES, pieceEntry);
const positionList = (v) => list(v, MAX_PIECES, positionEntry);
const lockList = (v) => optional(v, (locks) => list(locks, MAX_PIECES, lockEntry));
const zoneLabelList = (v) => optional(v, (labels) => list(labels, MAX_PIECES, zoneLabelEntry));
const fakeSpecList = (v) => list(v, MAX_FAKE_SPECS, fakeSpecEntry);
const optionalText = (v) => optional(v, (s) => text(s, MAX_TEXT));
const durationSec = (v) => bounded(v, NET_LIMITS.MAX_OJAMA_DURATION_SEC);
const hitPoints = (v) => bounded(v, NET_LIMITS.MAX_SUPERCHAT_HP);

/** Base64 text of one transfer chunk: non-empty, at most IMAGE_CHUNK_BYTES, base64 characters. */
function imageChunkData(value) {
  const size = MULTIPLAYER_CONFIG.IMAGE_CHUNK_BYTES;
  need(typeof value === 'string' && value.length >= 1 && value.length <= size);
  need(BASE64_TEXT.test(value));
  return value;
}

function validateAuthChallenge(m) {
  return { type: m.type, nonce: token(m.nonce) };
}

/** Rejection messages (AUTH_ERROR, JOIN_REJECTED, KICKED) carry a display reason. */
function validateRejection(m) {
  return { type: m.type, reason: optionalText(m.reason) };
}

/** Messages that carry no fields. */
function validateSignal(m) {
  return { type: m.type };
}

function validateWelcome(m) {
  return {
    type: m.type,
    playerId: playerId(m.playerId),
    reconnectToken: token(m.reconnectToken),
    color: sanitizeColor(m.color),
    roomRules: sanitizeRoomRules(m.roomRules),
    roster: sanitizeRoster(m.roster),
    isSampleImage: optional(m.isSampleImage, bool),
    imageHash: optional(m.imageHash, token),
    totalChunks: optional(m.totalChunks, (v) => count(v, NET_LIMITS.MAX_IMAGE_CHUNKS)),
  };
}

function validateImageStart(m) {
  return {
    type: m.type,
    totalChunks: positive(m.totalChunks, NET_LIMITS.MAX_IMAGE_CHUNKS),
    mimeType: oneOf(m.mimeType, NET_LIMITS.IMAGE_MIME_TYPES),
    width: positive(m.width, NET_LIMITS.MAX_IMAGE_DIM),
    height: positive(m.height, NET_LIMITS.MAX_IMAGE_DIM),
  };
}

function validateImageChunk(m) {
  return {
    type: m.type,
    index: count(m.index, NET_LIMITS.MAX_IMAGE_CHUNKS - 1),
    data: imageChunkData(m.data),
  };
}

/**
 * The save data itself is checked by saveValidation after the chunks are merged. Here only the
 * size of the inline piece list is bounded, so the guard never has to look inside the save.
 */
function validateFullState(m) {
  const saveData = object(m.saveData);
  need(
    saveData.pieces === undefined ||
      (Array.isArray(saveData.pieces) && saveData.pieces.length <= MAX_PIECES),
  );
  return {
    type: m.type,
    saveData,
    totalPieceChunks: optional(m.totalPieceChunks, (v) => positive(v, NET_LIMITS.MAX_STATE_CHUNKS)),
    roomRules: sanitizeRoomRules(m.roomRules),
    roster: sanitizeRoster(m.roster),
    locks: lockList(m.locks),
    zoneLabels: zoneLabelList(m.zoneLabels),
    fakePieces: optional(m.fakePieces, fakeSpecList),
  };
}

function validateFullStateChunk(m) {
  return {
    type: m.type,
    chunkIndex: count(m.chunkIndex, NET_LIMITS.MAX_STATE_CHUNKS - 1),
    pieces: list(m.pieces, MAX_PIECES, object),
  };
}

function validatePiecesPatch(m) {
  return {
    type: m.type,
    pieces: pieceList(m.pieces),
    stats: optional(m.stats, sanitizeStats),
    actionResult: sanitizeActionResult(m.actionResult),
    actorId: optional(m.actorId, playerId),
    locks: lockList(m.locks),
    zoneLabels: zoneLabelList(m.zoneLabels),
    isFinalChunk: optional(m.isFinalChunk, bool),
  };
}

function validateLockGranted(m) {
  return {
    type: m.type,
    groupId: entityId(m.groupId),
    ownerId: playerId(m.ownerId),
    zOrder: optional(m.zOrder, (v) => count(v, MAX_Z_ORDER)),
  };
}

function validateLockDenied(m) {
  return {
    type: m.type,
    groupId: entityId(m.groupId),
    ownerId: m.ownerId === null || m.ownerId === undefined ? null : playerId(m.ownerId),
    pieces: optional(m.pieces, pieceList),
  };
}

function validateLockRelease(m) {
  return { type: m.type, groupId: entityId(m.groupId) };
}

function validateDragPreview(m) {
  return {
    type: m.type,
    groupId: entityId(m.groupId),
    ownerId: playerId(m.ownerId),
    positions: positionList(m.positions),
  };
}

function validateRoster(m) {
  return { type: m.type, roster: sanitizeRoster(m.roster) };
}

function validateCursorMove(m) {
  return {
    type: m.type,
    playerId: playerId(m.playerId),
    x: coord(m.x),
    y: coord(m.y),
    name: optional(m.name, (v) => text(v, MAX_NAME)) ?? '',
    color: sanitizeColor(m.color),
  };
}

function validateOjamaVisual(m) {
  return {
    type: m.type,
    visualType: oneOf(m.visualType, VISUAL_TYPES),
    duration: durationSec(m.duration),
  };
}

function validateFakePieces(m) {
  return {
    type: m.type,
    fakePieces: fakeSpecList(m.fakePieces),
    stats: optional(m.stats, sanitizeStats),
  };
}

/** Superchat text is cut to MAX_TEXT_LENGTH; the overlay shows it as plain text. */
function validateSuperchat(m) {
  return {
    type: m.type,
    maxHp: hitPoints(m.maxHp),
    duration: durationSec(m.duration),
    author: optionalText(m.author),
    message: optionalText(m.message),
    amountDisplay: optionalText(m.amountDisplay),
  };
}

function validateSuperchatState(m) {
  return { type: m.type, hp: hitPoints(m.hp), maxHp: hitPoints(m.maxHp) };
}

function validateNotice(m) {
  return { type: m.type, text: text(m.text, MAX_TEXT) };
}

/** Every host -> guest message type the guest handles, with its field validator. */
const HOST_MESSAGE_VALIDATORS = new Map([
  [MSG.AUTH_CHALLENGE, validateAuthChallenge],
  [MSG.AUTH_ERROR, validateRejection],
  [MSG.JOIN_REJECTED, validateRejection],
  [MSG.KICKED, validateRejection],
  [MSG.KNOCK_PENDING, validateSignal],
  [MSG.WELCOME, validateWelcome],
  [MSG.IMAGE_START, validateImageStart],
  [MSG.IMAGE_CHUNK, validateImageChunk],
  [MSG.FULL_STATE, validateFullState],
  [MSG.FULL_STATE_CHUNK, validateFullStateChunk],
  [MSG.PIECES_PATCH, validatePiecesPatch],
  [MSG.LOCK_GRANTED, validateLockGranted],
  [MSG.LOCK_DENIED, validateLockDenied],
  [MSG.LOCK_RELEASE, validateLockRelease],
  [MSG.DRAG_PREVIEW, validateDragPreview],
  [MSG.ROSTER_UPDATE, validateRoster],
  [MSG.CURSOR_MOVE, validateCursorMove],
  [MSG.OJAMA_VISUAL, validateOjamaVisual],
  [MSG.OJAMA_VISUAL_CLEAR, validateSignal],
  [MSG.OJAMA_FAKE_PIECES, validateFakePieces],
  [MSG.OJAMA_SUPERCHAT, validateSuperchat],
  [MSG.SUPERCHAT_STATE, validateSuperchatState],
  [MSG.SUPERCHAT_DISMISS, validateSignal],
  [MSG.OJAMA_NOTICE, validateNotice],
  [MSG.PUZZLE_COMPLETED, validateSignal],
]);

/** Logs only the message type (truncated) and the reason, never the message contents. */
function rejectHostMessage(type, reason) {
  const logged = typeof type === 'string' ? type.slice(0, MAX_LOGGED_TYPE) : 'unknown';
  recordDiagnostic('p2p', 'host_message_rejected', { type: logged, reason }, 'warn');
  return null;
}

/**
 * Returns a sanitized copy of a host message containing only the fields the guest reads, or null
 * (after recording a diagnostic) when the message must be ignored. Callers end the join for a
 * null result whose type is in HOST_TRANSFER_TYPES.
 */
export function sanitizeHostMessage(msg) {
  if (!isValidMessage(msg)) return rejectHostMessage(null, 'malformed');
  const validate = HOST_MESSAGE_VALIDATORS.get(msg.type);
  if (!validate) return rejectHostMessage(msg.type, 'unknown_type');
  try {
    return validate(msg);
  } catch {
    return rejectHostMessage(msg.type, 'invalid_fields');
  }
}
