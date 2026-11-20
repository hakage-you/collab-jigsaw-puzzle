import { beforeEach, describe, expect, it } from 'vitest';
import { NET_LIMITS } from '../../src/config/constants.js';
import { clearDiagnostics, getDiagnosticsState } from '../../src/services/diagnostics.js';
import {
  RATE_DROPPED,
  RATE_FLOOD,
  RATE_OK,
  createRateGate,
  sanitizeGuestMessage,
} from '../../src/net/guestMessageGuard.js';
import { MSG } from '../../src/net/protocol.js';

// S3/S4 (security assessment 2026-11-21): the host must accept only well-formed guest messages.
// These tests cover the validators and the token bucket directly; hostileGuest.test.js covers
// the same rules end to end through a real room.

const pos = (id, x = 10, y = 10) => ({ id, x, y });

beforeEach(() => {
  clearDiagnostics();
});

function rejectedDiagnostics() {
  return JSON.stringify(getDiagnosticsState()).match(/guest_message_rejected/g) || [];
}

describe('sanitizeGuestMessage: accepted shapes', () => {
  it('keeps only the known fields of each guest message type', () => {
    expect(sanitizeGuestMessage({ type: MSG.CURSOR_MOVE, x: 1.5, y: -2, extra: 'x' })).toEqual({
      type: MSG.CURSOR_MOVE,
      x: 1.5,
      y: -2,
    });
    expect(sanitizeGuestMessage({ type: MSG.LOCK_REQUEST, groupId: 3 })).toEqual({
      type: MSG.LOCK_REQUEST,
      groupId: 3,
    });
    expect(sanitizeGuestMessage({ type: MSG.SUPERCHAT_HIT })).toEqual({
      type: MSG.SUPERCHAT_HIT,
    });
    expect(sanitizeGuestMessage({ type: MSG.IMAGE_ACK, needImage: true })).toEqual({
      type: MSG.IMAGE_ACK,
      needImage: true,
    });
  });

  it('accepts drag and drop positions with the bounds of the protocol', () => {
    const drop = {
      type: MSG.DROP_REQUEST,
      groupId: 7,
      positions: [pos(7, 0, 0), pos(8, -NET_LIMITS.MAX_ABS_COORD, NET_LIMITS.MAX_ABS_COORD)],
    };
    expect(sanitizeGuestMessage(drop)).toEqual(drop);
  });

  it('accepts negative ids of fake (ojama) pieces, which guests may drag and turn', () => {
    expect(sanitizeGuestMessage({ type: MSG.LOCK_REQUEST, groupId: -7 })).toEqual({
      type: MSG.LOCK_REQUEST,
      groupId: -7,
    });
    const drop = {
      type: MSG.DROP_REQUEST,
      groupId: -7,
      positions: [pos(-7, 20, 30)],
    };
    expect(sanitizeGuestMessage(drop)).toEqual(drop);
    expect(sanitizeGuestMessage({ type: MSG.ROTATE_REQUEST, pieceId: -7, opSeq: 2 })).toEqual({
      type: MSG.ROTATE_REQUEST,
      pieceId: -7,
      opSeq: 2,
    });
  });

  it('accepts rotate and flip requests with a piece id and an operation number', () => {
    expect(sanitizeGuestMessage({ type: MSG.ROTATE_REQUEST, pieceId: 4, opSeq: 0 })).toEqual({
      type: MSG.ROTATE_REQUEST,
      pieceId: 4,
      opSeq: 0,
    });
    expect(sanitizeGuestMessage({ type: MSG.FLIP_REQUEST, pieceId: 4, opSeq: 9 })).toEqual({
      type: MSG.FLIP_REQUEST,
      pieceId: 4,
      opSeq: 9,
    });
  });

  it('truncates overlong display names to the name limit', () => {
    const clean = sanitizeGuestMessage({
      type: MSG.AUTH_RESPONSE,
      hash: 'abc',
      displayName: 'a'.repeat(5000),
    });
    expect(clean.displayName).toHaveLength(NET_LIMITS.MAX_NAME_LENGTH);
  });
});

