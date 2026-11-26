import { createEngine } from './coreEngine.js';

// Stand-in for GameSession in Node unit tests of the app-layer ojama (app/ojamaSession.js,
// app/timedOjamaRunner.js): a canvas-free engine, the settings, an event log, and a room whose
// broadcasts are recorded. When GameSession or RoomController changes shape, fix it here.

/**
 * @param {object} [options]
 * @param {'solo'|'host'|'guest'} [options.role]
 * @param {object} [options.ojama] ojama settings
 * @param {object} [options.engine]
 */
export function createFakeAppSession({ role = 'host', ojama = {}, engine = createEngine() } = {}) {
  /** [eventName, payload] for each emit. */
  const events = [];
  /** [what, ...args] for each room broadcast or call. */
  const sent = [];
  const listeners = new Map();
  const record =
    (what) =>
    (...args) =>
      sent.push([what, ...args]);

  const session = {
    engine,
    room: {
      role,
      lockedGroupIds: new Set(),
      getLockedGroupIds() {
        return this.lockedGroupIds;
      },
      computeSuperchatMaxHp: () => 15,
      broadcastPhysicalOjama: record('physical'),
      broadcastFakePieces: record('fakePieces'),
      broadcastVisualOjama: record('visual'),
      broadcastVisualClear: record('visualClear'),
      broadcastSuperchatStart: record('superchat'),
      broadcastTimedOjama: record('timed'),
      setRunaway: record('runaway'),
    },
    settings: { ojama },
    getSettings() {
      return this.settings;
    },
    getAllowRotation: () => false,
    getAllowFlip: () => false,
    emit: (name, payload) => events.push([name, payload]),
    on(name, fn) {
      listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    },
  };

  /** Fires a session event as GameSession would. */
  const fire = (name, payload) => {
    for (const fn of listeners.get(name) ?? []) fn(payload);
  };
  /** Payloads of one event, in order. */
  const eventsOf = (name) => events.filter(([n]) => n === name).map(([, p]) => p);
  /** Calls of one room method, as their argument lists. */
  const sentOf = (what) => sent.filter(([w]) => w === what).map(([, ...args]) => args);

  return { session, events, sent, fire, eventsOf, sentOf };
}
