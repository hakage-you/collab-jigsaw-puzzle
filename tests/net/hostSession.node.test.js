import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER_CONFIG, NET_LIMITS, STORAGE_KEYS } from '../../src/config/constants.js';
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

// HostSession inside a real RoomController, with real guests over the in-memory transport:
// admission and knocks, kicking, disconnects and heartbeats, the host's own moves, the shared
// superchat, broadcasts, auto backup and contributions.

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

/** Messages of a type the host sent, as their payloads. */
const hostSent = (type) =>
  net
    .sentOf(type)
    .filter((e) => e.from === 'host')
    .map((e) => e.msg);

/** The host's record of a guest, by display name. */
const seat = (host, name) =>
  [...host.room.hostSession.guests.values()].find((g) => g.name === name);

function looseGroup(host) {
  return host.engine.pieces.find((p) => !p.isLocked).groupId;
}

async function hostWithGuest(options = {}) {
  const host = await openHost(options);
  const guest = await joinNode(host.room.roomId, { name: 'アリス' });
  return { host, guest, hs: host.room.hostSession };
}

describe('configure', () => {
  it('keeps the capacity between the limits and falls back to the default', () => {
    const { room } = createNodeRoom();
    const hs = room.hostSession;
    hs.configure({ capacity: 1 });
    expect(hs.capacity).toBe(MULTIPLAYER_CONFIG.MIN_CAPACITY);
    hs.configure({ capacity: 99 });
    expect(hs.capacity).toBe(MULTIPLAYER_CONFIG.MAX_CAPACITY);
    hs.configure({ capacity: 'x' });
    expect(hs.capacity).toBe(MULTIPLAYER_CONFIG.DEFAULT_CAPACITY);
    hs.configure({ capacity: 3 });
    expect(hs.capacity).toBe(3);
  });

  it('trims the passcode, reads approval as a flag, and starts the host contribution', () => {
    const { room, engine } = createNodeRoom();
    const hs = room.hostSession;
    engine.stats.placedCount = 4;
    hs.configure({ passcode: '  abc ', requireApproval: 0 });
    expect(hs.passcode).toBe('abc');
    expect(hs.requireApproval).toBe(false);
    expect(hs.hostContrib).toBe(4);
    hs.configure({ requireApproval: 'yes' });
    expect(hs.requireApproval).toBe(true);
    room.savedHostContrib = 0;
    hs.configure({});
    expect(hs.hostContrib).toBe(0);
  });
});

