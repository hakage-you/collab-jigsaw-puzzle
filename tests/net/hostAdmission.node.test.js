import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER_CONFIG } from '../../src/config/constants.js';
import { admitNewGuest, handleAuthResponse, handleRejoin } from '../../src/net/hostAdmission.js';
import { MSG, computeChallengeHash } from '../../src/net/protocol.js';
import { clearDiagnostics, getDiagnosticsState } from '../../src/services/diagnostics.js';
import { createFakeHost } from '../helpers/fakeHost.js';

// The host letting guests in: passcode answers, knocks, capacity, rejoining with a token and
// taking a seat back from a stale connection.

beforeEach(() => {
  clearDiagnostics();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const NONCE = 'nonce-1';

/** A fake host whose connection `c1` is waiting to answer the passcode challenge. */
function pendingHost(options = {}) {
  const host = createFakeHost(options);
  host.session.passcode = options.passcode ?? 'secret';
  host.session.pendingAuth.set('c1', { nonce: NONCE });
  return host;
}

const answer = async (host, displayName, passcode = 'secret') =>
  handleAuthResponse(host.session, 'c1', {
    hash: await computeChallengeHash(NONCE, passcode),
    displayName,
  });

describe('handleAuthResponse', () => {
  it('lets a guest with the right passcode in, with a cleaned-up name', async () => {
    const host = pendingHost();
    await answer(host, '  とても長いお名前をここに書いてみましたよ  ');
    const [guest] = host.session.guests.values();
    expect(guest.name).toBe('とても長いお名前をここに書いてみましたよ'.slice(0, 20));
    expect(host.session.pendingAuth.has('c1')).toBe(false);
    expect(host.calls.welcomes).toEqual([guest.id]);
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
  ])('calls a guest whose name is %s ゲスト', async (_, name) => {
    const host = pendingHost();
    await answer(host, name);
    expect([...host.session.guests.values()][0].name).toBe('ゲスト');
  });

  it('turns away a wrong passcode, logs it and hangs up shortly after', async () => {
    const host = pendingHost();
    await answer(host, 'A', 'wrong');
    expect(host.sent).toEqual([['c1', { type: MSG.AUTH_ERROR, reason: '合言葉が一致しません' }]]);
    expect(host.session.pendingAuth.has('c1')).toBe(false);
    expect(host.session.guests.size).toBe(0);
    expect(getDiagnosticsState().entries.at(-1)).toMatchObject({
      message: 'host_auth_failed',
      meta: { reason: 'passcode_mismatch' },
    });
    expect(host.disconnected).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(host.disconnected).toEqual(['c1']);
  });

  it('turns a guest away when the room is full', async () => {
    const host = pendingHost({ capacity: 2 });
    host.addGuest('g1');
    await answer(host, 'B');
    expect(host.sent).toEqual([['c1', { type: MSG.AUTH_ERROR, reason: '部屋が満員です' }]]);
    expect(host.session.pendingAuth.has('c1')).toBe(false);
    vi.advanceTimersByTime(100);
    expect(host.disconnected).toEqual(['c1']);
  });

  it('makes a guest knock when the host approves each one', async () => {
    const host = pendingHost();
    host.session.requireApproval = true;
    await answer(host, 'C');
    expect(host.sent).toEqual([['c1', { type: MSG.KNOCK_PENDING }]]);
    expect(host.session.pendingKnocks.get('c1')).toEqual({ connId: 'c1', displayName: 'C' });
    expect(host.calls.knocks).toEqual([{ connId: 'c1', displayName: 'C' }]);
    expect(host.session.guests.size).toBe(0);
  });

  it('ignores an answer from a connection that was not asked', async () => {
    const host = createFakeHost();
    await handleAuthResponse(host.session, 'c9', { hash: 'x' });
    expect([host.sent, host.session.guests.size]).toEqual([[], 0]);
  });

  it('accepts the empty passcode of an open room', async () => {
    const host = pendingHost({ passcode: '' });
    await answer(host, 'D', '');
    expect(host.session.guests.size).toBe(1);
  });
});

describe('handleRejoin', () => {
  const rejoin = (over = {}) => ({ playerId: 'g1', reconnectToken: 'token-g1', ...over });

  it('gives an offline guest their seat back on a new connection', () => {
    const host = createFakeHost();
    const guest = host.addGuest('g1', { online: false, connId: null, name: 'Old' });
    host.session.pendingAuth.set('c2', {});
    handleRejoin(host.session, 'c2', rejoin({ displayName: ' New ' }));
    expect(guest).toMatchObject({ connId: 'c2', online: true, name: 'New' });
    expect(host.session.connToPlayer.get('c2')).toBe('g1');
    expect(host.session.pendingAuth.has('c2')).toBe(false);
    expect(host.calls.welcomes).toEqual(['g1']);
    expect(host.calls.roster).toBe(1);
  });

  it('keeps the old name when the new one is blank or missing', () => {
    const host = createFakeHost();
    const guest = host.addGuest('g1', { online: false, connId: null, name: 'Old' });
    handleRejoin(host.session, 'c2', rejoin({ displayName: '   ' }));
    expect(guest.name).toBe('Old');
    guest.online = false;
    handleRejoin(host.session, 'c3', rejoin());
    expect(guest.name).toBe('Old');
  });

  it('takes the seat over from a stale connection of the same guest', () => {
    const host = createFakeHost();
    const guest = host.addGuest('g1', { connId: 'c-old' });
    handleRejoin(host.session, 'c-new', rejoin());
    expect(host.calls.released).toEqual(['g1']);
    expect(host.session.connToPlayer.has('c-old')).toBe(false);
    expect(host.session.connToPlayer.get('c-new')).toBe('g1');
    expect(host.sent[0]).toEqual([
      'c-old',
      { type: MSG.KICKED, reason: expect.stringContaining('別の接続から再参加') },
    ]);
    expect(getDiagnosticsState().entries.at(-1).message).toBe('guest_seat_taken_over');
    expect(guest).toMatchObject({ connId: 'c-new', online: true });
    vi.advanceTimersByTime(100);
    expect(host.disconnected).toEqual(['c-old']);
  });

  it('takes over an online seat without a connection quietly', () => {
    const host = createFakeHost();
    host.addGuest('g1', { connId: null });
    handleRejoin(host.session, 'c-new', rejoin());
    expect(host.calls.released).toEqual(['g1']);
    expect(host.sentOf(MSG.KICKED)).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(host.disconnected).toEqual([]);
  });

  it.each([
    ['an unknown player', rejoin({ playerId: 'nobody' })],
    ['a wrong token', rejoin({ reconnectToken: 'stolen' })],
  ])('turns away %s and hangs up', (_, msg) => {
    const host = createFakeHost();
    host.addGuest('g1', { online: false, connId: null });
    handleRejoin(host.session, 'c2', msg);
    expect(host.sent).toEqual([
      ['c2', { type: MSG.AUTH_ERROR, reason: expect.stringContaining('再接続トークン') }],
    ]);
    expect(host.calls.welcomes).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(host.disconnected).toEqual(['c2']);
  });

  it('turns an offline guest away when the room filled up meanwhile', () => {
    const host = createFakeHost({ capacity: 2 });
    host.addGuest('g1', { online: false, connId: null });
    host.addGuest('g2');
    handleRejoin(host.session, 'c2', rejoin());
    expect(host.sent).toEqual([['c2', { type: MSG.AUTH_ERROR, reason: '部屋が満員です' }]]);
    expect(host.session.guests.get('g1').online).toBe(false);
  });
});

describe('admitNewGuest', () => {
  it('creates a guest with an id, a token and the next player colour', () => {
    const host = createFakeHost();
    host.addGuest('g0');
    admitNewGuest(host.session, 'c5', 'Eve');
    const guest = [...host.session.guests.values()].at(-1);
    expect(guest).toMatchObject({
      connId: 'c5',
      name: 'Eve',
      role: 'guest',
      contrib: 0,
      online: true,
      color: MULTIPLAYER_CONFIG.PLAYER_COLORS[2],
    });
    expect(guest.id).toMatch(/^p-[0-9a-f]{8}$/);
    expect(guest.reconnectToken).toMatch(/^[0-9a-f]{16,}$/);
    expect(host.session.connToPlayer.get('c5')).toBe(guest.id);
    expect(host.calls.welcomes).toEqual([guest.id]);
    expect(host.calls.roster).toBe(1);
  });

  it('wraps around the player colours', () => {
    const host = createFakeHost();
    const colors = MULTIPLAYER_CONFIG.PLAYER_COLORS;
    for (let i = 0; i < colors.length - 1; i++) host.addGuest(`g${i}`);
    admitNewGuest(host.session, 'c9', 'Last');
    expect([...host.session.guests.values()].at(-1).color).toBe(colors[0]);
  });

  it('gives a returning name its saved contribution and colour from the save', () => {
    const host = createFakeHost();
    host.room.savedGuests.set('Ann', { contrib: 7, color: '#00ff00' });
    admitNewGuest(host.session, 'c5', 'Ann');
    expect([...host.session.guests.values()][0]).toMatchObject({ contrib: 7, color: '#00ff00' });
  });

  it('puts a guest with the name of an offline guest back in that seat with a new token', () => {
    const host = createFakeHost();
    const old = host.addGuest('g1', { online: false, connId: null, name: 'Bob' });
    admitNewGuest(host.session, 'c6', 'Bob');
    expect(host.session.guests.size).toBe(1);
    expect(old).toMatchObject({ connId: 'c6', online: true });
    expect(old.reconnectToken).not.toBe('token-g1');
    expect(host.session.connToPlayer.get('c6')).toBe('g1');
    expect(host.calls.welcomes).toEqual(['g1']);
  });

  it('does not reuse the seat of an online guest with the same name', () => {
    const host = createFakeHost();
    host.addGuest('g1', { name: 'Bob' });
    admitNewGuest(host.session, 'c6', 'Bob');
    expect(host.session.guests.size).toBe(2);
  });
});
