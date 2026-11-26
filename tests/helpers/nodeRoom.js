import { vi } from 'vitest';
import { RoomController } from '../../src/net/roomController.js';
import { loadSavedSettings } from '../../src/services/storage.js';
import { createEngine, createFakeImage } from './coreEngine.js';
import { memoryNetwork } from './memoryTransport.js';

// Real RoomController / HostSession / GuestSession in Node, talking over memoryTransport.js.
// The test file must route createTransport() to the memory network:
//
//   vi.mock('../../src/net/transport.js', async () => {
//     const { memoryNetwork } = await import('../helpers/memoryTransport.js');
//     return { createTransport: () => memoryNetwork.createTransport(), getTransportModeFromUrl: () => 'memory' };
//   });
//
// and call installNodeRoomGlobals() in beforeEach and closeNodeRooms() in afterEach.
// Every room uses the same fake image, so a guest already "has" the host's image and joining
// skips the image transfer (which needs a canvas); joining goes straight to the full state.

const rooms = new Set();

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

/**
 * Browser globals the sessions touch: window.location (invite URL), sessionStorage (reconnect
 * tokens), localStorage (settings, auto backup). crypto keeps random values but loses crypto.subtle, so hashing runs the
 * synchronous fallback and flush() never has to wait for the thread pool.
 */
export function installNodeRoomGlobals() {
  const realCrypto = globalThis.crypto;
  vi.stubGlobal('window', { location: { href: 'https://puzzle.test/play?x=1#top' } });
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('crypto', {
    getRandomValues: (buf) => realCrypto.getRandomValues(buf),
    randomUUID: () => realCrypto.randomUUID(),
  });
  memoryNetwork.reset();
}

/**
 * A RoomController with a canvas-free engine and callbacks that record every call.
 * @param {object} [options]
 * @param {object} [options.settings] patched over the default settings
 * @param {object} [options.puzzle] engine options (SMALL_PUZZLE by default)
 * @param {boolean} [options.isSampleImage] what getSourceState reports
 * @param {string} [options.sampleImageId] the sample's id, when it is one
 */
export function createNodeRoom({
  settings = {},
  puzzle = {},
  isSampleImage = false,
  sampleImageId = undefined,
} = {}) {
  const engine = createEngine(puzzle);
  const roomSettings = { ...loadSavedSettings(), ...settings };
  const image = createFakeImage();
  /** [callbackName, ...args] for each callback call, in order. */
  const calls = [];
  const callbacks = new Proxy(
    {},
    {
      get: (_, name) =>
        typeof name === 'string' ? (...args) => void calls.push([name, ...args]) : undefined,
    },
  );
  const room = new RoomController({
    engine,
    getSettings: () => roomSettings,
    getSourceState: () => ({ sourceCanvas: image, isSampleImage, sampleImageId }),
    callbacks,
  });
  rooms.add(room);
  /** Argument lists of one callback, in order. */
  const callsOf = (name) => calls.filter(([n]) => n === name).map(([, ...args]) => args);
  return { room, engine, settings: roomSettings, calls, callsOf };
}

/** Opens a room as host and lets its first messages settle. */
export async function openHost({
  passcode = '',
  requireApproval = false,
  capacity = 8,
  ...rest
} = {}) {
  const host = createNodeRoom(rest);
  await host.room.startHostRoom({ passcode, requireApproval, capacity });
  await memoryNetwork.flush();
  return host;
}

/**
 * Joins a guest and delivers messages until nothing is left (admitted and synced, or waiting /
 * rejected). `rejoin`: the { playerId, reconnectToken } this tab remembers, or null for none.
 */
export async function joinNode(
  roomId,
  { name = 'ゲスト', passcode = '', rejoin = null, flush = true, ...rest } = {},
) {
  const key = `cj_rejoin_${roomId}`;
  if (rejoin) sessionStorage.setItem(key, JSON.stringify(rejoin));
  else sessionStorage.removeItem(key);
  const guest = createNodeRoom(rest);
  await guest.room.joinGuestRoom({ roomId, displayName: name, passcode });
  if (flush) await memoryNetwork.flush();
  return guest;
}

/** The reconnect token the tab stored for a room (read right after that guest joined). */
export function storedRejoin(roomId) {
  return JSON.parse(sessionStorage.getItem(`cj_rejoin_${roomId}`) || 'null');
}

/** Closes every room created here. Call from afterEach. */
export function closeNodeRooms() {
  for (const room of rooms) room.close();
  rooms.clear();
  memoryNetwork.reset();
  vi.unstubAllGlobals();
}
