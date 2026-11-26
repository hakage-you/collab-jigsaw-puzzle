import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER_CONFIG, NET_LIMITS } from '../../src/config/constants.js';
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

// GuestSession details beyond guestSession.node.test.js: what it logs, edge cases of tokens and
// chunk limits, and that it stops pinging once it left.

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

const guestSent = (type) =>
  net
    .sentOf(type)
    .filter((e) => e.to === 'host')
    .map((e) => e.msg);
const logged = (message) => getDiagnosticsState().entries.filter((e) => e.message === message);

function loneGuest() {
  const guest = createNodeRoom();
  const sent = [];
  guest.room.role = 'guest';
  guest.room.roomId = 'cj-lone';
  guest.room.transport = { sendToHost: (m) => sent.push(m), close: () => {} };
  const feed = (msg) => guest.room.guestSession.onMessage(msg);
  return { ...guest, gs: guest.room.guestSession, sent, feed };
}

async function realFullState() {
  const host = await openHost();
  await joinNode(host.room.roomId);
  return structuredClone(net.sentOf(MSG.FULL_STATE).at(-1).msg);
}

describe('a new guest session', () => {
  it('starts with no name or passcode, and a join without a passcode clears the old one', () => {
    const { gs } = loneGuest();
    expect(gs).toMatchObject({ guestDisplayName: '', guestPasscode: '' });
    gs.configure({ displayName: 'アリス', passcode: 'abc' });
    gs.configure({ displayName: 'アリス' });
    expect(gs.guestPasscode).toBe('');
  });

  it('turns and flips by default when no rule is given', () => {
    const { gs, engine, sent } = loneGuest();
    expect(gs.submitRotate(engine.pieces[0])).toBe(true);
    expect(gs.submitFlip(engine.pieces[0])).toBe(true);
    expect(sent.map((m) => m.type)).toEqual([MSG.ROTATE_REQUEST, MSG.FLIP_REQUEST]);
  });
});

describe('tokens', () => {
  it('needs both the player id and the token to rejoin', async () => {
    const host = await openHost();
    await joinNode(host.room.roomId, { rejoin: { playerId: 'p-1' } });
    await joinNode(host.room.roomId, { rejoin: { reconnectToken: 't' } });
    expect(guestSent(MSG.REJOIN)).toEqual([]);
    expect(guestSent(MSG.AUTH_RESPONSE)).toHaveLength(2);
  });

  it('keeps its token when turned away for another reason', async () => {
    const { feed } = loneGuest();
    sessionStorage.setItem('cj_rejoin_cj-lone', '{"playerId":"p","reconnectToken":"t"}');
    await feed({ type: MSG.JOIN_REJECTED, reason: '部屋が満員です' });
    expect(sessionStorage.getItem('cj_rejoin_cj-lone')).not.toBeNull();
    expect(logged('guest_rejected').at(-1)).toMatchObject({
      category: 'p2p',
      level: 'warn',
      meta: { type: MSG.JOIN_REJECTED, reason: '部屋が満員です' },
    });
  });
});

