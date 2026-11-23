import { OJAMA_CONFIG, PUZZLE_CONFIG } from '../config/constants.js';
import { normalizeCutComplexity } from './jigsawPath.js';

/*
 * Strict validation of save data. Save files and auto backups are untrusted input (S1).
 * validateSaveData never passes the raw object through: it returns a NEW object containing only
 * the known fields, with every value re-checked. Unknown keys (including __proto__ and
 * constructor) are simply never copied.
 */

/** Largest save text accepted (characters; also used as the file size limit in bytes). */
export const MAX_SAVE_TEXT_LENGTH = 5 * 1024 * 1024;

const FORMAT_ERROR = 'セーブデータの形式が正しくありません';
const MAX_COORD = 1e6;
const MAX_IMAGE_DIM = 20000;
const MAX_GROUP_ID = 1e6;
const MAX_COUNTER = 1e12;
const MAX_HASH_LENGTH = 128;
const MAX_NAME_LENGTH = 20;
const MAX_CONTRIBUTIONS = 64;
const MAX_TEXT_LENGTH = 500;
const MAX_SAVED_AT_LENGTH = 64;
const MAX_IMAGE_NAME_LENGTH = 200;
const COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;
const ACCENT_COLOR = 'var(--accent)';
const CUT_COMPLEXITY_VALUES = ['uniform', 'standard', 'complex', 'irregular', 'extreme'];
const COUNTER_KEYS = ['elapsedMs', 'placedCount', 'ojamaTotal'];
const BREAKDOWN_KEYS = ['drop', 'visual', 'superchat', 'prank', 'fake', 'heavy', 'runaway'];

/** Thrown by the checks below; its message is shown to the user as-is. */
class InvalidSaveError extends Error {}

