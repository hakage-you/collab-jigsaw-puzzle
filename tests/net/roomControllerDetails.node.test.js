import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER_CONFIG } from '../../src/config/constants.js';
import { MSG } from '../../src/net/protocol.js';
import { RECRUIT_STATE } from '../../src/net/recruitment.js';
import { memoryNetwork as net } from '../helpers/memoryTransport.js';
import {
  closeNodeRooms,
  createNodeRoom,
  installNodeRoomGlobals,
  joinNode,
  openHost,
} from '../helpers/nodeRoom.js';

// RoomController details beyond roomController*.node.test.js: which session each role's action
// goes to, broadcasts that only the host makes, starting and leaving rooms, recruiting while
// joins are pending, interpolation per axis, and contributions on close.

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

async function hostAndGuest(options = {}) {
  const host = await openHost(options);
  const guest = await joinNode(host.room.roomId, { name: 'アリス' });
  return { host, guest };
}

describe('a new room controller', () => {
  it('starts solo as the host colour, and does not send a cursor that barely left the origin', async () => {
    const { room } = createNodeRoom();
    expect(room).toMatchObject({ role: 'solo', myPlayerId: 'host', myColor: 'var(--accent)' });
    const { host } = await hostAndGuest();
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.CURSOR_THROTTLE_MS);
    host.room.sendCursorMove(1, 1);
    expect(hostSent(MSG.CURSOR_MOVE)).toEqual([]);
  });

  it('counts one player in solo play and asks the host session in a hosted room', async () => {
    const { room } = createNodeRoom();
    room.roster = [{ online: true }, { online: true }];
    expect(room.getOnlineCount()).toBe(1);
    const { host } = await hostAndGuest();
    host.room.roster = [];
    expect(host.room.getOnlineCount()).toBe(2);
  });
});

describe('routing each action to the right place', () => {
  it('solo play uses the engine directly and holds no locks', () => {
    const { room, engine } = createNodeRoom();
    const hs = room.hostSession;
    const spies = ['requestLock', 'submitDrop', 'submitRotate', 'submitFlip'].map((m) =>
      vi.spyOn(hs, m),
    );
    const piece = engine.pieces[0];
    room.requestLock(piece.groupId);
    room.submitDrop(piece.groupId);
    room.submitRotate(piece, true);
    room.submitFlip(piece, true);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(room.groupLocks.size).toBe(0);
  });

  it('a solo drop that does not snap leaves the saved contribution alone', () => {
    const { room, engine } = createNodeRoom();
    room.savedHostContrib = 3;
    const piece = engine.pieces[0];
    engine.moveGroup(piece.groupId, 900, 900);
    room.submitDrop(piece.groupId);
    expect(room.savedHostContrib).toBe(3);
  });

  it('the host’s actions go through the host session and reach the guests', async () => {
    const { host } = await hostAndGuest({ settings: { allowRotation: true, allowFlip: true } });
    const piece = host.engine.pieces[0];
    host.room.requestLock(piece.groupId);
    expect(host.room.requestLock(piece.groupId)).toEqual({ allowed: true });
    expect(host.room.submitDrop(piece.groupId).type).not.toBe('pending');
    expect(hostSent(MSG.PIECES_PATCH).at(-1).actionResult.type).not.toBe('rotate');
    host.room.submitRotate(piece, true);
    expect(hostSent(MSG.PIECES_PATCH).at(-1).actionResult).toEqual({ type: 'rotate' });
    host.room.submitFlip(piece, true);
    expect(hostSent(MSG.PIECES_PATCH).at(-1).actionResult).toEqual({ type: 'flip' });
  });

  it('runaway pieces hear about every drop but a guest’s (the host decides those)', async () => {
    const { host, guest } = await hostAndGuest();
    const solo = createNodeRoom();
    for (const room of [host.room, guest.room, solo.room]) {
      const release = vi.spyOn(room.runaway, 'onRelease');
      room.submitDrop(room.engine.pieces[0].groupId);
      expect(release).toHaveBeenCalledTimes(room === guest.room ? 0 : 1);
    }
  });
});

