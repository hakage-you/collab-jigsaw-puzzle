import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER_CONFIG, NET_LIMITS, STORAGE_KEYS } from '../../src/config/constants.js';
import { MSG } from '../../src/net/protocol.js';
import { getDiagnosticsState } from '../../src/services/diagnostics.js';
import { memoryNetwork as net } from '../helpers/memoryTransport.js';
import {
  closeNodeRooms,
  createNodeRoom,
  installNodeRoomGlobals,
  joinNode,
  openHost,
} from '../helpers/nodeRoom.js';

// HostSession details beyond hostSession.node.test.js: guest cursors and drag previews, rate
// limiting, what closing and disconnects clean up, which locks are released, and that each
// host action is sent as the host's and saved.

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

const hostSent = (type) =>
  net
    .sentOf(type)
    .filter((e) => e.from === 'host')
    .map((e) => e.msg);
const seat = (host, name) =>
  [...host.room.hostSession.guests.values()].find((g) => g.name === name);

async function roomOfThree() {
  const host = await openHost();
  const alice = await joinNode(host.room.roomId, { name: 'アリス' });
  const bob = await joinNode(host.room.roomId, { name: 'ボブ' });
  return { host, alice, bob, hs: host.room.hostSession };
}

describe('a new host session', () => {
  it('starts with no passcode, approval on and the default capacity', () => {
    const { room } = createNodeRoom();
    expect(room.hostSession).toMatchObject({
      passcode: '',
      requireApproval: true,
      capacity: MULTIPLAYER_CONFIG.DEFAULT_CAPACITY,
    });
    room.hostSession.configure({ passcode: 'x', requireApproval: false });
    room.hostSession.configure({});
    expect(room.hostSession).toMatchObject({ passcode: '', requireApproval: true });
  });
});

describe('guest cursors and drag previews', () => {
  it('shows a guest’s cursor and passes its drag on to the others', async () => {
    const { host, alice, bob } = await roomOfThree();
    const aliceId = alice.room.myPlayerId;
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.CURSOR_THROTTLE_MS);
    alice.room.sendCursorMove(40, 50);
    const piece = alice.engine.pieces[0];
    alice.room.requestLock(piece.groupId);
    await net.flush();
    alice.engine.moveGroup(piece.groupId, 120, 0);
    alice.room.sendDragPreview(piece.groupId, true);
    await net.flush();
    expect(host.room.remoteCursors.get(aliceId)).toMatchObject({ targetX: 40, targetY: 50 });
    const relayed = net.sentOf(MSG.DRAG_PREVIEW).filter((e) => e.from === 'host');
    expect(relayed.map((e) => e.msg.ownerId)).toEqual([aliceId]);
    expect(relayed.map((e) => e.to)).not.toContain(alice.room.transport.connId);
    expect(bob.room.remoteDragTargets.has(piece.groupId)).toBe(true);
  });
});

describe('rate limiting', () => {
  it('drops what goes over the burst without kicking', async () => {
    const { host, alice, hs } = await roomOfThree();
    hs.now = () => 0;
    const before = hostSent(MSG.PONG).length;
    for (let i = 0; i < NET_LIMITS.RATE_BURST + 10; i++) {
      alice.room.transport.sendToHost({ type: MSG.PING });
    }
    await net.flush();
    expect(hostSent(MSG.PONG).length - before).toBeLessThanOrEqual(NET_LIMITS.RATE_BURST);
    expect(hostSent(MSG.PONG).length - before).toBeGreaterThan(NET_LIMITS.RATE_BURST - 10);
    expect(seat(host, 'アリス').online).toBe(true);
  });

  it('a flooding connection that has no seat yet is not kicked (there is nothing to kick)', async () => {
    const host = await openHost({ requireApproval: true });
    const knocking = await joinNode(host.room.roomId);
    const hs = host.room.hostSession;
    let now = 0;
    hs.now = () => now;
    for (let t = 0; t <= NET_LIMITS.FLOOD_KICK_AFTER_MS + 100; t += 100) {
      now = t;
      for (let i = 0; i < NET_LIMITS.RATE_BURST * 2; i++) {
        knocking.room.transport.sendToHost({ type: MSG.PING });
      }
      // eslint-disable-next-line no-await-in-loop -- deliver each burst at its own time
      await net.flush();
    }
    expect(hostSent(MSG.KICKED)).toEqual([]);
    expect(hs.pendingKnocks.size).toBe(1);
  });
});

describe('messages it cannot place', () => {
  it('ignores malformed messages and connections without a seat', async () => {
    const { hs } = await roomOfThree();
    await expect(hs.onMessage('conn-x', null)).resolves.toBeUndefined();
    await expect(
      hs.onMessage('conn-x', { type: MSG.CURSOR_MOVE, x: 1, y: 1 }),
    ).resolves.toBeUndefined();
    hs.connToPlayer.set('conn-y', 'gone');
    await expect(
      hs.onMessage('conn-y', { type: MSG.CURSOR_MOVE, x: 1, y: 1 }),
    ).resolves.toBeUndefined();
  });
});

