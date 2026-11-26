import { describe, expect, it } from 'vitest';
import {
  handleCursorMove,
  handleDragPreview,
  handleDropRequest,
  handleLockRequest,
  handleRotateOrFlip,
} from '../../src/net/hostBoardOps.js';
import { MSG } from '../../src/net/protocol.js';
import { createEngine, dropNearTarget, movePieceTo } from '../helpers/coreEngine.js';
import { createFakeHost } from '../helpers/fakeHost.js';

// The host's handling of a guest's board actions: cursors, drag previews, lock requests, drops,
// turns and flips. tests/sync covers the same flows between real sessions.

const CONN = 'conn-g1';
const G1 = 'g1';

/** A fake host with guest g1 online. */
function hostWithGuest(options) {
  const host = createFakeHost(options);
  const guest = host.addGuest(G1, { name: 'ゲスト', color: '#abcdef' });
  return { ...host, guest, engine: host.room.engine };
}

const lockRequest = (groupId, extra = {}) => ({
  connId: CONN,
  playerId: G1,
  msg: { type: MSG.LOCK_REQUEST, groupId, ...extra },
});

describe('handleCursorMove', () => {
  it('stores the cursor and relays it to everyone else', () => {
    const { session, room, guest, broadcasts, calls } = hostWithGuest();
    handleCursorMove(session, { connId: CONN, playerId: G1, guest, msg: { x: 5, y: 6 } });
    const cursor = { playerId: G1, x: 5, y: 6, name: 'ゲスト', color: '#abcdef' };
    expect(room.remoteCursors.get(G1)).toEqual({ ...cursor, targetX: 5, targetY: 6 });
    expect(broadcasts).toEqual([[{ type: MSG.CURSOR_MOVE, ...cursor }, CONN]]);
    expect(calls.render).toBe(1);
  });
});

describe('handleDragPreview', () => {
  it("moves the holder's group and relays only its pieces", () => {
    const { session, room, engine, broadcasts, calls } = hostWithGuest();
    const [a, b] = engine.pieces;
    room.groupLocks.set(a.groupId, G1);
    const positions = [
      { id: a.id, x: 1, y: 2 },
      { id: b.id, x: 3, y: 4 }, // another group: ignored
    ];
    handleDragPreview(session, {
      connId: CONN,
      playerId: G1,
      msg: { groupId: a.groupId, positions },
    });
    expect([a.x, a.y]).toEqual([1, 2]);
    expect([b.x, b.y]).not.toEqual([3, 4]);
    expect(broadcasts).toEqual([
      [
        {
          type: MSG.DRAG_PREVIEW,
          groupId: a.groupId,
          ownerId: G1,
          positions: [{ id: a.id, x: 1, y: 2 }],
        },
        CONN,
      ],
    ]);
    expect(calls.render).toBe(1);
  });

  it('ignores a preview from someone who does not hold the group', () => {
    const { session, room, engine, broadcasts, calls } = hostWithGuest();
    const [a] = engine.pieces;
    room.groupLocks.set(a.groupId, 'someone-else');
    const before = [a.x, a.y];
    handleDragPreview(session, {
      connId: CONN,
      playerId: G1,
      msg: { groupId: a.groupId, positions: [{ id: a.id, x: 1, y: 2 }] },
    });
    expect([a.x, a.y]).toEqual(before);
    expect(broadcasts).toEqual([]);
    expect(calls.render).toBe(0);
  });
});

