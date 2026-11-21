import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MULTIPLAYER_CONFIG } from '../../src/config/constants.js';
import { closeAllSessions, joinGuest, startHost } from '../helpers/room.js';
import { nextEvent, waitFor } from '../helpers/wait.js';

// Short liveness timings so a vanished peer is noticed within the test.
const saved = {};
beforeEach(() => {
  saved.interval = MULTIPLAYER_CONFIG.HEARTBEAT_INTERVAL_MS;
  saved.timeout = MULTIPLAYER_CONFIG.HEARTBEAT_TIMEOUT_MS;
  MULTIPLAYER_CONFIG.HEARTBEAT_INTERVAL_MS = 50;
  MULTIPLAYER_CONFIG.HEARTBEAT_TIMEOUT_MS = 300;
});
afterEach(() => {
  MULTIPLAYER_CONFIG.HEARTBEAT_INTERVAL_MS = saved.interval;
  MULTIPLAYER_CONFIG.HEARTBEAT_TIMEOUT_MS = saved.timeout;
  closeAllSessions();
});

/**
 * Makes a session vanish without saying goodbye (tab killed, network gone): its transport goes
 * silent and its own liveness check stops, but nothing is closed cleanly.
 */
function vanish(app) {
  app.room.hostSession.liveness.stop();
  app.room.guestSession.liveness.stop();
  const transport = app.room.transport;
  transport.channel.onmessage = null;
  transport.channel.close();
  transport.channel = null;
}

function onlineGuests(host) {
  return host.room.roster.filter((m) => m.role === 'guest' && m.online).length;
}

describe('a guest that vanishes', () => {
  it('is dropped by the host, freeing the seat and reopening a full room', async () => {
    const { host, roomId } = await startHost({ capacity: 2 });
    const guest = await joinGuest(roomId, { name: 'A' });
    await waitFor(() => host.room.getRecruitStatus().recruit === 'full');

    vanish(guest);
    await waitFor(() => onlineGuests(host) === 0, { message: 'vanished guest kept its seat' });
    await waitFor(() => host.room.getRecruitStatus().recruit === 'open');
  });

  it('can take its seat back with its token before the host noticed', async () => {
    MULTIPLAYER_CONFIG.HEARTBEAT_TIMEOUT_MS = 60_000;
    const { host, roomId } = await startHost();
    const guest = await joinGuest(roomId, { name: 'A' });
    const token = guest.rejoinToken;

    vanish(guest);
    expect(onlineGuests(host)).toBe(1);

    const back = await joinGuest(roomId, { name: 'A', rejoinToken: token });
    expect(back.room.myPlayerId).toBe(token.playerId);
    await waitFor(() => onlineGuests(host) === 1 && host.room.hostSession.guests.size === 1);
  });

  it('the older of two connections with the same token is told why it was cut off', async () => {
    const { host, roomId } = await startHost();
    const first = await joinGuest(roomId, { name: 'A' });
    const notice = nextEvent(first, 'notice', { timeout: 3000 });

    const second = await joinGuest(roomId, { name: 'A', rejoinToken: first.rejoinToken });
    expect(second.room.myPlayerId).toBe(first.rejoinToken.playerId);
    expect((await notice).message).toContain('別の接続から再参加');
    expect(first.room.role).toBe('solo');
    expect(host.room.getOnlineCount()).toBe(2);
  });
});

describe('a host that vanishes', () => {
  it('the guest is disconnected and shown a notice it must close itself, with a rejoin action', async () => {
    const { host, roomId } = await startHost();
    const guest = await joinGuest(roomId, { name: 'A' });
    const notice = nextEvent(guest, 'notice', { timeout: 3000 });

    vanish(host);
    const shown = await notice;
    expect(guest.room.role).toBe('solo');
    expect(shown.title).toContain('接続が切れました');
    expect(shown.hint).toContain('このタブのまま');
    expect(shown.action).toEqual({ id: 'rejoin', label: '再参加する' });
    expect(guest.canRejoinLastRoom()).toBe(true);
  });
});

describe('a host that closes the connection', () => {
  it('the guest leaves the room and is notified exactly once', async () => {
    const { host, roomId } = await startHost();
    const guest = await joinGuest(roomId, { name: 'A' });
    const notices = [];
    guest.on('notice', (n) => notices.push(n));

    // What the host tab sends when it is closed.
    host.room.transport.channel.postMessage({ kind: 'lc_host_closed', from: 'host' });
    await waitFor(() => notices.length === 1);
    expect(guest.room.role).toBe('solo');
    // Longer than the liveness timeout: no second notice from the heartbeat.
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toBe('');
  });
});

describe('notices', () => {
  it('a kicked guest gets a notice without a rejoin action', async () => {
    const { host, roomId } = await startHost();
    const guest = await joinGuest(roomId, { name: 'A' });
    const notice = nextEvent(guest, 'notice', { timeout: 3000 });

    host.room.kickGuest(guest.room.myPlayerId);
    const shown = await notice;
    expect(shown.action).toBeNull();
    expect(guest.canRejoinLastRoom()).toBe(false);
  });
});
