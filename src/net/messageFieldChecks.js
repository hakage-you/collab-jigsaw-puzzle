/**
 * Field checks shared by the guards that validate network messages (guest -> host and
 * host -> guest). Pure predicates: callers decide whether a failure drops the message.
 */
import { NET_LIMITS } from '../config/constants.js';

/** Upper bound of a player id, a reconnect token or a session nonce, in characters. */
export const MAX_PLAYER_ID_LENGTH = 64;
export const MAX_TOKEN_LENGTH = 128;

// Real pieces and groups are positive and bounded by the group filter. Fake (ojama) pieces use
// negative ids from a counter, and guests can drag them, so both signs are allowed.
const MAX_ENTITY_ID = 1e6;

/** Piece or group id: a safe integer of bounded magnitude, either sign. */
export const isEntityId = (v) => Number.isSafeInteger(v) && Math.abs(v) <= MAX_ENTITY_ID;

/** Integer in [0, max]. */
export const isNonNegInt = (v, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(v) && v >= 0 && v <= max;

/** World coordinate: finite and within NET_LIMITS.MAX_ABS_COORD of the origin. */
export const isCoord = (v) =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= NET_LIMITS.MAX_ABS_COORD;

export const isShortString = (v, max) => typeof v === 'string' && v.length <= max;

/** Returns the string cut to `max` characters, or '' for anything that is not a string. */
export const clampText = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
