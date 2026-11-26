import { afterEach, describe, expect, it } from 'vitest';
import {
  closeAllSessions,
  dropConnection,
  joinGuest,
  startHost,
  waitForConvergence,
} from '../helpers/room.js';
import {
  boardOf,
  dragAway,
  dragIntoPlace,
  grab,
  holderOf,
  looseIds,
  pieceOf,
  progressOf,
  rotate,
  turnUpright,
} from '../helpers/board.js';
import { nextEvent, waitFor } from '../helpers/wait.js';

/*
 * Acceptance tests: getting into a room, joining a game in progress, and losing and regaining
 * the connection. Black-box: only GameSession's public methods and events, plus the drivers in
 * tests/helpers (eslint.config.mjs enforces this).
 */

const TEST_TIMEOUT = 15000;
const ALICE = 'アリス';
const BOB = 'ボブ';
const CAROL = 'キャロル';

afterEach(closeAllSessions);

function member(app, name) {
  return app.getRoster().find((m) => m.name === name);
}

function names(app) {
  return app
    .getRoster()
    .filter((m) => m.online)
    .map((m) => m.name)
    .sort();
}

describe('joining a room', () => {
  it(
    'guests of an open room see the host’s board and everyone in the room',
    async () => {
      const { host, roomId } = await startHost({ name: 'ホスト' });
      const alice = await joinGuest(roomId, { name: ALICE });
      const bob = await joinGuest(roomId, { name: BOB });

      await waitForConvergence([host, alice, bob]);
      const everyone = ['ホスト', ALICE, BOB].sort();
      await waitFor(() => names(alice).length === 3 && names(bob).length === 3, {
        message: 'guests see the whole room',
      });
      for (const app of [host, alice, bob]) {
        expect(app.getRoomId()).toBe(roomId);
        expect(app.getOnlineCount()).toBe(3);
        expect(names(app)).toEqual(everyone);
      }
      expect(alice.getMyPlayerId()).toBe(member(host, ALICE).id);
      expect(bob.getMyPlayerId()).toBe(member(host, BOB).id);
      expect(alice.getMyPlayerId()).not.toBe(bob.getMyPlayerId());
    },
    TEST_TIMEOUT,
  );

  it(
    'with approval on, the host lets one knocking guest in and turns the other away',
    async () => {
      const { host, roomId } = await startHost({ requireApproval: true });
      const knocks = [];
      host.on('knockChange', (queue) => knocks.push(queue.map((k) => k.displayName)));

      const alice = await joinGuest(roomId, { name: ALICE, waitForSync: false });
      await waitFor(() => knocks.at(-1)?.includes(ALICE), { message: 'alice knocks' });
      expect(host.getOnlineCount()).toBe(1);
      const aliceIn = nextEvent(alice, 'fullStateSynced', { timeout: 5000 });
      host.approveNextKnock();
      await aliceIn;

      const bob = await joinGuest(roomId, { name: BOB, waitForSync: false });
      const bobOut = nextEvent(bob, 'authRejected', { timeout: 5000 });
      await waitFor(() => knocks.at(-1)?.includes(BOB), { message: 'bob knocks' });
      host.rejectNextKnock();
      await bobOut;

      await waitForConvergence([host, alice]);
      expect(knocks.at(-1)).toEqual([]);
      expect(host.getOnlineCount()).toBe(2);
      expect(member(host, BOB)).toBeUndefined();
    },
    TEST_TIMEOUT,
  );

  it(
    'a wrong passcode is turned away and the right one gets in',
    async () => {
      const { host, roomId } = await startHost({ passcode: 'abc' });
      const wrong = await joinGuest(roomId, { name: ALICE, passcode: 'xyz', waitForSync: false });
      await nextEvent(wrong, 'authRejected', { timeout: 5000 });
      expect(host.getOnlineCount()).toBe(1);

      const right = await joinGuest(roomId, { name: BOB, passcode: 'abc' });
      await waitForConvergence([host, right]);
      expect(host.getOnlineCount()).toBe(2);
    },
    TEST_TIMEOUT,
  );
});

