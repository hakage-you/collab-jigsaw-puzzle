import { describe, expect, it } from 'vitest';
import {
  BOARD_CONFIG,
  DESK_CONFIG,
  OJAMA_CONFIG,
  PUZZLE_CONFIG,
} from '../../src/config/constants.js';
import {
  MAX_SAVE_TEXT_LENGTH,
  parseSaveText,
  validateSaveData,
} from '../../src/core/saveValidation.js';
import { createEngine } from '../helpers/coreEngine.js';

// Field-by-field checks of validateSaveData (security promise S1; the structural cases are in
// saveValidation.node.test.js). The settings and counters a save carries are listed here on
// purpose, independently of the validator's schema: a key whose type is mistyped in the schema
// would otherwise be dropped from every save without any test noticing.

const perType = (valueAt) => Object.fromEntries(OJAMA_CONFIG.TYPES.map((t, i) => [t, valueAt(i)]));

/** Every setting that travels with a save, each with a valid, non-default value. */
const FULL_SETTINGS = {
  theme: 'dark',
  deskStyle: DESK_CONFIG.STYLES.at(-1),
  boardStyle: BOARD_CONFIG.STYLES.at(-1),
  cols: 9,
  rows: 7,
  seed: 4242,
  cutComplexity: 'complex',
  allowRotation: true,
  allowFlip: true,
  showStats: false,
  referenceMode: 'floating',
  guideOpacity: 37,
  playerName: 'テスター',
  ojama: {
    commentThreshold: 11,
    cooldownSec: 12,
    dropCount: 13,
    visualDuration: 14,
    visualType: 'mist',
    fakeDuration: 15,
    superchatDuration: 16,
    fakeMaxCount: 17,
    heavyLevel: 'heavier',
    heavyDuration: 18,
    heavyReduceSec: 19,
    runawayChance: 20,
    runawayDuration: 21,
    runawayReduceSec: 22,
    runawayGripMinSec: 23,
    runawayGripMaxSec: 24,
    ghostDuration: 25,
    prankCount: 26,
    fakeAddCount: 27,
    superchatScaleByTier: false,
    commentCountOn: false,
    perViewerCooldownSec: 28,
    showTriggerName: true,
    matchMode: 'whole',
    enabled: perType((i) => i % 2 === 0),
    randomPool: perType((i) => i % 3 === 0),
    triggers: Object.fromEntries(
      Object.keys(OJAMA_CONFIG.DEFAULT_TRIGGERS).map((k) => [k, `!${k}2`]),
    ),
  },
};

/** Settings whose text must be one of a fixed list. */
const CHOICE_PATHS = [
  'theme',
  'deskStyle',
  'boardStyle',
  'cutComplexity',
  'referenceMode',
  'ojama.heavyLevel',
  'ojama.matchMode',
];

/** Dotted paths of every primitive value in `obj`. */
function leafPaths(obj, prefix = '') {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' ? leafPaths(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((o, k) => o[k], obj);
  if (value === undefined) delete parent[last];
  else parent[last] = value;
  return obj;
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => o[k], obj);

/** A value of another type than `value`. */
function wrongType(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return Number(value);
  return 7;
}

/** A real save written by the game, with `patch` applied on top (JSON round trip). */
function realSave(patch = {}) {
  const raw = JSON.parse(JSON.stringify(createEngine().exportSaveData(FULL_SETTINGS)));
  return { ...raw, ...patch };
}

/** A save built by hand for any grid size: one unlocked piece per cell, each in its own group. */
function syntheticSave(cols, rows) {
  return {
    puzzle: { cols, rows, seed: 1 },
    pieces: Array.from({ length: cols * rows }, (_, id) => ({
      id,
      x: 0,
      y: 0,
      rotation: 0,
      isFlipped: false,
      isLocked: false,
      groupId: id,
    })),
  };
}

const accepted = (raw) => validateSaveData(raw).ok;

