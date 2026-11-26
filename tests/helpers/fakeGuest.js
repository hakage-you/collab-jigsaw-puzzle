import { createEngine } from './coreEngine.js';

// Stand-in for the guest side of a room (RoomController + GuestSession) in Node unit tests of the
// guest handlers (net/guestSyncHandlers.js): a canvas-free engine, the lock table, cursors, drag
// targets, and callbacks that record what they were told. When RoomController or GuestSession
// changes shape, fix it here rather than in each test.

/**
 * @param {object} [options]
 * @param {string} [options.myPlayerId]
 * @param {string[]} [options.without] callbacks this room does not have (older versions)
 */
export function createFakeGuest({ myPlayerId = 'me', without = [] } = {}) {
  const engine = createEngine();
  /** [callbackName, ...args] for each callback call, in order. */
  const calls = [];
  const names = [
    'onRosterUpdate',
    'onRenderNeeded',
    'onLockDenied',
    'onPieceHop',
    'onGuestPatchApplied',
    'onRemoteVisualOjama',
    'onRemoteVisualClear',
    'onRemoteSuperchat',
    'onRemoteSuperchatState',
    'onRemoteSuperchatDismiss',
    'onOjamaNotice',
    'onToast',
    'onRemoteCompleted',
    'onRemoteTimedOjama',
  ].filter((name) => !without.includes(name));
  const cb = Object.fromEntries(
    names.map((name) => [name, (...args) => calls.push([name, ...args])]),
  );

  const room = {
    engine,
    myPlayerId,
    roster: [],
    groupLocks: new Map(),
    remoteCursors: new Map(),
    remoteDragTargets: new Map(),
    cb,
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
  };
  const session = { room, optimisticRollback: null, pendingGroupOpSeq: new Map() };

  /** Calls of one callback, as their argument lists. */
  const callsOf = (name) => calls.filter(([n]) => n === name).map(([, ...args]) => args);

  return { session, room, engine, calls, callsOf };
}
