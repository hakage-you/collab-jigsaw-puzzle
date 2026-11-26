import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER_CONFIG } from '../../src/config/constants.js';
import { MSG } from '../../src/net/protocol.js';
import { boardState } from '../helpers/coreEngine.js';
import { memoryNetwork as net } from '../helpers/memoryTransport.js';
import {
  closeNodeRooms,
  createNodeRoom,
  installNodeRoomGlobals,
  joinNode,
  openHost,
} from '../helpers/nodeRoom.js';

// RoomController: roles, who may touch a group, routing each action by role (solo, host, guest),
// throttled cursor and drag sends, and the broadcasts only the host makes.
// (Recruiting, joining, interpolation, contributions, closing: roomControllerLifecycle.node.test.js.)

vi.mock('../../src/net/transport.js', async () => {
  const { memoryNetwork } = await import('../helpers/memoryTransport.js');
  return {
    createTransport: () => memoryNetwork.createTransport(),
    getTransportModeFromUrl: () => 'memory',
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  installNodeRoomGlobals();
});

afterEach(() => {
  closeNodeRooms();
  vi.useRealTimers();
});

const sentBy = (from, type) =>
  net
    .sentOf(type)
    .filter((e) => (from === 'host' ? e.from === 'host' : e.to === 'host'))
    .map((e) => e.msg);

async function hostAndGuest(options = {}) {
  const host = await openHost(options);
  const guest = await joinNode(host.room.roomId, { name: 'アリス' });
  return { host, guest };
}

describe('roles', () => {
  it('reports what each role is and counts the players', async () => {
    const solo = createNodeRoom().room;
    expect([solo.isMultiplayer(), solo.isHost(), solo.isGuest()]).toEqual([false, true, false]);
    expect(solo.getOnlineCount()).toBe(1);
    expect(solo.getCapacity()).toBe(1);
    expect(solo.shouldWarnBeforeUnload()).toBe(false);

    const { host, guest } = await hostAndGuest({ capacity: 4 });
    expect([host.room.isMultiplayer(), host.room.isHost(), host.room.isGuest()]).toEqual([
      true,
      true,
      false,
    ]);
    expect([guest.room.isMultiplayer(), guest.room.isHost(), guest.room.isGuest()]).toEqual([
      true,
      false,
      true,
    ]);
    expect(host.room.getOnlineCount()).toBe(2);
    expect(guest.room.getOnlineCount()).toBe(2);
    expect(host.room.getCapacity()).toBe(4);
    expect(guest.room.getCapacity()).toBe(4);
    expect(host.room.shouldWarnBeforeUnload()).toBe(true);
    expect(guest.room.shouldWarnBeforeUnload()).toBe(false);
  });

  it('a guest counts at least itself, and falls back to the default capacity', () => {
    const { room } = createNodeRoom();
    room.role = 'guest';
    room.roster = [{ online: false }];
    expect(room.getOnlineCount()).toBe(1);
    room.roster = [{ online: true }, { online: true }, { online: false }];
    expect(room.getOnlineCount()).toBe(2);
    room.roomRules = null;
    expect(room.getCapacity()).toBe(MULTIPLAYER_CONFIG.DEFAULT_CAPACITY);
  });

  it('names players: the host by its setting, guests from the room, others as 参加者', async () => {
    const { host, guest } = await hostAndGuest({ settings: { playerName: 'ホストさん' } });
    expect(host.room.getPlayerMeta('host')).toEqual({
      id: 'host',
      name: 'ホストさん',
      color: 'var(--accent)',
    });
    const aliceId = guest.room.myPlayerId;
    expect(host.room.getPlayerMeta(aliceId)).toMatchObject({ id: aliceId, name: 'アリス' });
    expect(guest.room.getPlayerMeta(aliceId)).toMatchObject({ id: aliceId, name: 'アリス' });
    expect(host.room.getPlayerMeta('ghost')).toEqual({
      id: 'ghost',
      name: '参加者',
      color: '#64748b',
    });
    host.settings.playerName = '';
    expect(host.room.getPlayerMeta('host').name).toBe('ホスト（自分）');
  });

  it('builds the invite link from the page address with only the room (and local transport)', async () => {
    const solo = createNodeRoom().room;
    expect(solo.buildInviteUrl()).toBe('');
    const host = await openHost();
    const id = host.room.roomId;
    expect(id).toMatch(/^cj-/);
    expect(host.room.buildInviteUrl()).toBe(`https://puzzle.test/play?room=${id}`);
    host.room.transportMode = 'local';
    expect(host.room.buildInviteUrl()).toBe(`https://puzzle.test/play?room=${id}&transport=local`);
  });

  it('opens a host room under the given id and returns its invite link', async () => {
    const { room } = createNodeRoom();
    const res = await room.startHostRoom({ roomId: 'cj-fixed' });
    expect(res).toEqual({
      roomId: 'cj-fixed',
      inviteUrl: 'https://puzzle.test/play?room=cj-fixed',
    });
    expect(room.hostSession.requireApproval).toBe(true);
    expect(room.hostSession.capacity).toBe(8);
  });
});

describe('who may touch a group', () => {
  it('in solo play anyone may; in a room only when nobody else holds it', async () => {
    const solo = createNodeRoom().room;
    solo.groupLocks.set('g', 'someone');
    expect(solo.canInteractWithGroup('g')).toBe(true);
    expect(solo.requestLock('g')).toEqual({ allowed: true });

    const { host, guest } = await hostAndGuest();
    const gid = host.engine.pieces[0].groupId;
    host.room.requestLock(gid);
    await net.flush();
    expect(guest.room.canInteractWithGroup(gid)).toBe(false);
    expect(host.room.canInteractWithGroup(gid)).toBe(true);
    expect(guest.room.requestLock(gid)).toEqual({ allowed: false, ownerName: 'ホスト（自分）' });
    const piece = guest.engine.getPieceById(host.engine.pieces[0].id);
    expect(guest.room.submitRotate(piece, true)).toBe(false);
    expect(guest.room.submitFlip(piece, true)).toBe(false);
    expect(guest.room.submitRotate(null, true)).toBe(false);
    expect(guest.room.submitFlip(null, true)).toBe(false);
  });
});

describe('routing by role', () => {
  it('solo drops resolve locally and add to a saved host contribution', () => {
    const { room, engine } = createNodeRoom();
    const piece = engine.pieces[0];
    engine.moveGroup(piece.groupId, piece.targetX - piece.x, piece.targetY - piece.y);
    room.savedHostContrib = 2;
    const res = room.submitDrop(piece.groupId);
    expect(res.type).toBe('snap');
    expect(room.savedHostContrib).toBe(2 + res.count);

    const other = createNodeRoom();
    const p = other.engine.pieces[0];
    other.engine.moveGroup(p.groupId, p.targetX - p.x, p.targetY - p.y);
    other.room.submitDrop(p.groupId);
    expect(other.room.savedHostContrib).toBeNull();
  });

  it('solo turns and flips follow the rules', () => {
    const { room, engine } = createNodeRoom();
    const piece = engine.pieces[0];
    expect(room.submitRotate(piece, false)).toBe(false);
    expect(room.submitRotate(piece, true)).toBe(true);
    expect(room.submitFlip(piece, false)).toBe(false);
    expect(room.submitFlip(piece, true)).toBe(true);
  });

  it('host and guest moves go through their sessions and end on the same board', async () => {
    const { host, guest } = await hostAndGuest({
      settings: { allowRotation: true, allowFlip: true },
    });
    const [a, b] = host.engine.pieces;
    expect(host.room.requestLock(a.groupId)).toEqual({ allowed: true });
    host.engine.moveGroup(a.groupId, 300, 0);
    expect(host.room.submitDrop(a.groupId).type).toBeDefined();
    expect(host.room.submitRotate(a, true)).toBe(true);
    expect(host.room.submitFlip(a, true)).toBe(true);
    await net.flush();

    const gb = guest.engine.getPieceById(b.id);
    expect(guest.room.requestLock(gb.groupId)).toEqual({ allowed: true });
    guest.engine.moveGroup(gb.groupId, -300, 0);
    expect(guest.room.submitDrop(gb.groupId)).toEqual({ type: 'pending' });
    expect(guest.room.submitRotate(gb, true)).toBe(true);
    expect(guest.room.submitFlip(gb, true)).toBe(true);
    await net.flush();
    expect(boardState(guest.engine)).toEqual(boardState(host.engine));
  });

  it('a runaway group hops away instead of being grabbed', async () => {
    const { host } = await hostAndGuest();
    const gid = host.engine.pieces[0].groupId;
    host.room.setRunaway({ chance: 1, gripMinSec: 1, gripMaxSec: 2 });
    expect(host.room.requestLock(gid, { x: 0, y: 0 })).toEqual({ allowed: false, hopped: true });
    expect(host.room.groupLocks.has(gid)).toBe(false);
    host.room.setRunaway(null);
    expect(host.room.requestLock(gid)).toEqual({ allowed: true });
  });

  it('superchat hits go to the host when a guest hits', async () => {
    const { host, guest } = await hostAndGuest();
    host.room.sharedSuperchatHp = 5;
    expect(guest.room.submitSuperchatHit()).toBeNull();
    await net.flush();
    expect(host.room.sharedSuperchatHp).toBe(4);
    expect(host.room.submitSuperchatHit()).toBe(3);
  });
});

describe('cursor and drag sends', () => {
  it('sends the cursor at most every throttle interval, only when it moved, rounded to tenths', async () => {
    const { host, guest } = await hostAndGuest({ settings: { playerName: 'ホストさん' } });
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.CURSOR_THROTTLE_MS);
    host.room.sendCursorMove(10.04, 20.06);
    host.room.sendCursorMove(50, 50);
    expect(sentBy('host', MSG.CURSOR_MOVE)).toEqual([
      {
        type: MSG.CURSOR_MOVE,
        playerId: 'host',
        x: 10,
        y: 20.1,
        name: 'ホストさん',
        color: 'var(--accent)',
      },
    ]);
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.CURSOR_THROTTLE_MS);
    host.room.sendCursorMove(11, 20.06);
    expect(sentBy('host', MSG.CURSOR_MOVE)).toHaveLength(1);
    host.room.sendCursorMove(10.04 + MULTIPLAYER_CONFIG.CURSOR_MIN_MOVE_PX, 20.06);
    expect(sentBy('host', MSG.CURSOR_MOVE)).toHaveLength(2);

    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.CURSOR_THROTTLE_MS);
    guest.room.sendCursorMove(5, 5);
    expect(sentBy('guest', MSG.CURSOR_MOVE)).toEqual([{ type: MSG.CURSOR_MOVE, x: 5, y: 5 }]);
  });

  it('sends nothing outside a room', () => {
    const { room } = createNodeRoom();
    vi.advanceTimersByTime(1000);
    room.sendCursorMove(10, 10);
    room.sendDragPreview(room.engine.pieces[0].groupId, true);
    expect(room.lastCursorSentAt).toBe(0);
    expect(room.lastDragSentAt).toBe(0);
  });

  it('throttles drag previews unless forced, and rounds them to tenths', async () => {
    const { host, guest } = await hostAndGuest();
    const piece = host.engine.pieces[0];
    piece.x = 1.26;
    piece.y = 2.24;
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.CURSOR_THROTTLE_MS);
    host.room.sendDragPreview(piece.groupId);
    host.room.sendDragPreview(piece.groupId);
    expect(sentBy('host', MSG.DRAG_PREVIEW)).toEqual([
      {
        type: MSG.DRAG_PREVIEW,
        groupId: piece.groupId,
        ownerId: 'host',
        positions: [{ id: piece.id, x: 1.3, y: 2.2 }],
      },
    ]);
    host.room.sendDragPreview(piece.groupId, true);
    expect(sentBy('host', MSG.DRAG_PREVIEW)).toHaveLength(2);

    guest.room.sendDragPreview(piece.groupId, true);
    expect(sentBy('guest', MSG.DRAG_PREVIEW)[0]).toEqual({
      type: MSG.DRAG_PREVIEW,
      groupId: piece.groupId,
      positions: [expect.objectContaining({ id: piece.id })],
    });
  });
});

