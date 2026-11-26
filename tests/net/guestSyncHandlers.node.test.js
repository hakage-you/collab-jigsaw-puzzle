import { describe, expect, it } from 'vitest';
import { REALTIME_HANDLERS, isRollbackFor } from '../../src/net/guestSyncHandlers.js';
import { MSG } from '../../src/net/protocol.js';
import { createFakeGuest } from '../helpers/fakeGuest.js';

// The guest's handling of the host's realtime messages: roster, cursors, locks, previews, piece
// patches (including out-of-date echoes of its own turns) and the ojama relays.

/** Runs the handler for msg.type on the fake guest. */
function receive(guest, msg) {
  REALTIME_HANDLERS.get(msg.type)(guest.session, msg);
}

const serialized = (p, over = {}) => ({
  id: p.id,
  x: p.x,
  y: p.y,
  rotation: p.rotation,
  isFlipped: p.isFlipped,
  groupId: p.groupId,
  isLocked: p.isLocked,
  zOrder: p.zOrder,
  ...over,
});

describe('roster and cursors', () => {
  it('takes the roster, or none', () => {
    const guest = createFakeGuest();
    receive(guest, { type: MSG.ROSTER_UPDATE, roster: [{ id: 'host' }] });
    receive(guest, { type: MSG.ROSTER_UPDATE });
    expect(guest.room.roster).toEqual([]);
    expect(guest.callsOf('onRosterUpdate')).toEqual([[[{ id: 'host' }]], [[]]]);
  });

  it('adds a cursor where it is, then only moves its target, name and colour', () => {
    const guest = createFakeGuest();
    receive(guest, { type: MSG.CURSOR_MOVE, playerId: 'p2', x: 1, y: 2, name: 'A', color: '#111' });
    receive(guest, { type: MSG.CURSOR_MOVE, playerId: 'p2', x: 5, y: 6, name: 'B', color: '#222' });
    expect(guest.room.remoteCursors.get('p2')).toEqual({
      playerId: 'p2',
      x: 1,
      y: 2,
      targetX: 5,
      targetY: 6,
      name: 'B',
      color: '#222',
    });
    expect(guest.callsOf('onRenderNeeded')).toHaveLength(2);
  });

  it('ignores its own cursor', () => {
    const guest = createFakeGuest();
    receive(guest, { type: MSG.CURSOR_MOVE, playerId: 'me', x: 1, y: 2 });
    expect([guest.room.remoteCursors.size, guest.calls]).toEqual([0, []]);
  });
});