describe('what it logs', () => {
  it('a malformed transfer, a chunk out of range, and too many pieces', async () => {
    const bad = loneGuest();
    await bad.feed({ type: MSG.FULL_STATE, saveData: 'nope' });
    expect(logged('host_transfer_rejected').at(-1)).toMatchObject({
      category: 'p2p',
      level: 'warn',
      meta: { type: MSG.FULL_STATE, reason: 'invalid_message' },
    });

    const msg = await realFullState();
    const range = loneGuest();
    await range.feed({ ...msg, totalPieceChunks: 2 });
    await range.feed({ type: MSG.FULL_STATE_CHUNK, chunkIndex: 5, pieces: [] });
    expect(logged('host_transfer_rejected').at(-1).meta).toEqual({
      type: MSG.FULL_STATE_CHUNK,
      reason: 'index_out_of_range',
    });

    const many = loneGuest();
    const half = Array.from({ length: NET_LIMITS.MAX_PIECES / 2 + 1 }, () => ({}));
    await many.feed({ ...msg, totalPieceChunks: 3 });
    await many.feed({ type: MSG.FULL_STATE_CHUNK, chunkIndex: 0, pieces: half });
    await many.feed({ type: MSG.FULL_STATE_CHUNK, chunkIndex: 1, pieces: half });
    expect(logged('host_transfer_rejected').at(-1).meta).toEqual({
      type: MSG.FULL_STATE_CHUNK,
      reason: 'too_many_pieces',
    });

    const image = loneGuest();
    await image.feed({
      type: MSG.IMAGE_START,
      totalChunks: 1,
      mimeType: 'image/webp',
      width: 9,
      height: 9,
    });
    await image.feed({ type: MSG.IMAGE_CHUNK, index: 1, data: 'QUJD' });
    expect(logged('host_transfer_rejected').at(-1).meta).toEqual({
      type: MSG.IMAGE_CHUNK,
      reason: 'index_out_of_range',
    });
  });

  it('a board that fails the save checks, with the reason', async () => {
    const msg = await realFullState();
    msg.saveData.pieces[0].x = 'far';
    await loneGuest().feed(msg);
    expect(logged('guest_invalid_full_state').at(-1)).toMatchObject({
      category: 'p2p',
      level: 'warn',
      meta: { reason: expect.any(String) },
    });
  });

  it('a host lost to the heartbeat', async () => {
    const host = await openHost();
    const guest = await joinNode(host.room.roomId);
    host.room.transport.sendTo = () => {};
    host.room.transport.broadcast = () => {};
    for (
      let t = 0;
      t <= MULTIPLAYER_CONFIG.HEARTBEAT_TIMEOUT_MS * 2 && guest.room.role === 'guest';
      t += 1000
    ) {
      vi.advanceTimersByTime(1000);
      // eslint-disable-next-line no-await-in-loop -- pings go out as time passes
      await net.flush();
    }
    expect(logged('host_timed_out').at(-1)).toMatchObject({
      category: 'p2p',
      level: 'warn',
      meta: { reason: 'no_heartbeat' },
    });
  });
});

describe('limits and leftovers', () => {
  it('accepts chunks that add up to exactly the most pieces a board may have', async () => {
    const msg = await realFullState();
    const { feed, room, gs } = loneGuest();
    const half = Array.from({ length: NET_LIMITS.MAX_PIECES / 2 }, () => ({}));
    await feed({ ...msg, totalPieceChunks: 3 });
    await feed({ type: MSG.FULL_STATE_CHUNK, chunkIndex: 0, pieces: half });
    await feed({ type: MSG.FULL_STATE_CHUNK, chunkIndex: 1, pieces: half });
    expect(room.role).toBe('guest');
    expect(gs.pendingFullState.pieceCount).toBe(NET_LIMITS.MAX_PIECES);
  });

  it('a chunk within the announced count is kept', async () => {
    const { feed, room, gs } = loneGuest();
    await feed({
      type: MSG.IMAGE_START,
      totalChunks: 2,
      mimeType: 'image/webp',
      width: 9,
      height: 9,
    });
    await feed({ type: MSG.IMAGE_CHUNK, index: 1, data: 'QUJD' });
    expect(room.role).toBe('guest');
    expect(gs.incomingImage.chunks[1]).toBe('QUJD');
  });

  it('survives an empty message and a ping after the transport is gone', async () => {
    const { feed, room } = loneGuest();
    await expect(feed(null)).resolves.toBeUndefined();
    room.transport = null;
    await expect(feed({ type: MSG.PING })).resolves.toBeUndefined();
  });

  it('stops pinging once it left the room', async () => {
    const host = await openHost();
    const guest = await joinNode(host.room.roomId);
    guest.room.close();
    const pings = guestSent(MSG.PING).length;
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.HEARTBEAT_TIMEOUT_MS * 2);
    expect(guestSent(MSG.PING).length).toBe(pings);
  });

  it('does not ping while it is not a guest, even with the heartbeat running', () => {
    const { room, gs, sent } = loneGuest();
    room.role = 'solo';
    gs.startHeartbeat();
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.HEARTBEAT_INTERVAL_MS * 3);
    room.role = 'guest';
    room.transport = null;
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.HEARTBEAT_INTERVAL_MS * 3);
    gs.liveness.stop();
    expect(sent).toEqual([]);
  });

  it('pings the host while it is a guest with a connection', () => {
    const { gs, sent } = loneGuest();
    gs.startHeartbeat();
    vi.advanceTimersByTime(MULTIPLAYER_CONFIG.HEARTBEAT_INTERVAL_MS);
    gs.liveness.stop();
    expect(sent).toEqual([{ type: MSG.PING }]);
  });

  it('a welcome without a roster leaves an empty one', async () => {
    const host = await openHost();
    await joinNode(host.room.roomId);
    const welcome = { ...net.sentOf(MSG.WELCOME)[0].msg };
    delete welcome.roster;
    const { feed, room } = loneGuest();
    room.roster = [{ id: 'old' }];
    await feed(welcome);
    expect(room.roster).toEqual([]);
  });
});
