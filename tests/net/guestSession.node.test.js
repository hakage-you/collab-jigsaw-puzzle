import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER_CONFIG } from '../../src/config/constants.js';
import { MSG, computeChallengeHash } from '../../src/net/protocol.js';
import { boardState } from '../helpers/coreEngine.js';
import { memoryNetwork as net } from '../helpers/memoryTransport.js';
import {
  closeNodeRooms,
  createNodeRoom,
  installNodeRoomGlobals,
  joinNode,
  openHost,
  storedRejoin,
} from '../helpers/nodeRoom.js';

// GuestSession inside a real RoomController: joining (auth, rejoin, welcome), being turned away,
// receiving the image and the board (whole or in chunks, and rejecting bad ones), the heartbeat,
// and the guest's own optimistic moves.

vi.mock('../../src/net/transport.js', async () => {
  const { memoryNetwork } = await import('../helpers/memoryTransport.js');
  return {
    createTransport: () => memoryNetwork.createTransport(),
    getTransportModeFromUrl: () => 'memory',
  };
});

const FULL_STATE_REJECTED = 'ホストの盤面データが不正なため切断しました';
const IMAGE_REJECTED = 'ホストから受信した画像が不正なため切断しました';

beforeEach(() => {
  vi.useFakeTimers();
  installNodeRoomGlobals();
});

afterEach(() => {
  closeNodeRooms();
  vi.useRealTimers();
});

/** Messages of a type a guest sent to the host, as their payloads. */
const guestSent = (type) =>
  net
    .sentOf(type)
    .filter((e) => e.to === 'host')
    .map((e) => e.msg);

/**
 * A guest room fed messages directly (no host): its sends to the host are recorded in `sent`.
 * Used for transfers a Node host cannot produce (images) and for hostile ones.
 */
function loneGuest(options) {
  const guest = createNodeRoom(options);
  const sent = [];
  guest.room.role = 'guest';
  guest.room.roomId = 'cj-lone';
  guest.room.transport = { sendToHost: (m) => sent.push(m), close: () => {} };
  const feed = (msg) => guest.room.guestSession.onMessage(msg);
  return { ...guest, gs: guest.room.guestSession, sent, feed };
}

/** A real FULL_STATE message for a host board (taken from a real join). */
async function realFullState(hostOptions = {}) {
  const host = await openHost(hostOptions);
  // Change the host's board so that a fresh guest board differs from it.
  const [placed, moved] = host.engine.pieces;
  host.engine.moveGroup(placed.groupId, placed.targetX - placed.x, placed.targetY - placed.y);
  host.engine.resolveDrop(placed.groupId);
  host.engine.moveGroup(moved.groupId, 900, -700);
  await joinNode(host.room.roomId);
  return { host, msg: structuredClone(net.sentOf(MSG.FULL_STATE).at(-1).msg) };
}

describe('joining', () => {
  it('answers the challenge with the hash of its nonce and passcode, and its name', async () => {
    const host = await openHost({ passcode: 'abc' });
    await joinNode(host.room.roomId, { name: '  アリス ', passcode: 'abc' });
    const { nonce } = net.sentOf(MSG.AUTH_CHALLENGE)[0].msg;
    expect(guestSent(MSG.AUTH_RESPONSE)).toEqual([
      {
        type: MSG.AUTH_RESPONSE,
        hash: await computeChallengeHash(nonce, 'abc'),
        displayName: 'アリス',
      },
    ]);
    expect(guestSent(MSG.REJOIN)).toEqual([]);
  });

  it('is called ゲスト when it gives no name', async () => {
    const host = await openHost();
    await joinNode(host.room.roomId, { name: '   ' });
    expect(guestSent(MSG.AUTH_RESPONSE)[0].displayName).toBe('ゲスト');
  });

  it('on welcome takes its seat, the rules and the roster, and keeps its token', async () => {
    const host = await openHost({ settings: { allowRotation: true } });
    const guest = await joinNode(host.room.roomId, { name: 'アリス' });
    const welcome = net.sentOf(MSG.WELCOME)[0].msg;
    expect(guest.room.myPlayerId).toBe(welcome.playerId);
    expect(guest.room.myColor).toBe(welcome.color);
    expect(guest.room.roomRules).toMatchObject({ allowRotation: true, capacity: 8 });
    expect(guest.callsOf('onGuestAdmitted')[0][0]).toMatchObject({
      playerId: welcome.playerId,
      color: welcome.color,
      roomRules: { allowRotation: true },
    });
    expect(storedRejoin(host.room.roomId)).toEqual({
      playerId: welcome.playerId,
      reconnectToken: welcome.reconnectToken,
    });
    expect(guest.room.hasRejoinToken(host.room.roomId)).toBe(true);
    expect(guest.room.hasRejoinToken('cj-other')).toBe(false);
  });

  it('skips the image it already has and asks for the board', async () => {
    const host = await openHost();
    const guest = await joinNode(host.room.roomId);
    expect(guestSent(MSG.IMAGE_ACK)).toEqual([{ type: MSG.IMAGE_ACK, needImage: false }]);
    expect(guest.callsOf('onFullStateSynced')).toHaveLength(1);
    expect(boardState(guest.engine)).toEqual(boardState(host.engine));
  });

  it('rejoins with the token this tab kept, as the same player', async () => {
    const host = await openHost();
    const first = await joinNode(host.room.roomId, { name: 'アリス' });
    const token = storedRejoin(host.room.roomId);
    net.dropLink(first.room.transport);
    await net.flush();
    const again = await joinNode(host.room.roomId, { name: 'アリス', rejoin: token });
    expect(guestSent(MSG.REJOIN).at(-1)).toEqual({
      type: MSG.REJOIN,
      playerId: token.playerId,
      reconnectToken: token.reconnectToken,
      displayName: 'アリス',
    });
    expect(guestSent(MSG.AUTH_RESPONSE)).toHaveLength(1);
    expect(again.room.myPlayerId).toBe(token.playerId);
  });
});

