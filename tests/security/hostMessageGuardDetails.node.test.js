import { beforeEach, describe, expect, it } from 'vitest';
import { MULTIPLAYER_CONFIG, NET_LIMITS, OJAMA_CONFIG } from '../../src/config/constants.js';
import { sanitizeHostMessage } from '../../src/net/hostMessageGuard.js';
import { MSG } from '../../src/net/protocol.js';
import { clearDiagnostics, getDiagnosticsState } from '../../src/services/diagnostics.js';

// S7, field by field: every host message type, every allowed value and every limit at its edge
// (hostMessageGuard.node.test.js covers the shapes and the typical attacks).

const ROOM_RULES = {
  cols: 4,
  rows: 3,
  cutComplexity: 'standard',
  allowRotation: true,
  allowFlip: false,
};
const PIECE = {
  id: 3,
  x: 10,
  y: 20,
  rotation: 1,
  isFlipped: false,
  groupId: 3,
  isLocked: false,
  zOrder: 5,
};
const accepted = (msg) => sanitizeHostMessage(msg) !== null;

beforeEach(() => {
  clearDiagnostics();
});

describe('messages without fields', () => {
  it.each([
    MSG.KNOCK_PENDING,
    MSG.OJAMA_VISUAL_CLEAR,
    MSG.SUPERCHAT_DISMISS,
    MSG.PUZZLE_COMPLETED,
    MSG.PING,
    MSG.PONG,
  ])('%s passes with its type only', (type) => {
    expect(sanitizeHostMessage({ type, extra: 'dropped' })).toEqual({ type });
  });
});

describe('join messages', () => {
  it('keeps the auth nonce up to the token length', () => {
    const nonce = 'n'.repeat(128);
    expect(sanitizeHostMessage({ type: MSG.AUTH_CHALLENGE, nonce, x: 1 })).toEqual({
      type: MSG.AUTH_CHALLENGE,
      nonce,
    });
    expect(accepted({ type: MSG.AUTH_CHALLENGE, nonce: `${nonce}n` })).toBe(false);
    expect(accepted({ type: MSG.AUTH_CHALLENGE, nonce: 5 })).toBe(false);
  });

  it.each([MSG.AUTH_ERROR, MSG.JOIN_REJECTED, MSG.KICKED])(
    '%s keeps an optional reason, cut to the text limit',
    (type) => {
      expect(sanitizeHostMessage({ type, reason: 'r'.repeat(300) })).toEqual({
        type,
        reason: 'r'.repeat(NET_LIMITS.MAX_TEXT_LENGTH),
      });
      expect(sanitizeHostMessage({ type })).toEqual({ type, reason: undefined });
      expect(accepted({ type, reason: 3 })).toBe(false);
    },
  );

  const welcome = (over = {}) => ({
    type: MSG.WELCOME,
    playerId: 'p1',
    reconnectToken: 'tok',
    color: '#123456',
    roomRules: ROOM_RULES,
    ...over,
  });

  it('fills in an empty roster and keeps the optional image fields of a welcome', () => {
    const clean = sanitizeHostMessage(
      welcome({
        isSampleImage: true,
        sampleImageId: 's'.repeat(40),
        imageHash: 'hash',
        totalChunks: NET_LIMITS.MAX_IMAGE_CHUNKS,
        roomRules: { ...ROOM_RULES, capacity: MULTIPLAYER_CONFIG.MAX_CAPACITY },
      }),
    );
    expect(clean).toMatchObject({
      roster: [],
      isSampleImage: true,
      sampleImageId: 's'.repeat(32),
      imageHash: 'hash',
      totalChunks: NET_LIMITS.MAX_IMAGE_CHUNKS,
    });
    expect(clean.roomRules.capacity).toBe(MULTIPLAYER_CONFIG.MAX_CAPACITY);
  });

  it.each([
    ['too many image chunks', { totalChunks: NET_LIMITS.MAX_IMAGE_CHUNKS + 1 }],
    ['a capacity over the maximum', { roomRules: { ...ROOM_RULES, capacity: 9 } }],
    ['an image hash that is not text', { imageHash: 5 }],
    ['a sample image id that is not text', { sampleImageId: 5 }],
    ['a roster that is not a list', { roster: 'host' }],
  ])('rejects a welcome with %s', (_, over) => {
    expect(accepted(welcome(over))).toBe(false);
  });
});

