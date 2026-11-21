import { beforeEach, describe, expect, it } from 'vitest';
import { MULTIPLAYER_CONFIG, NET_LIMITS } from '../../src/config/constants.js';
import { clearDiagnostics, getDiagnosticsState } from '../../src/services/diagnostics.js';
import { HOST_TRANSFER_TYPES, sanitizeHostMessage } from '../../src/net/hostMessageGuard.js';
import { MSG } from '../../src/net/protocol.js';

// S7 (security assessment 2026-11-21): the guest accepts only well-formed host messages. These
// tests cover the validators directly; hostileHost.test.js covers the same rules end to end.

const ROOM_RULES = {
  cols: 4,
  rows: 3,
  cutComplexity: 'standard',
  allowRotation: true,
  allowFlip: false,
  showStats: true,
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
const ROSTER_ENTRY = {
  id: 'host',
  name: 'ホスト',
  color: 'var(--accent)',
  role: 'host',
  contrib: 0,
  online: true,
};

beforeEach(() => {
  clearDiagnostics();
});

function rejectedDiagnostics() {
  return JSON.stringify(getDiagnosticsState()).match(/host_message_rejected/g) || [];
}

const patch = (overrides = {}) => ({
  type: MSG.PIECES_PATCH,
  pieces: [PIECE],
  actorId: 'host',
  isFinalChunk: true,
  ...overrides,
});

describe('sanitizeHostMessage: accepted shapes', () => {
  it('accepts the welcome shape and keeps the fields the guest reads', () => {
    const clean = sanitizeHostMessage({
      type: MSG.WELCOME,
      playerId: 'p-1',
      reconnectToken: 'token',
      color: '#1d4ed8',
      roomRules: ROOM_RULES,
      roster: [ROSTER_ENTRY],
      imageHash: 'abc123',
      isSampleImage: false,
      extra: 'dropped',
    });
    expect(clean).toMatchObject({
      type: MSG.WELCOME,
      playerId: 'p-1',
      color: '#1d4ed8',
      roomRules: ROOM_RULES,
      roster: [ROSTER_ENTRY],
    });
    expect(clean).not.toHaveProperty('extra');
  });

  it('keeps every piece field of a patch and drops unknown ones', () => {
    const clean = sanitizeHostMessage(patch({ pieces: [{ ...PIECE, junk: 1 }] }));
    expect(clean.pieces).toEqual([PIECE]);
  });

  it('accepts negative ids of fake (ojama) pieces', () => {
    const clean = sanitizeHostMessage(patch({ pieces: [{ ...PIECE, id: -4, groupId: -4 }] }));
    expect(clean.pieces[0]).toMatchObject({ id: -4, groupId: -4 });
  });

  it('accepts a lock denial without pieces and with a null owner', () => {
    expect(sanitizeHostMessage({ type: MSG.LOCK_DENIED, groupId: 2, ownerId: null })).toMatchObject(
      { groupId: 2, ownerId: null },
    );
  });

  it('accepts a small image transfer header and chunk', () => {
    expect(
      sanitizeHostMessage({
        type: MSG.IMAGE_START,
        totalChunks: 1,
        mimeType: 'image/webp',
        width: 960,
        height: 640,
        byteLength: 123,
      }),
    ).toEqual({
      type: MSG.IMAGE_START,
      totalChunks: 1,
      mimeType: 'image/webp',
      width: 960,
      height: 640,
    });
    expect(sanitizeHostMessage({ type: MSG.IMAGE_CHUNK, index: 0, data: 'QUJD+/==' })).toEqual({
      type: MSG.IMAGE_CHUNK,
      index: 0,
      data: 'QUJD+/==',
    });
  });

  it('knows which types are transfers', () => {
    expect([...HOST_TRANSFER_TYPES].sort()).toEqual(
      [MSG.FULL_STATE, MSG.FULL_STATE_CHUNK, MSG.IMAGE_CHUNK, MSG.IMAGE_START].sort(),
    );
    expect(HOST_TRANSFER_TYPES.has(MSG.PIECES_PATCH)).toBe(false);
  });
});

describe('sanitizeHostMessage: unknown and malformed messages', () => {
  it('rejects non-objects, missing types and unknown types', () => {
    expect(sanitizeHostMessage(null)).toBeNull();
    expect(sanitizeHostMessage('pieces')).toBeNull();
    expect(sanitizeHostMessage({})).toBeNull();
    expect(sanitizeHostMessage({ type: 'set_board_state', x: 1 })).toBeNull();
    expect(rejectedDiagnostics().length).toBeGreaterThanOrEqual(1);
  });
});

describe('sanitizeHostMessage: image transfer', () => {
  const start = (overrides = {}) => ({
    type: MSG.IMAGE_START,
    totalChunks: 4,
    mimeType: 'image/webp',
    width: 100,
    height: 100,
    ...overrides,
  });

  it('bounds the chunk count to [1, MAX_IMAGE_CHUNKS]', () => {
    for (const totalChunks of [0, -1, 1.5, '3', 1e9, NET_LIMITS.MAX_IMAGE_CHUNKS + 1]) {
      expect(sanitizeHostMessage(start({ totalChunks }))).toBeNull();
    }
    expect(sanitizeHostMessage(start({ totalChunks: 1 }))).not.toBeNull();
    expect(sanitizeHostMessage(start({ totalChunks: NET_LIMITS.MAX_IMAGE_CHUNKS }))).not.toBeNull();
  });

  it('accepts only the image mime types', () => {
    expect(sanitizeHostMessage(start({ mimeType: 'text/html' }))).toBeNull();
    expect(sanitizeHostMessage(start({ mimeType: 'image/svg+xml' }))).toBeNull();
    expect(sanitizeHostMessage(start({ mimeType: undefined }))).toBeNull();
    for (const mimeType of NET_LIMITS.IMAGE_MIME_TYPES) {
      expect(sanitizeHostMessage(start({ mimeType }))).not.toBeNull();
    }
  });

  it('rejects declared sizes outside [1, MAX_IMAGE_DIM]', () => {
    expect(sanitizeHostMessage(start({ width: NET_LIMITS.MAX_IMAGE_DIM + 1 }))).toBeNull();
    expect(sanitizeHostMessage(start({ height: 0 }))).toBeNull();
    expect(sanitizeHostMessage(start({ width: NET_LIMITS.MAX_IMAGE_DIM }))).not.toBeNull();
  });

  it('requires chunk indexes in range and base64 chunk text of bounded length', () => {
    const chunk = (overrides = {}) => ({
      type: MSG.IMAGE_CHUNK,
      index: 0,
      data: 'QUJD',
      ...overrides,
    });
    expect(sanitizeHostMessage(chunk({ index: -1 }))).toBeNull();
    expect(sanitizeHostMessage(chunk({ index: 1.5 }))).toBeNull();
    expect(sanitizeHostMessage(chunk({ index: NET_LIMITS.MAX_IMAGE_CHUNKS }))).toBeNull();
    expect(sanitizeHostMessage(chunk({ data: '' }))).toBeNull();
    expect(sanitizeHostMessage(chunk({ data: 'QUJD<script>' }))).toBeNull();
    expect(sanitizeHostMessage(chunk({ data: 'QUJD\n' }))).toBeNull();
    const tooLong = 'A'.repeat(MULTIPLAYER_CONFIG.IMAGE_CHUNK_BYTES + 1);
    expect(sanitizeHostMessage(chunk({ data: tooLong }))).toBeNull();
    expect(sanitizeHostMessage(chunk({ index: NET_LIMITS.MAX_IMAGE_CHUNKS - 1 }))).not.toBeNull();
  });
});

describe('sanitizeHostMessage: full state transfer', () => {
  const header = (overrides = {}) => ({
    type: MSG.FULL_STATE,
    saveData: { pieces: [] },
    roomRules: ROOM_RULES,
    roster: [],
    locks: [],
    zoneLabels: [],
    totalPieceChunks: 2,
    ...overrides,
  });

  it('bounds the chunk count to [1, MAX_STATE_CHUNKS]', () => {
    expect(sanitizeHostMessage(header({ totalPieceChunks: 1e6 }))).toBeNull();
    expect(sanitizeHostMessage(header({ totalPieceChunks: 0 }))).toBeNull();
    expect(
      sanitizeHostMessage(header({ totalPieceChunks: NET_LIMITS.MAX_STATE_CHUNKS + 1 })),
    ).toBeNull();
    expect(
      sanitizeHostMessage(header({ totalPieceChunks: NET_LIMITS.MAX_STATE_CHUNKS })),
    ).not.toBeNull();
  });

  it('requires an object save and a bounded inline piece list', () => {
    expect(sanitizeHostMessage(header({ saveData: 'x' }))).toBeNull();
    expect(sanitizeHostMessage(header({ saveData: null }))).toBeNull();
    const pieces = Array.from({ length: NET_LIMITS.MAX_PIECES + 1 }, () => ({}));
    expect(sanitizeHostMessage(header({ saveData: { pieces } }))).toBeNull();
  });

  it('rejects room rules with non-boolean flags or non-numeric sizes', () => {
    expect(
      sanitizeHostMessage(header({ roomRules: { ...ROOM_RULES, allowFlip: 'yes' } })),
    ).toBeNull();
    expect(sanitizeHostMessage(header({ roomRules: { ...ROOM_RULES, cols: '4' } }))).toBeNull();
  });

  it('bounds each full state chunk to MAX_PIECES objects and a valid index', () => {
    const chunk = (overrides = {}) => ({
      type: MSG.FULL_STATE_CHUNK,
      chunkIndex: 0,
      pieces: [{}],
      ...overrides,
    });
    expect(sanitizeHostMessage(chunk({ chunkIndex: NET_LIMITS.MAX_STATE_CHUNKS }))).toBeNull();
    expect(sanitizeHostMessage(chunk({ pieces: [null] }))).toBeNull();
    const pieces = Array.from({ length: NET_LIMITS.MAX_PIECES + 1 }, () => ({}));
    expect(sanitizeHostMessage(chunk({ pieces }))).toBeNull();
    expect(sanitizeHostMessage(chunk())).not.toBeNull();
  });
});

describe('sanitizeHostMessage: piece lists', () => {
  it('rejects non-finite or out-of-bounds coordinates', () => {
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, NET_LIMITS.MAX_ABS_COORD + 1, '5']) {
      expect(sanitizeHostMessage(patch({ pieces: [{ ...PIECE, x }] }))).toBeNull();
    }
  });

  it('rejects rotations outside 0..3 and non-boolean flags', () => {
    expect(sanitizeHostMessage(patch({ pieces: [{ ...PIECE, rotation: 4 }] }))).toBeNull();
    expect(sanitizeHostMessage(patch({ pieces: [{ ...PIECE, rotation: -1 }] }))).toBeNull();
    expect(sanitizeHostMessage(patch({ pieces: [{ ...PIECE, isFlipped: 1 }] }))).toBeNull();
    expect(sanitizeHostMessage(patch({ pieces: [{ ...PIECE, isLocked: 'no' }] }))).toBeNull();
  });

  it('rejects lists longer than MAX_PIECES and ids beyond the entity bound', () => {
    const pieces = Array.from({ length: NET_LIMITS.MAX_PIECES + 1 }, () => PIECE);
    expect(sanitizeHostMessage(patch({ pieces }))).toBeNull();
    expect(sanitizeHostMessage(patch({ pieces: [{ ...PIECE, id: 1e7 }] }))).toBeNull();
  });

  it('validates drag previews and drop positions', () => {
    const drag = { type: MSG.DRAG_PREVIEW, groupId: 3, ownerId: 'p-2', positions: [] };
    expect(sanitizeHostMessage({ ...drag, positions: [{ id: 'x', x: 0, y: 0 }] })).toBeNull();
    expect(sanitizeHostMessage({ ...drag, positions: [{ id: 3, x: 1, y: 2, z: 9 }] })).toEqual({
      type: MSG.DRAG_PREVIEW,
      groupId: 3,
      ownerId: 'p-2',
      positions: [{ id: 3, x: 1, y: 2 }],
    });
  });

  it('rejects a lock table whose entries are not [groupId, owner] pairs', () => {
    expect(sanitizeHostMessage(patch({ locks: [[1]] }))).toBeNull();
    expect(sanitizeHostMessage(patch({ locks: [['a', 'host']] }))).toBeNull();
    expect(sanitizeHostMessage(patch({ locks: [[1, 'host']] }))).toMatchObject({
      locks: [[1, 'host']],
    });
  });

  it('rejects stats with missing or non-finite counters', () => {
    const stats = {
      elapsedMs: 1,
      placedCount: 2,
      ojamaTotal: 0,
      ojamaBreakdown: { drop: 0, visual: 0, superchat: 0, prank: 0, fake: 0 },
    };
    expect(sanitizeHostMessage(patch({ stats }))).toMatchObject({ stats });
    expect(sanitizeHostMessage(patch({ stats: { ...stats, placedCount: Number.NaN } }))).toBeNull();
    expect(sanitizeHostMessage(patch({ stats: { ...stats, ojamaBreakdown: {} } }))).toBeNull();
  });
});

