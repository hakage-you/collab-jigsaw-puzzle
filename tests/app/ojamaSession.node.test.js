import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OJAMA_CONFIG, YOUTUBE_CONFIG } from '../../src/config/constants.js';
import { OjamaSession } from '../../src/app/ojamaSession.js';
import { COMPLETED_NOTICE } from '../../src/app/ojamaRules.js';
import { dropNearTarget, solveAll } from '../helpers/coreEngine.js';
import { createFakeAppSession } from '../helpers/fakeAppSession.js';

// The ojama use cases on the host (or solo): what each one does to the board, what it tells the
// UI ('ojamaTriggered', effects, toasts) and what it sends to the guests.

function setup(options = {}) {
  const fake = createFakeAppSession(options);
  const ojama = new OjamaSession(fake.session);
  return { ...fake, ojama, engine: fake.session.engine };
}

const toasts = (fake) => fake.eventsOf('toast').map((t) => t.message);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a finished puzzle', () => {
  it.each(['drop', 'prank', 'fake', 'visual', 'ghost', 'superchat', 'heavy', 'runaway'])(
    'refuses %s with a notice and sends nothing',
    (action) => {
      const fake = setup();
      solveAll(fake.engine);
      expect(fake.ojama.run(action)).toBe(false);
      expect(toasts(fake)).toEqual([COMPLETED_NOTICE]);
      expect(fake.sent).toEqual([]);
      expect(fake.eventsOf('ojamaTriggered')).toEqual([]);
    },
  );
});

describe('drop', () => {
  it('knocks off the set number of placed pieces and tells everyone', () => {
    const fake = setup({ ojama: { dropCount: 2 } });
    for (const p of fake.engine.pieces.slice(0, 3)) dropNearTarget(fake.engine, p);
    expect(fake.ojama.run('drop', '視聴者')).toBe(true);
    const [effect] = fake.eventsOf('ojamaDropEffect');
    expect(effect.pieces).toHaveLength(2);
    const text = 'ピースが2個、ポロッと外れてしまった！';
    expect(fake.eventsOf('ojamaTriggered')).toEqual([
      { type: 'drop', author: '視聴者', text, pieces: effect.pieces },
    ]);
    expect(fake.sentOf('physical')).toEqual([[text, effect.pieces, 'ojama_drop', 'drop']]);
    expect(fake.eventsOf('hudUpdate')).toHaveLength(1);
    expect(fake.eventsOf('renderNeeded')).toHaveLength(1);
  });

  it('drops the default number when none is set, and at least one', () => {
    const fake = setup({ ojama: { dropCount: 0 } });
    for (const p of fake.engine.pieces) dropNearTarget(fake.engine, p);
    fake.engine.pieces.at(-1).isLocked = false;
    fake.ojama.drop();
    expect(fake.eventsOf('ojamaDropEffect')[0].pieces).toHaveLength(
      OJAMA_CONFIG.DEFAULT_DROP_COUNT,
    );
  });

  it('says so when nothing is placed yet', () => {
    const fake = setup();
    expect(fake.ojama.drop()).toBe(false);
    expect(toasts(fake)).toEqual(['台紙にはまっているピースがまだありません']);
    expect(fake.sent).toEqual([]);
  });
});

describe('prank', () => {
  it('turns loose pieces nobody holds, with how they were before', () => {
    const fake = setup({ ojama: { prankCount: 2 } });
    const held = fake.engine.pieces[0];
    fake.session.room.lockedGroupIds = new Set([held.groupId]);
    const before = held.rotation;
    expect(fake.ojama.prank('A')).toBe(true);
    const [effect] = fake.eventsOf('ojamaPrankEffect');
    expect(effect.pieces).toHaveLength(2);
    expect(effect.pieces).not.toContain(held);
    expect(effect.before.get(held.id)).toEqual({ rotation: before, isFlipped: held.isFlipped });
    const text = 'ピース2個がくるりと回転した！';
    expect(fake.sentOf('physical')).toEqual([[text, effect.pieces, 'ojama_prank', 'prank']]);
    expect(fake.eventsOf('ojamaTriggered')[0]).toMatchObject({ type: 'prank', author: 'A', text });
  });

  it('uses the default count, and says so when nothing can move', () => {
    const fake = setup();
    fake.ojama.prank();
    expect(fake.eventsOf('ojamaPrankEffect')[0].pieces).toHaveLength(
      OJAMA_CONFIG.PRANK_DEFAULT_COUNT,
    );
    const stuck = setup();
    stuck.session.room.lockedGroupIds = new Set(stuck.engine.pieces.map((p) => p.groupId));
    expect(stuck.ojama.prank()).toBe(false);
    expect(toasts(stuck)).toEqual(['動かせる未配置ピースがありません']);
  });
});