describe('the welcome for an image it does not have', () => {
  it('asks for the image and says it is receiving it', async () => {
    const host = await openHost();
    await joinNode(host.room.roomId);
    const welcome = {
      ...net.sentOf(MSG.WELCOME)[0].msg,
      imageHash: 'not-this-one',
      totalChunks: 3,
    };
    const { feed, sent, callsOf, gs } = loneGuest();
    await feed(welcome);
    expect(sent).toEqual([{ type: MSG.IMAGE_ACK, needImage: true }]);
    expect(callsOf('onGuestStatus')).toEqual([['ホストから画像を受信中...']]);
    expect(gs.incomingImage).toMatchObject({ totalChunks: 3, received: 0 });
  });

  it('starts counting chunks when the image starts', async () => {
    const { feed, callsOf, gs } = loneGuest();
    await feed({
      type: MSG.IMAGE_START,
      totalChunks: 4,
      mimeType: 'image/webp',
      width: 10,
      height: 10,
    });
    expect(callsOf('onImageProgress')).toEqual([[0, 4]]);
    expect(gs.incomingImage).toMatchObject({ totalChunks: 4, received: 0, mimeType: 'image/webp' });
    expect(gs.incomingImage.chunks).toHaveLength(4);
  });

  it('ignores a chunk when no image is coming', async () => {
    const { feed, room, callsOf } = loneGuest();
    await feed({ type: MSG.IMAGE_CHUNK, index: 0, data: 'AAAA' });
    expect(room.role).toBe('guest');
    expect(callsOf('onDisconnected')).toEqual([]);
  });

  it('leaves when a chunk is beyond the announced count', async () => {
    const { feed, room, callsOf } = loneGuest();
    await feed({
      type: MSG.IMAGE_START,
      totalChunks: 1,
      mimeType: 'image/webp',
      width: 10,
      height: 10,
    });
    await feed({ type: MSG.IMAGE_CHUNK, index: 1, data: 'AAAA' });
    expect(room.role).toBe('solo');
    expect(callsOf('onDisconnected')).toEqual([[IMAGE_REJECTED]]);
  });

  it('leaves when an image message is malformed, but ignores other malformed messages', async () => {
    const bad = loneGuest();
    await bad.feed({ type: MSG.LOCK_GRANTED, groupId: 42 });
    expect(bad.room.role).toBe('guest');
    await bad.feed({ type: MSG.IMAGE_START, totalChunks: -1 });
    expect(bad.room.role).toBe('solo');
    expect(bad.callsOf('onDisconnected')).toEqual([[IMAGE_REJECTED]]);
  });
});

