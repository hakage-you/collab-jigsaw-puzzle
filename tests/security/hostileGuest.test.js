/* eslint-disable no-await-in-loop -- the steps of these scenarios are sequential by design */
import { afterEach, describe, expect, it } from 'vitest';
import { NET_LIMITS } from '../../src/config/constants.js';
import { MSG } from '../../src/net/protocol.js';
import { closeAllSessions, joinGuest, startHost, waitForConvergence } from '../helpers/room.js';
import { boardState } from '../helpers/puzzle.js';
import { nextEvent, waitFor } from '../helpers/wait.js';

// S3/S4 (security assessment 2026-11-21): a guest is untrusted. The "hostile" guest below sends
// raw protocol messages through its transport, bypassing the game's own guest API.
// The host must ignore what it should not act on, and stay responsive for everyone else.

const TEST_TIMEOUT = 20000;
const NAME_HOSTILE = 'ミャロ';
const NAME_PLAYER = 'アリス';
const NAME_BYSTANDER = 'ボブ';
const FLOOD_KICK_REASON = '通信量が多すぎるため退出しました';
// Offset (world units) large enough that a dropped piece never snaps or merges.
const FAR = 500;

afterEach(closeAllSessions);

function pause(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function pieceOf(app, id) {
  const piece = app.engine.getPieceById(id);
  if (!piece) throw new Error(`piece ${id} not found`);
  return piece;
}

function unlockedIds(app) {
  return app.engine.pieces.filter((p) => !p.isLocked).map((p) => p.id);
}

/** Sends a raw protocol message from a guest, bypassing the guest API. */
function sendRaw(guestApp, msg) {
  guestApp.room.transport?.sendToHost(msg);
}

function pos(id, x, y) {
  return { id, x, y };
}

/** Two unlocked pieces that belong to different groups. */
function pickTwoPieces(app) {
  const first = app.engine.pieces.find((p) => !p.isLocked);
  const second = app.engine.pieces.find((p) => !p.isLocked && p.groupId !== first.groupId);
  return [first, second];
}

/** Drags a whole group far from its target through the game's own guest API. */
function dragFar(app, id) {
  const { groupId } = pieceOf(app, id);
  if (!app.requestLock(groupId).allowed) throw new Error('lock denied in test setup');
  app.moveGroup(groupId, FAR, 0);
  app.sendDragPreview(groupId, true);
  app.submitDrop(groupId);
}

function allFinite(engine) {
  return engine.pieces.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** Waits until the host has granted `groupId` to the hostile guest. */
function waitForHostileLock(host, hostile, groupId) {
  return waitFor(() => host.room.groupLocks.get(groupId) === hostile.room.myPlayerId, {
    message: 'hostile lock granted',
  });
}

describe('positions outside the held group', () => {
  it(
    'drag and drop ignore positions of pieces the guest does not hold',
    async () => {
      const { host, roomId } = await startHost();
      const hostile = await joinGuest(roomId, { name: NAME_HOSTILE });
      const bystander = await joinGuest(roomId, { name: NAME_BYSTANDER });
      await waitForConvergence([host, hostile, bystander]);

      const [mine, other] = pickTwoPieces(host);
      const mineX = mine.x;
      sendRaw(hostile, { type: MSG.LOCK_REQUEST, groupId: mine.groupId });
      await waitForHostileLock(host, hostile, mine.groupId);

      const otherStart = { x: other.x, y: other.y };
      sendRaw(hostile, {
        type: MSG.DRAG_PREVIEW,
        groupId: mine.groupId,
        positions: [pos(other.id, 800, 800)],
      });
      await pause(50);
      expect(pieceOf(host, other.id).x).toBe(otherStart.x);

      sendRaw(hostile, {
        type: MSG.DROP_REQUEST,
        groupId: mine.groupId,
        positions: [pos(other.id, 900, 900), pos(mine.id, mineX + FAR, mine.y)],
      });
      await waitFor(() => pieceOf(host, mine.id).x > mineX + FAR / 2, {
        message: 'legitimate drop applied',
      });
      await waitForConvergence([host, bystander]);
      expect(pieceOf(host, mine.id).x).toBeCloseTo(mineX + FAR, 1);
      for (const app of [host, bystander]) {
        expect(pieceOf(app, other.id).x).toBeCloseTo(otherStart.x, 1);
        expect(pieceOf(app, other.id).y).toBeCloseTo(otherStart.y, 1);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'a guest cannot drop a group held by another guest',
    async () => {
      const { host, roomId } = await startHost();
      const owner = await joinGuest(roomId, { name: NAME_PLAYER });
      const hostile = await joinGuest(roomId, { name: NAME_HOSTILE });
      await waitForConvergence([host, owner, hostile]);

      const id = unlockedIds(owner)[0];
      const { groupId } = pieceOf(owner, id);
      expect(owner.requestLock(groupId).allowed).toBe(true);
      await waitFor(() => host.room.groupLocks.get(groupId) === owner.room.myPlayerId);

      const before = boardState(host.engine);
      sendRaw(hostile, {
        type: MSG.DROP_REQUEST,
        groupId,
        positions: [pos(id, pieceOf(host, id).x + FAR, 0)],
      });
      await pause(50);
      expect(boardState(host.engine)).toEqual(before);
      expect(host.room.groupLocks.get(groupId)).toBe(owner.room.myPlayerId);
    },
    TEST_TIMEOUT,
  );
});

describe('lock ownership on drop', () => {
  it(
    'a drop without holding the group lock is ignored',
    async () => {
      const { host, roomId } = await startHost();
      const hostile = await joinGuest(roomId, { name: NAME_HOSTILE });
      const bystander = await joinGuest(roomId, { name: NAME_BYSTANDER });
      await waitForConvergence([host, hostile, bystander]);

      const [target] = pickTwoPieces(host);
      const { id, groupId, x } = target;
      const before = boardState(host.engine);
      sendRaw(hostile, {
        type: MSG.DROP_REQUEST,
        groupId,
        positions: [pos(id, x + FAR, target.y)],
      });
      await pause(50);

      expect(boardState(host.engine)).toEqual(before);
      expect(host.room.groupLocks.has(groupId)).toBe(false);
      await waitForConvergence([host, bystander]);
      expect(pieceOf(bystander, id).x).toBeCloseTo(x, 1);
    },
    TEST_TIMEOUT,
  );
});

describe('malformed messages', () => {
  it(
    'NaN, Infinity and out-of-bounds coordinates never reach the boards',
    async () => {
      const { host, roomId } = await startHost();
      const hostile = await joinGuest(roomId, { name: NAME_HOSTILE });
      const bystander = await joinGuest(roomId, { name: NAME_BYSTANDER });
      await waitForConvergence([host, hostile, bystander]);

      const [mine] = pickTwoPieces(host);
      sendRaw(hostile, { type: MSG.LOCK_REQUEST, groupId: mine.groupId });
      await waitForHostileLock(host, hostile, mine.groupId);

      const before = boardState(host.engine);
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e9]) {
        sendRaw(hostile, {
          type: MSG.DRAG_PREVIEW,
          groupId: mine.groupId,
          positions: [pos(mine.id, bad, 0)],
        });
        sendRaw(hostile, { type: MSG.CURSOR_MOVE, x: bad, y: bad });
      }
      sendRaw(hostile, {
        type: MSG.DROP_REQUEST,
        groupId: mine.groupId,
        positions: [pos(mine.id, 1e9, Number.NaN)],
      });
      await pause(60);

      expect(boardState(host.engine)).toEqual(before);
      expect(allFinite(host.engine)).toBe(true);
      expect(allFinite(bystander.engine)).toBe(true);
      await waitForConvergence([host, bystander]);
    },
    TEST_TIMEOUT,
  );

  it(
    'an unknown message type changes nothing and the guest stays in the room',
    async () => {
      const { host, roomId } = await startHost();
      const hostile = await joinGuest(roomId, { name: NAME_HOSTILE });
      const bystander = await joinGuest(roomId, { name: NAME_BYSTANDER });
      await waitForConvergence([host, hostile, bystander]);

      const before = boardState(host.engine);
      sendRaw(hostile, { type: 'set_host_state', groupId: 0, x: 1, y: 1 });
      sendRaw(hostile, { type: MSG.FULL_STATE, pieces: [] });
      await pause(50);

      expect(boardState(host.engine)).toEqual(before);
      expect(host.room.roster.find((m) => m.name === NAME_HOSTILE)?.online).toBe(true);
      await waitForConvergence([host, bystander]);
    },
    TEST_TIMEOUT,
  );

  it(
    'an oversized positions array is ignored without freezing the host',
    async () => {
      const { host, roomId } = await startHost();
      const hostile = await joinGuest(roomId, { name: NAME_HOSTILE });
      const bystander = await joinGuest(roomId, { name: NAME_BYSTANDER });
      await waitForConvergence([host, hostile, bystander]);

      const [mine, other] = pickTwoPieces(host);
      const otherX = other.x;
      sendRaw(hostile, { type: MSG.LOCK_REQUEST, groupId: mine.groupId });
      await waitForHostileLock(host, hostile, mine.groupId);

      const before = boardState(host.engine);
      const huge = Array.from({ length: 100000 }, (_, i) => pos(i % 50, 1, 1));
      sendRaw(hostile, { type: MSG.DRAG_PREVIEW, groupId: mine.groupId, positions: huge });
      sendRaw(hostile, { type: MSG.DROP_REQUEST, groupId: mine.groupId, positions: huge });
      await pause(100);
      expect(boardState(host.engine)).toEqual(before);

      // The host still serves a legitimate move by another player.
      dragFar(bystander, other.id);
      await waitForConvergence([host, bystander]);
      expect(pieceOf(host, other.id).x).toBeCloseTo(otherX + FAR, 1);
    },
    TEST_TIMEOUT,
  );

  it(
    'an overlong display name is cut to the name limit',
    async () => {
      const { host, roomId } = await startHost();
      const longName = 'あ'.repeat(5000);
      await joinGuest(roomId, { name: longName });

      const cut = 'あ'.repeat(NET_LIMITS.MAX_NAME_LENGTH);
      await waitFor(() => host.room.roster.some((m) => m.name === cut), {
        message: 'truncated name in roster',
      });
      expect(host.room.roster.some((m) => m.name.length > NET_LIMITS.MAX_NAME_LENGTH)).toBe(false);
    },
    TEST_TIMEOUT,
  );
});

describe('flooding', () => {
  it(
    'a burst of 1000 messages leaves the host responsive, and the flooder is kicked once it persists',
    async () => {
      const { host, roomId } = await startHost();
      const flooder = await joinGuest(roomId, { name: NAME_HOSTILE });
      const player = await joinGuest(roomId, { name: NAME_PLAYER });
      await waitForConvergence([host, player, flooder]);

      // A fake clock controls the rate limiter: time only moves when the test moves it.
      let clock = performance.now();
      host.room.hostSession.now = () => clock;
      const rejected = nextEvent(flooder, 'authRejected', { timeout: 5000 });

      for (let i = 0; i < 1000; i++) {
        sendRaw(flooder, { type: MSG.CURSOR_MOVE, x: i, y: 0 });
      }
      await pause(50);

      const [id] = unlockedIds(player);
      dragFar(player, id);
      await waitForConvergence([host, player]);

      for (let step = 0; step < 6; step++) {
        clock += 1000;
        for (let i = 0; i < 200; i++) {
          sendRaw(flooder, { type: MSG.CURSOR_MOVE, x: i, y: 0 });
        }
        await pause(30);
      }

      expect((await rejected).reason).toBe(FLOOD_KICK_REASON);
      await waitFor(() => !host.room.roster.some((m) => m.name === NAME_HOSTILE), {
        message: 'flooder removed from roster',
      });
      await waitForConvergence([host, player]);
    },
    TEST_TIMEOUT,
  );

  it(
    'a normal player at 20 Hz cursor and drag is never rate limited',
    async () => {
      const { host, roomId } = await startHost();
      const player = await joinGuest(roomId, { name: NAME_PLAYER });
      const bystander = await joinGuest(roomId, { name: NAME_BYSTANDER });
      await waitForConvergence([host, player, bystander]);

      const id = unlockedIds(player)[0];
      const { groupId } = pieceOf(player, id);
      expect(player.requestLock(groupId).allowed).toBe(true);
      // Two seconds of cursor and drag updates, each stream at 20 Hz.
      for (let i = 0; i < 40; i++) {
        player.moveGroup(groupId, 2, 0);
        player.sendCursorMove(100 + i * 5, 100);
        player.sendDragPreview(groupId, true);
        await pause(50);
      }
      player.submitDrop(groupId);

      await waitForConvergence([host, player, bystander]);
      expect(host.room.roster.find((m) => m.name === NAME_PLAYER)?.online).toBe(true);
    },
    TEST_TIMEOUT,
  );
});