describe('broadcasts only the host makes', () => {
  it('a guest neither sends them nor runs the host session for them', async () => {
    const { guest } = await hostAndGuest();
    const room = guest.room;
    const broadcast = vi.spyOn(room.transport, 'broadcast');
    const hsSpies = ['broadcastFullState', 'broadcastSortResult', 'broadcastPhysicalOjama'].map(
      (m) => vi.spyOn(room.hostSession, m),
    );
    room.broadcastVisualOjama('fog', 5);
    room.broadcastTimedOjama('heavy', 3);
    room.broadcastVisualClear();
    room.broadcastFakePieces('x');
    room.broadcastSuperchatStart({ maxHp: 3 });
    room.broadcastCompletion();
    room.broadcastFullState();
    room.broadcastSortResult();
    room.broadcastPhysicalOjama('x', []);
    expect(broadcast).not.toHaveBeenCalled();
    for (const spy of hsSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('the host resends the whole state on request', async () => {
    const { host } = await hostAndGuest();
    const welcomes = hostSent(MSG.WELCOME).length;
    host.room.broadcastFullState();
    expect(hostSent(MSG.WELCOME)).toHaveLength(welcomes + 1);
  });
});

describe('starting and leaving rooms', () => {
  it('starting a host room leaves the room it was in and resets its colour and roster', async () => {
    const { host, guest } = await hostAndGuest();
    guest.room.myColor = '#123456';
    await guest.room.startHostRoom({});
    await net.flush();
    expect(guest.room).toMatchObject({ role: 'host', myColor: 'var(--accent)' });
    expect(guest.room.roster.map((m) => m.id)).toEqual(['host']);
    expect(guest.room.hostSession.passcode).toBe('');
    expect(guest.room.hostSession.autoBackupTimer).not.toBeNull();
    expect(host.room.roster.find((m) => m.name === 'アリス').online).toBe(false);
  });

  it('joining as a guest leaves the room it hosted', async () => {
    const first = await openHost();
    const other = await openHost();
    await first.room.joinGuestRoom({ roomId: other.room.roomId, displayName: 'アリス' });
    await net.flush();
    expect(first.room.role).toBe('guest');
    expect(first.room.hostSession.guests.size).toBe(0);
    expect(other.room.getOnlineCount()).toBe(2);
  });

  it('joins without a passcode when none is given', async () => {
    const host = await openHost();
    const { room } = createNodeRoom();
    await room.joinGuestRoom({ roomId: host.room.roomId, displayName: 'アリス' });
    await net.flush();
    expect(host.room.getOnlineCount()).toBe(2);
  });

  it('a transport that closes after the guest left reports nothing', async () => {
    const { guest } = await hostAndGuest();
    const transport = guest.room.transport;
    guest.room.close();
    transport.onDisconnect('x');
    expect(guest.callsOf('onDisconnected')).toEqual([]);
  });

  it('a host transport error without a message gets the default one', async () => {
    const host = await openHost();
    host.room.transport.onError(null);
    expect(host.callsOf('onError')).toEqual([['通信エラーが発生しました']]);
  });

  it('a rejected knock is turned away through the room', async () => {
    const host = await openHost({ requireApproval: true });
    const guest = await joinNode(host.room.roomId);
    const [connId] = host.room.hostSession.pendingKnocks.keys();
    host.room.rejectKnock(connId);
    expect(hostSent(MSG.JOIN_REJECTED)).toHaveLength(1);
    await net.flush();
    expect(guest.callsOf('onAuthRejected')).toHaveLength(1);
  });
});

describe('recruiting', () => {
  it('stops asking whether to keep recruiting once a guest is found knocking', async () => {
    const host = await openHost({ requireApproval: true });
    await joinNode(host.room.roomId);
    const { RECRUIT_IDLE_PROMPT_MS: prompt, RECRUIT_IDLE_GRACE_MS: grace } = MULTIPLAYER_CONFIG;
    const step = MULTIPLAYER_CONFIG.HEARTBEAT_INTERVAL_MS;
    // Deliver messages as time passes, so the knocking guest keeps answering pings.
    for (let t = 0; t < prompt + grace + step; t += step) {
      vi.advanceTimersByTime(step);
      // eslint-disable-next-line no-await-in-loop -- pings go out as time passes
      await net.flush();
    }
    expect(host.room.hostSession.pendingKnocks.size).toBe(1);
    expect(host.room.getRecruitStatus().recruit).toBe(RECRUIT_STATE.OPEN);
  });

  it('keeps recruiting without asking while a guest is signing in', async () => {
    const host = await openHost();
    await joinNode(host.room.roomId, { flush: false });
    host.room.recruitment.update();
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.RECRUIT_IDLE_PROMPT_MS * 2);
    expect(host.room.hostSession.pendingAuth.size).toBe(1);
    expect(host.room.getRecruitStatus().recruit).toBe(RECRUIT_STATE.OPEN);
  });

  it('tells the host each time the recruiting or signaling state changes', async () => {
    const host = await openHost();
    const count = () => host.callsOf('onRecruitChange').length;
    const before = count();
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.RECRUIT_IDLE_PROMPT_MS);
    expect(count()).toBeGreaterThan(before);
    expect(host.callsOf('onRecruitChange').at(-1)[0].recruit).toBe(RECRUIT_STATE.IDLE_PROMPT);
    const mid = count();
    host.room.transport.onSignalingChange('offline');
    expect(count()).toBe(mid + 1);
  });

  it('reopens recruiting after it stopped for lack of an answer', async () => {
    const host = await openHost();
    vi.advanceTimersByTime(
      MULTIPLAYER_CONFIG.RECRUIT_IDLE_PROMPT_MS + MULTIPLAYER_CONFIG.RECRUIT_IDLE_GRACE_MS,
    );
    expect(host.room.getRecruitStatus().recruit).toBe(RECRUIT_STATE.IDLE_STOPPED);
    host.room.resumeRecruiting();
    expect(host.room.getRecruitStatus().recruit).toBe(RECRUIT_STATE.OPEN);
    expect(host.room.transport.acceptingJoins).toBe(true);
  });

  it('stops watching for idleness once the room is closed', async () => {
    const host = await openHost();
    host.room.close();
    const count = host.callsOf('onRecruitChange').length;
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.RECRUIT_IDLE_PROMPT_MS * 2);
    expect(host.callsOf('onRecruitChange')).toHaveLength(count);
  });

  it('reports no recruiting change outside a hosted room', () => {
    const { room, callsOf } = createNodeRoom();
    room._emitRecruitStatus();
    expect(callsOf('onRecruitChange')).toEqual([]);
  });
});