describe('locks and hops', () => {
  it('keeps a lock grant with or without a z order', () => {
    const grant = { type: MSG.LOCK_GRANTED, groupId: 4, ownerId: 'p1', zOrder: 1e9 };
    expect(sanitizeHostMessage(grant)).toEqual(grant);
    expect(sanitizeHostMessage({ ...grant, zOrder: undefined }).zOrder).toBeUndefined();
    expect(accepted({ ...grant, zOrder: 1e9 + 1 })).toBe(false);
    expect(accepted({ ...grant, ownerId: 'o'.repeat(65) })).toBe(false);
  });

  it('keeps a lock release and a lock denial with an owner', () => {
    expect(sanitizeHostMessage({ type: MSG.LOCK_RELEASE, groupId: -2, x: 1 })).toEqual({
      type: MSG.LOCK_RELEASE,
      groupId: -2,
    });
    expect(sanitizeHostMessage({ type: MSG.LOCK_DENIED, groupId: 1, ownerId: 'p2' })).toMatchObject(
      {
        ownerId: 'p2',
      },
    );
    expect(sanitizeHostMessage({ type: MSG.LOCK_DENIED, groupId: 1 }).ownerId).toBeNull();
  });

  it('keeps who made a piece hop, or none', () => {
    const hop = { type: MSG.PIECE_HOP, groupId: 1, positions: [{ id: 1, x: 2, y: 3 }] };
    expect(sanitizeHostMessage(hop).byPlayerId).toBeNull();
    expect(sanitizeHostMessage({ ...hop, byPlayerId: null }).byPlayerId).toBeNull();
    expect(sanitizeHostMessage({ ...hop, byPlayerId: 'p1' }).byPlayerId).toBe('p1');
    expect(accepted({ ...hop, byPlayerId: 7 })).toBe(false);
  });

  it('accepts lock tables of pairs only', () => {
    const msg = (locks) => ({ type: MSG.PIECES_PATCH, pieces: [PIECE], locks });
    expect(sanitizeHostMessage(msg([[1, 'p1']])).locks).toEqual([[1, 'p1']]);
    expect(accepted(msg([[1]]))).toBe(false);
    expect(accepted(msg(['ab']))).toBe(false);
  });
});

describe('piece patches', () => {
  const patch = (over = {}) => ({ type: MSG.PIECES_PATCH, pieces: [PIECE], ...over });

  it('keeps the result of the action, cutting its type', () => {
    const actionResult = { type: 'm'.repeat(40), opSeq: 7, count: 3000, completed: true, x: 1 };
    expect(sanitizeHostMessage(patch({ actionResult })).actionResult).toEqual({
      type: 'm'.repeat(32),
      opSeq: 7,
      count: 3000,
      completed: true,
    });
    expect(sanitizeHostMessage(patch({ actionResult: { type: 'snap' } })).actionResult).toEqual({
      type: 'snap',
    });
    expect(sanitizeHostMessage(patch()).actionResult).toBeUndefined();
  });

  it.each([
    ['a count over the piece limit', { count: 3001 }],
    ['a fractional sequence number', { opSeq: 1.5 }],
    ['a completion flag that is not a boolean', { completed: 1 }],
    ['a type that is not text', { type: 3 }],
  ])('rejects an action result with %s', (_, result) => {
    expect(accepted(patch({ actionResult: { type: 'snap', ...result } }))).toBe(false);
  });

  it('keeps zone labels, the actor and the final chunk flag', () => {
    const clean = sanitizeHostMessage(
      patch({
        zoneLabels: [{ text: 't'.repeat(300), x: 1, y: 2, extra: 1 }],
        actorId: 'p1',
        isFinalChunk: false,
      }),
    );
    expect(clean.zoneLabels).toEqual([{ text: 't'.repeat(200), x: 1, y: 2 }]);
    expect([clean.actorId, clean.isFinalChunk]).toEqual(['p1', false]);
    expect(accepted(patch({ zoneLabels: [{ text: 'a', x: 'x', y: 0 }] }))).toBe(false);
  });

  it('accepts exactly MAX_PIECES pieces', () => {
    const pieces = Array.from({ length: NET_LIMITS.MAX_PIECES }, () => PIECE);
    expect(accepted(patch({ pieces }))).toBe(true);
  });
});