describe('locks', () => {
  it('records a grant and stacks the group at the given height', () => {
    const guest = createFakeGuest();
    const [a] = guest.engine.pieces;
    const zVersion = guest.engine.zVersion;
    receive(guest, { type: MSG.LOCK_GRANTED, groupId: a.groupId, ownerId: 'p2', zOrder: 500 });
    expect(guest.room.groupLocks.get(a.groupId)).toBe('p2');
    expect(a.zOrder).toBe(500);
    expect(guest.engine.maxZ).toBe(501);
    expect(guest.engine.zVersion).toBe(zVersion + 1);
    expect(guest.callsOf('onRenderNeeded')).toHaveLength(1);
  });

  it('keeps the stacking and a higher top when the grant has no height or a low one', () => {
    const guest = createFakeGuest();
    const [a, b] = guest.engine.pieces;
    const z = a.zOrder;
    receive(guest, { type: MSG.LOCK_GRANTED, groupId: a.groupId, ownerId: 'p2' });
    expect(a.zOrder).toBe(z);
    const maxZ = guest.engine.maxZ;
    receive(guest, { type: MSG.LOCK_GRANTED, groupId: b.groupId, ownerId: 'p2', zOrder: 0 });
    expect(guest.engine.maxZ).toBe(maxZ);
  });

  it('drops its pending rollback when its own grab is granted, not someone else’s', () => {
    const guest = createFakeGuest();
    const [a] = guest.engine.pieces;
    guest.session.optimisticRollback = { groupId: a.groupId, snapshot: [] };
    receive(guest, { type: MSG.LOCK_GRANTED, groupId: a.groupId, ownerId: 'p2' });
    expect(isRollbackFor(guest.session, a.groupId)).toBe(true);
    receive(guest, { type: MSG.LOCK_GRANTED, groupId: a.groupId, ownerId: 'me' });
    expect(guest.session.optimisticRollback).toBeNull();
    expect(isRollbackFor(guest.session, a.groupId)).toBe(false);
  });

  it('on a denial takes the true pieces and the owner', () => {
    const guest = createFakeGuest();
    const [a] = guest.engine.pieces;
    guest.session.optimisticRollback = { groupId: a.groupId, snapshot: [{ id: a.id, x: 0, y: 0 }] };
    receive(guest, {
      type: MSG.LOCK_DENIED,
      groupId: a.groupId,
      ownerId: 'p2',
      pieces: [serialized(a, { x: 77, y: 88 })],
    });
    expect([a.x, a.y]).toEqual([77, 88]);
    expect(guest.room.groupLocks.get(a.groupId)).toBe('p2');
    expect(guest.session.optimisticRollback).toBeNull();
    expect(guest.callsOf('onLockDenied')).toEqual([[a.groupId]]);
  });

  it('on a denial without pieces puts its own drag back, and frees an ownerless group', () => {
    const guest = createFakeGuest();
    const [a] = guest.engine.pieces;
    guest.room.groupLocks.set(a.groupId, 'me');
    a.x = 500;
    guest.session.optimisticRollback = { groupId: a.groupId, snapshot: [{ id: a.id, x: 1, y: 2 }] };
    receive(guest, { type: MSG.LOCK_DENIED, groupId: a.groupId, ownerId: null });
    expect([a.x, a.y]).toEqual([1, 2]);
    expect(guest.room.groupLocks.has(a.groupId)).toBe(false);
  });

  it('does not roll back another group on a denial without pieces', () => {
    const guest = createFakeGuest();
    const [a, b] = guest.engine.pieces;
    const before = [a.x, a.y];
    guest.session.optimisticRollback = { groupId: a.groupId, snapshot: [{ id: a.id, x: 1, y: 2 }] };
    receive(guest, { type: MSG.LOCK_DENIED, groupId: b.groupId, ownerId: 'p2' });
    expect([a.x, a.y]).toEqual(before);
  });

  it('forgets a released lock and its drag targets', () => {
    const guest = createFakeGuest();
    guest.room.groupLocks.set(3, 'p2');
    guest.room.remoteDragTargets.set(3, new Map());
    receive(guest, { type: MSG.LOCK_RELEASE, groupId: 3 });
    expect([guest.room.groupLocks.size, guest.room.remoteDragTargets.size]).toEqual([0, 0]);
    expect(guest.callsOf('onRenderNeeded')).toHaveLength(1);
  });
});

describe('drag previews', () => {
  it("keeps other players' drag targets per group", () => {
    const guest = createFakeGuest();
    const preview = (positions) => ({
      type: MSG.DRAG_PREVIEW,
      groupId: 4,
      ownerId: 'p2',
      positions,
    });
    receive(guest, preview([{ id: 1, x: 1, y: 1 }]));
    receive(guest, preview([{ id: 2, x: 2, y: 2 }]));
    expect([...guest.room.remoteDragTargets.get(4)]).toEqual([
      [1, { x: 1, y: 1 }],
      [2, { x: 2, y: 2 }],
    ]);
    expect(guest.callsOf('onRenderNeeded')).toHaveLength(2);
  });

  it('ignores its own previews and broken ones', () => {
    const guest = createFakeGuest();
    receive(guest, { type: MSG.DRAG_PREVIEW, groupId: 4, ownerId: 'me', positions: [] });
    receive(guest, { type: MSG.DRAG_PREVIEW, groupId: 4, ownerId: 'p2' });
    expect([guest.room.remoteDragTargets.size, guest.calls]).toEqual([0, []]);
  });
});

