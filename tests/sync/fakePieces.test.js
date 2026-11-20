import { afterEach, describe, expect, it } from 'vitest';
import { closeAllSessions, joinGuest, startHost, waitForConvergence } from '../helpers/room.js';
import { waitFor } from '../helpers/wait.js';

// Fake (ojama) pieces are shared like real pieces: a guest may lock, drag, drop, rotate and flip
// them, and every board must agree on where they are. Fake pieces have negative ids and group ids.

const TEST_TIMEOUT = 15000;
const NAME_A = 'アリス';
const NAME_B = 'ボブ';
const SHIFT = 150;
const EPS = 0.5;

afterEach(closeAllSessions);

/** Adds fake pieces on the host the way ojama does, then broadcasts them to the guests. */
function addFakesOnHost(host, count = 3) {
  const added = host.engine.addFakePieces(count, 0, true, true, 50);
  host.room.broadcastFakePieces('fake test');
  return added;
}

function fakeOf(app, id) {
  const fp = app.engine.fakePieces.find((p) => p.id === id);
  if (!fp) throw new Error(`fake piece ${id} not found`);
  return fp;
}

function waitForFakes(app, count) {
  return waitFor(() => app.engine.fakePieces.length === count, {
    message: `guest received ${count} fake pieces`,
  });
}

/** Waits until every listed board shows the fake piece at (x, y) and the expected rotation. */
function waitForFakeAt(apps, id, x, y) {
  return waitFor(
    () =>
      apps.every((app) => {
        const fp = fakeOf(app, id);
        return Math.abs(fp.x - x) < EPS && Math.abs(fp.y - y) < EPS;
      }),
    { message: `fake piece ${id} converged at ${x},${y}` },
  );
}

describe('fake pieces in multiplayer', () => {
  it(
    'a guest drags and drops a fake piece and every board agrees on its position',
    async () => {
      const { host, roomId } = await startHost({
        puzzle: { allowRotation: true, allowFlip: true },
      });
      const g1 = await joinGuest(roomId, { name: NAME_A });
      const g2 = await joinGuest(roomId, { name: NAME_B });
      await waitForConvergence([host, g1, g2]);

      addFakesOnHost(host);
      await waitForFakes(g1, host.engine.fakePieces.length);
      await waitForFakes(g2, host.engine.fakePieces.length);

      const fp = host.engine.fakePieces[0];
      const { id, groupId } = fp;
      const targetX = fp.x + SHIFT;
      const targetY = fp.y;

      expect(g1.requestLock(groupId).allowed).toBe(true);
      g1.moveGroup(groupId, SHIFT, 0);
      g1.sendDragPreview(groupId, true);
      g1.submitDrop(groupId);

      await waitFor(() => Math.abs(fakeOf(host, id).x - targetX) < EPS, {
        message: 'host applied the fake piece drop',
      });
      await waitForFakeAt([host, g1, g2], id, targetX, targetY);
      expect(host.room.groupLocks.has(groupId)).toBe(false);
    },
    TEST_TIMEOUT,
  );

  it(
    'a guest cannot drag a fake group without holding its lock',
    async () => {
      const { host, roomId } = await startHost({
        puzzle: { allowRotation: true, allowFlip: true },
      });
      const owner = await joinGuest(roomId, { name: NAME_A });
      const other = await joinGuest(roomId, { name: NAME_B });
      await waitForConvergence([host, owner, other]);

      addFakesOnHost(host);
      await waitForFakes(owner, host.engine.fakePieces.length);
      await waitForFakes(other, host.engine.fakePieces.length);

      const fp = host.engine.fakePieces[0];
      const { id, groupId } = fp;
      const startX = fp.x;
      expect(owner.requestLock(groupId).allowed).toBe(true);
      await waitFor(() => host.room.groupLocks.get(groupId) === owner.room.myPlayerId);

      // The other guest does not hold the lock: its drag and drop must not move the piece.
      other.moveGroup(groupId, SHIFT, 0);
      other.sendDragPreview(groupId, true);
      other.submitDrop(groupId);
      await waitForConvergence([host, owner]);
      expect(Math.abs(fakeOf(host, id).x - startX)).toBeLessThan(EPS);
      expect(host.room.groupLocks.get(groupId)).toBe(owner.room.myPlayerId);
    },
    TEST_TIMEOUT,
  );

  it(
    'a guest rotates a fake piece and every board shows the same rotation',
    async () => {
      const { host, roomId } = await startHost({
        puzzle: { allowRotation: true, allowFlip: true },
      });
      const g1 = await joinGuest(roomId, { name: NAME_A });
      const g2 = await joinGuest(roomId, { name: NAME_B });
      await waitForConvergence([host, g1, g2]);

      addFakesOnHost(host);
      await waitForFakes(g1, host.engine.fakePieces.length);
      await waitForFakes(g2, host.engine.fakePieces.length);

      const { id } = host.engine.fakePieces[0];
      const start = fakeOf(host, id).rotation;
      expect(g1.submitRotate(fakeOf(g1, id), true)).toBe(true);

      const expected = (start + 1) % 4;
      await waitFor(() => [host, g1, g2].every((app) => fakeOf(app, id).rotation === expected), {
        message: 'fake rotation converged',
      });
    },
    TEST_TIMEOUT,
  );
});