function check(condition, message = FORMAT_ERROR) {
  if (!condition) throw new InvalidSaveError(message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCounter(value) {
  return isFiniteNumber(value) && value >= 0 && value <= MAX_COUNTER;
}

/** Returns undefined when the optional value is absent, otherwise reader(value). */
function optional(value, reader) {
  return value === undefined ? undefined : reader(value);
}

/** Copies only the entries whose value is defined. Keys are always fixed names from this module. */
function definedEntries(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function readBoolean(value) {
  check(typeof value === 'boolean');
  return value;
}

function readGridSize(value) {
  check(
    Number.isInteger(value) && value >= PUZZLE_CONFIG.MIN_GRID && value <= PUZZLE_CONFIG.MAX_GRID,
    'グリッドサイズが不正です',
  );
  return value;
}

function readSeed(value) {
  check(isFiniteNumber(value), 'seedが不正です');
  return value;
}

function readImageDim(value) {
  check(isFiniteNumber(value) && value > 0 && value <= MAX_IMAGE_DIM, '画像サイズが不正です');
  return value;
}

function readCutComplexity(value) {
  if (value === undefined) return 'standard';
  check(CUT_COMPLEXITY_VALUES.includes(value), 'カット形状の指定が不正です');
  return normalizeCutComplexity(value);
}

function readBoundedString(maxLength) {
  return (value) => {
    check(typeof value === 'string' && value.length <= maxLength);
    return value;
  };
}

/** Reads the puzzle header: grid, seed, cut style and image geometry. */
function readPuzzleHeader(src) {
  check(isPlainObject(src), 'パズル情報が不正です');
  const cols = readGridSize(src.cols);
  const rows = readGridSize(src.rows);
  check(cols * rows <= PUZZLE_CONFIG.MAX_TOTAL_PIECES, 'ピース数が上限を超えています');
  return {
    cols,
    rows,
    seed: readSeed(src.seed),
    cutComplexity: readCutComplexity(src.cutComplexity),
    isSampleImage: optional(src.isSampleImage, readBoolean) ?? false,
    ...definedEntries({
      boardW: optional(src.boardW, readImageDim),
      boardH: optional(src.boardH, readImageDim),
      imageWidth: optional(src.imageWidth, readImageDim),
      imageHeight: optional(src.imageHeight, readImageDim),
      imageHash: optional(src.imageHash, readBoundedString(MAX_HASH_LENGTH)),
      imageName: optional(src.imageName, readBoundedString(MAX_IMAGE_NAME_LENGTH)),
      sampleImageId: optional(src.sampleImageId, readBoundedString(32)),
    }),
  };
}

function readCoord(value) {
  check(isFiniteNumber(value) && Math.abs(value) <= MAX_COORD, '座標が不正です');
  return value;
}

function readRotation(value) {
  check(Number.isInteger(value) && value >= 0 && value <= 3, '回転値が不正です');
  return value;
}

function readGroupId(value) {
  check(Number.isInteger(value) && value >= 0 && value <= MAX_GROUP_ID, 'グループIDが不正です');
  return value;
}

function readPieceId(value, total) {
  check(Number.isInteger(value) && value >= 0 && value < total, 'ピースIDが不正です');
  return value;
}

/** Reads one piece record. `seen` collects ids to reject duplicates. */
function readPiece(src, total, seen) {
  check(isPlainObject(src), 'ピース情報が不正です');
  const id = readPieceId(src.id, total);
  check(!seen.has(id), 'ピースIDが重複しています');
  seen.add(id);
  return {
    id,
    x: readCoord(src.x),
    y: readCoord(src.y),
    rotation: readRotation(src.rotation),
    isFlipped: readBoolean(src.isFlipped),
    isLocked: readBoolean(src.isLocked),
    groupId: readGroupId(src.groupId),
  };
}

/** Reads the piece list: exactly one valid, unique record per grid cell. */
function readPieces(list, total) {
  check(Array.isArray(list) && list.length === total, 'ピース数が盤面と一致しません');
  const seen = new Set();
  return list.map((src) => readPiece(src, total, seen));
}

/** Known counters only; invalid counters are dropped and restored as 0. */
function readStats(src) {
  if (!isPlainObject(src)) return undefined;
  const out = {};
  for (const key of COUNTER_KEYS) {
    if (isCounter(src[key])) out[key] = src[key];
  }
  const breakdown = isPlainObject(src.ojamaBreakdown) ? src.ojamaBreakdown : {};
  out.ojamaBreakdown = {};
  for (const key of BREAKDOWN_KEYS) {
    if (isCounter(breakdown[key])) out.ojamaBreakdown[key] = breakdown[key];
  }
  return out;
}

/**
 * Settings schema. A primitive spec has a type ('number' | 'boolean' | 'string'), and optionally
 * a maximum string length (longer strings are truncated) and allowed values. A section spec
 * holds a nested schema.
 */
/** One boolean per ojama type. */
function perTypeBooleans() {
  return Object.fromEntries(OJAMA_CONFIG.TYPES.map((t) => [t, { type: 'boolean' }]));
}

const OJAMA_SCHEMA = {
  commentThreshold: { type: 'number' },
  cooldownSec: { type: 'number' },
  dropCount: { type: 'number' },
  visualDuration: { type: 'number' },
  visualType: { type: 'string', max: MAX_TEXT_LENGTH },
  fakeDuration: { type: 'number' },
  superchatDuration: { type: 'number' },
  fakeMaxCount: { type: 'number' },
  heavyLevel: {
    type: 'string',
    max: MAX_TEXT_LENGTH,
    values: Object.keys(OJAMA_CONFIG.HEAVY_LEVELS),
  },
  heavyDuration: { type: 'number' },
  heavyReduceSec: { type: 'number' },
  runawayChance: { type: 'number' },
  runawayDuration: { type: 'number' },
  runawayReduceSec: { type: 'number' },
  runawayGripMinSec: { type: 'number' },
  runawayGripMaxSec: { type: 'number' },
  ghostDuration: { type: 'number' },
  prankCount: { type: 'number' },
  fakeAddCount: { type: 'number' },
  superchatScaleByTier: { type: 'boolean' },
  commentCountOn: { type: 'boolean' },
  perViewerCooldownSec: { type: 'number' },
  matchMode: { type: 'string', max: MAX_TEXT_LENGTH, values: OJAMA_CONFIG.MATCH_MODES },
  enabled: { section: perTypeBooleans() },
  randomPool: { section: perTypeBooleans() },
  triggers: {
    section: Object.fromEntries(
      Object.keys(OJAMA_CONFIG.DEFAULT_TRIGGERS).map((k) => [
        k,
        { type: 'string', max: MAX_TEXT_LENGTH },
      ]),
    ),
  },
};

const SETTINGS_SCHEMA = {
  theme: { type: 'string', max: MAX_TEXT_LENGTH, values: ['light', 'dark'] },
  cols: { type: 'number' },
  rows: { type: 'number' },
  seed: { type: 'number' },
  cutComplexity: { type: 'string', max: MAX_TEXT_LENGTH, values: CUT_COMPLEXITY_VALUES },
  allowRotation: { type: 'boolean' },
  allowFlip: { type: 'boolean' },
  showStats: { type: 'boolean' },
  soundEnabled: { type: 'boolean' },
  referenceMode: {
    type: 'string',
    max: MAX_TEXT_LENGTH,
    values: ['underlay', 'sheet', 'floating', 'none'],
  },
  guideOpacity: { type: 'number' },
  playerName: { type: 'string', max: MAX_NAME_LENGTH },
  ojama: { section: OJAMA_SCHEMA },
};

/** Returns the value for one schema entry, or undefined when it has the wrong type. */
function readSettingValue(value, spec) {
  if (spec.section) return isPlainObject(value) ? readSection(value, spec.section) : undefined;
  if (spec.type === 'number') return isFiniteNumber(value) ? value : undefined;
  if (spec.type === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.slice(0, spec.max);
  return !spec.values || spec.values.includes(text) ? text : undefined;
}

/** Copies the schema keys present in `src` with a valid type; everything else is dropped. */
function readSection(src, schema) {
  const out = {};
  for (const [key, spec] of Object.entries(schema)) {
    const value = readSettingValue(src[key], spec);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function readSettings(src) {
  if (!isPlainObject(src)) return undefined;
  return readSection(src, SETTINGS_SCHEMA);
}

/** Only hex colours or the accent variable pass; anything else (javascript:, url(), ...) is dropped. */
function readColor(value) {
  if (typeof value !== 'string') return undefined;
  return COLOR_PATTERN.test(value) || value === ACCENT_COLOR ? value : undefined;
}

/** One contribution entry; returns null when it is malformed (the entry is dropped). */
function readContribution(src) {
  if (!isPlainObject(src)) return null;
  const { name, role, contrib } = src;
  if (typeof name !== 'string' || name.length > MAX_NAME_LENGTH) return null;
  if (role !== 'host' && role !== 'guest') return null;
  if (!Number.isInteger(contrib) || contrib < 0 || contrib > MAX_COUNTER) return null;
  return { name, role, contrib, ...definedEntries({ color: readColor(src.color) }) };
}

function readContributions(list) {
  check(Array.isArray(list) && list.length <= MAX_CONTRIBUTIONS, '貢献情報が不正です');
  return list.map(readContribution).filter((entry) => entry !== null);
}

function readVersion(value) {
  check(value === 1, 'セーブデータのバージョンが未対応です');
  return value;
}

function buildSave(raw) {
  const puzzle = readPuzzleHeader(raw.puzzle);
  const pieces = readPieces(raw.pieces, puzzle.cols * puzzle.rows);
  return definedEntries({
    version: optional(raw.version, readVersion),
    savedAt: optional(raw.savedAt, readBoundedString(MAX_SAVED_AT_LENGTH)),
    completed: optional(raw.completed, readBoolean),
    puzzle,
    pieces,
    stats: readStats(raw.stats),
    settings: readSettings(raw.settings),
    contributions: optional(raw.contributions, readContributions),
  });
}

/**
 * Validates a parsed save object (from a file, localStorage or a peer).
 * Returns { ok: true, data } with a freshly built object, or { ok: false, error } with a
 * short Japanese message suitable for a toast.
 */
export function validateSaveData(raw) {
  try {
    check(isPlainObject(raw));
    return { ok: true, data: buildSave(raw) };
  } catch (err) {
    return { ok: false, error: err instanceof InvalidSaveError ? err.message : FORMAT_ERROR };
  }
}

/** Size guard, JSON.parse and validation for save text read from a file or storage. */
export function parseSaveText(text) {
  if (typeof text !== 'string') return { ok: false, error: FORMAT_ERROR };
  if (text.length > MAX_SAVE_TEXT_LENGTH) {
    return { ok: false, error: 'セーブデータが大きすぎます' };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: FORMAT_ERROR };
  }
  return validateSaveData(raw);
}