describe('piece patches', () => {
  const patch = (pieces, over = {}) => ({ type: MSG.PIECES_PATCH, pieces, ...over });

  it('applies pieces, locks, stats and labels, then reports the patch', () => {
    const guest = createFakeGuest();
    const [a] = guest.engine.pieces;
    guest.room.remoteDragTargets.set(9, new Map());
    const stats = { placedCount: 4 };
    const labels = [{ text: 'x', x: 0, y: 0 }];
    receive(
      guest,
      patch([serialized(a, { x: 10, y: 20 })], {
        locks: [[a.groupId, 'p2']],
        stats,
        zoneLabels: labels,
        actionResult: { type: 'snap' },
        actorId: 'p2',
      }),
    );
    expect([a.x, a.y]).toEqual([10, 20]);
    expect([...guest.room.groupLocks]).toEqual([[a.groupId, 'p2']]);
    expect(guest.engine.stats).toBe(stats);
    expect(guest.engine.zoneLabels).toBe(labels);
    expect(guest.room.remoteDragTargets.size).toBe(0);
    expect(guest.callsOf('onGuestPatchApplied')).toEqual([
      [[serialized(a, { x: 10, y: 20 })], { type: 'snap' }, 'p2', null],
    ]);
  });

  it('waits for the last chunk before reporting', () => {
    const guest = createFakeGuest();
    const [a, b] = guest.engine.pieces;
    guest.room.remoteDragTargets.set(9, new Map());
    receive(guest, patch([serialized(a, { x: 1 })], { isFinalChunk: false }));
    expect(a.x).toBe(1);
    expect(guest.calls).toEqual([]);
    expect(guest.room.remoteDragTargets.size).toBe(1);
    receive(guest, patch([serialized(b, { x: 2 })], { isFinalChunk: true }));
    expect(guest.callsOf('onGuestPatchApplied')).toHaveLength(1);
  });

  it('keeps its own drag position when its held group is turned', () => {
    const guest = createFakeGuest();
    const [a] = guest.engine.pieces;
    guest.room.groupLocks.set(a.groupId, 'me');
    const { x } = a;
    receive(
      guest,
      patch([serialized(a, { x: x + 50, rotation: 1 })], { actionResult: { type: 'rotate' } }),
    );
    expect([a.x, a.rotation]).toEqual([x, 1]);
    // Not held by itself: the host's position wins.
    guest.room.groupLocks.set(a.groupId, 'p2');
    receive(
      guest,
      patch([serialized(a, { x: x + 50, rotation: 2 })], { actionResult: { type: 'flip' } }),
    );
    expect(a.x).toBe(x + 50);
  });

  it('skips an echo of its own older turn and applies the latest one', () => {
    const guest = createFakeGuest();
    const [a] = guest.engine.pieces;
    guest.session.pendingGroupOpSeq.set(a.groupId, 5);
    const own = (opSeq, rotation) =>
      patch([serialized(a, { rotation })], {
        actorId: 'me',
        actionResult: { type: 'rotate', opSeq },
      });
    receive(guest, own(4, 1));
    expect(a.rotation).toBe(0);
    expect(guest.session.pendingGroupOpSeq.get(a.groupId)).toBe(5);
    receive(guest, own(5, 2));
    expect(a.rotation).toBe(2);
    expect(guest.session.pendingGroupOpSeq.has(a.groupId)).toBe(false);
  });

  it('applies older turns of other players and without a pending turn', () => {
    const guest = createFakeGuest();
    const [a] = guest.engine.pieces;
    guest.session.pendingGroupOpSeq.set(a.groupId, 5);
    receive(
      guest,
      patch([serialized(a, { rotation: 1 })], {
        actorId: 'p2',
        actionResult: { type: 'rotate', opSeq: 1 },
      }),
    );
    expect(a.rotation).toBe(1);
    guest.session.pendingGroupOpSeq.clear();
    receive(
      guest,
      patch([serialized(a, { rotation: 3 })], {
        actorId: 'me',
        actionResult: { type: 'rotate', opSeq: 1 },
      }),
    );
    expect(a.rotation).toBe(3);
  });

  it('remembers how pieces were turned before a prank, for its effect', () => {
    const guest = createFakeGuest();
    const [a] = guest.engine.pieces;
    receive(
      guest,
      patch([serialized(a, { rotation: 2 }), { id: 999 }], {
        actionResult: { type: 'ojama_prank' },
      }),
    );
    const [[, , , before]] = guest.callsOf('onGuestPatchApplied');
    expect([...before]).toEqual([[a.id, { rotation: 0, isFlipped: false }]]);
  });

  it('copes with a patch without pieces', () => {
    const guest = createFakeGuest();
    receive(guest, patch(undefined, { actionResult: { type: 'none' } }));
    expect(guest.callsOf('onGuestPatchApplied')).toEqual([[[], { type: 'none' }, undefined, null]]);
  });
});

