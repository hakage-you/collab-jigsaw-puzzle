import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMPLETED_NOTICE } from '../../src/app/ojamaRules.js';
import { MULTIPLAYER_CONFIG, STORAGE_KEYS } from '../../src/config/constants.js';
import { closeAllSessions, joinGuest, startHost, waitForConvergence } from '../helpers/room.js';
import { nextEvent, waitFor } from '../helpers/wait.js';

// Ojama are set off and seen through GameSession only: the host calls runOjama / clearAllOjama,
// and both screens report what happened in events, with the same board. The engine is only read
// (to pick pieces and to compare boards).

const TEST_TIMEOUT = 15000;
const VIEWER = '視聴者A';

let savedSettings = null;

beforeEach(() => {
  savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
});

afterEach(() => {
  closeAllSessions();
  // patchSettings saves to localStorage, which every session in this page reads.
  if (savedSettings === null) localStorage.removeItem(STORAGE_KEYS.SETTINGS);
  else localStorage.setItem(STORAGE_KEYS.SETTINGS, savedSettings);
});

/** Places `count` loose pieces on the host the way a player does (grab, move, drop). */
function placeOnHost(host, count = Infinity) {
  const loose = host.engine.pieces.filter((p) => !p.isLocked).slice(0, count);
  for (const p of loose) {
    expect(host.requestLock(p.groupId).allowed).toBe(true);
    host.moveGroup(p.groupId, p.targetX - p.x, p.targetY - p.y);
    host.submitDrop(p.groupId);
  }
}

const lockedCount = (app) => app.engine.pieces.filter((p) => p.isLocked).length;
const fakeCount = (app) => app.engine.fakePieces.length;

async function hostAndGuest(ojama = {}) {
  const { host, roomId } = await startHost();
  host.patchSettings({ ojama });
  const guest = await joinGuest(roomId, { name: 'A' });
  return { host, guest };
}

