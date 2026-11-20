import { afterEach, describe, expect, it } from 'vitest';
import { closeAllSessions, joinGuest, startHost, waitForConvergence } from '../helpers/room.js';
import { boardState } from '../helpers/puzzle.js';
import { nextEvent, waitFor } from '../helpers/wait.js';

/*
 * Multiplayer synchronisation, asserted the way a user would notice it:
 * board states, who is in the room, accept/reject outcomes and contributions.
 * Protocol message types and counts are deliberately never asserted.
 *
 * Every session lives in this page and talks over the BroadcastChannel transport.
 * Pieces are always looked up in each session's own engine by id.
 */

const TEST_TIMEOUT = 15000;
const NAME_A = 'アリス';
const NAME_B = 'ボブ';
// Offset (world units) large enough that a dropped piece never snaps or merges.
const FAR = 500;

afterEach(closeAllSessions);

function pieceOf(app, id) {
  const piece = app.engine.getPieceById(id);
  if (!piece) throw new Error(`piece ${id} not found`);
  return piece;
}

function unlockedIds(app) {
  return app.engine.pieces.filter((p) => !p.isLocked).map((p) => p.id);
}

function rosterEntry(app, name) {
  return app.room.roster.find((m) => m.name === name);
}

function pause(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Moves the whole group of a piece so that the piece sits at (x, y). */
function moveGroupTo(app, id, x, y) {
  const piece = pieceOf(app, id);
  app.moveGroup(piece.groupId, x - piece.x, y - piece.y);
}

/**
 * Drags a piece the way the canvas does: requestLock, moveGroup on each pointer move,
 * sendDragPreview, then submitDrop on pointer up. Returns null when the lock was denied.
 */
function dragPieceTo(app, id, x, y) {
  const { groupId } = pieceOf(app, id);
  const lock = app.requestLock(groupId);
  if (!lock.allowed) return null;
  moveGroupTo(app, id, x, y);
  app.sendDragPreview(groupId, true);
  return app.submitDrop(groupId);
}

/** Drags a piece onto its correct position, which snaps it into place. */
function snapPiece(app, id) {
  const { targetX, targetY } = pieceOf(app, id);
  return dragPieceTo(app, id, targetX, targetY);
}

/**
 * Rotates a piece on the given session until it is upright. With allowRotation the engine
 * scrambles initial rotations, and only upright pieces can snap.
 */
function rotateUpright(app, id) {
  const turns = (4 - pieceOf(app, id).rotation) % 4;
  for (let i = 0; i < turns; i++) {
    app.submitRotate(pieceOf(app, id));
  }
}

/** Drags a piece away from its target by (dx, FAR); it stays unlocked. */
function dropFarFromTarget(app, id, dx = FAR) {
  const { targetX, targetY } = pieceOf(app, id);
  return dragPieceTo(app, id, targetX + dx, targetY + FAR);
}

describe('room admission', () => {
  it(
    'two guests join without approval and all three boards converge',
    async () => {
      const { host, roomId } = await startHost({ name: 'ホスト' });
      const g1 = await joinGuest(roomId, { name: NAME_A });
      const g2 = await joinGuest(roomId, { name: NAME_B });

      await waitForConvergence([host, g1, g2]);
      expect(boardState(g1.engine)).toEqual(boardState(host.engine));
      expect(boardState(g2.engine)).toEqual(boardState(host.engine));
      expect(host.room.getOnlineCount()).toBe(3);
    },
    TEST_TIMEOUT,
  );

  it(
    'a knocking guest waits for approval, a rejected knock never enters the room',
    async () => {
      const { host, roomId } = await startHost({ requireApproval: true });

      const alice = await joinGuest(roomId, { name: NAME_A, waitForSync: false });
      await waitFor(() => host.knockQueue.length === 1, { message: 'alice knock queued' });
      expect(host.knockQueue[0].displayName).toBe(NAME_A);
      expect(host.room.getOnlineCount()).toBe(1);

      const aliceSynced = nextEvent(alice, 'fullStateSynced', { timeout: 5000 });
      host.approveNextKnock();
      await aliceSynced;
      await waitForConvergence([host, alice]);
      expect(host.room.getOnlineCount()).toBe(2);

      const bob = await joinGuest(roomId, { name: NAME_B, waitForSync: false });
      const bobRejected = nextEvent(bob, 'authRejected', { timeout: 5000 });
      await waitFor(() => host.knockQueue.length === 1, { message: 'bob knock queued' });
      host.rejectNextKnock();
      await bobRejected;

      await pause(300);
      expect(host.knockQueue).toHaveLength(0);
      expect(host.room.getOnlineCount()).toBe(2);
      expect(boardState(alice.engine)).toEqual(boardState(host.engine));
    },
    TEST_TIMEOUT,
  );

  it(
    'a wrong passcode is rejected and the right one joins',
    async () => {
      const { host, roomId } = await startHost({ passcode: 'abc' });

      const wrong = await joinGuest(roomId, {
        name: NAME_A,
        passcode: 'xyz',
        waitForSync: false,
      });
      await nextEvent(wrong, 'authRejected', { timeout: 5000 });
      await pause(300);
      expect(host.room.getOnlineCount()).toBe(1);

      const right = await joinGuest(roomId, { name: NAME_B, passcode: 'abc' });
      await waitForConvergence([host, right]);
      expect(host.room.getOnlineCount()).toBe(2);
    },
    TEST_TIMEOUT,
  );

  it(
    'the host counts as one seat, so a capacity of 2 rejects the second guest',
    async () => {
      const { host, roomId } = await startHost({ capacity: 2 });

      const first = await joinGuest(roomId, { name: NAME_A });
      await waitForConvergence([host, first]);

      const second = await joinGuest(roomId, { name: NAME_B, waitForSync: false });
      await nextEvent(second, 'authRejected', { timeout: 5000 });

      await pause(300);
      expect(host.room.getOnlineCount()).toBe(2);
      expect(boardState(first.engine)).toEqual(boardState(host.engine));
    },
    TEST_TIMEOUT,
  );
});

describe('piece interaction', () => {
  it(
    'a guest snap locks the piece everywhere and raises its contribution',
    async () => {
      const { host, roomId } = await startHost();
      const g1 = await joinGuest(roomId, { name: NAME_A });
      const g2 = await joinGuest(roomId, { name: NAME_B });
      await waitForConvergence([host, g1, g2]);

      const id = unlockedIds(g1)[0];
      const before = g1.getMyContribution();
      snapPiece(g1, id);

      await waitForConvergence([host, g1, g2]);
      for (const app of [host, g1, g2]) {
        expect(pieceOf(app, id).isLocked).toBe(true);
      }
      await waitFor(() => g1.getMyContribution() > before, { message: 'guest contribution' });
      expect(rosterEntry(host, NAME_A).contrib).toBe(g1.getMyContribution());
    },
    TEST_TIMEOUT,
  );

  it(
    'a host drop that does not snap is mirrored to both guests at the same position',
    async () => {
      const { host, roomId } = await startHost();
      const g1 = await joinGuest(roomId, { name: NAME_A });
      const g2 = await joinGuest(roomId, { name: NAME_B });
      await waitForConvergence([host, g1, g2]);

      const id = unlockedIds(host)[0];
      dropFarFromTarget(host, id);

      await waitForConvergence([host, g1, g2]);
      const hostPiece = pieceOf(host, id);
      expect(hostPiece.isLocked).toBe(false);
      for (const app of [g1, g2]) {
        const mirrored = pieceOf(app, id);
        // Positions travel rounded to 0.01, so compare within that tolerance.
        expect(mirrored.x).toBeCloseTo(hostPiece.x, 1);
        expect(mirrored.y).toBeCloseTo(hostPiece.y, 1);
        expect(mirrored.isLocked).toBe(false);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'a group locked by the host blocks a guest until the host drops it',
    async () => {
      const { host, roomId } = await startHost();
      const g1 = await joinGuest(roomId, { name: NAME_A });
      await waitForConvergence([host, g1]);

      const id = unlockedIds(host)[0];
      const { groupId } = pieceOf(host, id);

      expect(host.requestLock(groupId).allowed).toBe(true);
      await waitFor(() => !g1.room.canInteractWithGroup(groupId), {
        message: 'host lock propagated to guest',
      });

      const denied = g1.requestLock(groupId);
      expect(denied.allowed).toBe(false);

      dropFarFromTarget(host, id);
      await waitForConvergence([host, g1]);

      await waitFor(() => g1.room.canInteractWithGroup(groupId), {
        message: 'guest may lock after host drop',
      });
      expect(g1.requestLock(groupId).allowed).toBe(true);
      g1.submitDrop(groupId);
      await waitForConvergence([host, g1]);
    },
    TEST_TIMEOUT,
  );

  it(
    'three quick guest rotations converge to three quarter turns on every board',
    async () => {
      const { host, roomId } = await startHost({ puzzle: { allowRotation: true } });
      const g1 = await joinGuest(roomId, { name: NAME_A });
      const g2 = await joinGuest(roomId, { name: NAME_B });
      await waitForConvergence([host, g1, g2]);

      const id = unlockedIds(host)[0];
      const start = pieceOf(host, id).rotation;
      expect(g1.submitRotate(pieceOf(g1, id))).toBe(true);
      expect(g1.submitRotate(pieceOf(g1, id))).toBe(true);
      expect(g1.submitRotate(pieceOf(g1, id))).toBe(true);

      await waitForConvergence([host, g1, g2]);
      // Rotation is stored in quarter turns (0..3), so three turns is +3 modulo 4.
      const expected = (start + 3) % 4;
      expect(pieceOf(host, id).rotation).toBe(expected);
      expect(pieceOf(g1, id).rotation).toBe(expected);
      expect(pieceOf(g2, id).rotation).toBe(expected);
    },
    TEST_TIMEOUT,
  );
});

describe('late join and reconnect', () => {
  it(
    'a guest who joins late receives the current board, including earlier snaps',
    async () => {
      const { host, roomId } = await startHost();
      const g1 = await joinGuest(roomId, { name: NAME_A });
      await waitForConvergence([host, g1]);

      const [p0, p1, p2] = unlockedIds(host);
      snapPiece(host, p0);
      await waitForConvergence([host, g1]);
      snapPiece(g1, p1);
      await waitForConvergence([host, g1]);
      dropFarFromTarget(host, p2);
      await waitForConvergence([host, g1]);

      const g2 = await joinGuest(roomId, { name: 'キャロル' });
      await waitForConvergence([host, g1, g2]);
      expect(boardState(g2.engine)).toEqual(boardState(host.engine));
      expect(g2.engine.getLockedCount()).toBe(2);
    },
    TEST_TIMEOUT,
  );

  it(
    'a guest that reconnects with its token keeps its player id, colour and contribution',
    async () => {
      const { host, roomId } = await startHost();
      const a = await joinGuest(roomId, { name: NAME_A });
      await waitForConvergence([host, a]);

      snapPiece(a, unlockedIds(a)[0]);
      await waitFor(() => rosterEntry(host, NAME_A)?.contrib === 1, { message: 'contrib 1' });
      await waitFor(() => a.getMyContribution() === 1, { message: 'guest sees contrib 1' });
      const seat = rosterEntry(host, NAME_A);
      const reconnectToken = a.rejoinToken;

      a.room.close();
      await waitFor(() => rosterEntry(host, NAME_A)?.online === false, {
        message: 'alice shown offline',
      });
      expect(host.room.getOnlineCount()).toBe(1);

      const again = await joinGuest(roomId, { name: NAME_A, rejoinToken: reconnectToken });
      await waitForConvergence([host, again]);

      const back = rosterEntry(host, NAME_A);
      expect(back.id).toBe(seat.id);
      expect(back.color).toBe(seat.color);
      expect(back.online).toBe(true);
      expect(back.contrib).toBe(1);
      expect(again.room.myPlayerId).toBe(seat.id);
      expect(again.getMyContribution()).toBe(1);
      expect(host.room.getOnlineCount()).toBe(2);
    },
    TEST_TIMEOUT,
  );

  it(
    'a forged reconnect token is rejected and the real seat stays offline',
    async () => {
      const { host, roomId } = await startHost();
      const a = await joinGuest(roomId, { name: NAME_A });
      await waitForConvergence([host, a]);

      snapPiece(a, unlockedIds(a)[0]);
      await waitFor(() => rosterEntry(host, NAME_A)?.contrib === 1, { message: 'contrib 1' });
      const seat = rosterEntry(host, NAME_A);
      const reconnectToken = a.rejoinToken;

      a.room.close();
      await waitFor(() => rosterEntry(host, NAME_A)?.online === false, {
        message: 'alice shown offline',
      });

      const forger = await joinGuest(roomId, {
        name: NAME_A,
        rejoinToken: { playerId: seat.id, reconnectToken: 'bad' },
        waitForSync: false,
      });
      await nextEvent(forger, 'authRejected', { timeout: 5000 });

      await pause(300);
      expect(rosterEntry(host, NAME_A).online).toBe(false);
      expect(rosterEntry(host, NAME_A).id).toBe(seat.id);
      expect(host.room.getOnlineCount()).toBe(1);

      // The genuine token still works after the forged attempt.
      const genuine = await joinGuest(roomId, { name: NAME_A, rejoinToken: reconnectToken });
      await waitForConvergence([host, genuine]);
      expect(genuine.room.myPlayerId).toBe(seat.id);
      expect(genuine.getMyContribution()).toBe(1);
    },
    TEST_TIMEOUT,
  );

  // Suspected bug: HostSession._admitNewGuest reattaches any offline guest by display name
  // alone, without checking a reconnect token. A stranger who types the same name inherits
  // that seat and its contribution. Kept skipped until the intended rule is decided.
  it.skip(
    'a new guest that merely reuses an offline player name does not take over that seat',
    async () => {
      const { host, roomId } = await startHost();
      const a = await joinGuest(roomId, { name: NAME_A });
      await waitForConvergence([host, a]);

      snapPiece(a, unlockedIds(a)[0]);
      await waitFor(() => rosterEntry(host, NAME_A)?.contrib === 1, { message: 'contrib 1' });
      const seatId = rosterEntry(host, NAME_A).id;

      a.room.close();
      await waitFor(() => rosterEntry(host, NAME_A)?.online === false, {
        message: 'alice shown offline',
      });

      const stranger = await joinGuest(roomId, { name: NAME_A });
      await waitForConvergence([host, stranger]);
      expect(stranger.room.myPlayerId).not.toBe(seatId);
    },
    TEST_TIMEOUT,
  );
});

describe('mixed session', () => {
  it(
    'after mixed moves, snaps and rotations by host and two guests, every board and lock count agrees',
    async () => {
      const { host, roomId } = await startHost({ puzzle: { allowRotation: true } });
      const g1 = await joinGuest(roomId, { name: NAME_A });
      const g2 = await joinGuest(roomId, { name: 'キャロル' });
      await waitForConvergence([host, g1, g2]);

      const [p0, p1, p2, p3, p4, p5, p6, p7] = unlockedIds(host);

      // Host snaps a piece after making it upright.
      rotateUpright(host, p0);
      await waitForConvergence([host, g1, g2]);
      snapPiece(host, p0);
      await waitForConvergence([host, g1, g2]);

      // Host rotates a piece once; it stays unlocked.
      host.submitRotate(pieceOf(host, p1));
      await waitForConvergence([host, g1, g2]);

      // Guest 1 moves a piece far away; it stays unlocked.
      dropFarFromTarget(g1, p2);
      await waitForConvergence([host, g1, g2]);

      // Guest 2 snaps a piece.
      rotateUpright(g2, p3);
      await waitForConvergence([host, g1, g2]);
      snapPiece(g2, p3);
      await waitForConvergence([host, g1, g2]);

      // Guest 2 rotates a piece twice; it stays unlocked.
      g2.submitRotate(pieceOf(g2, p4));
      g2.submitRotate(pieceOf(g2, p4));
      await waitForConvergence([host, g1, g2]);

      // Guest 1 makes a piece upright, then snaps it.
      rotateUpright(g1, p5);
      await waitForConvergence([host, g1, g2]);
      snapPiece(g1, p5);
      await waitForConvergence([host, g1, g2]);

      // Guest 1 holds a group lock, guest 2 is denied, guest 1 snaps the group.
      rotateUpright(g1, p6);
      await waitForConvergence([host, g1, g2]);
      const { groupId: contested } = pieceOf(g1, p6);
      expect(g1.requestLock(contested).allowed).toBe(true);
      await waitFor(() => !g2.room.canInteractWithGroup(contested), {
        message: 'guest 1 lock propagated',
      });
      expect(g2.requestLock(contested).allowed).toBe(false);
      moveGroupTo(g1, p6, pieceOf(g1, p6).targetX, pieceOf(g1, p6).targetY);
      g1.sendDragPreview(contested, true);
      g1.submitDrop(contested);
      await waitForConvergence([host, g1, g2]);

      // Host moves a piece far away; it stays unlocked.
      dropFarFromTarget(host, p7, -FAR);
      await waitForConvergence([host, g1, g2]);

      // Snapped pieces: p0 (host), p3 (guest 2), p5 (guest 1), p6 (guest 1).
      for (const app of [host, g1, g2]) {
        expect(app.engine.getLockedCount()).toBe(4);
      }
    },
    TEST_TIMEOUT,
  );
});
