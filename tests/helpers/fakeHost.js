import { createEngine } from './coreEngine.js';

// Stand-in for the host side of a room (RoomController + HostSession) in Node unit tests of the
// net handlers (hostBoardOps, hostAdmission, runawayHost, hostSyncHelper). It holds only what the
// handlers touch: a canvas-free engine, the lock table, a transport that records what was sent,
// and callbacks that record what they were told. When RoomController or HostSession changes
// shape, fix it here rather than in each test.

/**
 * @param {object} [options]
 * @param {object} [options.engine] engine to use (default: coreEngine.createEngine())
 * @param {object} [options.settings] overrides of the room settings
 * @param {number} [options.capacity] seats, host included
 */
export function createFakeHost({ engine = createEngine(), settings = {}, capacity = 4 } = {}) {
  /** [connId, msg] for each sendTo. */
  const sent = [];
  /** [msg, exceptConnId] for each broadcast. */
  const broadcasts = [];
  const disconnected = [];
  const calls = {
    render: 0,
    roster: 0,
    backups: 0,
    patches: [],
    hops: [],
    knocks: [],
    welcomes: [],
    released: [],
  };

  const room = {
    engine,
    role: 'host',
    groupLocks: new Map(),
    remoteCursors: new Map(),
    transport: {
      sendTo: (connId, msg) => sent.push([connId, msg]),
      broadcast: (msg, except) => broadcasts.push([msg, except]),
      disconnect: (connId) => disconnected.push(connId),
    },
    cb: {
      onRenderNeeded: () => {
        calls.render += 1;
      },
      onHostPatchApplied: (pieces, res, actorId) => calls.patches.push({ pieces, res, actorId }),
      onPieceHop: (hop) => calls.hops.push(hop),
      onKnockRequest: (knock) => calls.knocks.push(knock),
    },
    runaway: { onGrab: () => false, onRelease: () => {} },
    savedGuests: new Map(),
    sourceState: { isSampleImage: true, sampleImageId: 'met-seaside', sourceCanvas: null },
    /** Same rule as RoomController.applyPositionsOnly: placed pieces stay where they are. */
    applyPositionsOnly(positions) {
      const byId = new Map(positions.map((pos) => [pos.id, pos]));
      for (const p of [...engine.pieces, ...engine.fakePieces]) {
        const upd = byId.get(p.id);
        if (upd && !p.isLocked) {
          p.x = upd.x;
          p.y = upd.y;
        }
      }
    },
    getSettings: () => ({ allowRotation: true, allowFlip: true, showStats: true, ...settings }),
    getSourceState() {
      return this.sourceState;
    },
    claimSavedGuestContrib(name) {
      const saved = this.savedGuests.get(name) ?? null;
      this.savedGuests.delete(name);
      return saved;
    },
  };

  const session = {
    room,
    passcode: '',
    capacity,
    requireApproval: false,
    pendingAuth: new Map(),
    pendingKnocks: new Map(),
    guests: new Map(),
    connToPlayer: new Map(),
    /** Host plus online guests, as HostSession counts them. */
    getOnlineCount() {
      return 1 + [...this.guests.values()].filter((g) => g.online).length;
    },
    syncRoster() {
      calls.roster += 1;
    },
    scheduleAutoBackup() {
      calls.backups += 1;
    },
    releasePlayerHolds(playerId) {
      calls.released.push(playerId);
    },
    _sendWelcomeToGuest(guest) {
      calls.welcomes.push(guest.id);
    },
  };
  room.hostSession = session;

  /** Adds an online guest and returns it. */
  function addGuest(id, over = {}) {
    const guest = {
      id,
      connId: `conn-${id}`,
      name: id,
      color: '#123456',
      role: 'guest',
      contrib: 0,
      online: true,
      reconnectToken: `token-${id}`,
      ...over,
    };
    session.guests.set(id, guest);
    if (guest.connId) session.connToPlayer.set(guest.connId, id);
    return guest;
  }

  /** Messages of one type, in order: sent ones as [connId, msg], broadcasts as [msg, except]. */
  const sentOf = (type) => sent.filter(([, msg]) => msg.type === type);
  const broadcastsOf = (type) => broadcasts.filter(([msg]) => msg.type === type);

  return { session, room, sent, broadcasts, disconnected, calls, addGuest, sentOf, broadcastsOf };
}