describe('host-only broadcasts', () => {
  const call = (room) => {
    room.broadcastVisualOjama('fog', 5);
    room.broadcastTimedOjama('heavy', 3.04, 'strong');
    room.broadcastTimedOjama('runaway', -2);
    room.broadcastVisualClear();
    room.broadcastFakePieces('ニセモノ');
    room.broadcastFakePieces();
    room.broadcastCompletion();
    room.broadcastSortResult();
    room.broadcastPhysicalOjama('揺れた', [], 'ojama', 'drop');
    room.broadcastFullState();
  };

  it('the host sends each one', async () => {
    const { host } = await hostAndGuest();
    call(host.room);
    expect(sentBy('host', MSG.OJAMA_VISUAL)).toEqual([
      { type: MSG.OJAMA_VISUAL, visualType: 'fog', duration: 5 },
    ]);
    expect(sentBy('host', MSG.OJAMA_TIMED)).toEqual([
      { type: MSG.OJAMA_TIMED, kind: 'heavy', remaining: 3, level: 'strong' },
      { type: MSG.OJAMA_TIMED, kind: 'runaway', remaining: 0 },
    ]);
    expect(sentBy('host', MSG.OJAMA_VISUAL_CLEAR)).toHaveLength(1);
    expect(sentBy('host', MSG.OJAMA_FAKE_PIECES)).toHaveLength(2);
    expect(sentBy('host', MSG.OJAMA_FAKE_PIECES)[0]).toMatchObject({
      fakePieces: [],
      stats: { placedCount: 0 },
    });
    expect(sentBy('host', MSG.OJAMA_NOTICE)).toEqual([
      { type: MSG.OJAMA_NOTICE, text: 'ニセモノ', kind: 'fake' },
      { type: MSG.OJAMA_NOTICE, text: '揺れた', kind: 'drop' },
    ]);
    expect(sentBy('host', MSG.PUZZLE_COMPLETED)).toHaveLength(1);
    expect(sentBy('host', MSG.PIECES_PATCH).map((m) => m.actionResult.type)).toEqual([
      'sort',
      'ojama',
    ]);
    expect(host.room.hostSession.autoBackupTimer).not.toBeNull();
  });

  it('a guest or solo player sends none of them', async () => {
    const { guest } = await hostAndGuest();
    const before = net.log.length;
    call(guest.room);
    call(createNodeRoom().room);
    expect(net.log.length).toBe(before);
  });

  it('starts the shared superchat everywhere with its HP', async () => {
    const { host, guest } = await hostAndGuest();
    const start = {
      maxHp: 23,
      duration: 30,
      author: '視聴者',
      message: 'がんばれ',
      amountDisplay: '¥500',
    };
    host.room.broadcastSuperchatStart(start);
    expect([host.room.sharedSuperchatHp, host.room.sharedSuperchatMaxHp]).toEqual([23, 23]);
    expect(sentBy('host', MSG.OJAMA_SUPERCHAT)).toEqual([{ type: MSG.OJAMA_SUPERCHAT, ...start }]);
    guest.room.broadcastSuperchatStart(start);
    expect(sentBy('host', MSG.OJAMA_SUPERCHAT)).toHaveLength(1);
  });

  it('gives the superchat more HP for each guest', async () => {
    const { host } = await hostAndGuest();
    await joinNode(host.room.roomId, { name: 'ボブ' });
    const { SUPERCHAT_BASE_HP: base, SUPERCHAT_HP_PER_GUEST: per } = MULTIPLAYER_CONFIG;
    expect(host.room.computeSuperchatMaxHp()).toBe(base + 2 * per);
    expect(createNodeRoom().room.computeSuperchatMaxHp()).toBe(base);
  });
});