describe('admission', () => {
  it('challenges each connection, saying whether a passcode is needed', async () => {
    const open = await openHost();
    await joinNode(open.room.roomId);
    const locked = await openHost({ passcode: 'abc' });
    await joinNode(locked.room.roomId, { passcode: 'abc' });
    const challenges = hostSent(MSG.AUTH_CHALLENGE);
    expect(challenges.map((m) => m.requirePasscode)).toEqual([false, true]);
    expect(challenges[0].nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(challenges[1].nonce).not.toBe(challenges[0].nonce);
  });

  it('holds a knocking guest until approved, then admits it', async () => {
    const host = await openHost({ requireApproval: true });
    const guest = await joinNode(host.room.roomId, { name: 'アリス' });
    const hs = host.room.hostSession;
    expect(hs.pendingKnocks.size).toBe(1);
    const [connId] = hs.pendingKnocks.keys();
    expect(host.callsOf('onKnockRequest')[0][0]).toMatchObject({ connId, displayName: 'アリス' });
    expect(guest.callsOf('onGuestStatus').at(-1)[0]).toContain('承認');
    expect(hs.getOnlineCount()).toBe(1);

    hs.approveKnock(connId);
    await net.flush();
    expect(host.callsOf('onKnockResolved')).toEqual([[connId]]);
    expect(hs.pendingKnocks.size).toBe(0);
    expect(hs.getOnlineCount()).toBe(2);
    expect(boardState(guest.engine)).toEqual(boardState(host.engine));
  });

  it('turns a rejected knock away and closes its connection a moment later', async () => {
    const host = await openHost({ requireApproval: true });
    const guest = await joinNode(host.room.roomId);
    const hs = host.room.hostSession;
    const [connId] = hs.pendingKnocks.keys();
    hs.rejectKnock(connId);
    expect(host.callsOf('onKnockResolved')).toEqual([[connId]]);
    expect(hostSent(MSG.JOIN_REJECTED).at(-1).reason).toContain('拒否');
    vi.advanceTimersByTime(99);
    expect(host.room.transport.peers.has(connId)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(host.room.transport.peers.has(connId)).toBe(false);
    await net.flush();
    expect(guest.callsOf('onAuthRejected')).toHaveLength(1);
  });

  it('refuses an approved knock when the room filled up meanwhile', async () => {
    const host = await openHost({ requireApproval: true, capacity: 2 });
    const hs = host.room.hostSession;
    await joinNode(host.room.roomId, { name: 'アリス' });
    await joinNode(host.room.roomId, { name: 'ボブ' });
    const [aliceConn, bobConn] = hs.pendingKnocks.keys();
    hs.approveKnock(aliceConn);
    await net.flush();
    hs.approveKnock(bobConn);
    expect(hostSent(MSG.JOIN_REJECTED).at(-1).reason).toBe('部屋が満員です');
    expect(host.room.transport.peers.has(bobConn)).toBe(false);
    expect(hs.getOnlineCount()).toBe(2);
  });

  it('ignores approving or rejecting a knock that is not waiting', async () => {
    const host = await openHost({ requireApproval: true });
    host.room.hostSession.approveKnock('nobody');
    host.room.hostSession.rejectKnock('nobody');
    expect(host.callsOf('onKnockResolved')).toEqual([]);
    expect(hostSent(MSG.JOIN_REJECTED)).toEqual([]);
  });
});

describe('messages from guests', () => {
  it('answers pings, and ignores board requests from a connection not yet admitted', async () => {
    const host = await openHost({ requireApproval: true });
    const knocking = await joinNode(host.room.roomId);
    const gid = looseGroup(host);
    knocking.room.transport.sendToHost({ type: MSG.PING });
    knocking.room.transport.sendToHost({ type: MSG.LOCK_REQUEST, groupId: gid });
    knocking.room.transport.sendToHost({ nonsense: true });
    await net.flush();
    expect(hostSent(MSG.PONG)).toHaveLength(1);
    expect(host.room.groupLocks.size).toBe(0);
  });

  it('kicks a guest that keeps flooding the host', async () => {
    const { host, guest, hs } = await hostWithGuest();
    let now = 0;
    hs.now = () => now;
    const flood = NET_LIMITS.RATE_BURST * 4;
    for (let t = 0; t <= NET_LIMITS.FLOOD_KICK_AFTER_MS + 100; t += 50) {
      now = t;
      for (let i = 0; i < flood; i++) guest.room.transport.sendToHost({ type: MSG.PING });
      // eslint-disable-next-line no-await-in-loop -- deliver each burst at its own time
      await net.flush();
      if (!seat(host, 'アリス')) break;
    }
    expect(seat(host, 'アリス')).toBeUndefined();
    expect(hostSent(MSG.KICKED).at(-1).reason).toBe('通信量が多すぎるため退出しました');
  });
});

describe('kicking a guest', () => {
  it('tells it why, frees what it held, and drops it from the room', async () => {
    const { host, guest, hs } = await hostWithGuest();
    const gid = looseGroup(host);
    guest.room.requestLock(gid);
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.CURSOR_THROTTLE_MS);
    guest.room.sendCursorMove(10, 10);
    await net.flush();
    const { id, connId } = seat(host, 'アリス');
    expect(host.room.groupLocks.get(gid)).toBe(id);
    expect(host.room.remoteCursors.has(id)).toBe(true);

    hs.kickGuest(id);
    expect(hostSent(MSG.KICKED).at(-1)).toMatchObject({ reason: 'ホストにより退出されました' });
    expect(hostSent(MSG.LOCK_RELEASE).at(-1)).toEqual({ type: MSG.LOCK_RELEASE, groupId: gid });
    expect(host.room.groupLocks.size).toBe(0);
    expect(host.room.remoteCursors.has(id)).toBe(false);
    expect(host.room.roster.map((m) => m.name)).not.toContain('アリス');
    expect(host.callsOf('onRenderNeeded').length).toBeGreaterThan(0);
    vi.advanceTimersByTime(79);
    expect(host.room.transport.peers.has(connId)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(host.room.transport.peers.has(connId)).toBe(false);
    await net.flush();
    expect(guest.callsOf('onAuthRejected').at(-1)).toEqual([
      'ホストにより退出されました',
      { kicked: true },
    ]);
  });

  it('does nothing for an unknown player', async () => {
    const { host, hs } = await hostWithGuest();
    const roster = host.room.roster;
    hs.kickGuest('nobody');
    expect(hostSent(MSG.KICKED)).toEqual([]);
    expect(host.room.roster).toBe(roster);
  });
});

describe('losing a guest', () => {
  it('shows it offline and frees what it held when its connection closes', async () => {
    const { host, guest, hs } = await hostWithGuest();
    const gid = looseGroup(host);
    guest.room.requestLock(gid);
    await net.flush();
    net.dropLink(guest.room.transport);
    await net.flush();
    expect(seat(host, 'アリス').online).toBe(false);
    expect(host.room.groupLocks.size).toBe(0);
    expect(hs.getOnlineCount()).toBe(1);
    expect(host.room.roster.find((m) => m.name === 'アリス').online).toBe(false);
  });

  it('forgets a knock whose connection closes before it was answered', async () => {
    const host = await openHost({ requireApproval: true });
    const knocking = await joinNode(host.room.roomId);
    const [connId] = host.room.hostSession.pendingKnocks.keys();
    net.dropLink(knocking.room.transport);
    await net.flush();
    expect(host.room.hostSession.pendingKnocks.size).toBe(0);
    expect(host.callsOf('onKnockResolved')).toEqual([[connId]]);
  });

  it('drops a guest that stops answering pings', async () => {
    const { host, guest } = await hostWithGuest();
    guest.room.transport.sendToHost = () => {};
    const timeout = MULTIPLAYER_CONFIG.HEARTBEAT_TIMEOUT_MS;
    for (let t = 0; t <= timeout + 2 * MULTIPLAYER_CONFIG.HEARTBEAT_INTERVAL_MS; t += 1000) {
      vi.advanceTimersByTime(1000);
      // eslint-disable-next-line no-await-in-loop -- pings go out as time passes
      await net.flush();
    }
    expect(hostSent(MSG.PING).length).toBeGreaterThan(0);
    expect(seat(host, 'アリス').online).toBe(false);
  });

  it('keeps a guest that answers', async () => {
    const { host } = await hostWithGuest();
    for (let t = 0; t <= 3 * MULTIPLAYER_CONFIG.HEARTBEAT_TIMEOUT_MS; t += 1000) {
      vi.advanceTimersByTime(1000);
      // eslint-disable-next-line no-await-in-loop -- pings go out as time passes
      await net.flush();
    }
    expect(seat(host, 'アリス').online).toBe(true);
  });
});

describe('the host’s own moves', () => {
  it('grabbing a group lets go of the one it held and tells everyone', async () => {
    const { host, guest, hs } = await hostWithGuest();
    const [a, b] = host.engine.pieces.map((p) => p.groupId);
    expect(hs.requestLock(a)).toEqual({ allowed: true });
    const zBefore = host.engine.getGroupPieces(b)[0].zOrder;
    hs.requestLock(b);
    expect([...host.room.groupLocks]).toEqual([[b, 'host']]);
    expect(hostSent(MSG.LOCK_RELEASE)).toEqual([{ type: MSG.LOCK_RELEASE, groupId: a }]);
    const granted = hostSent(MSG.LOCK_GRANTED).at(-1);
    expect(granted).toMatchObject({ groupId: b, ownerId: 'host' });
    expect(granted.zOrder).toBe(host.engine.getGroupPieces(b)[0].zOrder);
    expect(granted.zOrder).toBeGreaterThan(zBefore);
    await net.flush();
    expect(guest.room.groupLocks.get(b)).toBe('host');
  });

  it('a drop that snaps counts for the host and reaches the guests', async () => {
    const { host, guest, hs } = await hostWithGuest();
    const piece = host.engine.pieces.find((p) => !p.isLocked);
    hs.requestLock(piece.groupId);
    host.engine.moveGroup(piece.groupId, piece.targetX - piece.x, piece.targetY - piece.y);
    const res = hs.submitDrop(piece.groupId);
    expect(res.type).toBe('snap');
    expect(hs.hostContrib).toBe(res.count);
    expect(host.room.roster[0]).toMatchObject({ id: 'host', contrib: res.count });
    expect(host.room.groupLocks.size).toBe(0);
    expect(hostSent(MSG.PIECES_PATCH).at(-1)).toMatchObject({
      actorId: 'host',
      actionResult: { type: 'snap' },
    });
    await net.flush();
    expect(boardState(guest.engine)).toEqual(boardState(host.engine));
  });

  it('a drop that does not snap adds nothing', async () => {
    const { host, hs } = await hostWithGuest();
    const piece = host.engine.pieces.find((p) => !p.isLocked);
    host.engine.moveGroup(piece.groupId, 800, 800);
    expect(hs.submitDrop(piece.groupId).type).not.toBe('snap');
    expect(hs.hostContrib).toBe(0);
  });

  it('turns and flips only when the rules allow, and sends only real changes', async () => {
    const { host, guest, hs } = await hostWithGuest();
    const piece = host.engine.pieces.find((p) => !p.isLocked);
    expect(hs.submitRotate(piece, false)).toBe(false);
    expect(hs.submitFlip(piece, false)).toBe(false);
    expect(hostSent(MSG.PIECES_PATCH)).toEqual([]);
    expect(hs.submitRotate(piece, true)).toBe(true);
    expect(hostSent(MSG.PIECES_PATCH).at(-1).actionResult).toEqual({ type: 'rotate' });
    expect(hs.submitFlip(piece, true)).toBe(true);
    expect(hostSent(MSG.PIECES_PATCH).at(-1).actionResult).toEqual({ type: 'flip' });
    await net.flush();
    expect(boardState(guest.engine)).toEqual(boardState(host.engine));
  });
});

describe('the shared superchat', () => {
  it('counts hits down, tells the guests the HP, and dismisses it at zero', async () => {
    const { host, hs } = await hostWithGuest();
    host.room.sharedSuperchatHp = 2;
    host.room.sharedSuperchatMaxHp = 15;
    expect(hs.handleSuperchatHit()).toBe(1);
    expect(hostSent(MSG.SUPERCHAT_STATE)).toEqual([
      { type: MSG.SUPERCHAT_STATE, hp: 1, maxHp: 15 },
    ]);
    expect(hs.handleSuperchatHit()).toBe(0);
    expect(hostSent(MSG.SUPERCHAT_DISMISS)).toHaveLength(1);
    expect(hs.handleSuperchatHit()).toBe(0);
    expect(host.callsOf('onLocalSuperchatHp')).toEqual([
      [1, 15],
      [0, 15],
      [0, 15],
    ]);
  });

  it('in solo play only counts locally', () => {
    const { room, callsOf } = createNodeRoom();
    room.sharedSuperchatHp = 3;
    expect(room.hostSession.handleSuperchatHit()).toBe(2);
    expect(callsOf('onLocalSuperchatHp')).toEqual([[2, room.sharedSuperchatMaxHp]]);
  });
});

describe('broadcasts', () => {
  it('sends a physical ojama as a patch of the changed pieces plus its notice', async () => {
    const { host, hs } = await hostWithGuest();
    const changed = host.engine.pieces.slice(0, 2);
    hs.broadcastPhysicalOjama('揺れた', changed, 'ojama_drop', 'drop');
    const patch = hostSent(MSG.PIECES_PATCH).at(-1);
    expect(patch.actionResult).toEqual({ type: 'ojama_drop' });
    expect(patch.pieces.map((p) => p.id)).toEqual(changed.map((p) => p.id));
    expect(hostSent(MSG.OJAMA_NOTICE).at(-1)).toEqual({
      type: MSG.OJAMA_NOTICE,
      text: '揺れた',
      kind: 'drop',
    });
    hs.broadcastPhysicalOjama('いたずら', changed);
    expect(hostSent(MSG.PIECES_PATCH).at(-1).actionResult).toEqual({ type: 'ojama' });
    expect(hostSent(MSG.OJAMA_NOTICE).at(-1)).toEqual({ type: MSG.OJAMA_NOTICE, text: 'いたずら' });
  });

  it('sends a sort as a patch of every piece', async () => {
    const { host, hs } = await hostWithGuest();
    hs.broadcastSortResult();
    const patch = hostSent(MSG.PIECES_PATCH).at(-1);
    expect(patch.actionResult).toEqual({ type: 'sort' });
    expect(patch.pieces).toHaveLength(host.engine.pieces.length);
  });

  it('resends a welcome to every online guest (custom and sample) and clears locks', async () => {
    const custom = await openHost();
    await joinNode(custom.room.roomId, { name: 'アリス' });
    const offline = await joinNode(custom.room.roomId, { name: 'ボブ' });
    net.dropLink(offline.room.transport);
    await net.flush();
    custom.room.groupLocks.set(1, 'host');
    custom.room.remoteDragTargets.set(1, new Map([[0, { x: 1, y: 2 }]]));
    const welcomes = hostSent(MSG.WELCOME).length;
    custom.room.hostSession.broadcastFullState();
    expect(hostSent(MSG.WELCOME)).toHaveLength(welcomes + 1);
    expect(custom.room.groupLocks.size).toBe(0);
    expect(custom.room.remoteDragTargets.size).toBe(0);

    const sample = await openHost({ isSampleImage: true, sampleImageId: 'met-seaside' });
    const sampleWelcomes = hostSent(MSG.WELCOME).length;
    sample.room.hostSession.guests.set('p1', { id: 'p1', online: true, connId: 'conn-x' });
    sample.room.transport.peers.set('conn-x', { connId: 'conn-x', onMessage: () => {} });
    sample.room.hostSession.broadcastFullState();
    expect(hostSent(MSG.WELCOME)).toHaveLength(sampleWelcomes + 1);
    expect(hostSent(MSG.WELCOME).at(-1)).toMatchObject({
      isSampleImage: true,
      sampleImageId: 'met-seaside',
    });
  });
});

describe('auto backup', () => {
  const backup = () => JSON.parse(localStorage.getItem(STORAGE_KEYS.AUTO_BACKUP) || 'null');

  it('saves the board a while after the last change, once', async () => {
    const { host, hs } = await hostWithGuest();
    localStorage.removeItem(STORAGE_KEYS.AUTO_BACKUP);
    hs.scheduleAutoBackup();
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.AUTO_BACKUP_DEBOUNCE_MS - 1);
    hs.scheduleAutoBackup();
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.AUTO_BACKUP_DEBOUNCE_MS - 1);
    expect(backup()).toBeNull();
    vi.advanceTimersByTime(1);
    const saved = backup();
    expect(saved.pieces).toHaveLength(host.engine.pieces.length);
    expect(saved.completed).toBe(false);
    expect(saved.contributions.map((c) => c.name)).toContain('アリス');
    expect(hs.autoBackupTimer).toBeNull();
  });

  it('is not kept outside a hosted room', () => {
    const { room } = createNodeRoom();
    room.hostSession.scheduleAutoBackup();
    expect(room.hostSession.autoBackupTimer).toBeNull();
  });

  it('skips the save when the room closed meanwhile', async () => {
    const { host, hs } = await hostWithGuest();
    localStorage.removeItem(STORAGE_KEYS.AUTO_BACKUP);
    hs.scheduleAutoBackup();
    host.room.role = 'solo';
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.AUTO_BACKUP_DEBOUNCE_MS);
    expect(backup()).toBeNull();
  });
});