describe('closing and disconnects', () => {
  it('closing forgets every guest, knock and limit, and stops the heartbeat and backups', async () => {
    const { host, hs } = await roomOfThree();
    hs.scheduleAutoBackup();
    localStorage.removeItem(STORAGE_KEYS.AUTO_BACKUP);
    host.room.close();
    expect(hs.guests.size).toBe(0);
    expect(hs.connToPlayer.size).toBe(0);
    expect(hs.rateGates.size).toBe(0);
    expect(hs.pendingAuth.size).toBe(0);
    expect(hs.autoBackupTimer).toBeNull();
    const pings = hostSent(MSG.PING).length;
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.HEARTBEAT_TIMEOUT_MS * 2);
    expect(localStorage.getItem(STORAGE_KEYS.AUTO_BACKUP)).toBeNull();
    expect(hostSent(MSG.PING).length).toBe(pings);
  });

  it('closing forgets the knocks waiting for an answer', async () => {
    const host = await openHost({ requireApproval: true });
    await joinNode(host.room.roomId);
    const hs = host.room.hostSession;
    expect(hs.pendingKnocks.size).toBe(1);
    host.room.close();
    expect(hs.pendingKnocks.size).toBe(0);
  });

  it('a disconnect forgets the connection’s auth and rate state', async () => {
    const { alice, hs } = await roomOfThree();
    const connId = alice.room.transport.connId;
    expect(hs.rateGates.has(connId)).toBe(true);
    hs.pendingAuth.set(connId, { nonce: 'n' });
    net.dropLink(alice.room.transport);
    await net.flush();
    expect(hs.rateGates.has(connId)).toBe(false);
    expect(hs.pendingAuth.has(connId)).toBe(false);
    expect(hs.connToPlayer.has(connId)).toBe(false);
  });

  it('a disconnect of an unknown connection changes nothing', async () => {
    const { host, hs } = await roomOfThree();
    const roster = host.room.roster;
    hs.onDisconnect('conn-unknown');
    expect(host.room.roster).toBe(roster);
    expect(host.callsOf('onKnockResolved')).toEqual([]);
  });

  it('releases only the leaving player’s groups, and says so to the others', async () => {
    const { host, alice, bob } = await roomOfThree();
    const [a, b] = host.engine.pieces.map((p) => p.groupId);
    alice.room.requestLock(a);
    bob.room.requestLock(b);
    await net.flush();
    const aliceId = alice.room.myPlayerId;
    host.room.remoteDragTargets.set(a, new Map());
    net.dropLink(alice.room.transport);
    await net.flush();
    expect([...host.room.groupLocks]).toEqual([[b, bob.room.myPlayerId]]);
    expect(host.room.remoteDragTargets.has(a)).toBe(false);
    expect(host.room.remoteCursors.has(aliceId)).toBe(false);
    expect(hostSent(MSG.LOCK_RELEASE).at(-1)).toEqual({ type: MSG.LOCK_RELEASE, groupId: a });
    expect(bob.room.groupLocks.has(a)).toBe(false);
    expect(bob.room.roster.find((m) => m.name === 'アリス').online).toBe(false);
  });

  it('a kick releases only that guest’s groups and redraws', async () => {
    const { host, alice, bob, hs } = await roomOfThree();
    const [a, b] = host.engine.pieces.map((p) => p.groupId);
    alice.room.requestLock(a);
    bob.room.requestLock(b);
    await net.flush();
    const renders = host.callsOf('onRenderNeeded').length;
    hs.kickGuest(alice.room.myPlayerId);
    expect([...host.room.groupLocks]).toEqual([[b, bob.room.myPlayerId]]);
    expect(host.callsOf('onRenderNeeded')).toHaveLength(renders + 1);
  });

  it('closing right after a kick or a refusal does not fail when the timers fire', async () => {
    const host = await openHost({ requireApproval: true });
    await joinNode(host.room.roomId);
    const [connId] = host.room.hostSession.pendingKnocks.keys();
    host.room.rejectKnock(connId);
    const open = await openHost();
    const alice = await joinNode(open.room.roomId, { name: 'アリス' });
    open.room.kickGuest(alice.room.myPlayerId);
    host.room.close();
    open.room.close();
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
  });

  it('logs a guest lost to the heartbeat', async () => {
    const { host, alice } = await roomOfThree();
    alice.room.transport.sendToHost = () => {};
    for (let t = 0; t <= MULTIPLAYER_CONFIG.HEARTBEAT_TIMEOUT_MS * 2; t += 1000) {
      vi.advanceTimersByTime(1000);
      // eslint-disable-next-line no-await-in-loop -- pings go out as time passes
      await net.flush();
    }
    expect(seat(host, 'アリス').online).toBe(false);
    const entry = getDiagnosticsState().entries.find((e) => e.message === 'guest_timed_out');
    expect(entry).toMatchObject({
      category: 'p2p',
      level: 'warn',
      meta: { reason: 'no_heartbeat' },
    });
  });

  it('logs a flood kick', async () => {
    const { alice, hs } = await roomOfThree();
    let now = 0;
    hs.now = () => now;
    const seated = () => [...hs.guests.values()].some((g) => g.name === 'アリス');
    for (let t = 0; t <= NET_LIMITS.FLOOD_KICK_AFTER_MS + 100 && seated(); t += 50) {
      now = t;
      for (let i = 0; i < NET_LIMITS.RATE_BURST * 4; i++) {
        alice.room.transport.sendToHost({ type: MSG.PING });
      }
      // eslint-disable-next-line no-await-in-loop -- deliver each burst at its own time
      await net.flush();
    }
    const entry = getDiagnosticsState().entries.find((e) => e.message === 'guest_flood_kicked');
    expect(entry).toMatchObject({ category: 'p2p', level: 'warn', meta: { reason: 'rate_limit' } });
  });
});

