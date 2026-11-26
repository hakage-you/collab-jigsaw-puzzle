import { beforeEach, describe, expect, it } from 'vitest';
import { NET_LIMITS } from '../../src/config/constants.js';
import { sanitizeGuestMessage } from '../../src/net/guestMessageGuard.js';
import {
  MAX_PLAYER_ID_LENGTH,
  MAX_TOKEN_LENGTH,
  clampText,
  isCoord,
  isEntityId,
  isNonNegInt,
  isShortString,
} from '../../src/net/messageFieldChecks.js';
import { MSG } from '../../src/net/protocol.js';
import { clearDiagnostics, getDiagnosticsState } from '../../src/services/diagnostics.js';

// Guest -> host messages and the shared field checks, field by field and at each limit
// (guestMessageGuard.node.test.js covers the shapes, the rate gate and the typical attacks).

const accepted = (msg) => sanitizeGuestMessage(msg) !== null;

beforeEach(() => {
  clearDiagnostics();
});

describe('shared field checks', () => {
  it.each([
    [1e6, true],
    [-1e6, true],
    [1e6 + 1, false],
    [1.5, false],
    ['1', false],
  ])('isEntityId(%s) is %s', (v, ok) => {
    expect(isEntityId(v)).toBe(ok);
  });

  it.each([
    [0, true],
    [5, true],
    [6, false],
    [-1, false],
    [2.5, false],
  ])('isNonNegInt(%s, 5) is %s', (v, ok) => {
    expect(isNonNegInt(v, 5)).toBe(ok);
  });

  it.each([
    [NET_LIMITS.MAX_ABS_COORD, true],
    [-NET_LIMITS.MAX_ABS_COORD, true],
    [NET_LIMITS.MAX_ABS_COORD + 1, false],
    [Number.NaN, false],
    [Number.NEGATIVE_INFINITY, false],
    ['5', false],
  ])('isCoord(%s) is %s', (v, ok) => {
    expect(isCoord(v)).toBe(ok);
  });

  it.each([
    ['abc', true],
    ['abcd', false],
    [['a'], false],
  ])('isShortString(%j, 3) is %s', (v, ok) => {
    expect(isShortString(v, 3)).toBe(ok);
  });

  it('cuts text and turns anything else into an empty string', () => {
    expect(clampText('abcdef', 3)).toBe('abc');
    expect(clampText(['abc'], 3)).toBe('');
    expect(clampText(undefined, 3)).toBe('');
  });
});

describe('join messages', () => {
  const rejoin = (over = {}) => ({
    type: MSG.REJOIN,
    playerId: 'p'.repeat(MAX_PLAYER_ID_LENGTH),
    reconnectToken: 't'.repeat(MAX_TOKEN_LENGTH),
    displayName: 'n'.repeat(30),
    ...over,
  });

  it('keeps a rejoin request, cutting the name', () => {
    expect(sanitizeGuestMessage({ ...rejoin(), extra: 1 })).toEqual({
      type: MSG.REJOIN,
      playerId: 'p'.repeat(MAX_PLAYER_ID_LENGTH),
      reconnectToken: 't'.repeat(MAX_TOKEN_LENGTH),
      displayName: 'n'.repeat(NET_LIMITS.MAX_NAME_LENGTH),
    });
    expect(sanitizeGuestMessage(rejoin({ displayName: undefined })).displayName).toBe('');
  });

  it.each([
    ['a player id that is too long', { playerId: 'p'.repeat(MAX_PLAYER_ID_LENGTH + 1) }],
    ['a token that is too long', { reconnectToken: 't'.repeat(MAX_TOKEN_LENGTH + 1) }],
    ['a name that is not text', { displayName: 5 }],
  ])('rejects a rejoin with %s', (_, over) => {
    expect(accepted(rejoin(over))).toBe(false);
  });

  it('rejects an auth response whose name is not text', () => {
    expect(accepted({ type: MSG.AUTH_RESPONSE, hash: 'h', displayName: 5 })).toBe(false);
    expect(sanitizeGuestMessage({ type: MSG.AUTH_RESPONSE, hash: 'h' }).displayName).toBe('');
  });

  it.each([MSG.SUPERCHAT_HIT, MSG.PING, MSG.PONG])('%s passes with its type only', (type) => {
    expect(sanitizeGuestMessage({ type, extra: 1 })).toEqual({ type });
  });
});

describe('positions and locks', () => {
  it('keeps the grab point of a lock request only when both coordinates are given', () => {
    expect(sanitizeGuestMessage({ type: MSG.LOCK_REQUEST, groupId: 1, x: 5, y: 6 })).toEqual({
      type: MSG.LOCK_REQUEST,
      groupId: 1,
      x: 5,
      y: 6,
    });
    expect(accepted({ type: MSG.LOCK_REQUEST, groupId: 1, x: 5 })).toBe(false);
    expect(accepted({ type: MSG.LOCK_REQUEST, groupId: 1, y: 5 })).toBe(false);
  });

  it.each([MSG.DRAG_PREVIEW, MSG.DROP_REQUEST])(
    '%s accepts exactly MAX_PIECES positions and no broken entries',
    (type) => {
      const msg = (positions) => ({ type, groupId: 1, positions });
      const full = Array.from({ length: NET_LIMITS.MAX_PIECES }, (_, id) => ({ id, x: 0, y: 0 }));
      expect(accepted(msg(full))).toBe(true);
      expect(accepted(msg([...full, { id: 0, x: 0, y: 0 }]))).toBe(false);
      expect(accepted(msg([null]))).toBe(false);
      expect(accepted(msg([5]))).toBe(false);
    },
  );
});

describe('what a rejection logs', () => {
  const lastLog = () => getDiagnosticsState().entries.at(-1);

  it('logs the category and reason, and the type only for a known message', () => {
    sanitizeGuestMessage({ type: 'set_board_state' });
    expect(lastLog()).toMatchObject({
      category: 'p2p',
      level: 'warn',
      message: 'guest_message_rejected',
      meta: { type: 'unknown', reason: 'unknown_type' },
    });
    sanitizeGuestMessage(null);
    expect(lastLog().meta).toEqual({ type: 'unknown', reason: 'malformed' });
    sanitizeGuestMessage({ type: MSG.CURSOR_MOVE, x: 'a', y: 0 });
    expect(lastLog().meta).toEqual({ type: MSG.CURSOR_MOVE, reason: 'invalid_fields' });
  });
});