describe('receiving the board', () => {
  it('applies a whole board with its rules, locks, roster and labels', async () => {
    const { host, msg } = await realFullState();
    const { feed, room, engine, callsOf } = loneGuest();
    expect(boardState(engine)).not.toEqual(boardState(host.engine));
    room.remoteDragTargets.set('old', new Map());
    msg.locks = [[host.engine.pieces[0].groupId, 'host']];
    msg.zoneLabels = [{ text: '端', x: 1, y: 2 }];
    await feed(msg);
    expect(boardState(engine)).toEqual(boardState(host.engine));
    expect([...room.groupLocks]).toEqual(msg.locks);
    expect(room.roster.map((m) => m.id)).toEqual(msg.roster.map((m) => m.id));
    expect(room.roomRules).toEqual(msg.roomRules);
    expect(engine.zoneLabels).toEqual(msg.zoneLabels);
    expect(room.remoteDragTargets.size).toBe(0);
    expect(callsOf('onFullStateSynced')).toEqual([
      [{ roomRules: msg.roomRules, roster: room.roster }],
    ]);
    expect(callsOf('onRenderNeeded')).toEqual([]);
  });

  it('also takes the fake pieces on the board', async () => {
    const { host, msg } = await realFullState();
    host.engine.addFakePieces(2, 30);
    msg.fakePieces = host.engine.serializeFakePieces();
    const { feed, engine, callsOf } = loneGuest();
    await feed(msg);
    expect(engine.fakePieces.map((f) => f.id)).toEqual(host.engine.fakePieces.map((f) => f.id));
    expect(callsOf('onRenderNeeded')).toHaveLength(1);
  });

  it('puts a board sent in chunks back together in order, ignoring repeats', async () => {
    const { host, msg } = await realFullState();
    const pieces = msg.saveData.pieces;
    const header = { ...msg, totalPieceChunks: 3, saveData: { ...msg.saveData, pieces: [] } };
    const part = (i) => ({
      type: MSG.FULL_STATE_CHUNK,
      chunkIndex: i,
      pieces: pieces.slice(i * 5, i * 5 + 5),
    });
    const { feed, engine, gs, callsOf } = loneGuest();
    await feed(header);
    expect(gs.pendingFullState).not.toBeNull();
    await feed(part(2));
    await feed(part(0));
    await feed(part(0));
    expect(callsOf('onFullStateSynced')).toEqual([]);
    expect(callsOf('onDisconnected')).toEqual([]);
    expect(gs.pendingFullState.received).toBe(2);
    await feed(part(1));
    expect(gs.pendingFullState).toBeNull();
    expect(boardState(engine)).toEqual(boardState(host.engine));
  });

  it('treats a single-chunk header as a whole board', async () => {
    const { msg } = await realFullState();
    const { feed, callsOf, gs } = loneGuest();
    await feed({ ...msg, totalPieceChunks: 1 });
    expect(gs.pendingFullState).toBeNull();
    expect(callsOf('onFullStateSynced')).toHaveLength(1);
  });

  it('ignores a chunk that belongs to no board', async () => {
    const { feed, room, callsOf } = loneGuest();
    await feed({ type: MSG.FULL_STATE_CHUNK, chunkIndex: 0, pieces: [] });
    expect(room.role).toBe('guest');
    expect(callsOf('onFullStateSynced')).toEqual([]);
  });

  it('leaves when a chunk is beyond the announced count', async () => {
    const { msg } = await realFullState();
    const { feed, room, callsOf } = loneGuest();
    await feed({ ...msg, totalPieceChunks: 2 });
    await feed({ type: MSG.FULL_STATE_CHUNK, chunkIndex: 2, pieces: [] });
    expect(room.role).toBe('solo');
    expect(callsOf('onDisconnected')).toEqual([[FULL_STATE_REJECTED]]);
  });

  it('leaves when the chunks add up to more pieces than any board has', async () => {
    const { msg } = await realFullState();
    const { feed, room, callsOf } = loneGuest();
    const many = Array.from({ length: 2000 }, () => ({}));
    await feed({ ...msg, totalPieceChunks: 3 });
    await feed({ type: MSG.FULL_STATE_CHUNK, chunkIndex: 0, pieces: many });
    expect(room.role).toBe('guest');
    await feed({ type: MSG.FULL_STATE_CHUNK, chunkIndex: 1, pieces: many });
    expect(room.role).toBe('solo');
    expect(callsOf('onDisconnected')).toEqual([[FULL_STATE_REJECTED]]);
  });

  it('leaves when the board does not pass the save checks', async () => {
    const { msg } = await realFullState();
    msg.saveData.pieces[0].x = 'far away';
    const { feed, room, engine, callsOf } = loneGuest();
    const before = boardState(engine);
    await feed(msg);
    expect(room.role).toBe('solo');
    expect(callsOf('onDisconnected')).toEqual([[FULL_STATE_REJECTED]]);
    expect(boardState(engine)).toEqual(before);
  });

  it('waits when it has no image to put the board on yet', async () => {
    const { msg } = await realFullState();
    const { feed, room, callsOf } = loneGuest();
    room.getSourceState = () => ({ sourceCanvas: null, isSampleImage: false });
    await feed(msg);
    expect(callsOf('onFullStateSynced')).toEqual([]);
    expect(room.role).toBe('guest');
  });

  it('does not report a broken transfer after it already left', () => {
    const { room, gs, callsOf } = loneGuest();
    room.role = 'solo';
    gs._failTransfer(MSG.FULL_STATE, 'test');
    expect(callsOf('onDisconnected')).toEqual([]);
  });
});