describe('sanitizeHostMessage: roster, names and colours', () => {
  it('cuts the roster to MAX_CAPACITY (offline guests stay listed on the host)', () => {
    const roster = Array.from({ length: MULTIPLAYER_CONFIG.MAX_CAPACITY + 3 }, (_, i) => ({
      ...ROSTER_ENTRY,
      id: `g${i}`,
      role: 'guest',
      online: false,
    }));
    const clean = sanitizeHostMessage({ type: MSG.ROSTER_UPDATE, roster });
    expect(clean.roster).toHaveLength(MULTIPLAYER_CONFIG.MAX_CAPACITY);
  });

  it('cuts names to MAX_NAME_LENGTH', () => {
    const name = 'あ'.repeat(NET_LIMITS.MAX_NAME_LENGTH + 10);
    const clean = sanitizeHostMessage({
      type: MSG.CURSOR_MOVE,
      playerId: 'p-1',
      x: 1,
      y: 2,
      name,
      color: '#fff',
    });
    expect(clean.name).toHaveLength(NET_LIMITS.MAX_NAME_LENGTH);
  });

  it('replaces colours that are not #hex or the accent variable', () => {
    const colorOf = (color) =>
      sanitizeHostMessage({ type: MSG.CURSOR_MOVE, playerId: 'p', x: 0, y: 0, name: 'n', color })
        .color;
    expect(colorOf('#abc')).toBe('#abc');
    expect(colorOf('#12345678')).toBe('#12345678');
    expect(colorOf('var(--accent)')).toBe('var(--accent)');
    expect(colorOf('#1234567890')).toBe('#888888');
    expect(colorOf('red')).toBe('#888888');
    expect(colorOf('url(javascript:alert(1))')).toBe('#888888');
  });

  it('rejects a cursor whose player id is too long', () => {
    expect(
      sanitizeHostMessage({
        type: MSG.CURSOR_MOVE,
        playerId: 'p'.repeat(65),
        x: 0,
        y: 0,
        name: 'n',
        color: '#fff',
      }),
    ).toBeNull();
  });
});

