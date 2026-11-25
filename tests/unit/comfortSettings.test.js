import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../src/config/constants.js';
import { resolveEffectStrength } from '../../src/app/comfortSettings.js';
import { validateSaveData } from '../../src/core/saveValidation.js';
import { ViewState } from '../../src/render/viewState.js';
import { sound } from '../../src/services/sound.js';
import { loadSavedSettings, readComfortSettings } from '../../src/services/storage.js';
import { createEngine } from '../helpers/puzzle.js';

// "演出と音": each player's own effect strength and volumes. They follow the OS until chosen,
// carry over from the older switches, and never travel in a save (nor change from one).

describe('resolveEffectStrength', () => {
  it('follows the OS until the player chooses', () => {
    expect(resolveEffectStrength(null, false)).toBe('normal');
    expect(resolveEffectStrength(null, true)).toBe('reduced');
    expect(resolveEffectStrength('nonsense', true)).toBe('reduced');
  });

  it("uses the player's choice whatever the OS says", () => {
    for (const os of [false, true]) {
      expect(resolveEffectStrength('normal', os)).toBe('normal');
      expect(resolveEffectStrength('reduced', os)).toBe('reduced');
      expect(resolveEffectStrength('off', os)).toBe('off');
    }
  });
});

describe('readComfortSettings', () => {
  it('starts following the OS, at full volume', () => {
    expect(readComfortSettings({})).toEqual({
      effectStrength: null,
      volume: { normal: 100, ojama: 100 },
    });
  });

  it('carries over "演出を控えめに" and the sound switch', () => {
    expect(readComfortSettings({ reduceEffects: true }).effectStrength).toBe('reduced');
    expect(readComfortSettings({ reduceEffects: false }).effectStrength).toBeNull();
    expect(readComfortSettings({ soundEnabled: false }).volume).toEqual({ normal: 0, ojama: 0 });
    expect(readComfortSettings({ soundEnabled: true }).volume).toEqual({ normal: 100, ojama: 100 });
  });

  it('keeps a valid choice and mends a broken one', () => {
    const read = readComfortSettings({
      effectStrength: 'off',
      volume: { normal: 34, ojama: 'loud' },
    });
    expect(read).toEqual({ effectStrength: 'off', volume: { normal: 30, ojama: 100 } });
    expect(readComfortSettings({ effectStrength: 'max', volume: { normal: 250 } })).toEqual({
      effectStrength: null,
      volume: { normal: 100, ojama: 100 },
    });
  });
});

describe('loadSavedSettings', () => {
  let saved;
  beforeEach(() => {
    saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
  });
  afterEach(() => {
    if (saved === null) localStorage.removeItem(STORAGE_KEYS.SETTINGS);
    else localStorage.setItem(STORAGE_KEYS.SETTINGS, saved);
  });

  it('turns the older switches into the new settings and drops them', () => {
    localStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({ theme: 'dark', soundEnabled: false, reduceEffects: true }),
    );
    const settings = loadSavedSettings();
    expect(settings.theme).toBe('dark');
    expect(settings.effectStrength).toBe('reduced');
    expect(settings.volume).toEqual({ normal: 0, ojama: 0 });
    expect(settings).not.toHaveProperty('soundEnabled');
    expect(settings).not.toHaveProperty('reduceEffects');
  });
});

describe('saves leave the player’s own effects and sound alone', () => {
  it('does not write them into a save', () => {
    const engine = createEngine();
    const settings = {
      theme: 'light',
      effectStrength: 'off',
      volume: { normal: 0, ojama: 50 },
    };
    const save = engine.exportSaveData(settings);
    expect(save.settings.theme).toBe('light');
    expect(save.settings).not.toHaveProperty('effectStrength');
    expect(save.settings).not.toHaveProperty('volume');
    // The settings given are not changed.
    expect(settings.effectStrength).toBe('off');
  });

  it('does not read them (nor the older switches) from a save', () => {
    const engine = createEngine();
    const save = JSON.parse(JSON.stringify(engine.exportSaveData({ theme: 'dark' })));
    Object.assign(save.settings, {
      effectStrength: 'off',
      volume: { normal: 0, ojama: 0 },
      soundEnabled: false,
      reduceEffects: true,
    });
    const checked = validateSaveData(save);
    expect(checked.ok).toBe(true);
    expect(checked.data.settings).toEqual({ theme: 'dark' });
  });
});

describe('sound volumes', () => {
  const before = { ...sound.volumes };
  afterEach(() => {
    sound.setVolumes(before);
    vi.restoreAllMocks();
  });

  it('scales loudness as the ear hears it', () => {
    sound.setVolumes({ normal: 100, ojama: 50 });
    expect(sound.gainFor('normal')).toBe(1);
    expect(sound.gainFor('ojama')).toBe(0.25);
    sound.setVolumes({ ojama: 0 });
    expect(sound.gainFor('ojama')).toBe(0);
  });

  it('plays nothing of a silent kind, not even opening the audio', () => {
    const open = vi.spyOn(sound, '_ensureCtx').mockReturnValue(null);
    sound.setVolumes({ normal: 0, ojama: 70 });
    sound.playSnap();
    sound.playMerge();
    sound.playWin();
    sound.playTick();
    sound.playDeal(24);
    sound.unlock('normal');
    expect(open).not.toHaveBeenCalled();
    sound.playTick('ojama');
    sound.playOjama();
    expect(open).toHaveBeenCalled();
  });
});

describe('the snap flash follows the effect strength', () => {
  function flashAlpha(intensity) {
    const engine = createEngine();
    const vs = new ViewState({
      getViewportSize: () => ({ width: 800, height: 600 }),
      engine,
      getSettings: () => ({}),
    });
    vs.effectIntensity = intensity;
    vs.addSnapFlashes([engine.pieces[0]]);
    return vs.snapFlashes.map((f) => f.alpha);
  }

  it('is full, fainter, or not drawn', () => {
    expect(flashAlpha('normal')).toEqual([0.9]);
    expect(flashAlpha('reduced')).toEqual([0.45]);
    expect(flashAlpha('off')).toEqual([]);
  });
});