describe('being turned away', () => {
  it('forgets its token when kicked, and says it was kicked', async () => {
    const { feed, room, callsOf } = loneGuest();
    sessionStorage.setItem(
      'cj_rejoin_cj-lone',
      JSON.stringify({ playerId: 'p', reconnectToken: 't' }),
    );
    await feed({ type: MSG.KICKED, reason: '出て行って' });
    expect(sessionStorage.getItem('cj_rejoin_cj-lone')).toBeNull();
    expect(room.role).toBe('solo');
    expect(callsOf('onAuthRejected')).toEqual([['出て行って', { kicked: true }]]);
  });

  it('forgets its token when the host says the token is bad', async () => {
    const { feed } = loneGuest();
    sessionStorage.setItem('cj_rejoin_cj-lone', '{"playerId":"p","reconnectToken":"t"}');
    await feed({ type: MSG.AUTH_ERROR, reason: '再接続トークンが無効です' });
    expect(sessionStorage.getItem('cj_rejoin_cj-lone')).toBeNull();
  });

  it('keeps its token for other refusals, and has a default reason', async () => {
    const { feed, callsOf } = loneGuest();
    sessionStorage.setItem('cj_rejoin_cj-lone', '{"playerId":"p","reconnectToken":"t"}');
    await feed({ type: MSG.JOIN_REJECTED });
    expect(sessionStorage.getItem('cj_rejoin_cj-lone')).not.toBeNull();
    expect(callsOf('onAuthRejected')).toEqual([['接続が拒否されました', { kicked: false }]]);
  });

  it('survives storage that throws', () => {
    const { gs } = loneGuest();
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(gs.hasSavedSession('cj-lone')).toBe(false);
    expect(() => gs._saveSession('cj-lone', 'p', 't')).not.toThrow();
    expect(() => gs._clearSession('cj-lone')).not.toThrow();
  });

  it('reads a broken token as none', () => {
    const { gs } = loneGuest();
    sessionStorage.setItem('cj_rejoin_cj-lone', '{not json');
    expect(gs.hasSavedSession('cj-lone')).toBe(false);
    sessionStorage.setItem('cj_rejoin_cj-lone', '{"playerId":"p"}');
    expect(gs.hasSavedSession('cj-lone')).toBe(false);
  });
});

describe('the heartbeat', () => {
  it('answers the host’s pings', async () => {
    const { feed, sent } = loneGuest();
    await feed({ type: MSG.PING });
    expect(sent).toEqual([{ type: MSG.PONG }]);
  });

  it('leaves when the host stops answering', async () => {
    const host = await openHost();
    const guest = await joinNode(host.room.roomId);
    host.room.transport.sendTo = () => {};
    host.room.transport.broadcast = () => {};
    const limit =
      MULTIPLAYER_CONFIG.HEARTBEAT_TIMEOUT_MS + 2 * MULTIPLAYER_CONFIG.HEARTBEAT_INTERVAL_MS;
    for (let t = 0; t <= limit && guest.room.role === 'guest'; t += 1000) {
      vi.advanceTimersByTime(1000);
      // eslint-disable-next-line no-await-in-loop -- pings go out as time passes
      await net.flush();
    }
    expect(guest.room.role).toBe('solo');
    expect(guest.callsOf('onDisconnected')).toEqual([
      ['ホストからの応答が途絶えたため切断しました'],
    ]);
  });

  it('stays while the host answers', async () => {
    const host = await openHost();
    const guest = await joinNode(host.room.roomId);
    for (let t = 0; t <= 3 * MULTIPLAYER_CONFIG.HEARTBEAT_TIMEOUT_MS; t += 1000) {
      vi.advanceTimersByTime(1000);
      // eslint-disable-next-line no-await-in-loop -- pings go out as time passes
      await net.flush();
    }
    expect(guest.room.role).toBe('guest');
    expect(guestSent(MSG.PING).length).toBeGreaterThan(0);
  });

  it('does nothing when the host is lost after it already left', () => {
    const { room, gs, callsOf } = loneGuest();
    room.role = 'solo';
    gs._onHostLost();
    expect(callsOf('onDisconnected')).toEqual([]);
  });
});