describe('sanitizeHostMessage: ojama values', () => {
  it('accepts only the known visual types and bounded durations', () => {
    const visual = (visualType, duration) => ({ type: MSG.OJAMA_VISUAL, visualType, duration });
    expect(sanitizeHostMessage(visual('hue', 8))).toEqual(visual('hue', 8));
    expect(sanitizeHostMessage(visual('random', 8))).toBeNull();
    expect(sanitizeHostMessage(visual('<img src=x>', 8))).toBeNull();
    expect(sanitizeHostMessage(visual('hue', NET_LIMITS.MAX_OJAMA_DURATION_SEC + 1))).toBeNull();
    expect(sanitizeHostMessage(visual('hue', -1))).toBeNull();
  });

  it('bounds superchat hit points and cuts its texts', () => {
    const superchat = (overrides = {}) => ({
      type: MSG.OJAMA_SUPERCHAT,
      maxHp: 20,
      duration: 15,
      author: 'a',
      message: 'm',
      amountDisplay: '¥1',
      ...overrides,
    });
    expect(sanitizeHostMessage(superchat({ maxHp: NET_LIMITS.MAX_SUPERCHAT_HP + 1 }))).toBeNull();
    // 0 seconds: the card stays until it is driven off (the default).
    expect(sanitizeHostMessage(superchat({ duration: 0 }))).toMatchObject({ duration: 0 });
    expect(sanitizeHostMessage(superchat({ author: 5 }))).toBeNull();
    const clean = sanitizeHostMessage(superchat({ message: 'x'.repeat(10000) }));
    expect(clean.message).toHaveLength(NET_LIMITS.MAX_TEXT_LENGTH);
  });

  it('bounds the superchat state and the notice text', () => {
    expect(sanitizeHostMessage({ type: MSG.SUPERCHAT_STATE, hp: 5, maxHp: 10 })).toEqual({
      type: MSG.SUPERCHAT_STATE,
      hp: 5,
      maxHp: 10,
    });
    expect(sanitizeHostMessage({ type: MSG.SUPERCHAT_STATE, hp: -5, maxHp: 10 })).toBeNull();
    const notice = sanitizeHostMessage({ type: MSG.OJAMA_NOTICE, text: 'x'.repeat(500) });
    expect(notice.text).toHaveLength(NET_LIMITS.MAX_TEXT_LENGTH);
  });

  it('bounds fake piece specs in count and coordinates', () => {
    const spec = {
      fakeId: -1,
      sourcePieceId: 3,
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      rotation: 0,
      isFlipped: false,
      expiresAt: 0,
      zOrder: 2,
    };
    const fake = (fakePieces) => ({ type: MSG.OJAMA_FAKE_PIECES, fakePieces });
    expect(sanitizeHostMessage(fake([spec]))).not.toBeNull();
    expect(sanitizeHostMessage(fake([{ ...spec, x: Number.POSITIVE_INFINITY }]))).toBeNull();
    expect(sanitizeHostMessage(fake([{ ...spec, rotation: 4 }]))).toBeNull();
    const many = Array.from({ length: 17 }, () => spec);
    expect(sanitizeHostMessage(fake(many))).toBeNull();
  });
});

describe('sanitizeHostMessage: diagnostics', () => {
  it('logs the message type and reason, never the contents', () => {
    sanitizeHostMessage({ type: MSG.OJAMA_VISUAL, visualType: 'SECRETMARK', duration: 1 });
    sanitizeHostMessage({ type: 'set_board_state', payload: 'SECRETMARK' });
    const logged = JSON.stringify(getDiagnosticsState());
    expect(logged).toContain('invalid_fields');
    expect(logged).toContain('unknown_type');
    expect(logged).not.toContain('SECRETMARK');
  });
});