describe('joining a game in progress', () => {
  it(
    'a late guest gets the board as it is now and the room’s rules',
    async () => {
      const { host, roomId } = await startHost({ puzzle: { allowRotation: true } });
      const alice = await joinGuest(roomId, { name: ALICE });
      const [p0, p1, p2] = looseIds(host);

      turnUpright(host, p0);
      dragIntoPlace(host, p0);
      await waitForConvergence([host, alice]);
      turnUpright(alice, p1);
      dragIntoPlace(alice, p1);
      await waitForConvergence([host, alice]);
      dragAway(host, p2);
      await waitForConvergence([host, alice]);

      const carol = await joinGuest(roomId, { name: CAROL });
      await waitForConvergence([host, alice, carol]);
      expect(boardOf(carol)).toEqual(boardOf(host));
      expect(progressOf(carol)).toEqual(progressOf(host));
      expect(progressOf(carol).placed).toBe(2);

      // Rotation is allowed in this room, so the late guest may turn a piece too.
      const id = looseIds(carol)[0];
      const before = pieceOf(carol, id).rotation;
      expect(rotate(carol, id)).toBe(true);
      await waitForConvergence([host, alice, carol]);
      expect(pieceOf(host, id).rotation).toBe((before + 1) % 4);
    },
    TEST_TIMEOUT,
  );
});

describe('losing and regaining the connection', () => {
  it(
    'a piece held by a guest whose connection drops is free again for the others',
    async () => {
      const { host, roomId } = await startHost();
      const alice = await joinGuest(roomId, { name: ALICE });
      const bob = await joinGuest(roomId, { name: BOB });
      await waitForConvergence([host, alice, bob]);

      const id = looseIds(host)[0];
      expect(grab(alice, id).allowed).toBe(true);
      const aliceId = alice.getMyPlayerId();
      await waitFor(() => holderOf(host, id) === aliceId, {
        message: 'host sees alice holding it',
      });
      await waitFor(() => holderOf(bob, id) === aliceId, { message: 'bob sees alice holding it' });
      expect(grab(bob, id).allowed).toBe(false);

      dropConnection(alice);
      await waitFor(() => member(host, ALICE)?.online === false, { message: 'alice offline' });
      expect(host.getOnlineCount()).toBe(2);
      await waitFor(() => holderOf(bob, id) === null, { message: 'bob sees it free' });
      expect(holderOf(host, id)).toBeNull();

      expect(grab(bob, id).allowed).toBe(true);
      dragAway(bob, id);
      await waitForConvergence([host, bob]);
      expect(pieceOf(host, id).x).toBeCloseTo(pieceOf(bob, id).x, 1);
    },
    TEST_TIMEOUT,
  );

  it(
    'a guest that comes back keeps its seat, colour and contribution',
    async () => {
      const { host, roomId } = await startHost();
      const alice = await joinGuest(roomId, { name: ALICE });
      dragIntoPlace(alice, looseIds(alice)[0]);
      await waitFor(() => alice.getMyContribution() === 1, { message: 'alice placed one' });
      const seat = member(host, ALICE);

      dropConnection(alice);
      await waitFor(() => member(host, ALICE)?.online === false, { message: 'alice offline' });

      const back = await joinGuest(roomId, { name: ALICE, rejoinToken: alice.rejoinToken });
      await waitForConvergence([host, back]);
      expect(back.getMyPlayerId()).toBe(seat.id);
      expect(back.getMyContribution()).toBe(1);
      expect(member(host, ALICE)).toMatchObject({
        id: seat.id,
        color: seat.color,
        online: true,
        contrib: 1,
      });
      expect(host.getOnlineCount()).toBe(2);
    },
    TEST_TIMEOUT,
  );

  it(
    'someone else’s seat cannot be taken with a made-up token',
    async () => {
      const { host, roomId } = await startHost();
      const alice = await joinGuest(roomId, { name: ALICE });
      const seat = member(host, ALICE);
      dropConnection(alice);
      await waitFor(() => member(host, ALICE)?.online === false, { message: 'alice offline' });

      const forger = await joinGuest(roomId, {
        name: ALICE,
        rejoinToken: { playerId: seat.id, reconnectToken: 'made-up' },
        waitForSync: false,
      });
      await nextEvent(forger, 'authRejected', { timeout: 5000 });
      expect(member(host, ALICE)).toMatchObject({ id: seat.id, online: false });
      expect(host.getOnlineCount()).toBe(1);

      const back = await joinGuest(roomId, { name: ALICE, rejoinToken: alice.rejoinToken });
      await waitForConvergence([host, back]);
      expect(back.getMyPlayerId()).toBe(seat.id);
    },
    TEST_TIMEOUT,
  );
});