describe('the guest’s own moves', () => {
  it('grabs at once and remembers where the group was, in case the host says no', () => {
    const { gs, room, engine, sent } = loneGuest();
    room.myPlayerId = 'me';
    const piece = engine.pieces[0];
    expect(gs.requestLock(piece.groupId, { x: 3, y: 4 })).toEqual({ allowed: true });
    expect(room.groupLocks.get(piece.groupId)).toBe('me');
    expect(gs.optimisticRollback).toEqual({
      groupId: piece.groupId,
      snapshot: [{ id: piece.id, x: piece.x, y: piece.y }],
    });
    expect(sent).toEqual([{ type: MSG.LOCK_REQUEST, groupId: piece.groupId, x: 3, y: 4 }]);
    gs.requestLock(piece.groupId);
    expect(sent[1]).toEqual({ type: MSG.LOCK_REQUEST, groupId: piece.groupId });
  });

  it('drops with positions rounded to hundredths and lets go of the group', () => {
    const { gs, room, engine, sent } = loneGuest();
    const piece = engine.pieces[0];
    gs.requestLock(piece.groupId);
    piece.x = 10.123;
    piece.y = -4.567;
    expect(gs.submitDrop(piece.groupId)).toEqual({ type: 'pending' });
    expect(sent.at(-1)).toEqual({
      type: MSG.DROP_REQUEST,
      groupId: piece.groupId,
      positions: [{ id: piece.id, x: 10.12, y: -4.57 }],
    });
    expect(gs.optimisticRollback).toBeNull();
    expect(room.groupLocks.has(piece.groupId)).toBe(false);
  });

  it('keeps the rollback of another group when it drops this one', () => {
    const { gs, engine } = loneGuest();
    const [a, b] = engine.pieces;
    gs.requestLock(a.groupId);
    gs.submitDrop(b.groupId);
    expect(gs.optimisticRollback.groupId).toBe(a.groupId);
  });

  it('numbers its turns and flips, and sends nothing the rules refuse', () => {
    const { gs, engine, sent } = loneGuest();
    const piece = engine.pieces[0];
    expect(gs.submitRotate(piece, false)).toBe(false);
    expect(gs.submitFlip(piece, false)).toBe(false);
    expect(sent).toEqual([]);
    expect(gs.submitRotate(piece, true)).toBe(true);
    expect(gs.submitFlip(piece, true)).toBe(true);
    expect(sent).toEqual([
      { type: MSG.ROTATE_REQUEST, pieceId: piece.id, opSeq: 1 },
      { type: MSG.FLIP_REQUEST, pieceId: piece.id, opSeq: 2 },
    ]);
    expect(gs.pendingGroupOpSeq.get(piece.groupId)).toBe(2);
  });

  it('sends superchat hits to the host and keeps no HP itself', () => {
    const { gs, sent } = loneGuest();
    expect(gs.submitSuperchatHit()).toBeNull();
    expect(sent).toEqual([{ type: MSG.SUPERCHAT_HIT }]);
  });
});

describe('resetting', () => {
  it('configure and reset start a join from scratch', () => {
    const { gs, engine } = loneGuest();
    gs.requestLock(engine.pieces[0].groupId);
    gs.submitRotate(engine.pieces[1], true);
    gs.incomingImage = {};
    gs.pendingFullState = {};
    gs.configure({ displayName: 'ボブ', passcode: 'x' });
    expect(gs).toMatchObject({
      guestDisplayName: 'ボブ',
      guestPasscode: 'x',
      incomingImage: null,
      pendingFullState: null,
      optimisticRollback: null,
      localOpSeq: 0,
    });
    expect(gs.pendingGroupOpSeq.size).toBe(0);
    gs.submitRotate(engine.pieces[1], true);
    gs.reset();
    expect(gs).toMatchObject({ guestDisplayName: '', guestPasscode: '', localOpSeq: 0 });
    expect(gs.pendingGroupOpSeq.size).toBe(0);
  });
});
