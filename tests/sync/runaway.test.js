import { afterEach, describe, expect, it } from 'vitest';
import { MSG } from '../../src/net/protocol.js';
import { closeAllSessions, joinGuest, startHost, waitForConvergence } from '../helpers/room.js';
import { nextEvent, waitFor } from '../helpers/wait.js';

// Runaway pieces are decided on the host: a grab may make the group hop away (the first always
// does), and a held group slips out of the hand after a few seconds. Every screen ends up with
// the same board, and each hop is one small message.

afterEach(closeAllSessions);

// Real games use 3 to 6 seconds; a short grip keeps the test quick.
const RULES = { chance: 0, gripMinSec: 0.2, gripMaxSec: 0.2 };
const sleep = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

function loosePiece(app) {
  return app.engine.pieces.find((p) => !p.isLocked);
}

function recordHops(host) {
  const sent = [];
  const transport = host.room.transport;
  const original = transport.broadcast.bind(transport);
  transport.broadcast = (msg, ...rest) => {
    if (msg.type === MSG.PIECE_HOP) sent.push(msg);
    return original(msg, ...rest);
  };
  return sent;
}

describe('runaway pieces in multiplayer', () => {
  it('the first grab of a guest makes the piece hop away, and every board agrees', async () => {
    const { host, roomId } = await startHost();
    const guest = await joinGuest(roomId, { name: 'A' });
    host.room.setRunaway(RULES);
    const hops = recordHops(host);

    const piece = loosePiece(guest);
    const before = { x: piece.x, y: piece.y };
    const hopped = nextEvent(guest, 'pieceHop', { timeout: 5000 });
    guest.requestLock(piece.groupId, { x: piece.x - 10, y: piece.y });
    const hop = await hopped;

    expect(hop.byPlayerId).toBe(guest.room.myPlayerId);
    expect(hops).toHaveLength(1);
    expect(hops[0].positions).toHaveLength(1);
    const moved = guest.engine.getPieceById(piece.id);
    expect(Math.hypot(moved.x - before.x, moved.y - before.y)).toBeGreaterThan(host.engine.pieceW);
    expect(host.room.groupLocks.has(piece.groupId)).toBe(false);
    expect(guest.room.groupLocks.has(piece.groupId)).toBe(false);
    await waitForConvergence([host, guest]);
  });

  it('after the first hop a grab can hold, but the piece slips out of the hand later', async () => {
    const { host, roomId } = await startHost();
    const guest = await joinGuest(roomId, { name: 'A' });
    host.room.setRunaway(RULES);
    const piece = loosePiece(guest);
    const first = nextEvent(guest, 'pieceHop', { timeout: 5000 });
    guest.requestLock(piece.groupId);
    await first;

    guest.requestLock(piece.groupId);
    await waitFor(() => host.room.groupLocks.get(piece.groupId) === guest.room.myPlayerId, {
      message: 'the second grab was not granted',
    });
    await nextEvent(guest, 'pieceHop', { timeout: 5000 });
    expect(host.room.groupLocks.has(piece.groupId)).toBe(false);
    await waitForConvergence([host, guest]);
  });

  it('dropping before the time is up keeps the piece where it was put', async () => {
    const { host } = await startHost();
    host.room.setRunaway(RULES);
    const piece = loosePiece(host);
    expect(host.requestLock(piece.groupId).hopped).toBe(true);

    expect(host.requestLock(piece.groupId).allowed).toBe(true);
    host.moveGroup(piece.groupId, 5, 0);
    const at = { x: piece.x, y: piece.y };
    host.submitDrop(piece.groupId);
    await sleep(400);
    expect({ x: piece.x, y: piece.y }).toEqual(at);
  });

  it('big groups and placed pieces do not run away', async () => {
    const { host } = await startHost();
    host.room.setRunaway(RULES);
    const [a, b, c, d, e] = host.engine.pieces;
    for (const p of [b, c, d, e]) p.groupId = a.groupId;
    expect(host.requestLock(a.groupId).allowed).toBe(true);
  });
});