describe('contributions', () => {
  it('counts online guests only', async () => {
    const { host, guest, hs } = await hostWithGuest();
    await joinNode(host.room.roomId, { name: 'ボブ' });
    expect(hs.getOnlineCount()).toBe(3);
    net.dropLink(guest.room.transport);
    await net.flush();
    expect(hs.getOnlineCount()).toBe(2);
  });

  it('hands saved contributions to guests by name and zeroes the rest', async () => {
    const { host, hs } = await hostWithGuest();
    await joinNode(host.room.roomId, { name: 'ボブ' });
    const saved = [
      { name: 'アリス', contrib: 5 },
      { name: 'キャロル', contrib: 2 },
    ];
    seat(host, 'ボブ').contrib = 9;
    hs.applySavedContributions(3, saved);
    expect(hs.hostContrib).toBe(3);
    expect(seat(host, 'アリス').contrib).toBe(5);
    expect(seat(host, 'ボブ').contrib).toBe(0);
    expect(saved).toEqual([{ name: 'キャロル', contrib: 2 }]);

    hs.resetContributions();
    expect(hs.hostContrib).toBe(0);
    expect(seat(host, 'アリス').contrib).toBe(0);
  });

  it('saves the present players plus the saved guests who are not here', async () => {
    const { host, hs } = await hostWithGuest();
    host.settings.playerName = 'ホストさん';
    host.room.savedGuestContribs = [
      { name: 'アリス', contrib: 7, color: '#000' },
      { name: 'キャロル', contrib: 2, color: null },
    ];
    const list = hs.buildContributionsForSave();
    expect(list.map((e) => [e.name, e.role])).toEqual([
      ['ホストさん', 'host'],
      ['アリス', 'guest'],
      ['キャロル', 'guest'],
    ]);
    expect(list[1].contrib).toBe(0);
    expect(list[2]).toEqual({ name: 'キャロル', role: 'guest', contrib: 2, color: '#64748b' });
    expect(Object.keys(list[0]).sort()).toEqual(['color', 'contrib', 'name', 'role']);
  });

  it('lists the host first, unnamed as ホスト（自分）, with the placed count outside a room', () => {
    const { room, engine } = createNodeRoom({ settings: { playerName: '' } });
    engine.stats.placedCount = 6;
    expect(room.hostSession.buildRosterList()).toEqual([
      {
        id: 'host',
        name: 'ホスト（自分）',
        color: 'var(--accent)',
        role: 'host',
        contrib: 6,
        online: true,
      },
    ]);
  });
});