describe('the host’s actions', () => {
  it('grabbing keeps the guests’ groups and lets go only of its own other group', async () => {
    const { host, alice, hs } = await roomOfThree();
    const [a, b, c] = host.engine.pieces.map((p) => p.groupId);
    alice.room.requestLock(a);
    await net.flush();
    hs.requestLock(b);
    hs.requestLock(b);
    expect(hostSent(MSG.LOCK_RELEASE)).toEqual([]);
    hs.requestLock(c);
    expect(new Map(host.room.groupLocks)).toEqual(
      new Map([
        [a, alice.room.myPlayerId],
        [c, 'host'],
      ]),
    );
    const released = new Set(hostSent(MSG.LOCK_RELEASE).map((m) => m.groupId));
    expect([...released]).toEqual([b]);
  });

  it('grabbing an unknown group still sends a front layer of 1', async () => {
    const { hs } = await roomOfThree();
    hs.requestLock('no-such-group');
    expect(hostSent(MSG.LOCK_GRANTED).at(-1)).toMatchObject({
      groupId: 'no-such-group',
      zOrder: 1,
    });
  });

  it('every action is sent as the host’s, updates the roster and is saved', async () => {
    const { host, alice, hs } = await roomOfThree();
    host.settings.allowRotation = true;
    const piece = host.engine.pieces[0];
    const rosterUpdates = () => host.callsOf('onRosterUpdate').length;
    const check = (run, type) => {
      hs.autoBackupTimer = null;
      const res = run();
      expect(hostSent(MSG.PIECES_PATCH).at(-1)).toMatchObject({
        actorId: 'host',
        actionResult: { type: type ?? res.type },
      });
      expect(hs.autoBackupTimer).not.toBeNull();
    };
    const before = rosterUpdates();
    check(() => hs.submitDrop(piece.groupId));
    expect(rosterUpdates()).toBe(before + 1);
    expect(hostSent(MSG.LOCK_RELEASE).at(-1)).toEqual({
      type: MSG.LOCK_RELEASE,
      groupId: piece.groupId,
    });
    check(() => hs.submitRotate(piece, true), 'rotate');
    check(() => hs.submitFlip(piece, true), 'flip');
    check(() => hs.broadcastPhysicalOjama('!', [piece], 'ojama'), 'ojama');
    check(() => hs.broadcastSortResult(), 'sort');
    await net.flush();
    expect(alice.room.roster[0]).toMatchObject({ id: 'host' });
  });

  it('the roster shows the host’s own count in a room, the placed count outside one', async () => {
    const { host, hs } = await roomOfThree();
    host.engine.stats.placedCount = 9;
    hs.hostContrib = 2;
    expect(hs.buildRosterList()[0].contrib).toBe(2);
    host.room.role = 'solo';
    expect(hs.buildRosterList()[0].contrib).toBe(9);
  });

  it('a full resend also refreshes the roster and schedules a backup', async () => {
    const { host, hs } = await roomOfThree();
    const updates = host.callsOf('onRosterUpdate').length;
    hs.autoBackupTimer = null;
    hs.broadcastFullState();
    expect(host.callsOf('onRosterUpdate')).toHaveLength(updates + 1);
    expect(hs.autoBackupTimer).not.toBeNull();
  });

  it('a saved guest named like the host is still kept for the save', async () => {
    const { host, hs } = await roomOfThree();
    host.settings.playerName = 'アリス2';
    host.room.savedGuestContribs = [{ name: 'アリス2', contrib: 3, color: '#000' }];
    expect(hs.buildContributionsForSave().filter((e) => e.name === 'アリス2')).toEqual([
      { name: 'アリス2', role: 'host', contrib: 0, color: 'var(--accent)' },
      { name: 'アリス2', role: 'guest', contrib: 3, color: '#000' },
    ]);
  });

  it('does not back up an empty board', async () => {
    const { host, hs } = await roomOfThree();
    localStorage.removeItem(STORAGE_KEYS.AUTO_BACKUP);
    host.engine.pieces = [];
    hs.scheduleAutoBackup();
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.AUTO_BACKUP_DEBOUNCE_MS);
    expect(localStorage.getItem(STORAGE_KEYS.AUTO_BACKUP)).toBeNull();
  });
});