describe('ojama through GameSession', () => {
  it(
    'the host knocks pieces off: both screens show it and the boards agree',
    async () => {
      const { host, guest } = await hostAndGuest({ dropCount: 2 });
      placeOnHost(host, 4);
      await waitForConvergence([host, guest]);
      expect(lockedCount(guest)).toBe(4);

      const triggered = nextEvent(host, 'ojamaTriggered');
      const effect = nextEvent(guest, 'ojamaDropEffect', { timeout: 5000 });
      const notice = nextEvent(guest, 'ojamaNotice', { timeout: 5000 });
      expect(host.runOjama('drop', VIEWER)).toBe(true);

      const fired = await triggered;
      expect(fired).toMatchObject({ type: 'drop', author: VIEWER });
      expect(fired.pieces).toHaveLength(2);
      // The guests get the notice without the viewer's name.
      expect(await notice).toEqual({ kind: 'drop', text: fired.text });
      expect(fired.text).not.toContain(VIEWER);
      expect((await effect).pieces.map((p) => p.id).sort()).toEqual(
        fired.pieces.map((p) => p.id).sort(),
      );
      await waitForConvergence([host, guest]);
      expect(lockedCount(guest)).toBe(2);
    },
    TEST_TIMEOUT,
  );

  it(
    'with nothing placed yet, a drop does not go off and says why',
    async () => {
      const { host } = await hostAndGuest();
      const toast = nextEvent(host, 'toast');
      expect(host.runOjama('drop')).toBe(false);
      expect((await toast).message).toBe('台紙にはまっているピースがまだありません');
    },
    TEST_TIMEOUT,
  );

  it(
    'the host turns loose pieces: the guest plays the prank effect and the boards agree',
    async () => {
      const { host, guest } = await hostAndGuest({ prankCount: 3 });
      const effect = nextEvent(guest, 'ojamaPrankEffect', { timeout: 5000 });
      const triggered = nextEvent(host, 'ojamaTriggered');
      expect(host.runOjama('prank')).toBe(true);

      expect((await triggered).type).toBe('prank');
      expect((await effect).pieces.length).toBeGreaterThan(0);
      await waitForConvergence([host, guest]);
    },
    TEST_TIMEOUT,
  );

  it(
    'fake pieces reach the guest and vanish from both screens when their time is up',
    async () => {
      const { host, guest } = await hostAndGuest({ fakeAddCount: 3, fakeDuration: 1 });
      const notice = nextEvent(guest, 'ojamaNotice', { timeout: 5000 });
      expect(host.runOjama('fake', VIEWER)).toBe(true);

      expect((await notice).kind).toBe('fake');
      await waitFor(() => fakeCount(guest) === 3 && fakeCount(host) === 3, {
        message: 'fake pieces on both screens',
      });
      await waitFor(() => fakeCount(guest) === 0 && fakeCount(host) === 0, {
        timeout: 5000,
        message: 'fake pieces vanished on both screens',
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'a visual ojama is shown on the guest with the same kind and time',
    async () => {
      const { host, guest } = await hostAndGuest({ visualType: 'sepia', visualDuration: 5 });
      const triggered = nextEvent(host, 'ojamaTriggered');
      const remote = nextEvent(guest, 'remoteVisualOjama', { timeout: 5000 });
      expect(host.runOjama('visual', VIEWER)).toBe(true);

      expect(await triggered).toEqual({
        type: 'visual',
        author: VIEWER,
        visualType: 'sepia',
        duration: 5,
      });
      expect(await remote).toEqual({ visualType: 'sepia', duration: 5 });
    },
    TEST_TIMEOUT,
  );

  it(
    'the giant superchat reaches the guest, and a guest hit wears down the shared HP',
    async () => {
      const { host, guest } = await hostAndGuest();
      const maxHp =
        MULTIPLAYER_CONFIG.SUPERCHAT_BASE_HP + MULTIPLAYER_CONFIG.SUPERCHAT_HP_PER_GUEST;
      const triggered = nextEvent(host, 'ojamaTriggered');
      const shown = nextEvent(guest, 'remoteSuperchat', { timeout: 5000 });
      expect(host.runOjama('superchat', VIEWER, 'ブロック！')).toBe(true);

      expect((await triggered).superchat).toMatchObject({
        maxHp,
        author: VIEWER,
        message: 'ブロック！',
      });
      expect(await shown).toMatchObject({ maxHp, author: VIEWER, message: 'ブロック！' });

      const hostHp = nextEvent(host, 'remoteSuperchatHp', { timeout: 5000 });
      const guestHp = nextEvent(guest, 'remoteSuperchatHp', { timeout: 5000 });
      guest.hitSuperchat();
      expect(await hostHp).toEqual({ hp: maxHp - 1, maxHp });
      expect(await guestHp).toEqual({ hp: maxHp - 1, maxHp });
      expect(host.hitSuperchat()).toBe(maxHp - 2);
    },
    TEST_TIMEOUT,
  );

  it(
    'heavy pieces start and end on both screens',
    async () => {
      const { host, guest } = await hostAndGuest({ heavyDuration: 60 });
      const hostHeavy = nextEvent(host, 'heavyChange');
      const guestHeavy = nextEvent(guest, 'heavyChange', { timeout: 5000 });
      const guestStart = nextEvent(guest, 'timedOjamaChange', { timeout: 5000 });
      expect(host.runOjama('heavy', VIEWER)).toBe(true);

      const { level } = await hostHeavy;
      expect(level).toBeTruthy();
      expect(await guestHeavy).toEqual({ level });
      expect(await guestStart).toEqual({
        kind: 'heavy',
        active: true,
        announce: true,
        author: null,
      });

      const guestEnd = nextEvent(guest, 'timedOjamaChange', { timeout: 5000 });
      const guestLight = nextEvent(guest, 'heavyChange', { timeout: 5000 });
      host.clearAllOjama();
      expect(await guestEnd).toMatchObject({ kind: 'heavy', active: false });
      expect(await guestLight).toEqual({ level: null });
    },
    TEST_TIMEOUT,
  );

  it(
    'while runaway lasts a grabbed piece hops away on the guest; after it ends a grab holds',
    async () => {
      const { host, guest } = await hostAndGuest({ runawayDuration: 60 });
      const guestStart = nextEvent(guest, 'timedOjamaChange', { timeout: 5000 });
      expect(host.runOjama('runaway')).toBe(true);
      expect(await guestStart).toMatchObject({ kind: 'runaway', active: true });

      const piece = guest.engine.pieces.find((p) => !p.isLocked);
      const hopped = nextEvent(guest, 'pieceHop', { timeout: 5000 });
      guest.requestLock(piece.groupId, { x: piece.x - 10, y: piece.y });
      expect((await hopped).groupId).toBe(piece.groupId);
      await waitForConvergence([host, guest]);

      host.clearAllOjama();
      const other = host.engine.pieces.find((p) => !p.isLocked && p.groupId !== piece.groupId);
      expect(host.requestLock(other.groupId)).toMatchObject({ allowed: true });
    },
    TEST_TIMEOUT,
  );

  it(
    '"すべて消す" ends the visual ojama and the fake pieces on the guest too',
    async () => {
      const { host, guest } = await hostAndGuest({
        visualType: 'hue',
        visualDuration: 30,
        fakeAddCount: 2,
        fakeDuration: 0,
      });
      expect(host.runOjama('visual')).toBe(true);
      expect(host.runOjama('fake')).toBe(true);
      await waitFor(() => fakeCount(guest) === 2, { message: 'fake pieces on the guest' });

      const cleared = nextEvent(host, 'ojamaCleared');
      const visualClear = nextEvent(guest, 'remoteVisualClear', { timeout: 5000 });
      host.clearAllOjama();
      await cleared;
      await visualClear;
      expect(fakeCount(host)).toBe(0);
      await waitFor(() => fakeCount(guest) === 0, { message: 'fake pieces cleared on the guest' });
    },
    TEST_TIMEOUT,
  );

  it(
    'once the puzzle is done no ojama goes off, and the reason is said',
    async () => {
      const { host } = await hostAndGuest();
      placeOnHost(host);
      await waitFor(() => host.engine.isCompleted(), { message: 'puzzle completed' });

      const toast = nextEvent(host, 'toast');
      const fired = [];
      host.on('ojamaTriggered', (e) => fired.push(e));
      expect(host.runOjama('visual')).toBe(false);
      expect((await toast).message).toBe(COMPLETED_NOTICE);
      expect(host.runOjama('superchat')).toBe(false);
      expect(fired).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});

describe('host commands for the room through GameSession', () => {
  it(
    'kickGuest sends the guest out of the room',
    async () => {
      const { host, guest } = await hostAndGuest();
      const rejected = nextEvent(guest, 'authRejected', { timeout: 5000 });
      host.kickGuest(guest.room.myPlayerId);
      expect((await rejected).reason).toBe('ホストにより退出されました');
    },
    TEST_TIMEOUT,
  );

  it(
    "setHostName changes the host's name in the guest's roster",
    async () => {
      const { host, guest } = await hostAndGuest();
      host.setHostName('配信者');
      expect(host.getSettings().playerName).toBe('配信者');
      await waitFor(() => guest.room.roster.find((m) => m.role === 'host')?.name === '配信者', {
        message: "the guest sees the host's new name",
      });
    },
    TEST_TIMEOUT,
  );
});