describe('handleLockRequest', () => {
  it('grants a free group, brings it to the front and tells everyone', () => {
    const { session, room, engine, broadcasts, calls } = hostWithGuest();
    const piece = engine.pieces[2];
    handleLockRequest(session, lockRequest(piece.groupId));
    expect(room.groupLocks.get(piece.groupId)).toBe(G1);
    expect(piece.zOrder).toBe(engine.maxZ - 1);
    expect(broadcasts).toEqual([
      [
        { type: MSG.LOCK_GRANTED, groupId: piece.groupId, ownerId: G1, zOrder: piece.zOrder },
        undefined,
      ],
    ]);
    expect(calls.render).toBe(1);
  });

  it('releases the other group the guest was holding', () => {
    const { session, room, engine, broadcastsOf } = hostWithGuest();
    const [a, b] = engine.pieces;
    handleLockRequest(session, lockRequest(a.groupId));
    handleLockRequest(session, lockRequest(b.groupId));
    expect(room.groupLocks.has(a.groupId)).toBe(false);
    expect(broadcastsOf(MSG.LOCK_RELEASE)).toEqual([
      [{ type: MSG.LOCK_RELEASE, groupId: a.groupId }, undefined],
    ]);
    // Asking again for the group it holds is granted again, without a release.
    handleLockRequest(session, lockRequest(b.groupId));
    expect(broadcastsOf(MSG.LOCK_RELEASE)).toHaveLength(1);
    expect(broadcastsOf(MSG.LOCK_GRANTED)).toHaveLength(3);
  });

  it('denies a group someone else holds, with its owner and pieces', () => {
    const { session, room, engine, sentOf, broadcasts } = hostWithGuest();
    const piece = engine.pieces[1];
    room.groupLocks.set(piece.groupId, 'g2');
    handleLockRequest(session, lockRequest(piece.groupId));
    const [[to, msg]] = sentOf(MSG.LOCK_DENIED);
    expect(to).toBe(CONN);
    expect(msg).toMatchObject({ groupId: piece.groupId, ownerId: 'g2' });
    expect(msg.pieces.map((p) => p.id)).toEqual([piece.id]);
    expect(room.groupLocks.get(piece.groupId)).toBe('g2');
    expect(broadcasts).toEqual([]);
  });

  it('denies a group with a placed piece, or one that does not exist, without an owner', () => {
    const { session, engine, sentOf } = hostWithGuest();
    const placed = engine.pieces[0];
    dropNearTarget(engine, placed);
    handleLockRequest(session, lockRequest(placed.groupId));
    handleLockRequest(session, lockRequest(9999));
    const denials = sentOf(MSG.LOCK_DENIED).map(([, msg]) => msg);
    expect(denials.map((m) => [m.groupId, m.ownerId, m.pieces.length])).toEqual([
      [placed.groupId, null, 1],
      [9999, null, 0],
    ]);
  });

  it('lets a runaway group hop away instead, passing the grab point on', () => {
    const { session, room, engine, broadcasts } = hostWithGuest();
    const grabs = [];
    room.runaway.onGrab = (...args) => {
      grabs.push(args);
      return true;
    };
    const piece = engine.pieces[0];
    handleLockRequest(session, lockRequest(piece.groupId, { x: 7, y: 8 }));
    handleLockRequest(session, lockRequest(piece.groupId));
    expect(grabs).toEqual([
      [piece.groupId, G1, { x: 7, y: 8 }],
      [piece.groupId, G1, null],
    ]);
    expect(room.groupLocks.size).toBe(0);
    expect(broadcasts).toEqual([]);
  });
});

describe('handleDropRequest', () => {
  const drop = (groupId, positions = []) => ({ groupId, positions });

  it("applies the holder's drop, snaps it, credits the guest and tells everyone", () => {
    const { session, room, engine, guest, broadcastsOf, calls } = hostWithGuest();
    const piece = engine.pieces[0];
    const released = [];
    room.runaway.onRelease = (gid) => released.push(gid);
    room.groupLocks.set(piece.groupId, G1);
    handleDropRequest(session, {
      connId: CONN,
      playerId: G1,
      guest,
      msg: drop(piece.groupId, [{ id: piece.id, x: piece.targetX, y: piece.targetY }]),
    });
    expect(piece.isLocked).toBe(true);
    expect(room.groupLocks.has(piece.groupId)).toBe(false);
    expect(released).toEqual([piece.groupId]);
    expect(guest.contrib).toBe(1);
    const [[patch]] = broadcastsOf(MSG.PIECES_PATCH);
    expect(patch).toMatchObject({ actorId: G1, actionResult: { type: 'snap', count: 1 } });
    expect(patch.pieces.map((p) => p.id)).toEqual([piece.id]);
    expect(calls.patches).toEqual([{ pieces: [piece], res: patch.actionResult, actorId: G1 }]);
    expect([calls.roster, calls.backups]).toEqual([1, 1]);
  });

  it('moves only pieces of the dropped group and credits nothing without a snap', () => {
    const { session, room, engine, guest } = hostWithGuest();
    const [a, b] = engine.pieces;
    const bBefore = [b.x, b.y];
    room.groupLocks.set(a.groupId, G1);
    handleDropRequest(session, {
      connId: CONN,
      playerId: G1,
      guest,
      msg: drop(a.groupId, [
        { id: a.id, x: 2000, y: 2000 },
        { id: b.id, x: 2100, y: 2000 },
      ]),
    });
    expect([a.x, a.y]).toEqual([2000, 2000]);
    expect([b.x, b.y]).toEqual(bBefore);
    expect(guest.contrib).toBe(0);
  });

  it('denies a drop from someone who does not hold the group, with the true pieces', () => {
    const { session, room, engine, guest, sentOf, broadcasts, calls } = hostWithGuest();
    const piece = engine.pieces[0];
    movePieceTo(engine, piece, 50, 60);
    const msg = drop(piece.groupId, [{ id: piece.id, x: piece.targetX, y: piece.targetY }]);
    handleDropRequest(session, { connId: CONN, playerId: G1, guest, msg });
    room.groupLocks.set(piece.groupId, 'g2');
    handleDropRequest(session, { connId: CONN, playerId: G1, guest, msg });
    const denials = sentOf(MSG.LOCK_DENIED).map(([, m]) => m);
    expect(denials.map((m) => m.ownerId)).toEqual([null, 'g2']);
    expect(denials[0].pieces).toEqual([expect.objectContaining({ id: piece.id, x: 50, y: 60 })]);
    expect(piece.isLocked).toBe(false);
    expect(broadcasts).toEqual([]);
    expect(calls.backups).toBe(0);
  });
});

