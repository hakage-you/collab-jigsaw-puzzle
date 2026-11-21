import { describe, expect, it } from 'vitest';
import { OJAMA_CONFIG } from '../../src/config/constants.js';
import {
  COMPLETED_NOTICE,
  buildTriggerTable,
  decideCommentOjama,
  findTrigger,
  parseTriggerWords,
} from '../../src/app/ojamaRules.js';

const KEYWORDS = {
  drop: '!drop',
  ghost: '!ghost',
  fake: '!fake',
  visual: '!color',
  prank: '!spin',
  superchat: '!sp',
};

function settings({ threshold = 5, cooldownSec = 0, triggers = KEYWORDS } = {}) {
  return { ojama: { commentThreshold: threshold, cooldownSec, triggers } };
}

const NOW = 100000;

function decide(text, opts = {}) {
  const { words, threshold, cooldownSec, state, isCompleted = false, now = NOW } = opts;
  return decideCommentOjama({
    text,
    settings: settings({ threshold, cooldownSec, triggers: words }),
    now,
    state: state ?? { commentCounter: 0, lastOjamaTime: 0 },
    isCompleted,
  });
}

describe('parseTriggerWords', () => {
  it('splits, trims, lowercases, drops empties and sorts longest first', () => {
    expect(parseTriggerWords(' Sp , ,!SPIN,,drop ')).toEqual(['!spin', 'drop', 'sp']);
  });

  it('returns an empty list for an empty or missing setting', () => {
    expect(parseTriggerWords('')).toEqual([]);
    expect(parseTriggerWords(' , ')).toEqual([]);
    expect(parseTriggerWords(undefined)).toEqual([]);
  });
});

describe('trigger table', () => {
  it('lists every word with its type, longest first', () => {
    const table = buildTriggerTable({ prank: '!spin, 回', superchat: '!sp' });
    expect(table).toEqual([
      { word: '!spin', action: 'prank' },
      { word: '!sp', action: 'superchat' },
      { word: '回', action: 'prank' },
    ]);
    expect(findTrigger(table, 'go !spin')).toEqual({ word: '!spin', action: 'prank' });
    expect(findTrigger(table, 'nothing')).toBeNull();
  });

  it('breaks a tie between words of the same length by the type order', () => {
    const table = buildTriggerTable({ runaway: 'ab', drop: 'cd' });
    expect(findTrigger(table, 'ab cd').action).toBe('drop');
  });
});

describe('decideCommentOjama: keyword actions', () => {
  it.each([
    ['!drop', 'drop'],
    ['!ghost', 'ghost'],
    ['!fake', 'fake'],
    ['!color', 'visual'],
    ['!spin', 'prank'],
    ['!sp', 'superchat'],
  ])('text %s -> %s', (text, action) => {
    const r = decide(text, { words: KEYWORDS, cooldownSec: 0 });
    expect(r.action).toBe(action);
    expect(r.matchedWord).toBe(text);
    expect(r.notice).toBeNull();
  });

  it.each([
    ['ピース落として', 'drop'],
    ['色かえて', 'visual'],
    ['透明にしよう', 'ghost'],
    ['回れ', 'prank'],
    ['スパチャ', 'superchat'],
    ['偽物まぜて', 'fake'],
    ['重くなれ', 'heavy'],
    ['逃げろ', 'runaway'],
    ['お邪魔します', 'random'],
    ['!heavy', 'heavy'],
    ['!run', 'runaway'],
  ])('the default words fire on their own: %s -> %s', (text, action) => {
    expect(decide(text, { words: OJAMA_CONFIG.DEFAULT_TRIGGERS }).action).toBe(action);
  });

  it('the longer word wins when a comment has two: !sp and 落と', () => {
    expect(decide('!sp 落と', { words: OJAMA_CONFIG.DEFAULT_TRIGGERS }).action).toBe('superchat');
  });

  it('longest trigger word wins: !spin beats !sp', () => {
    expect(decide('!spin', { words: KEYWORDS }).action).toBe('prank');
    expect(decide('!sp', { words: KEYWORDS }).action).toBe('superchat');
  });

  it('matching is case-insensitive', () => {
    const r = decide('!DrOp please', { words: { drop: 'DROP' } });
    expect(r.action).toBe('drop');
    expect(r.matchedWord).toBe('drop');
  });

  it('a matched keyword resets nothing: counter increments and lastOjamaTime is set to now', () => {
    const r = decide('!drop', {
      words: KEYWORDS,
      state: { commentCounter: 2, lastOjamaTime: 0 },
    });
    expect(r.nextState).toEqual({ commentCounter: 3, lastOjamaTime: NOW });
  });
});

