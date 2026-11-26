import { describe, expect, it } from 'vitest';
import { MULTIPLAYER_CONFIG } from '../../src/config/constants.js';
import {
  broadcastPiecesPatch,
  buildRoomRules,
  sendFullStateToGuest,
  sendWelcomeToGuest,
  serializePieces,
} from '../../src/net/hostSyncHelper.js';
import { MSG } from '../../src/net/protocol.js';
import { createEngine } from '../helpers/coreEngine.js';
import { createFakeHost } from '../helpers/fakeHost.js';

// What the host sends: piece lists, room rules, the welcome, and patches and full states split
// into chunks. The image transfer needs a canvas and is covered by tests/net/imageTransfer.test.js.

const CHUNK = MULTIPLAYER_CONFIG.STATE_CHUNK_PIECES;

/** An engine with more pieces than one chunk holds (cols * rows > CHUNK). */
const bigEngine = () => createEngine({ cols: 20, rows: 15 });

describe('serializePieces', () => {
  it('keeps the synced fields, positions rounded to 0.01', () => {
    const piece = {
      id: 1,
      x: 1.234,
      y: -5.678,
      rotation: 2,
      isFlipped: true,
      groupId: 3,
      isLocked: false,
      zOrder: 9,
      outline: {},
    };
    expect(serializePieces([piece])).toEqual([
      {
        id: 1,
        x: 1.23,
        y: -5.68,
        rotation: 2,
        isFlipped: true,
        groupId: 3,
        isLocked: false,
        zOrder: 9,
      },
    ]);
  });
});

describe('room rules and welcome', () => {
  it('sends the grid, cut, turning rules and capacity', () => {
    const host = createFakeHost({
      settings: { allowRotation: false, allowFlip: true, showStats: false },
      capacity: 6,
    });
    expect(buildRoomRules(host.room)).toEqual({
      cols: 4,
      rows: 3,
      cutComplexity: 'standard',
      allowRotation: false,
      allowFlip: true,
      showStats: false,
      capacity: 6,
    });
  });

  it("welcomes a guest with its id, token, colour, the image's identity and the roster", () => {
    const host = createFakeHost();
    const guest = host.addGuest('g1');
    sendWelcomeToGuest(host.room, guest, ['roster']);
    const [[to, msg]] = host.sent;
    expect(to).toBe(guest.connId);
    expect(msg).toEqual({
      type: MSG.WELCOME,
      playerId: 'g1',
      reconnectToken: 'token-g1',
      color: '#123456',
      isSampleImage: true,
      sampleImageId: 'met-seaside',
      imageHash: host.room.engine.imageHash,
      imageWidth: 960,
      imageHeight: 640,
      roomRules: buildRoomRules(host.room),
      roster: ['roster'],
    });
  });

  it('leaves the sample id out for an own image', () => {
    const host = createFakeHost();
    host.room.sourceState = { isSampleImage: false, sampleImageId: 'x', sourceCanvas: null };
    sendWelcomeToGuest(host.room, host.addGuest('g1'), []);
    expect(host.sent[0][1]).not.toHaveProperty('sampleImageId');
  });
});

describe('broadcastPiecesPatch', () => {
  it('sends a small patch in one message with stats, locks and labels', () => {
    const host = createFakeHost();
    host.room.groupLocks.set(2, 'g1');
    const pieces = host.room.engine.pieces.slice(0, 2);
    broadcastPiecesPatch(host.room, pieces, { type: 'snap' }, 'g1');
    expect(host.broadcasts).toEqual([
      [
        {
          type: MSG.PIECES_PATCH,
          pieces: serializePieces(pieces),
          stats: host.room.engine.stats,
          actionResult: { type: 'snap' },
          actorId: 'g1',
          locks: [[2, 'g1']],
          zoneLabels: host.room.engine.zoneLabels,
          isFinalChunk: true,
        },
        undefined,
      ],
    ]);
    expect(host.broadcasts[0][0].stats).not.toBe(host.room.engine.stats);
  });

  it('splits a big patch, with the extras only in the last chunk', () => {
    const host = createFakeHost({ engine: bigEngine() });
    const { pieces } = host.room.engine;
    broadcastPiecesPatch(host.room, pieces, { type: 'sort' }, 'host');
    const messages = host.broadcasts.map(([msg]) => msg);
    expect(messages.map((m) => m.pieces.length)).toEqual([CHUNK, pieces.length - CHUNK]);
    expect(messages.map((m) => m.isFinalChunk)).toEqual([false, true]);
    expect(messages[0]).toMatchObject({
      actorId: 'host',
      stats: undefined,
      locks: undefined,
      actionResult: undefined,
    });
    expect(messages[1]).toMatchObject({
      actorId: 'host',
      actionResult: { type: 'sort' },
      locks: [],
    });
    expect(messages.flatMap((m) => m.pieces.map((p) => p.id))).toEqual(pieces.map((p) => p.id));
  });

  it('sends exactly one chunk at the chunk size', () => {
    const host = createFakeHost({ engine: bigEngine() });
    broadcastPiecesPatch(host.room, host.room.engine.pieces.slice(0, CHUNK), null, 'host');
    expect(host.broadcasts).toHaveLength(1);
  });

  it('does nothing without a transport', () => {
    const host = createFakeHost();
    host.room.transport = null;
    expect(() => broadcastPiecesPatch(host.room, [], null, 'host')).not.toThrow();
  });
});

describe('sendFullStateToGuest', () => {
  it('sends a small board in one message', () => {
    const host = createFakeHost();
    host.room.groupLocks.set(1, 'g1');
    host.room.engine.addFakePieces(1, 0);
    sendFullStateToGuest(host.room, 'c1', ['r']);
    const [[to, msg]] = host.sent;
    expect(to).toBe('c1');
    expect(msg).toMatchObject({
      type: MSG.FULL_STATE,
      locks: [[1, 'g1']],
      roster: ['r'],
      roomRules: buildRoomRules(host.room),
      fakePieces: host.room.engine.serializeFakePieces(),
    });
    expect(msg.saveData.pieces).toHaveLength(12);
    expect(msg).not.toHaveProperty('totalPieceChunks');
  });

  it('sends a big board as a header without pieces, then the pieces in chunks', () => {
    const host = createFakeHost({ engine: bigEngine() });
    sendFullStateToGuest(host.room, 'c1', []);
    const [[, header], ...chunks] = host.sent;
    const total = host.room.engine.pieces.length;
    expect(header).toMatchObject({ type: MSG.FULL_STATE, totalPieceChunks: 2 });
    expect(header.saveData.pieces).toEqual([]);
    expect(
      chunks.map(([to, m]) => [to, m.type, m.chunkIndex, m.totalChunks, m.pieces.length]),
    ).toEqual([
      ['c1', MSG.FULL_STATE_CHUNK, 0, 2, CHUNK],
      ['c1', MSG.FULL_STATE_CHUNK, 1, 2, total - CHUNK],
    ]);
    expect(chunks.flatMap(([, m]) => m.pieces.map((p) => p.id))).toEqual(
      host.room.engine.pieces.map((p) => p.id),
    );
  });
});