describe('sanitizeGuestMessage: rejected messages', () => {
  it.each([
    ['NaN cursor', { type: MSG.CURSOR_MOVE, x: Number.NaN, y: 0 }],
    ['Infinity cursor', { type: MSG.CURSOR_MOVE, x: 0, y: Number.POSITIVE_INFINITY }],
    ['string coordinate', { type: MSG.CURSOR_MOVE, x: '5', y: 0 }],
    ['coordinate beyond the bound', { type: MSG.CURSOR_MOVE, x: 1e9, y: 0 }],
    ['group id beyond the id bound', { type: MSG.LOCK_REQUEST, groupId: -1e6 - 1 }],
    ['fractional group id', { type: MSG.LOCK_REQUEST, groupId: 1.5 }],
    ['missing group id', { type: MSG.LOCK_REQUEST }],
    ['positions that is not an array', { type: MSG.DRAG_PREVIEW, groupId: 1, positions: 'x' }],
    [
      'positions over the piece limit',
      {
        type: MSG.DRAG_PREVIEW,
        groupId: 1,
        positions: Array.from({ length: NET_LIMITS.MAX_PIECES + 1 }, (_, i) => pos(i)),
      },
    ],
    [
      'one position with a NaN coordinate',
      { type: MSG.DROP_REQUEST, groupId: 1, positions: [pos(1), { id: 1, x: Number.NaN, y: 0 }] },
    ],
    [
      'one position with a coordinate beyond the bound',
      { type: MSG.DROP_REQUEST, groupId: 1, positions: [{ id: 1, x: 0, y: 1e9 }] },
    ],
    ['position without an id', { type: MSG.DROP_REQUEST, groupId: 1, positions: [{ x: 1, y: 1 }] }],
    ['null in the positions', { type: MSG.DRAG_PREVIEW, groupId: 1, positions: [null] }],
    ['rotate without an operation number', { type: MSG.ROTATE_REQUEST, pieceId: 1 }],
    ['piece id beyond the id bound', { type: MSG.FLIP_REQUEST, pieceId: 1e6 + 1, opSeq: 1 }],
    ['negative operation number', { type: MSG.FLIP_REQUEST, pieceId: 3, opSeq: -1 }],
    ['non-boolean image ack', { type: MSG.IMAGE_ACK, needImage: 'yes' }],
    ['non-string auth hash', { type: MSG.AUTH_RESPONSE, hash: 42 }],
    [
      'overlong rejoin token',
      { type: MSG.REJOIN, playerId: 'p-1', reconnectToken: 'x'.repeat(500) },
    ],
    ['non-string display name', { type: MSG.AUTH_RESPONSE, hash: 'h', displayName: 7 }],
  ])('rejects %s', (_label, msg) => {
    expect(sanitizeGuestMessage(msg)).toBeNull();
  });

  it('rejects message types the guest is not allowed to send', () => {
    for (const type of [MSG.FULL_STATE, MSG.PIECES_PATCH, MSG.LOCK_GRANTED, 'no_such_type']) {
      expect(sanitizeGuestMessage({ type, groupId: 1 })).toBeNull();
    }
  });

  it('rejects values that are not messages', () => {
    expect(sanitizeGuestMessage(null)).toBeNull();
    expect(sanitizeGuestMessage('drop')).toBeNull();
    expect(sanitizeGuestMessage({})).toBeNull();
  });

  it('records each rejection as a warning with only the type and reason', () => {
    sanitizeGuestMessage({ type: MSG.CURSOR_MOVE, x: Number.NaN, y: 0, name: 'SECRET-NAME' });
    sanitizeGuestMessage({ type: 'mystery', text: 'SECRET-TEXT' });
    expect(rejectedDiagnostics()).toHaveLength(2);
    const state = JSON.stringify(getDiagnosticsState());
    expect(state).toContain('invalid_fields');
    expect(state).toContain('unknown_type');
    expect(state).not.toContain('SECRET');
  });
});

describe('createRateGate', () => {
  it('admits a full burst and then drops at the refill rate', () => {
    const gate = createRateGate();
    let admitted = 0;
    for (let i = 0; i < NET_LIMITS.RATE_BURST + 50; i++) {
      if (gate.admit(1000) === RATE_OK) admitted++;
    }
    expect(admitted).toBe(NET_LIMITS.RATE_BURST);
    expect(gate.admit(1000)).toBe(RATE_DROPPED);
    // One second later the bucket has refilled RATE_TOKENS_PER_SEC tokens.
    let refilled = 0;
    for (let i = 0; i < NET_LIMITS.RATE_TOKENS_PER_SEC + 10; i++) {
      if (gate.admit(2000) === RATE_OK) refilled++;
    }
    expect(refilled).toBe(NET_LIMITS.RATE_TOKENS_PER_SEC);
  });

  it('never drops a steady 20 Hz cursor plus drag stream', () => {
    const gate = createRateGate();
    // Cursor and drag preview each at 20 Hz: two messages every 50 ms.
    for (let t = 0; t <= 10000; t += 50) {
      expect(gate.admit(t)).toBe(RATE_OK);
      expect(gate.admit(t)).toBe(RATE_OK);
    }
  });

  it('reports a flood only after dropping continuously for FLOOD_KICK_AFTER_MS', () => {
    const gate = createRateGate();
    let floodAt = null;
    // 200 messages per second, far above the refill rate, until the gate reports a flood.
    for (let t = 0; t <= 20000 && floodAt === null; t += 100) {
      for (let i = 0; i < 20; i++) {
        if (gate.admit(t) === RATE_FLOOD) {
          floodAt = t;
          break;
        }
      }
    }
    expect(floodAt).not.toBeNull();
    expect(floodAt).toBeGreaterThanOrEqual(NET_LIMITS.FLOOD_KICK_AFTER_MS);
  });

  it('restarts the flood timer after a quiet period', () => {
    const gate = createRateGate();
    for (let i = 0; i < NET_LIMITS.RATE_BURST; i++) gate.admit(0);
    expect(gate.admit(0)).toBe(RATE_DROPPED);
    // A long pause refills the bucket completely, which ends the drop streak.
    expect(gate.admit(60000)).toBe(RATE_OK);
    for (let i = 0; i < NET_LIMITS.RATE_BURST; i++) gate.admit(60000);
    // A new streak starts now: it is dropped, but not yet a flood.
    expect(gate.admit(60000)).toBe(RATE_DROPPED);
    expect(gate.admit(60000)).toBe(RATE_DROPPED);
  });

  it('treats a clock that goes backwards as no time passing', () => {
    const gate = createRateGate();
    for (let i = 0; i < NET_LIMITS.RATE_BURST; i++) gate.admit(5000);
    expect(gate.admit(1000)).toBe(RATE_DROPPED);
  });
});
