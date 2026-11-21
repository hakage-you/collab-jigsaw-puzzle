import { afterEach, describe, expect, it } from 'vitest';
import { MSG } from '../../src/net/protocol.js';
import { dropNearTarget } from '../helpers/puzzle.js';
import { closeAllSessions, joinGuest, startHost, waitForConvergence } from '../helpers/room.js';
import { nextEvent } from '../helpers/wait.js';

// Physical interference (knocking pieces off the board, rotating/flipping loose pieces) runs on
// the host. Guests must end up with the same board, and the host must send only the pieces that
// changed, not the whole board.

afterEach(closeAllSessions);

/** Locks the first `n` pieces on the host and shares the result with the guests. */
function lockOnHost(host, n) {
  for (const p of host.engine.pieces.slice(0, n)) dropNearTarget(host.engine, p);
  host.room.broadcastSortResult();
}

/** Records the pieces carried by every pieces_patch the host broadcasts. */
function recordPatches(host) {
  const sent = [];
  const transport = host.room.transport;
  const original = transport.broadcast.bind(transport);
  transport.broadcast = (msg) => {
    if (msg.type === MSG.PIECES_PATCH) sent.push(...msg.pieces);
    return original(msg);
  };
  return sent;
}

describe('physical interference in multiplayer', () => {
  it('knocking pieces off the board sends only those pieces and every board agrees', async () => {
    const { host, roomId } = await startHost();
    const guest = await joinGuest(roomId, { name: 'A' });
    lockOnHost(host, 6);
    await waitForConvergence([host, guest]);

    const sent = recordPatches(host);
    const effect = nextEvent(guest, 'ojamaDropEffect', { timeout: 5000 });
    const dropped = host.engine.dropLockedPieces(2, false);
    host.room.broadcastPhysicalOjama('drop test', dropped, 'ojama_drop');

    await waitForConvergence([host, guest]);
    expect(dropped).toHaveLength(2);
    expect(sent.map((p) => p.id).sort()).toEqual(dropped.map((p) => p.id).sort());
    expect(sent.length).toBeLessThan(host.engine.pieces.length);
    // The guest plays the drop effect too, at each piece's board spot and where it landed.
    const { pieces } = await effect;
    // Positions travel rounded to 0.01 (serializePieces).
    const spots = (list) =>
      list.map((p) => [p.id, p.targetX, p.targetY, p.x, p.y].map((v) => Math.round(v))).sort();
    expect(spots(pieces)).toEqual(spots(dropped));
  });

  it('rotating and flipping loose pieces sends only the changed pieces and boards agree', async () => {
    const { host, roomId } = await startHost();
    const guest = await joinGuest(roomId, { name: 'A' });

    const sent = recordPatches(host);
    const changed = host.engine.prankLoosePieces(3, host.room.getLockedGroupIds());
    host.room.broadcastPhysicalOjama('prank test', changed);

    await waitForConvergence([host, guest]);
    expect(changed.length).toBeGreaterThan(0);
    expect(sent.map((p) => p.id).sort()).toEqual(changed.map((p) => p.id).sort());
    expect(sent.length).toBeLessThan(host.engine.pieces.length);
  });
});
