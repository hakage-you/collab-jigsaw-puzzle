import { describe, expect, it } from 'vitest';
import { OJAMA_CONFIG } from '../../src/config/constants.js';
import { buildKeywordGuide, guideLead, guideWords } from '../../src/app/keywordGuide.js';

// The keyword guide shown while streaming (settings.ojama.keywordGuideOn).

const allOn = () => Object.fromEntries(OJAMA_CONFIG.TYPES.map((t) => [t, true]));

function ojamaWith(overrides = {}) {
  return {
    triggers: { ...OJAMA_CONFIG.DEFAULT_TRIGGERS },
    enabled: allOn(),
    randomPool: { ...OJAMA_CONFIG.DEFAULT_RANDOM_POOL },
    ...overrides,
  };
}

const types = (lines) => lines.map((l) => l.type);

describe('buildKeywordGuide', () => {
  it('lists every ojama type with keywords in the settings order, then random', () => {
    const lines = buildKeywordGuide({ ojama: ojamaWith() });
    expect(types(lines)).toEqual([
      'drop',
      'visual',
      'ghost',
      'prank',
      'fake',
      'heavy',
      'runaway',
      'random',
    ]);
    expect(lines[0]).toEqual({ type: 'drop', words: ['!drop', '落'] });
    expect(lines.at(-1)).toEqual({ type: 'random', words: ['ランダム'] });
  });

  it('leaves out a type that is switched off', () => {
    const ojama = ojamaWith({ enabled: { ...allOn(), ghost: false, heavy: false } });
    expect(types(buildKeywordGuide({ ojama }))).not.toContain('ghost');
    expect(types(buildKeywordGuide({ ojama }))).not.toContain('heavy');
    expect(types(buildKeywordGuide({ ojama }))).toContain('drop');
  });

  it('leaves out a type without keywords', () => {
    const ojama = ojamaWith({
      triggers: { ...OJAMA_CONFIG.DEFAULT_TRIGGERS, prank: ' , ', fake: '' },
    });
    const lines = types(buildKeywordGuide({ ojama }));
    expect(lines).not.toContain('prank');
    expect(lines).not.toContain('fake');
  });

  it('copes with settings that have no keyword or switch maps', () => {
    expect(buildKeywordGuide({ ojama: {} })).toEqual([]);
    const lines = buildKeywordGuide({ ojama: { triggers: { drop: '!drop' } } });
    expect(lines).toEqual([{ type: 'drop', words: ['!drop'] }]);
    // No switch map: every type is in use, the giant superchat too.
    expect(buildKeywordGuide({ ojama: {}, youtubeLive: true })).toEqual([
      { type: 'superchat', words: [] },
    ]);
  });

  it('leaves out random when it has nothing to pick', () => {
    const noPool = Object.fromEntries(OJAMA_CONFIG.TYPES.map((t) => [t, false]));
    expect(types(buildKeywordGuide({ ojama: ojamaWith({ randomPool: noPool }) }))).not.toContain(
      'random',
    );
    // Its only targets switched off: nothing to pick either.
    const onlyDrop = { ...noPool, drop: true };
    const ojama = ojamaWith({ randomPool: onlyDrop, enabled: { ...allOn(), drop: false } });
    expect(types(buildKeywordGuide({ ojama }))).not.toContain('random');
  });

  it('keeps random when one target is left', () => {
    const onlyGhost = Object.fromEntries(OJAMA_CONFIG.TYPES.map((t) => [t, t === 'ghost']));
    const ojama = ojamaWith({ randomPool: onlyGhost });
    expect(types(buildKeywordGuide({ ojama }))).toContain('random');
  });

  it('adds the giant superchat last, only while YouTube is linked', () => {
    const ojama = ojamaWith();
    expect(types(buildKeywordGuide({ ojama }))).not.toContain('superchat');
    expect(types(buildKeywordGuide({ ojama, youtubeLive: false }))).not.toContain('superchat');
    const lines = buildKeywordGuide({ ojama, youtubeLive: true });
    expect(lines.at(-1)).toEqual({ type: 'superchat', words: [] });
  });

  it('leaves the giant superchat out when it is switched off', () => {
    const ojama = ojamaWith({ enabled: { ...allOn(), superchat: false } });
    expect(types(buildKeywordGuide({ ojama, youtubeLive: true }))).not.toContain('superchat');
  });
});

describe('guideWords', () => {
  it('keeps the streamer order and text', () => {
    expect(guideWords('落, !Drop')).toEqual(['落', '!Drop']);
  });

  it('shows full-width letters and commas as half-width, as they are compared', () => {
    expect(guideWords('！ＤＲＯＰ，落')).toEqual(['!DROP', '落']);
  });

  it('drops empty entries and repeats (case ignored)', () => {
    expect(guideWords(' !drop ,, !DROP, 落 ,')).toEqual(['!drop', '落']);
  });

  it('shows every keyword, however many', () => {
    expect(guideWords('a, b, c, d, e, f')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('is empty without keywords', () => {
    expect(guideWords(undefined)).toEqual([]);
    expect(guideWords('')).toEqual([]);
  });
});

describe('guideLead', () => {
  it('says which comments the keywords work in, for each way keywords are matched', () => {
    expect(guideLead('any')).toBe('を含むコメント');
    expect(guideLead('start')).toBe('から始まるコメント');
    expect(guideLead('whole')).toBe('だけのコメント');
  });

  it('falls back to the default way for an unknown or missing value', () => {
    expect(guideLead(undefined)).toBe('を含むコメント');
    expect(guideLead('nope')).toBe('を含むコメント');
  });
});
