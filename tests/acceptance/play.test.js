import { afterEach, describe, expect, it } from 'vitest';
import { closeAllSessions, joinGuest, startHost, waitForConvergence } from '../helpers/room.js';
import {
  FAR,
  boardOf,
  dragIntoPlace,
  grab,
  holderOf,
  looseIds,
  moveHeld,
  pieceOf,
  progressOf,
  release,
  rotate,
} from '../helpers/board.js';
import { nextEvent, waitFor } from '../helpers/wait.js';

/*
 * Acceptance tests: playing on one board together. Two players reaching for the same piece,
 * and a whole puzzle solved by three players ending in the same state everywhere.
 * Black-box: only GameSession's public methods and events, plus the drivers in tests/helpers.
 */

const TEST_TIMEOUT = 20000;
const ALICE = 'アリス';
const BOB = 'ボブ';

afterEach(closeAllSessions);

async function roomOfThree(puzzle = {}) {
  const { host, roomId } = await startHost({ puzzle });
  const alice = await joinGuest(roomId, { name: ALICE });
  const bob = await joinGuest(roomId, { name: BOB });
  await waitForConvergence([host, alice, bob]);
  return { host, alice, bob, all: [host, alice, bob] };
}

describe('two players reach for the same piece', () => {
  it(
    'the first to grab it wins, the other’s move is undone, and every board agrees',
    async () => {
      const { host, alice, bob, all } = await roomOfThree();
      const id = looseIds(host)[0];
      const { targetX, targetY } = pieceOf(host, id);
      const denied = [];
      for (const app of [alice, bob]) app.on('lockDenied', () => denied.push(app));

      // Both grab before either hears from the host; each sees its own grab succeed at first.
      expect(grab(alice, id).allowed).toBe(true);
      expect(grab(bob, id).allowed).toBe(true);
      moveHeld(alice, id, targetX + FAR, targetY + FAR);
      moveHeld(bob, id, targetX - FAR, targetY + FAR);

      await waitFor(() => denied.length > 0, { message: 'one grab denied' });
      expect(denied).toEqual([bob]);
      const aliceId = alice.getMyPlayerId();
      await waitFor(() => all.every((app) => holderOf(app, id) === aliceId), {
        message: 'everyone sees alice holding it',
      });

      release(alice, id);
      await waitForConvergence(all);
      for (const app of all) {
        expect(pieceOf(app, id)).toMatchObject({ isLocked: false });
        expect(pieceOf(app, id).x).toBeCloseTo(targetX + FAR, 1);
        expect(holderOf(app, id)).toBeNull();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'a guest who loses the race sees its move undone at once',
    async () => {
      const { host, bob, all } = await roomOfThree();
      const id = looseIds(host)[0];
      const start = pieceOf(host, id);
      const bobDenied = nextEvent(bob, 'lockDenied');

      // The host's grab counts at once; bob's grab has not reached the host yet.
      expect(grab(host, id).allowed).toBe(true);
      expect(grab(bob, id).allowed).toBe(true);
      moveHeld(bob, id, start.targetX - FAR, start.targetY + FAR);
      expect(pieceOf(bob, id).x).not.toBeCloseTo(start.x, 1);

      await bobDenied;
      expect(pieceOf(bob, id).x).toBeCloseTo(start.x, 1);
      expect(pieceOf(bob, id).y).toBeCloseTo(start.y, 1);
      expect(holderOf(bob, id)).toBe('host');

      release(host, id);
      await waitForConvergence(all);
    },
    TEST_TIMEOUT,
  );

  it(
    'a piece someone holds cannot be grabbed, turned or dropped by another until it is let go',
    async () => {
      const { host, alice, bob, all } = await roomOfThree({ allowRotation: true });
      const id = looseIds(host)[0];
      const before = pieceOf(host, id);

      expect(grab(host, id).allowed).toBe(true);
      await waitFor(() => holderOf(bob, id) === 'host', {
        message: 'bob sees the host holding it',
      });
      expect(grab(bob, id).allowed).toBe(false);
      expect(rotate(bob, id)).toBe(false);

      moveHeld(host, id, before.targetX + FAR, before.targetY + FAR);
      release(host, id);
      await waitForConvergence(all);
      expect(pieceOf(bob, id).rotation).toBe(before.rotation);

      expect(grab(alice, id).allowed).toBe(true);
      release(alice, id);
      await waitForConvergence(all);
      expect(boardOf(alice)).toEqual(boardOf(host));
    },
    TEST_TIMEOUT,
  );
});

describe('solving the puzzle together', () => {
  it(
    'three players take turns, everyone sees it complete, and the final state is the same everywhere',
    async () => {
      const { host, alice, bob, all } = await roomOfThree();
      const completions = new Map(all.map((app) => [app, []]));
      for (const app of all) app.on('puzzleComplete', (r) => completions.get(app).push(r));

      const ids = looseIds(host);
      const placedBy = new Map(all.map((app) => [app, 0]));
      for (const [i, id] of ids.entries()) {
        const player = all[i % all.length];
        expect(dragIntoPlace(player, id)).not.toBeNull();
        placedBy.set(player, placedBy.get(player) + 1);
        // eslint-disable-next-line no-await-in-loop -- players take turns, one drop at a time
        await waitForConvergence(all);
      }

      await waitFor(() => all.every((app) => completions.get(app).length > 0), {
        message: 'everyone sees the puzzle complete',
      });
      const total = ids.length;
      for (const app of all) {
        expect(completions.get(app)).toHaveLength(1);
        expect(completions.get(app)[0]).toMatchObject({
          pieceCount: total,
          placedCount: total,
          isMultiplayer: true,
          myContrib: placedBy.get(app),
        });
        expect(progressOf(app)).toEqual({ placed: total, total });
        expect(boardOf(app)).toEqual(boardOf(host));
      }
      await waitFor(() => alice.getRoster().every((m) => m.contrib > 0), {
        message: 'roster contributions reach the guests',
      });
      for (const app of all) {
        const byName = Object.fromEntries(app.getRoster().map((m) => [m.name, m.contrib]));
        expect(byName).toMatchObject({
          [ALICE]: placedBy.get(alice),
          [BOB]: placedBy.get(bob),
        });
      }
    },
    TEST_TIMEOUT,
  );
});