describe('fake pieces', () => {
  it('mixes in timed fakes that vanish on their own, telling the guests', () => {
    const fake = setup({ ojama: { fakeDuration: 2, fakeAddCount: 2, fakeMaxCount: 5 } });
    expect(fake.ojama.fake('B')).toBe(true);
    const text = 'ニセモノのピースが2個まぎれ込んだ！（2秒で消滅）';
    expect(fake.sentOf('fakePieces')).toEqual([[text]]);
    expect(fake.eventsOf('ojamaTriggered')[0]).toMatchObject({ type: 'fake', author: 'B', text });
    vi.advanceTimersByTime(1000);
    expect(fake.engine.fakePieces).toHaveLength(2);
    vi.advanceTimersByTime(2000);
    expect(fake.engine.fakePieces).toEqual([]);
    expect(fake.sentOf('fakePieces')).toHaveLength(2);
    expect(fake.ojama.fakeCleanupTimerId).toBeNull();
  });

  it('keeps fakes without a duration, up to the cap, with no timer', () => {
    const fake = setup({ ojama: { fakeDuration: 0, fakeMaxCount: 4 } });
    fake.ojama.fake();
    expect(fake.eventsOf('ojamaTriggered')[0].text).toBe(
      `ニセモノのピースが${OJAMA_CONFIG.FAKE_PIECE_ADD_COUNT}個まぎれ込んだ！（消失なし・上限4個）`,
    );
    expect(fake.ojama.fakeCleanupTimerId).toBeNull();
  });

  it('does not send the cleanup on a guest screen', () => {
    const fake = setup({ role: 'solo', ojama: { fakeDuration: 1 } });
    fake.ojama.fake();
    vi.advanceTimersByTime(2000);
    expect(fake.engine.fakePieces).toEqual([]);
    expect(fake.sentOf('fakePieces')).toHaveLength(1);
  });

  it('fails without pieces to copy', () => {
    const fake = setup();
    fake.engine.pieces = [];
    expect(fake.ojama.fake()).toBe(false);
    expect(fake.sent).toEqual([]);
  });
});

describe('visual ojama', () => {
  it('uses the set type and duration, counts it and sends it', () => {
    const fake = setup({ ojama: { visualType: 'sepia', visualDuration: 9 } });
    expect(fake.ojama.run('visual', 'C')).toBe(true);
    expect(fake.engine.stats.ojamaBreakdown.visual).toBe(1);
    expect(fake.sentOf('visual')).toEqual([['sepia', 9]]);
    expect(fake.eventsOf('ojamaTriggered')).toEqual([
      { type: 'visual', author: 'C', visualType: 'sepia', duration: 9 },
    ]);
    expect(fake.eventsOf('hudUpdate')).toHaveLength(1);
  });

  it('picks a type at random for "random" or an unknown type', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const fake = setup({ ojama: { visualType: 'random', visualDuration: 4 } });
    fake.ojama.visual();
    expect(fake.sentOf('visual')).toEqual([['mist', 4]]);
  });

  it('shows ghost pieces for their own duration, or the visual one', () => {
    const fake = setup({ ojama: { visualType: 'hue', visualDuration: 4, ghostDuration: 7 } });
    fake.ojama.run('ghost');
    expect(fake.sentOf('visual')).toEqual([['ghost', 7]]);
    expect(fake.eventsOf('ojamaTriggered')[0].type).toBe('ghost');
    const plain = setup({ ojama: { visualDuration: 4 } });
    plain.ojama.run('ghost');
    expect(plain.sentOf('visual')).toEqual([['ghost', 4]]);
  });

  it('does not take ghost from the settings for a plain visual ojama', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fake = setup({ ojama: { visualType: 'ghost', visualDuration: 4 } });
    fake.ojama.visual();
    expect(fake.sentOf('visual')).toEqual([['grayscale', 4]]);
  });
});

