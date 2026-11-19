/**
 * Centralized configuration constants and magic numbers for Phase 1 Mock.
 */

export const STORAGE_KEYS = {
  SETTINGS: 'collab_jigsaw_phase1_settings_v1',
  AUTO_BACKUP: 'collab_jigsaw_auto_backup_v1',
  YOUTUBE_API_KEY: 'collab_jigsaw_yt_api_key_v1',
  YOUTUBE_STORAGE_MODE: 'collab_jigsaw_yt_key_mode_v1',
};

export const PUZZLE_CONFIG = {
  DEFAULT_COLS: 6,
  DEFAULT_ROWS: 4,
  MIN_GRID: 2,
  MAX_GRID: 80,
  MAX_TOTAL_PIECES: 3000,
  SPRITE_ATLAS_SIZE: 2048,
  SPRITE_ATLAS_PAD: 4,
  DEFAULT_SEED: 20261119,
  BOARD_MAX_WIDTH: 680,
  BOARD_MAX_HEIGHT: 460,
  TAB_RATIO: 0.24,
  SPRITE_PAD_TAB_MULT: 1.45,
  SPRITE_PAD_WARP_MULT: 0.22,
  SPRITE_PAD_EXTRA: 6,
  MIN_SNAP_DISTANCE: 18,
  SNAP_DISTANCE_RATIO: 0.34,
  FLIP_INITIAL_PROB: 0.35,
  BACKSIDE_PATTERN_SIZE: 48,
  SORT_STEP_RATIO: 1.38,
  SORT_EDGE_STEP_RATIO: 1.42,
  SORT_QUADRANT_STEP_RATIO: 1.4,
  MAX_UPLOAD_IMAGE_DIM: 1600,
  SAMPLE_IMAGE_WIDTH: 960,
  SAMPLE_IMAGE_HEIGHT: 640,
};

export const CUT_COMPLEXITY_CONFIG = {
  WARP_RATIOS: {
    uniform: 0,
    standard: 0.045,
    complex: 0.16,
  },
  // 5 archetypes for hand-cut "standard" style
  STANDARD_ARCHETYPES: [
    // 0: bulb
    { headWidth: 0.22, neckWidth: 0.095, depth: 0.96, uCenter: 0.5, tilt: 0 },
    // 1: slender
    { headWidth: 0.145, neckWidth: 0.105, depth: 1.14, uCenter: 0.5, tilt: 0 },
    // 2: compact
    { headWidth: 0.165, neckWidth: 0.105, depth: 0.84, uCenter: 0.5, tilt: 0 },
    // 3: lean_left
    { headWidth: 0.18, neckWidth: 0.1, depth: 0.98, uCenter: 0.445, tilt: -0.065 },
    // 4: lean_right
    { headWidth: 0.18, neckWidth: 0.1, depth: 0.98, uCenter: 0.555, tilt: 0.065 },
  ],
  JITTER: {
    U_CENTER: 0.025,
    DEPTH: 0.05,
    HEAD_WIDTH: 0.018,
    TILT: 0.022,
    EAR_ASYM: 0.045,
    SHOULDER_BOW: 0.03,
    COMPLEX_MULT: 1.4,
  },
};

export const VIEWPORT_CONFIG = {
  MIN_ZOOM: 0.15,
  MAX_ZOOM: 8.0,
  DEFAULT_SCALE: 0.72,
  ZOOM_STEP_WHEEL: 1.12,
  ZOOM_STEP_BUTTON: 1.2,
  DESK_GRID_STEP: 80,
};

export const OJAMA_CONFIG = {
  SUPERCHAT_MAX_HP: 5,
  SUPERCHAT_DURATION_SEC: 10,
  AUTO_COMMENT_INTERVAL_MS: 1100,
  PRANK_DEFAULT_COUNT: 3,
  DEFAULT_COMMENT_THRESHOLD: 5,
  DEFAULT_COOLDOWN_SEC: 3,
  DEFAULT_DROP_COUNT: 2,
  DEFAULT_VISUAL_DURATION_SEC: 8,
};

export const PARTICIPANTS_CONFIG = {
  MAX_DUMMY_PARTICIPANTS: 7,
  DUMMY_COLORS: ['#e11d48', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'],
  DUMMY_NAMES: [
    'コラボ相手A',
    'コラボ相手B',
    'ゲストC',
    '助っ人D',
    'フレンドE',
    '配信仲間F',
    '視聴者枠G',
  ],
};

export const MULTIPLAYER_CONFIG = {
  MIN_CAPACITY: 2,
  MAX_CAPACITY: 8,
  DEFAULT_CAPACITY: 8,
  PLAYER_COLORS: [
    '#1d4ed8',
    ...PARTICIPANTS_CONFIG.DUMMY_COLORS,
  ],
  CURSOR_THROTTLE_MS: 50, // 20Hz
  CURSOR_MIN_MOVE_PX: 2,
  IMAGE_MAX_BYTES: 2 * 1024 * 1024, // 2MB
  IMAGE_CHUNK_BYTES: 16 * 1024, // 16KB
  IMAGE_DEFAULT_QUALITY: 0.85,
  STATE_CHUNK_PIECES: 200,
  AUTO_BACKUP_DEBOUNCE_MS: 2000,
  SUPERCHAT_BASE_HP: 5,
  SUPERCHAT_HP_PER_GUEST: 3,
};

export const YOUTUBE_CONFIG = {
  API_BASE: 'https://www.googleapis.com/youtube/v3',
  QUOTA_DAILY_LIMIT: 10000,
  COST_VERIFY_VIDEOS: 1,
  COST_LIST_MESSAGES: 5,
  DEFAULT_POLL_INTERVAL_MS: 10000,
  SUPERCHAT_TIER_HP_BONUS: 2,
};

export const COLOR_BUCKETS = [
  { id: 'red', label: '赤・ピンク系', swatch: '#ef4444' },
  { id: 'orange', label: '橙・黄系', swatch: '#f59e0b' },
  { id: 'green', label: '緑系', swatch: '#22c55e' },
  { id: 'cyan', label: '水色・青緑系', swatch: '#06b6d4' },
  { id: 'blue', label: '青・紺系', swatch: '#3b82f6' },
  { id: 'purple', label: '紫系', swatch: '#a855f7' },
  { id: 'neutral', label: '白・灰・黒系', swatch: '#94a3b8' },
];