describe('full state and image transfers', () => {
  const fullState = (over = {}) => ({
    type: MSG.FULL_STATE,
    saveData: { puzzle: {} },
    roomRules: ROOM_RULES,
    ...over,
  });

  it('accepts a save without inline pieces, or with up to MAX_PIECES of them', () => {
    expect(accepted(fullState())).toBe(true);
    const pieces = Array.from({ length: NET_LIMITS.MAX_PIECES }, () => ({}));
    expect(accepted(fullState({ saveData: { pieces } }))).toBe(true);
    expect(accepted(fullState({ saveData: { pieces: 'x' } }))).toBe(false);
  });

  it('accepts chunk text of exactly the chunk size, in base64 only', () => {
    const chunk = (data) => ({ type: MSG.IMAGE_CHUNK, index: 0, data });
    expect(accepted(chunk('A'.repeat(MULTIPLAYER_CONFIG.IMAGE_CHUNK_BYTES)))).toBe(true);
    expect(accepted(chunk('A'))).toBe(true);
    expect(accepted(chunk(''))).toBe(false);
    expect(accepted(chunk('A'.repeat(MULTIPLAYER_CONFIG.IMAGE_CHUNK_BYTES + 1)))).toBe(false);
  });
});

describe('ojama messages', () => {
  it.each(['grayscale', 'sepia', 'hue', 'spotlight', 'ghost', 'mist'])(
    'accepts the visual ojama %s',
    (visualType) => {
      expect(accepted({ type: MSG.OJAMA_VISUAL, visualType, duration: 600 })).toBe(true);
    },
  );

  it('bounds durations at exactly the maximum', () => {
    const visual = { type: MSG.OJAMA_VISUAL, visualType: 'hue' };
    expect(accepted({ ...visual, duration: NET_LIMITS.MAX_OJAMA_DURATION_SEC })).toBe(true);
    expect(accepted({ ...visual, duration: NET_LIMITS.MAX_OJAMA_DURATION_SEC + 0.5 })).toBe(false);
    expect(accepted({ ...visual, duration: Number.POSITIVE_INFINITY })).toBe(false);
    expect(accepted({ ...visual, duration: '5' })).toBe(false);
  });

  it.each(['drop', 'visual', 'ghost', 'prank', 'fake', 'heavy', 'runaway'])(
    'keeps the notice kind %s',
    (kind) => {
      expect(sanitizeHostMessage({ type: MSG.OJAMA_NOTICE, text: 'x', kind }).kind).toBe(kind);
    },
  );

  it.each([
    ['heavy', undefined],
    ['runaway', undefined],
    ...Object.keys(OJAMA_CONFIG.HEAVY_LEVELS).map((level) => ['heavy', level]),
  ])('accepts the timed ojama %s (level %s)', (kind, level) => {
    expect(sanitizeHostMessage({ type: MSG.OJAMA_TIMED, kind, remaining: 30, level })).toEqual({
      type: MSG.OJAMA_TIMED,
      kind,
      remaining: 30,
      level,
    });
  });
});

describe('names and colours', () => {
  const cursor = (over) => ({ type: MSG.CURSOR_MOVE, playerId: 'p1', x: 0, y: 0, ...over });

  it.each([
    ['#abc', '#abc'],
    ['#12345678', '#12345678'],
    ['var(--accent)', 'var(--accent)'],
    ['red#abc', '#888888'],
    ['#abc;x', '#888888'],
    [5, '#888888'],
  ])('shows the colour %s as %s', (color, shown) => {
    expect(sanitizeHostMessage(cursor({ color })).color).toBe(shown);
  });

  it('defaults a missing cursor name to empty and rejects one that is not text', () => {
    expect(sanitizeHostMessage(cursor({})).name).toBe('');
    expect(accepted(cursor({ name: 5 }))).toBe(false);
  });
});

describe('what a rejection logs', () => {
  const lastLog = () => getDiagnosticsState().entries.at(-1);

  it('logs the category, the message type cut to 40 characters and the reason', () => {
    sanitizeHostMessage({ type: 'x'.repeat(50) });
    expect(lastLog()).toMatchObject({
      category: 'p2p',
      level: 'warn',
      message: 'host_message_rejected',
      meta: { type: 'x'.repeat(40), reason: 'unknown_type' },
    });
    sanitizeHostMessage({ type: 5 });
    expect(lastLog().meta).toEqual({ type: 'unknown', reason: 'malformed' });
    sanitizeHostMessage({ type: MSG.LOCK_RELEASE, groupId: 'x' });
    expect(lastLog().meta).toEqual({ type: MSG.LOCK_RELEASE, reason: 'invalid_fields' });
  });
});
