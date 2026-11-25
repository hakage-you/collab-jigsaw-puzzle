import { GameSession } from '../../src/app/gameSession.js';
import { boardState, SMALL_PUZZLE } from './puzzle.js';
import { nextEvent, waitFor } from './wait.js';

const sessions = new Set();

function createSession() {
  const app = new GameSession({ initialSampleId: 'rainbow' });
  // Same-page BroadcastChannel transport: no network, no PeerJS server.
  app.room.transportMode = 'local';
  sessions.add(app);
  return app;
}

/**
 * Starts a host with a small puzzle in a local-transport room.
 * Returns { host, roomId }.
 */
export async function startHost({
  puzzle = {},
  passcode = '',
  requireApproval = false,
  capacity = 8,
  name = 'ホスト',
} = {}) {
  const host = createSession();
  host.patchSettings({ ...SMALL_PUZZLE, ...puzzle });
  host.startNewPuzzle();
  await host.startHostRoom({ displayName: name, passcode, requireApproval, capacity });
  return { host, roomId: host.room.roomId };
}

/**
 * Joins a guest and waits until its board is synced with the host.
 * With `waitForSync: false` it returns right after the transport connects
 * (use this for knock / reject / passcode scenarios).
 */
export async function joinGuest(
  roomId,
  { name = 'ゲスト', passcode = '', waitForSync = true, rejoinToken = null } = {},
) {
  // All sessions share one page, so the per-tab rejoin token in sessionStorage must be set
  // explicitly per guest: none for a new guest, or the given token to simulate a reconnect.
  if (rejoinToken) {
    sessionStorage.setItem(`cj_rejoin_${roomId}`, JSON.stringify(rejoinToken));
  } else {
    sessionStorage.removeItem(`cj_rejoin_${roomId}`);
  }
  const guest = createSession();
  const synced = waitForSync ? nextEvent(guest, 'fullStateSynced', { timeout: 5000 }) : null;
  await guest.joinGuestRoom({ roomId, displayName: name, passcode });
  if (synced) await synced;
  // Remember this guest's own token so a test can reconnect as it later.
  guest.rejoinToken = JSON.parse(sessionStorage.getItem(`cj_rejoin_${roomId}`) || 'null');
  return guest;
}

/** Waits until every session's board equals the first one's. */
export function waitForConvergence(apps, { timeout = 3000 } = {}) {
  return waitFor(
    () => {
      const ref = JSON.stringify(boardState(apps[0].engine));
      return apps.every((a) => JSON.stringify(boardState(a.engine)) === ref);
    },
    { timeout, message: 'boards did not converge' },
  );
}

/** Closes every session created by these helpers. Call from afterEach. */
export function closeAllSessions() {
  for (const app of sessions) {
    try {
      app.room.close();
    } catch {
      // already closed
    }
  }
  sessions.clear();
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith('cj_rejoin_')) sessionStorage.removeItem(key);
  }
}