describe('validateSaveData: every saved setting', () => {
  it('keeps every setting with a valid value unchanged', () => {
    const { data } = validateSaveData(realSave());
    expect(data.settings).toEqual(FULL_SETTINGS);
  });

  it.each(leafPaths(FULL_SETTINGS))('drops %s when it has the wrong type', (path) => {
    const raw = realSave();
    setPath(raw.settings, path, wrongType(getPath(FULL_SETTINGS, path)));
    const { data } = validateSaveData(raw);
    expect(data.settings).toEqual(setPath(structuredClone(FULL_SETTINGS), path, undefined));
  });

  it.each(CHOICE_PATHS)('drops %s when its text is not one of the allowed values', (path) => {
    const raw = realSave();
    setPath(raw.settings, path, 'nope');
    const { data } = validateSaveData(raw);
    expect(data.settings).toEqual(setPath(structuredClone(FULL_SETTINGS), path, undefined));
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('drops a number setting that is %s', (_, value) => {
    const raw = realSave();
    raw.settings.guideOpacity = value;
    expect(validateSaveData(raw).data.settings).not.toHaveProperty('guideOpacity');
  });

  it.each([
    ['ojama', 'x'],
    ['ojama.enabled', [true]],
    ['ojama.triggers', null],
  ])('drops the section %s when it is not an object', (path, value) => {
    const raw = realSave();
    setPath(raw.settings, path, value);
    const { data } = validateSaveData(raw);
    expect(data.settings).toEqual(setPath(structuredClone(FULL_SETTINGS), path, undefined));
  });

  it('drops settings that are not an object', () => {
    expect(validateSaveData(realSave({ settings: ['dark'] })).data).not.toHaveProperty('settings');
  });

  it.each([
    ['theme', 'light'],
    ['theme', 'dark'],
    ...['underlay', 'sheet', 'floating', 'none'].map((v) => ['referenceMode', v]),
    ...['uniform', 'standard', 'complex', 'irregular', 'extreme'].map((v) => ['cutComplexity', v]),
  ])('keeps %s = %s', (path, value) => {
    const raw = realSave();
    setPath(raw.settings, path, value);
    expect(getPath(validateSaveData(raw).data.settings, path)).toBe(value);
  });
});

describe('validateSaveData: stats', () => {
  const COUNTERS = { elapsedMs: 120000, placedCount: 9, ojamaTotal: 6 };
  const BREAKDOWN = { drop: 1, visual: 2, superchat: 3, prank: 4, fake: 5, heavy: 6, runaway: 7 };

  it('keeps every counter and every ojama breakdown entry', () => {
    const { data } = validateSaveData(
      realSave({ stats: { ...COUNTERS, ojamaBreakdown: BREAKDOWN } }),
    );
    expect(data.stats).toEqual({ ...COUNTERS, ojamaBreakdown: BREAKDOWN });
  });

  it.each([
    ['0', 0, true],
    ['1e12', 1e12, true],
    ['just over 1e12', 1e12 + 1, false],
    ['-1', -1, false],
  ])('a counter of %s is kept: %s', (_, value, kept) => {
    const raw = realSave({ stats: { placedCount: value, ojamaBreakdown: { drop: value } } });
    const { stats } = validateSaveData(raw).data;
    expect('placedCount' in stats).toBe(kept);
    expect('drop' in stats.ojamaBreakdown).toBe(kept);
  });

  it('replaces a breakdown that is not an object with an empty one', () => {
    const { data } = validateSaveData(realSave({ stats: { placedCount: 1, ojamaBreakdown: 'x' } }));
    expect(data.stats).toEqual({ placedCount: 1, ojamaBreakdown: {} });
  });

  it('drops stats that are not an object', () => {
    expect(validateSaveData(realSave({ stats: 5 })).data).not.toHaveProperty('stats');
  });
});

describe('validateSaveData: puzzle header limits', () => {
  const { MIN_GRID, MAX_GRID, MAX_TOTAL_PIECES } = PUZZLE_CONFIG;

  it.each([
    ['the smallest grid', MIN_GRID, MIN_GRID, true],
    ['a grid below the minimum', MIN_GRID - 1, MIN_GRID, false],
    ['a fractional grid', 2.5, 2, false],
    ['the widest grid', MAX_GRID, MIN_GRID, true],
    ['exactly the piece limit', 50, MAX_TOTAL_PIECES / 50, true],
    ['one row over the piece limit', 50, MAX_TOTAL_PIECES / 50 + 1, false],
  ])('%s (%i x %i) is accepted: %s', (_, cols, rows, ok) => {
    expect(accepted(syntheticSave(cols, rows))).toBe(ok);
  });

  it('keeps the optional header fields and fills in the defaults', () => {
    const minimal = validateSaveData(syntheticSave(2, 2)).data.puzzle;
    expect(minimal).toEqual({
      cols: 2,
      rows: 2,
      seed: 1,
      cutComplexity: 'standard',
      isSampleImage: false,
    });

    const raw = syntheticSave(2, 2);
    const extra = {
      isSampleImage: true,
      boardW: 600,
      boardH: 400,
      imageWidth: 960,
      imageHeight: 640,
      imageHash: 'abc123',
      imageName: 'photo.jpg',
      sampleImageId: 'met-seaside',
    };
    Object.assign(raw.puzzle, extra);
    expect(validateSaveData(raw).data.puzzle).toEqual({ ...minimal, ...extra });
  });

  it.each([
    ['uniform', 'uniform'],
    ['standard', 'standard'],
    ['complex', 'complex'],
    ['irregular', 'standard'],
    ['extreme', 'complex'],
  ])('reads cutComplexity %s as %s', (value, expected) => {
    const raw = syntheticSave(2, 2);
    raw.puzzle.cutComplexity = value;
    expect(validateSaveData(raw).data.puzzle.cutComplexity).toBe(expected);
  });

  it.each([
    ['boardW', 20000, true],
    ['boardW', 20001, false],
    ['boardH', 0, false],
    ['imageWidth', 20001, false],
    ['imageHeight', -1, false],
    ['imageHash', 'h'.repeat(128), true],
    ['imageHash', 'h'.repeat(129), false],
    ['imageHash', ['h'], false],
    ['imageName', 'n'.repeat(200), true],
    ['imageName', 'n'.repeat(201), false],
    ['sampleImageId', 's'.repeat(32), true],
    ['sampleImageId', 's'.repeat(33), false],
    ['isSampleImage', 'yes', false],
  ])('puzzle.%s = %s is accepted: %s', (key, value, ok) => {
    const raw = syntheticSave(2, 2);
    raw.puzzle[key] = value;
    expect(accepted(raw)).toBe(ok);
  });

  it.each([
    ['version', 1, true],
    ['savedAt', 't'.repeat(64), true],
    ['savedAt', 't'.repeat(65), false],
    ['completed', true, true],
    ['completed', 'yes', false],
  ])('top-level %s = %s is accepted: %s', (key, value, ok) => {
    const raw = { ...syntheticSave(2, 2), [key]: value };
    expect(accepted(raw)).toBe(ok);
    if (ok) expect(validateSaveData(raw).data[key]).toBe(value);
  });
});

describe('validateSaveData: piece limits', () => {
  it.each([
    ['x', 1e6, true],
    ['x', 1e6 + 1, false],
    ['y', -1e6, true],
    ['y', -1e6 - 1, false],
    ['rotation', 3, true],
    ['rotation', 4, false],
    ['rotation', -1, false],
    ['rotation', 1.5, false],
    ['groupId', 1e6, true],
    ['groupId', 1e6 + 1, false],
    ['groupId', -1, false],
    ['groupId', 0.5, false],
    ['id', -1, false],
  ])('piece.%s = %s is accepted: %s', (key, value, ok) => {
    const raw = syntheticSave(2, 2);
    raw.pieces[0][key] = value;
    expect(accepted(raw)).toBe(ok);
  });

  it('keeps every piece field', () => {
    const raw = syntheticSave(2, 2);
    const piece = {
      id: 0,
      x: -12.5,
      y: 99,
      rotation: 2,
      isFlipped: true,
      isLocked: true,
      groupId: 3,
    };
    raw.pieces[0] = piece;
    expect(validateSaveData(raw).data.pieces[0]).toEqual(piece);
  });

  it('rejects a piece record that is not an object', () => {
    const raw = syntheticSave(2, 2);
    raw.pieces[0] = [0, 0, 0];
    expect(accepted(raw)).toBe(false);
  });
});

describe('validateSaveData: contribution limits', () => {
  const entry = (over = {}) => ({ name: 'A', role: 'guest', contrib: 1, ...over });
  const kept = (contribution) =>
    validateSaveData({ ...syntheticSave(2, 2), contributions: [contribution] }).data.contributions
      .length === 1;

  it.each([
    ['a 20-character name', entry({ name: 'n'.repeat(20) }), true],
    ['a 21-character name', entry({ name: 'n'.repeat(21) }), false],
    ['a name that is not text', entry({ name: 5 }), false],
    ['the host', entry({ role: 'host' }), true],
    ['a fractional count', entry({ contrib: 1.5 }), false],
    ['a count of 1e12', entry({ contrib: 1e12 }), true],
    ['a count over 1e12', entry({ contrib: 1e12 + 1 }), false],
    ['an entry that is not an object', 'A', false],
    ['an entry whose fields come from a prototype', Object.create(entry()), false],
  ])('keeps %s: %s', (_, contribution, ok) => {
    expect(kept(contribution)).toBe(ok);
  });

  it.each([
    ['#abc', true],
    ['#12345678', true],
    ['#123456789', false],
    ['red', false],
    ['red#abc', false],
    [42, false],
    [['#abc'], false],
  ])('keeps the colour %s: %s', (color, ok) => {
    const raw = { ...syntheticSave(2, 2), contributions: [entry({ color })] };
    const [first] = validateSaveData(raw).data.contributions;
    expect(first).toEqual(ok ? entry({ color }) : entry());
  });

  it('accepts exactly 64 entries and rejects a list that is not an array', () => {
    const list = Array.from({ length: 64 }, (_, i) => entry({ name: `P${i}` }));
    expect(
      validateSaveData({ ...syntheticSave(2, 2), contributions: list }).data.contributions,
    ).toHaveLength(64);
    expect(accepted({ ...syntheticSave(2, 2), contributions: { 0: entry() } })).toBe(false);
  });
});

describe('validateSaveData: objects that are not plain', () => {
  it('rejects a save whose fields come from a prototype', () => {
    expect(accepted(Object.create(syntheticSave(2, 2)))).toBe(false);
  });

  it('rejects a piece record whose fields come from a prototype', () => {
    const raw = syntheticSave(2, 2);
    raw.pieces[0] = Object.create(raw.pieces[0]);
    expect(accepted(raw)).toBe(false);
  });

  it('accepts objects without a prototype', () => {
    const raw = syntheticSave(2, 2);
    const bare = Object.assign(Object.create(null), raw, {
      puzzle: Object.assign(Object.create(null), raw.puzzle),
    });
    expect(accepted(bare)).toBe(true);
  });
});

describe('validateSaveData / parseSaveText: errors', () => {
  it('names the problem for a known check and falls back to the generic message', () => {
    const duplicate = syntheticSave(2, 2);
    duplicate.pieces[1].id = 0;
    const generic = validateSaveData(null).error;
    expect(validateSaveData(duplicate).error).not.toBe(generic);
    expect(validateSaveData(duplicate).error).toMatch(/重複/);
  });

  it('accepts text of exactly the size limit and rejects one character more', () => {
    const json = JSON.stringify(syntheticSave(2, 2));
    const atLimit = json + ' '.repeat(MAX_SAVE_TEXT_LENGTH - json.length);
    expect(parseSaveText(atLimit).ok).toBe(true);
    expect(parseSaveText(`${atLimit} `).ok).toBe(false);
  });

  it('rejects anything that is not text', () => {
    expect(parseSaveText(null).ok).toBe(false);
    expect(parseSaveText({}).ok).toBe(false);
  });
});
