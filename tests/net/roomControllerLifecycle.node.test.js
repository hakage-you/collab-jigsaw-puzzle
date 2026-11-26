import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER_CONFIG } from '../../src/config/constants.js';
import { RECRUIT_STATE } from '../../src/net/recruitment.js';
import { memoryNetwork as net } from '../helpers/memoryTransport.js';
import {
  closeNodeRooms,
  createNodeRoom,
  installNodeRoomGlobals,
  joinNode,
  openHost,
} from '../helpers/nodeRoom.js';

// RoomController over time: recruiting, joining and leaving as a guest, positions and the
// interpolation of remote moves, contributions carried across rooms, and closing.
// (Roles, routing and broadcasts: roomController.node.test.js.)

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

async function hostAndGuest(options = {}) {
  const host = await openHost(options);
  const guest = await joinNode(host.room.roomId, { name: 'アリス' });
  return { host, guest };
}

describe('recruiting', () => {
  it('reports the recruiting and signaling state to the host', async () => {
    const host = await openHost({ capacity: 2 });
    expect(host.room.getRecruitStatus()).toEqual({
      recruit: RECRUIT_STATE.OPEN,
      signaling: 'online',
    });
    expect(host.callsOf('onRecruitChange').at(-1)).toEqual([
      { recruit: RECRUIT_STATE.OPEN, signaling: 'online' },
    ]);
    await joinNode(host.room.roomId);
    expect(host.room.getRecruitStatus().recruit).toBe(RECRUIT_STATE.FULL);
    expect(host.room.transport.acceptingJoins).toBe(false);
    expect(host.callsOf('onRecruitChange').at(-1)[0].signaling).toBe('paused');
  });

  it('retries the signaling server on resume only when it was lost', async () => {
    const host = await openHost();
    const retry = vi.spyOn(host.room.transport, 'retrySignaling');
    host.room.resumeRecruiting();
    expect(retry).not.toHaveBeenCalled();
    for (const state of ['offline', 'id_taken']) {
      host.room.transport.onSignalingChange(state);
      expect(host.room.getRecruitStatus().signaling).toBe(state);
      host.room.resumeRecruiting();
    }
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('ignores recruiting calls and signaling news outside a hosted room', () => {
    const { room, callsOf } = createNodeRoom();
    room.resumeRecruiting();
    room.keepRecruiting();
    room._setSignalingState('offline');
    expect(room.signalingState).toBe('online');
    expect(callsOf('onRecruitChange')).toEqual([]);
    expect(room.getRecruitStatus()).toEqual({ recruit: RECRUIT_STATE.OPEN, signaling: 'online' });
  });

  it('keeps recruiting when the host answers the idle prompt', async () => {
    const host = await openHost();
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.RECRUIT_IDLE_PROMPT_MS);
    expect(host.room.getRecruitStatus().recruit).toBe(RECRUIT_STATE.IDLE_PROMPT);
    host.room.keepRecruiting();
    expect(host.room.getRecruitStatus().recruit).toBe(RECRUIT_STATE.OPEN);
  });
});

describe('joining as a guest', () => {
  it('leaves for real and reports it once when the host goes away', async () => {
    const { host, guest } = await hostAndGuest();
    host.room.close();
    await net.flush();
    expect(guest.room.role).toBe('solo');
    expect(guest.room.transport).toBeNull();
    expect(guest.callsOf('onDisconnected')).toEqual([['ホストとの接続が切れました']]);
  });

  it('passes transport errors on, with a default message', async () => {
    const { host, guest } = await hostAndGuest();
    guest.room.transport.onError(new Error('壊れた'));
    guest.room.transport.onError(null);
    host.room.transport.onError({});
    expect(guest.callsOf('onError')).toEqual([['壊れた'], ['通信エラーが発生しました']]);
    expect(host.callsOf('onError')).toEqual([['通信エラーが発生しました']]);
  });

  it('trims the room id and forgets earlier contributions', async () => {
    const host = await openHost();
    const { room } = createNodeRoom();
    room.savedHostContrib = 4;
    room.savedGuestContribs = [{ name: 'x', contrib: 1 }];
    await room.joinGuestRoom({ roomId: `  ${host.room.roomId} `, displayName: 'アリス' });
    expect(room.roomId).toBe(host.room.roomId);
    expect(room.savedHostContrib).toBeNull();
    expect(room.savedGuestContribs).toEqual([]);
  });

  it('routes knock decisions and kicks to the host session', async () => {
    const host = await openHost({ requireApproval: true });
    await joinNode(host.room.roomId, { name: 'アリス' });
    await joinNode(host.room.roomId, { name: 'ボブ' });
    const [a, b] = host.room.hostSession.pendingKnocks.keys();
    host.room.approveKnock(a);
    host.room.rejectKnock(b);
    await net.flush();
    expect(host.room.getOnlineCount()).toBe(2);
    const alice = [...host.room.hostSession.guests.values()][0];
    host.room.kickGuest(alice.id);
    expect(host.room.hostSession.guests.size).toBe(0);
  });

  it('a guest cannot kick', async () => {
    const { guest } = await hostAndGuest();
    const kick = vi.spyOn(guest.room.hostSession, 'kickGuest');
    guest.room.kickGuest('anyone');
    expect(kick).not.toHaveBeenCalled();
  });

  it('the host renaming itself reaches the guests', async () => {
    const { host, guest } = await hostAndGuest();
    host.settings.playerName = '新しい名前';
    host.room.updateHostName();
    await net.flush();
    expect(guest.room.roster[0].name).toBe('新しい名前');
    const solo = createNodeRoom();
    solo.room.updateHostName();
    expect(solo.callsOf('onRosterUpdate')).toEqual([]);
  });

  it('starts a new host room cleanly from guest state even when closing the old transport fires onDisconnect', async () => {
    const { guest } = await hostAndGuest();
    const oldTransport = guest.room.transport;
    const origClose = oldTransport.close.bind(oldTransport);
    oldTransport.close = () => {
      origClose();
      oldTransport.onDisconnect('host');
    };

    const { roomId } = await guest.room.startHostRoom({
      passcode: '',
      requireApproval: false,
      capacity: 4,
    });
    await net.flush();

    expect(roomId).toBeTruthy();
    expect(guest.room.role).toBe('host');
    expect(guest.room.roomRules).toBeNull();
    expect(guest.callsOf('onDisconnected')).toEqual([]);
  });

  it('returns to solo if opening a host room fails', async () => {
    const { room } = createNodeRoom();
    const origCreate = net.createTransport.bind(net);
    vi.spyOn(net, 'createTransport').mockImplementationOnce(() => {
      const t = origCreate();
      t.openHost = () => Promise.reject(new Error('open failed'));
      return t;
    });

    await expect(room.startHostRoom({ requireApproval: false })).rejects.toThrow('open failed');
    expect(room.role).toBe('solo');
    expect(room.transport).toBeNull();
  });
});

describe('positions and interpolation', () => {
  it('applies positions to loose pieces and fake pieces, never to placed ones', () => {
    const { room, engine } = createNodeRoom();
    engine.addFakePieces(1, 30);
    const [loose, placed] = engine.pieces;
    placed.isLocked = true;
    const fake = engine.fakePieces[0];
    const placedAt = { x: placed.x, y: placed.y };
    room.applyPositionsOnly([
      { id: loose.id, x: 1, y: 2 },
      { id: placed.id, x: 3, y: 4 },
      { id: fake.id, x: 5, y: 6 },
      { id: 'nobody', x: 7, y: 8 },
    ]);
    expect([loose.x, loose.y]).toEqual([1, 2]);
    expect({ x: placed.x, y: placed.y }).toEqual(placedAt);
    expect([fake.x, fake.y]).toEqual([5, 6]);
  });

  it('eases cursors and dragged pieces toward their targets and then snaps them there', () => {
    const { room, engine } = createNodeRoom();
    const piece = engine.pieces[0];
    piece.x = 0;
    piece.y = 0;
    room.remoteCursors.set('p', { x: 0, y: 0, targetX: 100, targetY: -50 });
    room.remoteDragTargets.set(piece.groupId, new Map([[piece.id, { x: 10, y: 20 }]]));

    expect(room.stepInterpolation()).toEqual({ cursorsMoved: true, piecesMoved: true });
    const cur = room.remoteCursors.get('p');
    expect([cur.x, cur.y]).toEqual([32, -16]);
    expect([piece.x, piece.y]).toEqual([4, 8]);

    for (let i = 0; i < 40; i++) room.stepInterpolation();
    expect(room.stepInterpolation()).toEqual({ cursorsMoved: false, piecesMoved: false });
    expect([cur.x, cur.y]).toEqual([100, -50]);
    expect([piece.x, piece.y]).toEqual([10, 20]);
  });

  it('moves the last fraction in one step, and leaves placed pieces and missing targets alone', () => {
    const { room, engine } = createNodeRoom();
    const [near, placed, other] = engine.pieces;
    near.x = 9.85;
    near.y = 20;
    placed.isLocked = true;
    const placedX = placed.x;
    const otherX = other.x;
    room.remoteCursors.set('p', { x: 0.1, y: 0, targetX: 0.25, targetY: 0.15 });
    for (const p of [near, placed, other]) room.remoteDragTargets.set(p.groupId, new Map());
    room.remoteDragTargets.get(near.groupId).set(near.id, { x: 10, y: 20 });
    room.remoteDragTargets.get(placed.groupId).set(placed.id, { x: 500, y: 500 });
    expect(room.stepInterpolation()).toEqual({ cursorsMoved: false, piecesMoved: false });
    expect(near.x).toBe(10);
    expect(room.remoteCursors.get('p')).toMatchObject({ x: 0.25, y: 0.15 });
    expect(placed.x).toBe(placedX);
    expect(other.x).toBe(otherX);
  });
});

describe('contributions across rooms', () => {
  it('with no saved list, starts from zero (the host from the placed count)', async () => {
    const host = await openHost();
    host.engine.stats.placedCount = 3;
    host.room.applySavedContributions([], 3);
    expect(host.room.hostSession.hostContrib).toBe(3);
    expect(host.room.savedHostContrib).toBeNull();
    const solo = createNodeRoom();
    solo.room.applySavedContributions(null, 5);
    expect(solo.room.savedHostContrib).toBeNull();
    expect(solo.room.hostSession.hostContrib).toBe(0);
  });

  it('reads the host and named guests from a saved list, cleaning bad numbers', () => {
    const { room } = createNodeRoom();
    room.applySavedContributions([
      { role: 'host', contrib: 4 },
      { role: 'guest', name: 'アリス', contrib: 2, color: '#111' },
      { role: 'guest', name: 'ボブ', contrib: 'x' },
      { role: 'guest', contrib: 9 },
      null,
    ]);
    expect(room.savedHostContrib).toBe(4);
    expect(room.savedGuestContribs).toEqual([
      { name: 'アリス', role: 'guest', contrib: 2, color: '#111' },
      { name: 'ボブ', role: 'guest', contrib: 0, color: null },
    ]);
    room.applySavedContributions([{ role: 'guest', name: 'キャロル', contrib: 1 }]);
    expect(room.savedHostContrib).toBe(0);
  });

  it('a host applies the saved list to the guests in the room', async () => {
    const { host } = await hostAndGuest();
    host.room.applySavedContributions([
      { role: 'host', contrib: 6 },
      { role: 'guest', name: 'アリス', contrib: 3 },
    ]);
    expect(host.room.hostSession.hostContrib).toBe(6);
    expect([...host.room.hostSession.guests.values()][0].contrib).toBe(3);
  });

  it('hands a saved contribution to the guest of that name once', () => {
    const { room } = createNodeRoom();
    room.applySavedContributions([{ role: 'guest', name: 'アリス', contrib: 2 }]);
    expect(room.claimSavedGuestContrib('ボブ')).toBeNull();
    expect(room.claimSavedGuestContrib('アリス')).toMatchObject({ name: 'アリス', contrib: 2 });
    expect(room.claimSavedGuestContrib('アリス')).toBeNull();
  });

  it('lists contributions for a save from whichever side it is on', async () => {
    const { host, guest } = await hostAndGuest();
    expect(host.room.buildContributionsList().map((c) => c.name)).toEqual([
      'ホスト（自分）',
      'アリス',
    ]);
    expect(guest.room.buildContributionsList()).toEqual(
      guest.room.roster.map(({ name, role, contrib, color }) => ({ name, role, contrib, color })),
    );

    const solo = createNodeRoom({ settings: { playerName: 'わたし' } });
    solo.engine.stats.placedCount = 7;
    solo.room.savedGuestContribs = [{ name: 'アリス', role: 'guest', contrib: 1, color: null }];
    expect(solo.room.buildContributionsList()).toEqual([
      { name: 'わたし', role: 'host', contrib: 7, color: 'var(--accent)' },
      { name: 'アリス', role: 'guest', contrib: 1, color: null },
    ]);
    solo.room.savedHostContrib = 2;
    expect(solo.room.buildContributionsList()[0].contrib).toBe(2);
    const lonely = createNodeRoom();
    lonely.room.role = 'guest';
    expect(lonely.room.buildContributionsList()[0].role).toBe('host');
  });

  it('closing a hosted room keeps everyone’s contribution for the next room', async () => {
    const { host } = await hostAndGuest();
    host.room.hostSession.hostContrib = 5;
    [...host.room.hostSession.guests.values()][0].contrib = 2;
    host.room.savedGuestContribs = [
      { name: 'アリス', role: 'guest', contrib: 9, color: null },
      { name: 'キャロル', role: 'guest', contrib: 1, color: null },
    ];
    host.room.close();
    expect(host.room.savedHostContrib).toBe(5);
    expect(host.room.savedGuestContribs.map((g) => [g.name, g.contrib])).toEqual([
      ['アリス', 2],
      ['キャロル', 1],
    ]);
  });
});

describe('closing', () => {
  it('returns to solo play with nothing left over', async () => {
    const { host, guest } = await hostAndGuest();
    host.room.requestLock(host.engine.pieces[0].groupId);
    host.room.remoteCursors.set('x', {});
    host.room.remoteDragTargets.set('g', new Map());
    host.room.transport.onSignalingChange('offline');
    host.room.close();
    expect(host.room).toMatchObject({
      role: 'solo',
      roomId: null,
      transport: null,
      recruitment: null,
      myPlayerId: 'host',
      signalingState: 'online',
      roster: [],
    });
    expect(host.room.groupLocks.size).toBe(0);
    expect(host.room.remoteCursors.size).toBe(0);
    expect(host.room.remoteDragTargets.size).toBe(0);
    expect(host.room.hostSession.guests.size).toBe(0);
    guest.room.close();
    expect(guest.room.myPlayerId).toBe('host');
    guest.room.close();
    expect(guest.room.role).toBe('solo');
  });

  it('the optimistic rollback lives in the guest session', () => {
    const { room } = createNodeRoom();
    room.optimisticRollback = { groupId: 'g' };
    expect(room.guestSession.optimisticRollback).toEqual({ groupId: 'g' });
    expect(room.optimisticRollback).toEqual({ groupId: 'g' });
  });

  it('lists the locked groups as a copy', () => {
    const { room } = createNodeRoom();
    room.groupLocks.set('g', 'p');
    const ids = room.getLockedGroupIds();
    ids.add('h');
    expect([...room.getLockedGroupIds()]).toEqual(['g']);
  });
});
