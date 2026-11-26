import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoomCallbacks } from '../../src/app/roomCallbacks.js';
import { disconnectNotice, kickedNotice } from '../../src/app/connectionNotices.js';
import { sound } from '../../src/services/sound.js';
import { createEngine } from '../helpers/coreEngine.js';

// The callback table RoomController reports through: each callback turns into the GameSession
// events the UI listens to (and a sound), keeps the knock queue, and finishes the puzzle when a
// snap completes it.

vi.mock('../../src/services/sound.js', () => ({
  sound: { playSnap: vi.fn(), playMerge: vi.fn(), playOjama: vi.fn() },
}));

function fakeSession({ canRejoin = false } = {}) {
  const events = [];
  const session = {
    events,
    knockQueue: [],
    engine: createEngine(),
    highlightFilter: 'edges',
    sourceImage: { name: '画像', isSample: false },
    room: { broadcastCompletion: vi.fn() },
    _ojama: { mirrorTimed: vi.fn() },
    emit: (name, payload) => events.push([name, payload]),
    _emitRoleChange: () => events.push(['roleChange', undefined]),
    completePuzzle: vi.fn(),
    canRejoinLastRoom: () => canRejoin,
    _replaceSourceImage: vi.fn(),
  };
  const cb = createRoomCallbacks(session);
  const names = () => events.map(([n]) => n);
  const payloadsOf = (name) => events.filter(([n]) => n === name).map(([, p]) => p);
  return { session, cb, events, names, payloadsOf };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('lobby and connection', () => {
  it('turns errors, toasts, notices, renders, roster and recruiting into events', () => {
    const { cb, events } = fakeSession();
    cb.onError('だめ');
    cb.onToast('やあ', 'success');
    cb.onOjamaNotice({ text: 'n' });
    cb.onRenderNeeded();
    cb.onRosterUpdate([]);
    cb.onRecruitChange({ recruit: 'open' });
    cb.onGuestStatus('待機中');
    cb.onPieceHop({ groupId: 'g' });
    expect(events).toEqual([
      ['toast', { message: 'だめ', kind: 'ojama' }],
      ['toast', { message: 'やあ', kind: 'success' }],
      ['ojamaNotice', { text: 'n' }],
      ['renderNeeded', undefined],
      ['hudUpdate', undefined],
      ['recruitChange', { recruit: 'open' }],
      ['guestStatus', { text: '待機中', isError: false }],
      ['pieceHop', { groupId: 'g' }],
    ]);
  });

  it('queues each knock once and drops it when resolved, telling the UI each time', () => {
    const { cb, session, payloadsOf } = fakeSession();
    const a = { connId: 'a', displayName: 'アリス' };
    const b = { connId: 'b', displayName: 'ボブ' };
    cb.onKnockRequest(a);
    cb.onKnockRequest(b);
    cb.onKnockRequest({ ...a });
    expect(session.knockQueue).toEqual([a, b]);
    cb.onKnockResolved('a');
    cb.onKnockResolved('nobody');
    expect(session.knockQueue).toEqual([b]);
    expect(payloadsOf('knockChange')).toEqual([[a], [a, b], [a, b], [b], [b]]);
    const sent = payloadsOf('knockChange')[1];
    sent.push('x');
    expect(session.knockQueue).toEqual([b]);
  });

  it('reports a refusal, and a kick also as a notice', () => {
    const { cb, events } = fakeSession();
    cb.onAuthRejected('合言葉が違います');
    cb.onAuthRejected('出て行って', { kicked: true });
    expect(events).toEqual([
      ['roleChange', undefined],
      ['authRejected', { reason: '合言葉が違います' }],
      ['roleChange', undefined],
      ['authRejected', { reason: '出て行って' }],
      ['notice', kickedNotice('出て行って')],
    ]);
  });

  it('reports a lost connection with a notice that offers rejoining when it can', () => {
    for (const canRejoin of [false, true]) {
      const { cb, events } = fakeSession({ canRejoin });
      cb.onDisconnected('切れた');
      expect(events).toEqual([
        ['roleChange', undefined],
        ['disconnected', { reason: '切れた' }],
        ['notice', disconnectNotice('切れた', canRejoin)],
      ]);
    }
  });

  it('updates role and HUD when admitted', () => {
    const { cb, names } = fakeSession();
    cb.onGuestAdmitted({});
    expect(names()).toEqual(['roleChange', 'hudUpdate']);
  });
});

describe('the board', () => {
  it('a host-side snap plays, shows the effect, and finishes the puzzle when it completes it', () => {
    const { cb, session, events } = fakeSession();
    const pieces = [{ id: 1 }];
    cb.onHostPatchApplied(pieces, { type: 'snap' });
    expect(sound.playSnap).toHaveBeenCalledTimes(1);
    expect(session.completePuzzle).not.toHaveBeenCalled();
    expect(events).toEqual([
      ['snapEffect', { pieces }],
      ['hudUpdate', undefined],
      ['renderNeeded', undefined],
    ]);
    cb.onHostPatchApplied(pieces, { type: 'snap', completed: true });
    expect(session.completePuzzle).toHaveBeenCalledTimes(1);
    expect(session.room.broadcastCompletion).toHaveBeenCalledTimes(1);
  });

  it('a host-side merge plays the merge sound; anything else just redraws', () => {
    const { cb, names } = fakeSession();
    cb.onHostPatchApplied([], { type: 'merge' });
    cb.onHostPatchApplied([], { type: 'drop' });
    cb.onHostPatchApplied([], undefined);
    expect(sound.playMerge).toHaveBeenCalledTimes(1);
    expect(sound.playSnap).not.toHaveBeenCalled();
    expect(names()).toEqual(Array(3).fill(['hudUpdate', 'renderNeeded']).flat());
  });

  it('a guest-side snap or merge plays its sound and shows the snap', () => {
    const { cb, events } = fakeSession();
    const pieces = [{ id: 2 }];
    cb.onGuestPatchApplied(pieces, { type: 'snap' });
    cb.onGuestPatchApplied(pieces, { type: 'merge' });
    cb.onGuestPatchApplied(pieces, null);
    expect(sound.playSnap).toHaveBeenCalledTimes(1);
    expect(sound.playMerge).toHaveBeenCalledTimes(1);
    expect(events.filter(([n]) => n === 'snapEffect')).toEqual([['snapEffect', { pieces }]]);
    expect(events.filter(([n]) => n === 'hudUpdate')).toHaveLength(3);
  });

  it('a dropped-pieces ojama shows its effect on the pieces as they are on this board', () => {
    const { cb, session, payloadsOf } = fakeSession();
    const [a, b] = session.engine.pieces;
    cb.onGuestPatchApplied([{ id: a.id }, { id: 'gone' }, { id: b.id }], { type: 'ojama_drop' });
    expect(payloadsOf('ojamaDropEffect')).toEqual([{ pieces: [a, b] }]);
  });

  it('a prank shows its effect only when the positions before it are known', () => {
    const { cb, session, payloadsOf } = fakeSession();
    const [a] = session.engine.pieces;
    const before = new Map([[a.id, { x: 0, y: 0 }]]);
    cb.onGuestPatchApplied([{ id: a.id }], { type: 'ojama_prank' }, 'host', before);
    cb.onGuestPatchApplied([{ id: a.id }], { type: 'ojama_prank' }, 'host');
    expect(payloadsOf('ojamaPrankEffect')).toEqual([{ pieces: [a], before }]);
  });

  it('a prank effect skips pieces this board does not have, and other patches show none', () => {
    const { cb, session, payloadsOf, names } = fakeSession();
    const [a] = session.engine.pieces;
    const before = new Map();
    cb.onGuestPatchApplied([{ id: 'gone' }, { id: a.id }], { type: 'ojama_prank' }, 'host', before);
    cb.onGuestPatchApplied([{ id: a.id }], { type: 'rotate' }, 'host', before);
    expect(payloadsOf('ojamaPrankEffect')).toEqual([{ pieces: [a], before }]);
    expect(names().slice(-2)).toEqual(['hudUpdate', 'renderNeeded']);
  });

  it('reports image progress and swaps in a received image without resetting effects', () => {
    const { cb, session, events } = fakeSession();
    cb.onImageProgress(3, 10);
    const canvas = { width: 1 };
    cb.onReceiveImage(canvas, '共有画像', false, 'x');
    expect(session._replaceSourceImage).toHaveBeenCalledWith(canvas, '共有画像', false, 'x');
    expect(events).toEqual([
      ['imageProgress', { received: 3, total: 10 }],
      ['puzzleReset', { name: '画像', isSample: false, resetEffects: false }],
    ]);
  });

  it('after a full sync resets the view, deals only a fresh board, and says it is synced', () => {
    const fresh = fakeSession();
    fresh.cb.onFullStateSynced({});
    expect(fresh.session.highlightFilter).toBe('all');
    expect(fresh.events).toEqual([
      [
        'puzzleReset',
        { name: '画像', isSample: false, resetEffects: true, fitView: true, animateDeal: true },
      ],
      ['roleChange', undefined],
      ['fullStateSynced', undefined],
      ['hudUpdate', undefined],
      ['toast', { message: 'ホストの盤面と同期しました', kind: 'success' }],
    ]);
    const started = fakeSession();
    started.session.engine.stats.placedCount = 1;
    started.cb.onFullStateSynced({});
    expect(started.payloadsOf('puzzleReset')[0].animateDeal).toBe(false);
  });

  it('a denied grab plays a sound and says someone else has it', () => {
    const { cb, events } = fakeSession();
    cb.onLockDenied('g');
    expect(sound.playOjama).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      ['lockDenied', { groupId: 'g' }],
      ['toast', { message: '他のメンバーが操作中のためロックできませんでした', kind: 'ojama' }],
      ['renderNeeded', undefined],
    ]);
  });

  it('finishes the puzzle when the host says it is complete', () => {
    const { cb, session } = fakeSession();
    cb.onRemoteCompleted();
    expect(session.completePuzzle).toHaveBeenCalledTimes(1);
    expect(session.room.broadcastCompletion).not.toHaveBeenCalled();
  });
});

describe('ojama from the host', () => {
  it('turns visual ojama and the shared superchat into events', () => {
    const { cb, events } = fakeSession();
    cb.onRemoteVisualOjama('fog', 5);
    cb.onRemoteVisualClear();
    cb.onRemoteSuperchat({ maxHp: 9 });
    cb.onRemoteSuperchatState(4, 9);
    cb.onLocalSuperchatHp(3, 9);
    cb.onRemoteSuperchatDismiss();
    expect(events).toEqual([
      ['remoteVisualOjama', { visualType: 'fog', duration: 5 }],
      ['remoteVisualClear', undefined],
      ['remoteSuperchat', { maxHp: 9 }],
      ['remoteSuperchatHp', { hp: 4, maxHp: 9 }],
      ['remoteSuperchatHp', { hp: 3, maxHp: 9 }],
      ['remoteSuperchatDismiss', undefined],
    ]);
  });

  it('hands timed ojama to the ojama session to mirror', () => {
    const { cb, session } = fakeSession();
    const msg = { kind: 'heavy', remaining: 3 };
    cb.onRemoteTimedOjama(msg);
    expect(session._ojama.mirrorTimed).toHaveBeenCalledWith(msg);
  });
});
