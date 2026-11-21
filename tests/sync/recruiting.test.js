import { afterEach, describe, expect, it } from 'vitest';
import { closeAllSessions, joinGuest, startHost } from '../helpers/room.js';
import { waitFor } from '../helpers/wait.js';

afterEach(closeAllSessions);

function recruit(host) {
  return host.room.getRecruitStatus().recruit;
}

describe('recruiting: room full', () => {
  it('a full room stops accepting joins and reopens when a seat frees up', async () => {
    const { host, roomId } = await startHost({ capacity: 2 });
    expect(recruit(host)).toBe('open');

    const first = await joinGuest(roomId, { name: 'A' });
    await waitFor(() => recruit(host) === 'full', { message: 'room did not pause when full' });

    await expect(joinGuest(roomId, { name: 'B', waitForSync: false })).rejects.toThrow('満席');

    first.room.close();
    await waitFor(() => recruit(host) === 'open', { message: 'room did not reopen' });
    const second = await joinGuest(roomId, { name: 'B' });
    expect(second.room.role).toBe('guest');
  });

  it('a guest who dropped can take their seat back with their token while the room was full', async () => {
    const { host, roomId } = await startHost({ capacity: 2 });
    const guest = await joinGuest(roomId, { name: 'A' });
    const token = guest.rejoinToken;
    await waitFor(() => recruit(host) === 'full');

    // Network drop: the seat goes offline, which frees it and reopens recruiting.
    guest.room.close();
    await waitFor(() => recruit(host) === 'open');

    const back = await joinGuest(roomId, { name: 'A', rejoinToken: token });
    expect(back.room.myPlayerId).toBe(token.playerId);
    await waitFor(() => recruit(host) === 'full');
  });
});

describe('recruiting: stopped by the host being away', () => {
  it('a stopped room refuses new players until the host resumes; play and saving continue', async () => {
    const { host, roomId } = await startHost();
    // Drive the idle path directly instead of waiting ten minutes.
    host.room.recruitment.idleStopped = true;
    host.room.recruitment.update();
    expect(recruit(host)).toBe('idle_stopped');

    await expect(joinGuest(roomId, { waitForSync: false })).rejects.toThrow('募集停止中');
    const save = host.exportSaveData();
    expect(save.pieces.length).toBeGreaterThan(0);

    host.resumeRecruiting();
    expect(recruit(host)).toBe('open');
    const guest = await joinGuest(roomId);
    expect(guest.room.role).toBe('guest');
  });

  it('the host sees signaling trouble as status, and can still save', async () => {
    const { host } = await startHost();
    const seen = [];
    host.on('recruitChange', (s) => seen.push(s));
    host.room.transport.onSignalingChange('offline');
    expect(seen.at(-1)).toEqual({ recruit: 'open', signaling: 'offline' });
    expect(host.exportSaveData().pieces.length).toBeGreaterThan(0);

    host.resumeRecruiting();
    expect(seen.at(-1)).toEqual({ recruit: 'open', signaling: 'online' });
  });
});