describe('positions and interpolation', () => {
  it('leaves fake pieces that are not in the update where they are', () => {
    const { room, engine } = createNodeRoom();
    engine.addFakePieces(2, 30);
    const [moved, kept] = engine.fakePieces;
    const keptAt = [kept.x, kept.y];
    room.applyPositionsOnly([{ id: moved.id, x: 1, y: 1 }]);
    expect([kept.x, kept.y]).toEqual(keptAt);
  });

  it('eases along one axis when only that axis is far', () => {
    const { room, engine } = createNodeRoom();
    const [a, b] = engine.pieces;
    for (const p of [a, b]) {
      p.x = 0;
      p.y = 0;
    }
    room.remoteCursors.set('x', { x: 0, y: 0, targetX: 10, targetY: 0 });
    room.remoteCursors.set('y', { x: 0, y: 0, targetX: 0, targetY: 10 });
    room.remoteDragTargets.set(a.groupId, new Map([[a.id, { x: 10, y: 0 }]]));
    room.remoteDragTargets.set(b.groupId, new Map([[b.id, { x: 0, y: 10 }]]));
    expect(room.stepInterpolation()).toEqual({ cursorsMoved: true, piecesMoved: true });
    expect(room.remoteCursors.get('x').x).toBeCloseTo(3.2);
    expect(room.remoteCursors.get('y').y).toBeCloseTo(3.2);
    expect([a.x, b.y]).toEqual([4, 4]);
  });

  it('jumps the rest of the way when exactly 0.2 is left', () => {
    const { room, engine } = createNodeRoom();
    const piece = engine.pieces[0];
    piece.x = 0;
    piece.y = 0;
    room.remoteCursors.set('c', { x: 0, y: 0, targetX: 0.2, targetY: 0.2 });
    room.remoteDragTargets.set(piece.groupId, new Map([[piece.id, { x: 0.2, y: 0.2 }]]));
    expect(room.stepInterpolation()).toEqual({ cursorsMoved: false, piecesMoved: false });
    expect(room.remoteCursors.get('c')).toMatchObject({ x: 0.2, y: 0.2 });
    expect([piece.x, piece.y]).toEqual([0.2, 0.2]);
  });
});

describe('contributions', () => {
  it('a saved host entry is never read as a guest, even with a name', () => {
    const { room } = createNodeRoom();
    room.applySavedContributions([
      { role: 'host', name: 'ホスト', contrib: 1 },
      { role: 'guest', name: 'アリス', contrib: 2 },
    ]);
    expect(room.savedGuestContribs.map((g) => g.name)).toEqual(['アリス']);
  });

  it('solo play keeps the saved list for later without touching the host session', () => {
    const { room } = createNodeRoom();
    const apply = vi.spyOn(room.hostSession, 'applySavedContributions');
    room.applySavedContributions([{ role: 'host', contrib: 5 }]);
    expect(apply).not.toHaveBeenCalled();
    expect(room.savedHostContrib).toBe(5);
  });

  it('forgetting contributions also clears the host session’s', async () => {
    const { host } = await hostAndGuest();
    host.room.hostSession.hostContrib = 4;
    host.room.resetContributions();
    expect(host.room.hostSession.hostContrib).toBe(0);
    host.room.hostSession.hostContrib = 4;
    host.room.applySavedContributions([]);
    expect(host.room.hostSession.hostContrib).toBe(0);
  });

  it('closing keeps guests as guests, and a guest closing keeps nothing', async () => {
    const { host, guest } = await hostAndGuest();
    host.room.close();
    expect(host.room.savedGuestContribs.map((g) => g.role)).toEqual(['guest']);
    guest.room.close();
    expect(guest.room.savedHostContrib).toBeNull();
    expect(guest.room.savedGuestContribs).toEqual([]);
  });
});