describe('decideCommentOjama: threshold', () => {
  it('no match below the threshold gives null and counter+1', () => {
    const r = decide('hi', {
      words: KEYWORDS,
      threshold: 5,
      state: { commentCounter: 1, lastOjamaTime: 0 },
    });
    expect(r).toEqual({
      action: null,
      matchedWord: null,
      nextState: { commentCounter: 2, lastOjamaTime: 0 },
      notice: null,
    });
  });

  it('reaching the threshold gives random and resets the counter', () => {
    const r = decide('hi', {
      words: KEYWORDS,
      threshold: 5,
      state: { commentCounter: 4, lastOjamaTime: 0 },
    });
    expect(r.action).toBe('random');
    expect(r.nextState).toEqual({ commentCounter: 0, lastOjamaTime: NOW });
  });

  it('reaching the threshold during cooldown gives null but still resets the counter', () => {
    const r = decide('hi', {
      words: KEYWORDS,
      threshold: 5,
      cooldownSec: 10,
      state: { commentCounter: 4, lastOjamaTime: NOW - 1000 },
    });
    expect(r.action).toBeNull();
    expect(r.nextState).toEqual({ commentCounter: 0, lastOjamaTime: NOW - 1000 });
  });

  it('cooldown boundary is inclusive (now - last >= cooldownSec * 1000)', () => {
    const r = decide('hi', {
      words: KEYWORDS,
      threshold: 1,
      cooldownSec: 2,
      state: { commentCounter: 0, lastOjamaTime: NOW - 2000 },
    });
    expect(r.action).toBe('random');
  });

  it('matched word during cooldown falls through to the threshold logic (counter+1, no action)', () => {
    const r = decide('!drop', {
      words: KEYWORDS,
      threshold: 5,
      cooldownSec: 10,
      state: { commentCounter: 0, lastOjamaTime: NOW - 1000 },
    });
    expect(r.action).toBeNull();
    expect(r.matchedWord).toBe('!drop');
    expect(r.nextState).toEqual({ commentCounter: 1, lastOjamaTime: NOW - 1000 });
  });

  it('matched word during cooldown that reaches the threshold resets the counter without firing', () => {
    const r = decide('!drop', {
      words: KEYWORDS,
      threshold: 5,
      cooldownSec: 10,
      state: { commentCounter: 4, lastOjamaTime: NOW - 1000 },
    });
    expect(r.action).toBeNull();
    expect(r.nextState).toEqual({ commentCounter: 0, lastOjamaTime: NOW - 1000 });
  });
});

describe('decideCommentOjama: completed puzzle', () => {
  it('returns null, leaves the counter unchanged and shows the notice when a word matched', () => {
    const r = decide('!drop', {
      words: KEYWORDS,
      isCompleted: true,
      state: { commentCounter: 3, lastOjamaTime: 500 },
    });
    expect(r).toEqual({
      action: null,
      matchedWord: '!drop',
      nextState: { commentCounter: 3, lastOjamaTime: 500 },
      notice: COMPLETED_NOTICE,
    });
  });

  it('shows no notice when no word matched, and does not increment the counter', () => {
    const r = decide('hi', {
      words: KEYWORDS,
      isCompleted: true,
      threshold: 1,
      state: { commentCounter: 4, lastOjamaTime: 0 },
    });
    expect(r.action).toBeNull();
    expect(r.notice).toBeNull();
    expect(r.nextState).toEqual({ commentCounter: 4, lastOjamaTime: 0 });
  });

  it('returns a fresh nextState object rather than the input state', () => {
    const state = { commentCounter: 1, lastOjamaTime: 0 };
    const r = decide('hi', { words: KEYWORDS, isCompleted: true, state });
    expect(r.nextState).not.toBe(state);
  });
});

describe('decideCommentOjama: empty trigger words', () => {
  it('never matches a word, so only the threshold logic applies', () => {
    const r = decide('!drop', {
      words: {},
      threshold: 2,
      state: { commentCounter: 0, lastOjamaTime: 0 },
    });
    expect(r.matchedWord).toBeNull();
    expect(r.action).toBeNull();
    expect(r.nextState).toEqual({ commentCounter: 1, lastOjamaTime: 0 });
  });

  it('still fires random once the threshold is reached', () => {
    const r = decide('!drop', { words: {}, threshold: 1 });
    expect(r.action).toBe('random');
  });
});
