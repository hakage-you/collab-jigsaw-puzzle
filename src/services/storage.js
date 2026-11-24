import {
  BOARD_CONFIG,
  COMFORT_CONFIG,
  DESK_CONFIG,
  PUZZLE_CONFIG,
  OJAMA_CONFIG,
  STORAGE_KEYS,
  VIEWPORT_CONFIG,
} from '../config/constants.js';
import { normalizeCutComplexity } from '../core/jigsawPath.js';
import { parseSaveText } from '../core/saveValidation.js';

export { MAX_SAVE_TEXT_LENGTH } from '../core/saveValidation.js';
export { parseSaveText };

const RENDERER_MODES = ['auto', 'webgpu', 'webgl2', 'canvas2d'];

const DEFAULT_SETTINGS = {
  theme: 'light', // 'light' | 'dark'
  deskStyle: DESK_CONFIG.DEFAULT_STYLE, // DESK_CONFIG.STYLES
  boardStyle: BOARD_CONFIG.DEFAULT_STYLE, // BOARD_CONFIG.STYLES
  cols: PUZZLE_CONFIG.DEFAULT_COLS,
  rows: PUZZLE_CONFIG.DEFAULT_ROWS,
  seed: PUZZLE_CONFIG.DEFAULT_SEED,
  cutComplexity: 'standard',
  allowRotation: true,
  allowFlip: false,
  showStats: true,
  // "演出と音": this player's own, never in a save (COMFORT_CONFIG). null follows the OS.
  effectStrength: null, // null | 'normal' | 'reduced' | 'off'
  volume: { normal: COMFORT_CONFIG.DEFAULT_VOLUME, ojama: COMFORT_CONFIG.DEFAULT_VOLUME },
  rendererMode: 'auto', // 'auto' | 'webgpu' | 'webgl2' | 'canvas2d'
  referenceMode: VIEWPORT_CONFIG.DEFAULT_REFERENCE_MODE, // 'underlay' | 'sheet' | 'floating' | 'none'
  guideOpacity: 14,
  playerName: 'ホスト（自分）',
  ojama: {
    commentThreshold: OJAMA_CONFIG.DEFAULT_COMMENT_THRESHOLD,
    cooldownSec: OJAMA_CONFIG.DEFAULT_COOLDOWN_SEC,
    dropCount: OJAMA_CONFIG.DEFAULT_DROP_COUNT,
    visualDuration: OJAMA_CONFIG.DEFAULT_VISUAL_DURATION_SEC,
    visualType: 'random',
    fakeDuration: OJAMA_CONFIG.FAKE_PIECE_DURATION_SEC,
    fakeMaxCount: OJAMA_CONFIG.FAKE_PIECE_MAX_COUNT,
    superchatDuration: OJAMA_CONFIG.DEFAULT_SUPERCHAT_DURATION_SEC,
    heavyLevel: OJAMA_CONFIG.DEFAULT_HEAVY_LEVEL,
    heavyDuration: OJAMA_CONFIG.DEFAULT_HEAVY_DURATION_SEC,
    heavyReduceSec: OJAMA_CONFIG.DEFAULT_HEAVY_REDUCE_SEC,
    runawayChance: OJAMA_CONFIG.DEFAULT_RUNAWAY_CHANCE,
    runawayDuration: OJAMA_CONFIG.DEFAULT_RUNAWAY_DURATION_SEC,
    runawayReduceSec: OJAMA_CONFIG.DEFAULT_RUNAWAY_REDUCE_SEC,
    runawayGripMinSec: OJAMA_CONFIG.DEFAULT_RUNAWAY_GRIP_MIN_SEC,
    runawayGripMaxSec: OJAMA_CONFIG.DEFAULT_RUNAWAY_GRIP_MAX_SEC,
    ghostDuration: OJAMA_CONFIG.DEFAULT_VISUAL_DURATION_SEC,
    prankCount: OJAMA_CONFIG.PRANK_DEFAULT_COUNT,
    fakeAddCount: OJAMA_CONFIG.FAKE_PIECE_ADD_COUNT,
    superchatScaleByTier: true,
    commentCountOn: true,
    perViewerCooldownSec: 0,
    /** Put the name of the viewer who set an ojama off on its sticker (off: names are opt-in). */
    showTriggerName: false,
    matchMode: OJAMA_CONFIG.DEFAULT_MATCH_MODE,
    triggers: { ...OJAMA_CONFIG.DEFAULT_TRIGGERS },
    /** Types in use (false: never fires, from keywords, random, superchats or test buttons). */
    enabled: Object.fromEntries(OJAMA_CONFIG.TYPES.map((t) => [t, true])),
    /** Types a random ojama may pick. */
    randomPool: { ...OJAMA_CONFIG.DEFAULT_RANDOM_POOL },
  },
};