describe('superchat', () => {
  it('sends a card with the room hit points and the given texts', () => {
    const fake = setup({ ojama: { superchatDuration: 20 } });
    fake.ojama.run('superchat', 'D', 'がんばれ', { amountDisplay: '¥500' });
    const card = {
      maxHp: 15,
      duration: 20,
      author: 'D',
      message: 'がんばれ',
      amountDisplay: '¥500',
    };
    expect(fake.sentOf('superchat')).toEqual([[card]]);
    expect(fake.eventsOf('ojamaTriggered')).toEqual([
      { type: 'superchat', author: 'D', superchat: card },
    ]);
    expect(fake.engine.stats.ojamaBreakdown.superchat).toBe(1);
  });

  it('fills in a sample card', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fake = setup();
    fake.ojama.superchat();
    expect(fake.sentOf('superchat')[0][0]).toEqual({
      maxHp: 15,
      duration: OJAMA_CONFIG.DEFAULT_SUPERCHAT_DURATION_SEC,
      author: '視聴者（お邪魔枠）',
      message: '完成させるな！中央をブロック中',
      amountDisplay: '¥10,000',
    });
    expect(fake.eventsOf('ojamaTriggered')[0].author).toBeNull();
  });

  it.each([
    [1, 15],
    [3, 15 + 2 * YOUTUBE_CONFIG.SUPERCHAT_TIER_HP_BONUS],
    [99, 15 + 6 * YOUTUBE_CONFIG.SUPERCHAT_TIER_HP_BONUS],
  ])('adds hit points for tier %i when asked to', (tier, maxHp) => {
    const fake = setup();
    fake.ojama.superchat('x', 'y', { scaleHpWithTier: true, tier });
    expect(fake.sentOf('superchat')[0][0].maxHp).toBe(maxHp);
  });

  it('ignores the tier unless asked to', () => {
    const fake = setup();
    fake.ojama.superchat('x', 'y', { tier: 5 });
    expect(fake.sentOf('superchat')[0][0].maxHp).toBe(15);
  });
});

describe('timed, random and others', () => {
  it.each(['heavy', 'runaway'])('starts %s through the timer', (kind) => {
    const fake = setup();
    expect(fake.ojama.run(kind, 'E')).toBe(true);
    expect(fake.sentOf('timed')).toHaveLength(1);
    expect(fake.eventsOf('ojamaTriggered').at(-1)).toEqual({ type: kind, author: 'E' });
  });

  it('runs the one type in the random pool, or says there is none', () => {
    const only = (type) => Object.fromEntries(OJAMA_CONFIG.TYPES.map((t) => [t, t === type]));
    const fake = setup({ ojama: { randomPool: only('prank') } });
    expect(fake.ojama.run('random', 'F')).toBe(true);
    expect(fake.eventsOf('ojamaTriggered')[0]).toMatchObject({ type: 'prank', author: 'F' });

    const none = setup({ ojama: { randomPool: only('drop') } });
    expect(none.ojama.random()).toBe(false);
    expect(toasts(none)).toEqual(['ランダム発動の対象がありません']);
  });

  it('rejects an unknown action', () => {
    expect(setup().ojama.run('explode')).toBe(false);
  });

  it('passes a guest the host state of a timed ojama', () => {
    const fake = setup({ role: 'guest' });
    fake.ojama.mirrorTimed({ kind: 'heavy', remaining: 5, level: 'strong' });
    expect(fake.eventsOf('heavyChange')).toEqual([{ level: 'strong' }]);
  });
});

describe('clearing', () => {
  it('ends every ojama on the host and tells the guests', () => {
    const fake = setup({ ojama: { fakeDuration: 30 } });
    fake.ojama.fake();
    fake.ojama.startTimed('heavy');
    fake.sent.length = 0;
    fake.ojama.clearAll();
    expect(fake.engine.fakePieces).toEqual([]);
    expect(fake.ojama.fakeCleanupTimerId).toBeNull();
    expect(fake.sent.map(([what]) => what)).toEqual(['visualClear', 'timed', 'fakePieces']);
    expect(fake.eventsOf('ojamaCleared')).toHaveLength(1);
    expect(fake.events.at(-1)).toEqual(['hudUpdate', undefined]);
  });

  it('sends nothing off the host and renders only when fakes went', () => {
    const fake = setup({ role: 'solo' });
    fake.ojama.clearAll();
    expect(fake.sent).toEqual([]);
    expect(fake.eventsOf('renderNeeded')).toEqual([]);
  });

  it.each(['puzzleComplete', 'puzzleReset'])('drops fake pieces quietly on %s', (event) => {
    const fake = setup({ ojama: { fakeDuration: 30 } });
    fake.ojama.fake();
    fake.sent.length = 0;
    const renders = fake.eventsOf('renderNeeded').length;
    fake.fire(event);
    expect(fake.engine.fakePieces).toEqual([]);
    expect(fake.ojama.fakeCleanupTimerId).toBeNull();
    expect(fake.sentOf('fakePieces')).toEqual([]);
    expect(fake.eventsOf('renderNeeded')).toHaveLength(renders + 1);
    fake.fire(event);
    expect(fake.eventsOf('renderNeeded')).toHaveLength(renders + 1);
  });
});
