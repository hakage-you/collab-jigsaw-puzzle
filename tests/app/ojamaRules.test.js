import { describe, expect, it } from 'vitest';
import {
  COMPLETED_NOTICE,
  decideCommentOjama,
  findMatchedWord,
  parseTriggerWords,
  resolveKeywordAction,
} from '../../src/app/ojamaRules.js';

const KEYWORDS = '!drop,!ghost,!fake,!color,!spin,!sp';

function settings({ threshold = 5, cooldownSec = 0, triggerWords = KEYWORDS } = {}) {
  return { ojama: { commentThreshold: threshold, cooldownSec, triggerWords } };
}

const NOW = 100000;

function decide(text, opts = {}) {
  const { words, threshold, cooldownSec, state, isCompleted = false, now = NOW } = opts;
  return decideCommentOjama({
    text,
    settings: settings({ threshold, cooldownSec, triggerWords: words }),
    now,
    state: state ?? { commentCounter: 0, lastOjamaTime: 0 },
    isCompleted,
  });
}

describe('parseTriggerWords', () => {
  it('splits, trims, lowercases, drops empties and sorts longest first', () => {
    expect(parseTriggerWords(' Sp , ,!SPIN,,drop ')).toEqual(['!spin', 'drop', 'sp']);
  });

  it('returns an empty list for an empty setting', () => {
    expect(parseTriggerWords('')).toEqual([]);
    expect(parseTriggerWords(' , ')).toEqual([]);
  });
});

describe('findMatchedWord', () => {
  it('returns the first (longest) word contained in the lowercased text, else null', () => {
    expect(findMatchedWord(['!spin', '!sp'], '!spin now')).toBe('!spin');
    expect(findMatchedWord(['!sp'], '!sp')).toBe('!sp');
    expect(findMatchedWord(['!drop'], 'nothing')).toBeNull();
  });
});

describe('resolveKeywordAction', () => {
  it('maps the trigger word to its action', () => {
    expect(resolveKeywordAction('drop', 'x')).toBe('drop');
    expect(resolveKeywordAction('ghost', 'x')).toBe('ghost');
    expect(resolveKeywordAction('fake', 'x')).toBe('fake');
    expect(resolveKeywordAction('color', 'x')).toBe('visual');
    expect(resolveKeywordAction('spin', 'x')).toBe('prank');
    expect(resolveKeywordAction('sp', 'x')).toBe('superchat');
    expect(resolveKeywordAction('hello', 'x')).toBe('random');
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

  it('falls back to random when the matched word has no specific keyword', () => {
    expect(decide('hello', { words: 'hello' }).action).toBe('random');
  });

  it('a trigger word plus 落と in the text gives drop', () => {
    expect(decide('!sp 落と', { words: KEYWORDS }).action).toBe('drop');
  });

  it('Japanese fallbacks apply to a generic trigger word', () => {
    expect(decide('hello 透明', { words: 'hello' }).action).toBe('ghost');
    expect(decide('hello 偽', { words: 'hello' }).action).toBe('fake');
    expect(decide('hello 色', { words: 'hello' }).action).toBe('visual');
    expect(decide('hello 回', { words: 'hello' }).action).toBe('prank');
    expect(decide('hello スパ', { words: 'hello' }).action).toBe('superchat');
  });

  it('longest trigger word wins: !spin beats !sp', () => {
    expect(decide('!spin', { words: KEYWORDS }).action).toBe('prank');
    expect(decide('!sp', { words: KEYWORDS }).action).toBe('superchat');
  });

  it('matching is case-insensitive', () => {
    const r = decide('!DrOp please', { words: 'DROP' });
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
      words: '',
      threshold: 2,
      state: { commentCounter: 0, lastOjamaTime: 0 },
    });
    expect(r.matchedWord).toBeNull();
    expect(r.action).toBeNull();
    expect(r.nextState).toEqual({ commentCounter: 1, lastOjamaTime: 0 });
  });

  it('still fires random once the threshold is reached', () => {
    const r = decide('!drop', { words: '', threshold: 1 });
    expect(r.action).toBe('random');
  });
});