/** The ojama settings kept per type; they merge key by key over the defaults. */
const OJAMA_PER_TYPE_KEYS = ['triggers', 'enabled', 'randomPool'];

/**
 * Saved ojama settings over the defaults; the per-type maps merge per type, so a type added later
 * gets its defaults. (The old single `triggerWords` list and the giant superchat's keywords are
 * dropped: a superchat only comes from a real one now.)
 */
export function mergeOjama(saved, base = DEFAULT_SETTINGS.ojama) {
  const rest = { ...saved };
  delete rest.triggerWords;
  const out = { ...base, ...rest };
  for (const key of OJAMA_PER_TYPE_KEYS) out[key] = { ...base[key], ...(rest[key] || {}) };
  delete out.triggers.superchat;
  return out;
}

/** A volume (0-100, on a VOLUME_STEP) from a saved value; anything else is the default. */
function readVolume(value) {
  if (!Number.isFinite(value)) return COMFORT_CONFIG.DEFAULT_VOLUME;
  const step = COMFORT_CONFIG.VOLUME_STEP;
  return Math.min(100, Math.max(0, Math.round(value / step) * step));
}

/**
 * This player's effects and sound from the saved settings. Settings saved before "演出と音"
 * carry them over: "演出を控えめに" on (reduceEffects) is 'reduced', and the sound switch off
 * (soundEnabled: false) is both volumes at 0.
 */
export function readComfortSettings(saved) {
  const strength = COMFORT_CONFIG.EFFECT_STRENGTHS.includes(saved.effectStrength)
    ? saved.effectStrength
    : saved.reduceEffects === true
      ? 'reduced'
      : null;
  const legacyMuted = saved.soundEnabled === false && !saved.volume;
  const volume = {};
  for (const kind of COMFORT_CONFIG.VOLUME_KINDS) {
    volume[kind] = legacyMuted ? 0 : readVolume(saved.volume?.[kind]);
  }
  return { effectStrength: strength, volume };
}

export function loadSavedSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    const rest = { ...parsed };
    delete rest.soundEnabled; // carried over by readComfortSettings
    delete rest.reduceEffects;
    return {
      ...DEFAULT_SETTINGS,
      ...rest,
      ...readComfortSettings(parsed),
      rendererMode: RENDERER_MODES.includes(parsed.rendererMode) ? parsed.rendererMode : 'auto',
      cutComplexity: normalizeCutComplexity(parsed.cutComplexity),
      ojama: mergeOjama(parsed.ojama),
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors in restricted modes
  }
}

export function resetSavedSettings() {
  try {
    localStorage.removeItem(STORAGE_KEYS.SETTINGS);
  } catch {
    // Ignore
  }
  return structuredClone(DEFAULT_SETTINGS);
}

export function downloadJsonFile(dataObj, filenamePrefix = 'puzzle-save') {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `${filenamePrefix}-${stamp}.json`;

  const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

export function saveAutoBackup(savePayload) {
  try {
    localStorage.setItem(STORAGE_KEYS.AUTO_BACKUP, JSON.stringify(savePayload));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadAutoBackup() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AUTO_BACKUP);
    if (!raw) return null;
    const result = parseSaveText(raw);
    return result.ok ? result.data : null;
  } catch {
    return null;
  }
}

export function clearAutoBackup() {
  try {
    localStorage.removeItem(STORAGE_KEYS.AUTO_BACKUP);
  } catch {
    // Ignore
  }
}
