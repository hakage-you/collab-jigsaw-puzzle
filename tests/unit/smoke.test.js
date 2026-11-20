import { afterEach, describe, expect, it } from 'vitest';
import { closeAllSessions, joinGuest, startHost, waitForConvergence } from '../helpers/room.js';
import { boardState } from '../helpers/puzzle.js';

afterEach(closeAllSessions);

describe('test harness', () => {
  it('connects a host and two guests over the local transport', async () => {
    const { host, roomId } = await startHost();
    const g1 = await joinGuest(roomId, { name: 'A' });
    const g2 = await joinGuest(roomId, { name: 'B' });
    await waitForConvergence([host, g1, g2]);
    expect(boardState(g1.engine)).toEqual(boardState(host.engine));
    expect(host.room.getOnlineCount()).toBe(3);
  });
});