describe('ojama and other relays', () => {
  it('rebuilds fake pieces and their stats', () => {
    const guest = createFakeGuest();
    const stats = { ojamaTotal: 1 };
    receive(guest, {
      type: MSG.OJAMA_FAKE_PIECES,
      fakePieces: [{ fakeId: -1, sourcePieceId: 5, x: 0, y: 0, rotation: 0, zOrder: 3 }],
      stats,
    });
    expect(guest.engine.fakePieces.map((f) => f.id)).toEqual([-1]);
    expect(guest.engine.stats).toBe(stats);
    receive(guest, { type: MSG.OJAMA_FAKE_PIECES });
    expect(guest.engine.fakePieces).toEqual([]);
    expect(guest.callsOf('onRosterUpdate')).toHaveLength(2);
    expect(guest.callsOf('onRenderNeeded')).toHaveLength(2);
  });

  it.each([
    [{ type: MSG.OJAMA_VISUAL, visualType: 'hue', duration: 5 }, 'onRemoteVisualOjama', ['hue', 5]],
    [{ type: MSG.OJAMA_VISUAL_CLEAR }, 'onRemoteVisualClear', []],
    [{ type: MSG.SUPERCHAT_STATE, hp: 3, maxHp: 9 }, 'onRemoteSuperchatState', [3, 9]],
    [{ type: MSG.SUPERCHAT_DISMISS }, 'onRemoteSuperchatDismiss', []],
    [{ type: MSG.PUZZLE_COMPLETED }, 'onRemoteCompleted', []],
    [
      { type: MSG.OJAMA_NOTICE, kind: 'drop', text: 't' },
      'onOjamaNotice',
      [{ kind: 'drop', text: 't' }],
    ],
    [{ type: MSG.OJAMA_NOTICE, text: 't' }, 'onToast', ['t', 'ojama']],
  ])('passes %j to %s', (msg, callback, args) => {
    const guest = createFakeGuest();
    receive(guest, msg);
    expect(guest.calls).toEqual([[callback, ...args]]);
  });

  it.each([MSG.OJAMA_SUPERCHAT, MSG.OJAMA_TIMED])('passes the whole %s message on', (type) => {
    const guest = createFakeGuest();
    const msg = { type, extra: 1 };
    receive(guest, msg);
    expect(guest.calls).toEqual([
      [type === MSG.OJAMA_TIMED ? 'onRemoteTimedOjama' : 'onRemoteSuperchat', msg],
    ]);
  });

  it('shows a typed notice as plain text on a room without stickers', () => {
    const guest = createFakeGuest({ without: ['onOjamaNotice'] });
    receive(guest, { type: MSG.OJAMA_NOTICE, kind: 'drop', text: 't' });
    expect(guest.calls).toEqual([['onToast', 't', 'ojama']]);
  });
});

describe('runaway hops', () => {
  it('frees the group, moves it to where it landed and reports where it came from', () => {
    const guest = createFakeGuest();
    const [a] = guest.engine.pieces;
    const from = { x: a.x, y: a.y };
    guest.room.groupLocks.set(a.groupId, 'me');
    guest.room.remoteDragTargets.set(a.groupId, new Map());
    guest.session.optimisticRollback = { groupId: a.groupId, snapshot: [] };
    receive(guest, {
      type: MSG.PIECE_HOP,
      groupId: a.groupId,
      positions: [{ id: a.id, x: 9, y: 8 }],
      byPlayerId: 'p2',
    });
    expect([a.x, a.y]).toEqual([9, 8]);
    expect([guest.room.groupLocks.size, guest.room.remoteDragTargets.size]).toEqual([0, 0]);
    expect(guest.session.optimisticRollback).toBeNull();
    expect(guest.callsOf('onPieceHop')).toEqual([
      [{ groupId: a.groupId, from: new Map([[a.id, from]]), byPlayerId: 'p2' }],
    ]);
  });

  it('keeps the rollback of another group', () => {
    const guest = createFakeGuest();
    const [a, b] = guest.engine.pieces;
    guest.session.optimisticRollback = { groupId: b.groupId, snapshot: [] };
    receive(guest, { type: MSG.PIECE_HOP, groupId: a.groupId, positions: [], byPlayerId: null });
    expect(isRollbackFor(guest.session, b.groupId)).toBe(true);
  });
});
