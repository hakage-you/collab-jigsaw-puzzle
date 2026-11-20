import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MULTIPLAYER_CONFIG, NET_LIMITS } from '../../src/config/constants.js';
import { chunkBase64 } from '../../src/net/imageTransfer.js';
import { MSG } from '../../src/net/protocol.js';
import { clearDiagnostics, getDiagnosticsState } from '../../src/services/diagnostics.js';
import { closeAllSessions, joinGuest, startHost, waitForConvergence } from '../helpers/room.js';
import { boardState } from '../helpers/puzzle.js';
import { nextEvent, waitFor } from '../helpers/wait.js';

// S7 (security assessment 2026-11-21): a guest trusts nothing from the host. The "hostile host"
// below sends raw protocol messages through the host's transport to one guest, bypassing the
// host's own API. The guest must disconnect on a broken transfer, drop bad realtime messages
// and keep its board untouched.

const TEST_TIMEOUT = 20000;
const NAME_HOSTILE = 'ミャロ';
const IMAGE_REJECTED = '画像';
const STATE_REJECTED = '盤面';
const MOVE = 50;

beforeEach(() => {
  clearDiagnostics();
});

afterEach(closeAllSessions);

function pause(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Sends a raw message from the hostile host to one guest's connection. */
function sendFromHost(host, guest, msg) {
  const connId = host.room.hostSession.guests.get(guest.room.myPlayerId)?.connId;
  if (!connId) throw new Error('guest connection not found');
  host.room.transport.sendTo(connId, msg);
}

function rejectedTypes() {
  const logged = JSON.stringify(getDiagnosticsState());
  return logged.match(/host_(message|transfer)_rejected/g) || [];
}

/** A piece in the shape the host sends in patches (serializePieces). */
function serializedPiece(app, index) {
  const p = app.engine.pieces[index];
  return {
    id: p.id,
    x: p.x,
    y: p.y,
    rotation: p.rotation,
    isFlipped: p.isFlipped,
    groupId: p.groupId,
    isLocked: p.isLocked,
    zOrder: p.zOrder,
  };
}

/** The piece at `index`, shifted by MOVE: a patch that would be visible if applied. */
function movedPiece(app, index) {
  const piece = serializedPiece(app, index);
  return { ...piece, x: piece.x + MOVE };
}

/** Base64 of a solid-colour canvas, as the host encodes images (no uploads needed). */
function canvasBase64(width, height, type = 'image/png') {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').fillRect(0, 0, width, height);
  return canvas.toDataURL(type).split(',')[1];
}

async function hostileGuest(name = NAME_HOSTILE) {
  const { host, roomId } = await startHost();
  const guest = await joinGuest(roomId, { name });
  return { host, guest, roomId };
}

describe('image transfer from a hostile host', () => {
  it(
    'IMAGE_START with a billion chunks ends the join instead of allocating',
    async () => {
      const { host, guest } = await hostileGuest();
      const disconnected = nextEvent(guest, 'disconnected', { timeout: 3000 });
      sendFromHost(host, guest, {
        type: MSG.IMAGE_START,
        totalChunks: 1e9,
        mimeType: 'image/webp',
        width: 10,
        height: 10,
      });
      await expect(disconnected).resolves.toMatchObject({
        reason: expect.stringContaining(IMAGE_REJECTED),
      });
      expect(guest.room.role).toBe('solo');
      expect(rejectedTypes()).toContain('host_message_rejected');
    },
    TEST_TIMEOUT,
  );

  it(
    'a chunk index beyond totalChunks ends the join',
    async () => {
      const { host, guest } = await hostileGuest();
      const disconnected = nextEvent(guest, 'disconnected', { timeout: 3000 });
      sendFromHost(host, guest, {
        type: MSG.IMAGE_START,
        totalChunks: 2,
        mimeType: 'image/webp',
        width: 10,
        height: 10,
      });
      sendFromHost(host, guest, { type: MSG.IMAGE_CHUNK, index: 5, data: 'QUJD' });
      await expect(disconnected).resolves.toMatchObject({
        reason: expect.stringContaining(IMAGE_REJECTED),
      });
      expect(rejectedTypes()).toContain('host_transfer_rejected');
    },
    TEST_TIMEOUT,
  );

  it(
    'a mimeType that is not an image type ends the join',
    async () => {
      const { host, guest } = await hostileGuest();
      const disconnected = nextEvent(guest, 'disconnected', { timeout: 3000 });
      sendFromHost(host, guest, {
        type: MSG.IMAGE_START,
        totalChunks: 1,
        mimeType: 'text/html',
        width: 10,
        height: 10,
      });
      await expect(disconnected).resolves.toMatchObject({
        reason: expect.stringContaining(IMAGE_REJECTED),
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'a declared size above MAX_IMAGE_DIM ends the join before any chunk arrives',
    async () => {
      const { host, guest } = await hostileGuest();
      const disconnected = nextEvent(guest, 'disconnected', { timeout: 3000 });
      sendFromHost(host, guest, {
        type: MSG.IMAGE_START,
        totalChunks: 1,
        mimeType: 'image/png',
        width: 5000,
        height: 10,
      });
      await expect(disconnected).resolves.toMatchObject({
        reason: expect.stringContaining(IMAGE_REJECTED),
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'a real image wider than MAX_IMAGE_DIM is refused from its header, not decoded',
    async () => {
      const { host, guest } = await hostileGuest();
      const chunks = chunkBase64(canvasBase64(NET_LIMITS.MAX_IMAGE_DIM + 904, 10));
      const disconnected = nextEvent(guest, 'disconnected', { timeout: 3000 });
      // The declared size lies (10x10) so that only the real header can reveal the big image.
      sendFromHost(host, guest, {
        type: MSG.IMAGE_START,
        totalChunks: chunks.length,
        mimeType: 'image/png',
        width: 10,
        height: 10,
      });
      chunks.forEach((data, index) =>
        sendFromHost(host, guest, { type: MSG.IMAGE_CHUNK, index, data }),
      );
      await expect(disconnected).resolves.toMatchObject({
        reason: expect.stringContaining(IMAGE_REJECTED),
      });
      expect(rejectedTypes()).toContain('host_transfer_rejected');
    },
    TEST_TIMEOUT,
  );
});

describe('full state from a hostile host', () => {
  it(
    'a full state with a million chunks ends the join',
    async () => {
      const { host, guest } = await hostileGuest();
      const disconnected = nextEvent(guest, 'disconnected', { timeout: 3000 });
      sendFromHost(host, guest, {
        type: MSG.FULL_STATE,
        saveData: { pieces: [] },
        totalPieceChunks: 1e6,
        roomRules: guest.room.roomRules,
        roster: [],
        locks: [],
        zoneLabels: [],
      });
      await expect(disconnected).resolves.toMatchObject({
        reason: expect.stringContaining(STATE_REJECTED),
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'a chunk index beyond the announced chunk count ends the join',
    async () => {
      const { host, guest } = await hostileGuest();
      const disconnected = nextEvent(guest, 'disconnected', { timeout: 3000 });
      const roomRules = guest.room.roomRules;
      sendFromHost(host, guest, {
        type: MSG.FULL_STATE,
        saveData: { pieces: [] },
        totalPieceChunks: 2,
        roomRules,
        roster: [],
        locks: [],
        zoneLabels: [],
      });
      sendFromHost(host, guest, { type: MSG.FULL_STATE_CHUNK, chunkIndex: 9, pieces: [] });
      await expect(disconnected).resolves.toMatchObject({
        reason: expect.stringContaining(STATE_REJECTED),
      });
    },
    TEST_TIMEOUT,
  );
});

describe('realtime messages from a hostile host', () => {
  it(
    'piece patches with bad coordinates, huge lists or rotation 9 are dropped',
    async () => {
      const { host, guest } = await hostileGuest();
      await waitForConvergence([host, guest]);
      const before = boardState(guest.engine);
      const moved = movedPiece(host, 0);
      const huge = Array.from({ length: NET_LIMITS.MAX_PIECES + 1 }, () => moved);
      const badPatches = [[{ ...moved, x: Number.NaN }], [{ ...moved, rotation: 9 }], huge];

      for (const pieces of badPatches) {
        sendFromHost(host, guest, {
          type: MSG.PIECES_PATCH,
          pieces,
          actorId: 'host',
          isFinalChunk: true,
        });
      }
      await pause(100);

      expect(boardState(guest.engine)).toEqual(before);
      expect(guest.engine.pieces.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(
        true,
      );
      expect(guest.room.role).toBe('guest');
      expect(rejectedTypes().length).toBeGreaterThanOrEqual(3);
    },
    TEST_TIMEOUT,
  );

  it(
    'a well-formed piece patch from the host is applied (control for the test above)',
    async () => {
      const { host, guest } = await hostileGuest();
      await waitForConvergence([host, guest]);
      const moved = movedPiece(host, 0);
      sendFromHost(host, guest, {
        type: MSG.PIECES_PATCH,
        pieces: [moved],
        actorId: 'host',
        isFinalChunk: true,
      });
      await waitFor(() => guest.engine.pieces.find((p) => p.id === moved.id)?.x === moved.x, {
        message: 'valid patch applied',
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'an unknown visual type is ignored, a known one is passed on',
    async () => {
      const { host, guest } = await hostileGuest();
      const seen = [];
      guest.on('remoteVisualOjama', (payload) => seen.push(payload));
      sendFromHost(host, guest, { type: MSG.OJAMA_VISUAL, visualType: '<img src=x>', duration: 5 });
      sendFromHost(host, guest, { type: MSG.OJAMA_VISUAL, visualType: 'sepia', duration: 1e9 });
      sendFromHost(host, guest, { type: MSG.OJAMA_VISUAL, visualType: 'sepia', duration: 5 });
      await waitFor(() => seen.length >= 1, { message: 'valid visual passed on' });
      expect(seen).toEqual([{ visualType: 'sepia', duration: 5 }]);
      expect(guest.room.role).toBe('guest');
    },
    TEST_TIMEOUT,
  );

  it(
    'a superchat message of 10k characters is cut to the text limit',
    async () => {
      const { host, guest } = await hostileGuest();
      const superchat = nextEvent(guest, 'remoteSuperchat', { timeout: 3000 });
      sendFromHost(host, guest, {
        type: MSG.OJAMA_SUPERCHAT,
        maxHp: 20,
        duration: 5,
        author: 'x',
        message: 'x'.repeat(10000),
        amountDisplay: '¥100',
      });
      const payload = await superchat;
      expect(payload.message.length).toBe(NET_LIMITS.MAX_TEXT_LENGTH);
      expect(payload.maxHp).toBe(20);
    },
    TEST_TIMEOUT,
  );

  it(
    'an unknown message type changes nothing and the guest stays in the room',
    async () => {
      const { host, guest } = await hostileGuest();
      await waitForConvergence([host, guest]);
      const before = boardState(guest.engine);
      let disconnects = 0;
      guest.on('disconnected', () => {
        disconnects += 1;
      });
      sendFromHost(host, guest, { type: 'set_board_state', groupId: 0, x: 1, y: 1 });
      await pause(50);

      expect(boardState(guest.engine)).toEqual(before);
      expect(disconnects).toBe(0);
      expect(guest.room.role).toBe('guest');
      expect(rejectedTypes()).toContain('host_message_rejected');
    },
    TEST_TIMEOUT,
  );

  it(
    'a roster longer than MAX_CAPACITY is cut and an invalid colour is replaced',
    async () => {
      const { host, guest } = await hostileGuest();
      const roster = Array.from({ length: MULTIPLAYER_CONFIG.MAX_CAPACITY + 5 }, (_, i) => ({
        id: `g${i}`,
        name: 'n',
        color: 'url(javascript:alert(1))',
        role: 'guest',
        contrib: 0,
        online: true,
      }));
      sendFromHost(host, guest, { type: MSG.ROSTER_UPDATE, roster });
      await waitFor(() => guest.room.roster.length === MULTIPLAYER_CONFIG.MAX_CAPACITY, {
        message: 'roster cut to capacity',
      });
      expect(guest.room.roster.every((e) => e.color === '#888888')).toBe(true);
    },
    TEST_TIMEOUT,
  );
});