describe('handleRotateOrFlip', () => {
  const request = (type, pieceId, opSeq = 3) => ({
    connId: CONN,
    playerId: G1,
    msg: { type, pieceId, opSeq },
  });

  it.each([
    [MSG.ROTATE_REQUEST, 'rotate', (p) => p.rotation === 1],
    [MSG.FLIP_REQUEST, 'flip', (p) => p.isFlipped === true],
  ])('applies %s and sends the change with its sequence number', (type, kind, changed) => {
    const { session, engine, broadcastsOf, calls } = hostWithGuest({
      engine: createEngine({ allowRotation: true, allowFlip: true }),
    });
    const piece = engine.pieces[0];
    piece.rotation = 0;
    piece.isFlipped = false;
    handleRotateOrFlip(session, request(type, piece.id));
    expect(changed(piece)).toBe(true);
    const [[patch]] = broadcastsOf(MSG.PIECES_PATCH);
    expect(patch).toMatchObject({ actorId: G1, actionResult: { type: kind, opSeq: 3 } });
    expect([calls.render, calls.backups]).toEqual([1, 1]);
  });

  it('does nothing when the room does not allow it', () => {
    const { session, engine, broadcasts, calls } = hostWithGuest({
      settings: { allowRotation: false, allowFlip: false },
    });
    const piece = engine.pieces[0];
    handleRotateOrFlip(session, request(MSG.ROTATE_REQUEST, piece.id));
    handleRotateOrFlip(session, request(MSG.FLIP_REQUEST, piece.id));
    expect([piece.rotation, piece.isFlipped]).toEqual([0, false]);
    expect(broadcasts).toEqual([]);
    expect(calls.backups).toBe(0);
  });

  it('ignores placed or unknown pieces and denies a group someone else holds', () => {
    const { session, room, engine, sentOf, broadcasts } = hostWithGuest();
    const [placed, held] = engine.pieces;
    dropNearTarget(engine, placed);
    room.groupLocks.set(held.groupId, 'g2');
    handleRotateOrFlip(session, request(MSG.ROTATE_REQUEST, placed.id));
    handleRotateOrFlip(session, request(MSG.ROTATE_REQUEST, 9999));
    handleRotateOrFlip(session, request(MSG.ROTATE_REQUEST, held.id));
    expect(broadcasts).toEqual([]);
    const [[to, denial]] = sentOf(MSG.LOCK_DENIED);
    expect(to).toBe(CONN);
    expect(denial).toMatchObject({ groupId: held.groupId, ownerId: 'g2' });
    expect(held.rotation).toBe(0);
  });

  it('lets the holder turn its own group', () => {
    const { session, room, engine, broadcastsOf } = hostWithGuest();
    const piece = engine.pieces[0];
    room.groupLocks.set(piece.groupId, G1);
    handleRotateOrFlip(session, request(MSG.ROTATE_REQUEST, piece.id));
    expect(piece.rotation).toBe(1);
    expect(broadcastsOf(MSG.PIECES_PATCH)).toHaveLength(1);
  });
});
