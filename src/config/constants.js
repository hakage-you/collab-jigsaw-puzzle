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
  TARGET_PIECE_SIZE: 76,
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
  MAX_UPLOAD_IMAGE_DIM: 2400,
  SAMPLE_IMAGE_WIDTH: 960,
  SAMPLE_IMAGE_HEIGHT: 640,
  DEFAULT_SAMPLE_IMAGE_ID: 'met-seaside',
};

export const SAMPLE_CAPTIONS = Object.freeze({
  'met-seaside': Object.freeze({
    title: 'At the Seaside',
    artist: 'William Merritt Chase',
    date: 'ca. 1892',
    credit: 'The Met (CC0)',
  }),
  'met-fruit': Object.freeze({
    title: 'Pomegranates and Other Fruit in a Landscape',
    artist: 'Abraham Brueghel',
    date: '17th century',
    credit: 'The Met (CC0)',
  }),
  'met-irises': Object.freeze({
    title: 'Irises',
    artist: 'Vincent van Gogh',
    date: '1890',
    credit: 'The Met (CC0)',
  }),
});

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
  MIN_ZOOM: 0.06,
  MAX_ZOOM: 3.0,
  DEFAULT_SCALE: 1.0,
  ZOOM_STEP_WHEEL: 1.12,
  ZOOM_STEP_BUTTON: 1.2,
  DESK_GRID_STEP: 80,
  /** How the reference image is shown when nothing is saved: 'underlay' | 'sheet' | 'floating' | 'none'. */
  DEFAULT_REFERENCE_MODE: 'sheet',
};

/** The desk under the board, chosen per player (settings.deskStyle; src/render/deskTextures.js). */
export const DESK_CONFIG = Object.freeze({
  DEFAULT_STYLE: 'wood-b',
  /** In the order shown in the menu. 'grid' is the plain grid with no texture. */
  STYLES: Object.freeze([
    'wood-b',
    'wood-a',
    'felt-green',
    'felt-navy',
    'cork-a',
    'cork-b',
    'grid',
  ]),
});

/** The board's frame, chosen per player (settings.boardStyle; canvasOverlayRenderer.js). */
export const BOARD_CONFIG = Object.freeze({
  DEFAULT_STYLE: 'wood',
  /** In the order shown in the menu. 'classic' is the plain board with a thin blue line. */
  STYLES: Object.freeze(['wood', 'tray', 'gallery', 'classic']),
});

/**
 * Each player's own effects and sound ("演出と音"): kept in this browser only. A save, the
 * auto backup and the board sent to guests leave them out, so a host's or a save's choice never
 * changes them.
 */
export const COMFORT_CONFIG = Object.freeze({
  /** settings.effectStrength, or null: follow the OS's reduce motion ('reduced' when it is on). */
  EFFECT_STRENGTHS: Object.freeze(['normal', 'reduced', 'off']),
  /** settings.volume keys: 'normal' (snap, merge, turn, completion), 'ojama' (ojama, superchat). */
  VOLUME_KINDS: Object.freeze(['normal', 'ojama']),
  /** 0-100 in steps of VOLUME_STEP; 100 is the loudness the sounds were made at, 0 is silent. */
  DEFAULT_VOLUME: 100,
  VOLUME_STEP: 10,
  PERSONAL_SETTING_KEYS: Object.freeze(['effectStrength', 'volume']),
});

export const OJAMA_CONFIG = {
  SUPERCHAT_MAX_HP: 15,
  /** Seconds a superchat stays unless driven off; 0 = until it is driven off. */
  DEFAULT_SUPERCHAT_DURATION_SEC: 0,
  AUTO_COMMENT_INTERVAL_MS: 1100,
  DEFAULT_AUTO_COMMENT_PACE: 'normal',
  AUTO_COMMENT_MIN_SEC: 3,
  AUTO_COMMENT_MAX_SEC: 60,
  AUTO_COMMENT_INTERVALS_MS: Object.freeze({
    slow: 30000,
    normal: 15000,
    fast: 6000,
  }),
  PRANK_DEFAULT_COUNT: 3,
  FAKE_PIECE_DURATION_SEC: 60,
  FAKE_PIECE_ADD_COUNT: 3,
  FAKE_PIECE_MAX_COUNT: 12,
  DEFAULT_COMMENT_THRESHOLD: 5,
  DEFAULT_COOLDOWN_SEC: 3,
  DEFAULT_DROP_COUNT: 2,
  DEFAULT_VISUAL_DURATION_SEC: 8,
  /** Every ojama type, in the order the settings list them. */
  TYPES: Object.freeze([
    'drop',
    'visual',
    'ghost',
    'prank',
    'superchat',
    'fake',
    'heavy',
    'runaway',
  ]),
  /**
   * Default keywords per comment ojama type (comma separated; editable in the settings), plus
   * `random` (a random ojama). The giant superchat has none: only a real superchat brings it.
   * The key order is the tie-break order when two keywords of the same length match.
   */
  DEFAULT_TRIGGERS: Object.freeze({
    drop: '!drop, 落',
    visual: '!color, 色',
    ghost: '!ghost, 透明',
    prank: '!spin, 回',
    fake: '!fake, 偽',
    heavy: '!heavy, 重',
    runaway: '!run, 逃',
    random: 'ランダム',
  }),
  /** Types a random ojama may pick by default. The giant superchat is special: off. */
  DEFAULT_RANDOM_POOL: Object.freeze({
    drop: true,
    visual: true,
    ghost: true,
    prank: true,
    superchat: false,
    fake: true,
    heavy: true,
    runaway: true,
  }),
  /** How a keyword must appear in a comment: 'any' (anywhere), 'start' or 'whole'. */
  DEFAULT_MATCH_MODE: 'any',
  MATCH_MODES: Object.freeze(['any', 'start', 'whole']),
  /** Seconds each line of the keyword guide (shown while streaming) stays before the next one. */
  DEFAULT_KEYWORD_GUIDE_INTERVAL_SEC: 4,
  /** Heavy pieces: seconds a dragged piece takes to close about 63% of the gap to the cursor. */
  HEAVY_LEVELS: Object.freeze({ strong: 0.35, heavier: 0.7, heaviest: 1.2 }),
  DEFAULT_HEAVY_LEVEL: 'heaviest',
  DEFAULT_HEAVY_DURATION_SEC: 30,
  /** Seconds taken off a timed ojama (heavy, runaway) for each piece placed while it lasts. */
  DEFAULT_HEAVY_REDUCE_SEC: 3,
  /** Runaway pieces: chance (%) a grab fails after the first one, which always fails. */
  DEFAULT_RUNAWAY_CHANCE: 30,
  DEFAULT_RUNAWAY_DURATION_SEC: 30,
  DEFAULT_RUNAWAY_REDUCE_SEC: 3,
  /** A held runaway piece slips out of the hand after a random time in this range (seconds). */
  DEFAULT_RUNAWAY_GRIP_MIN_SEC: 3,
  DEFAULT_RUNAWAY_GRIP_MAX_SEC: 6,
  /** Groups of at most this many pieces run away; bigger ones stay put. */
  RUNAWAY_MAX_GROUP: 4,
  /** A hop goes this many piece sizes away from where it was grabbed. */
  RUNAWAY_HOP_MIN_PIECES: 1.5,
  RUNAWAY_HOP_MAX_PIECES: 3,
  RUNAWAY_HOP_SEC: 0.35,
};

export const MULTIPLAYER_CONFIG = {
  // WebRTC ICE servers: STUN only. No TURN relay, so game data never passes through a third-party
  // server; players whose networks cannot connect directly cannot join (relay opt-in: open issue).
  ICE_SERVERS: [{ urls: 'stun:stun.l.google.com:19302' }],
  MIN_CAPACITY: 2,
  MAX_CAPACITY: 8,
  DEFAULT_CAPACITY: 8,
  PLAYER_COLORS: [
    '#1d4ed8',
    '#e11d48',
    '#16a34a',
    '#d97706',
    '#7c3aed',
    '#0891b2',
    '#db2777',
    '#65a30d',
  ],
  CURSOR_THROTTLE_MS: 50, // 20Hz
  CURSOR_MIN_MOVE_PX: 2,
  IMAGE_MAX_BYTES: 2 * 1024 * 1024, // 2MB
  IMAGE_CHUNK_BYTES: 16 * 1024, // 16KB
  IMAGE_DEFAULT_QUALITY: 0.85,
  STATE_CHUNK_PIECES: 200,
  AUTO_BACKUP_DEBOUNCE_MS: 2000,
  SUPERCHAT_BASE_HP: 15,
  SUPERCHAT_HP_PER_GUEST: 8,
  // Recruiting (staying registered on the signaling server). With no guest online for this long
  // the host is asked whether to keep recruiting; without an answer recruiting stops.
  RECRUIT_IDLE_PROMPT_MS: 10 * 60 * 1000,
  RECRUIT_IDLE_GRACE_MS: 60 * 1000,
  // Delays between attempts to re-register on the signaling server after an unexpected drop.
  SIGNALING_RETRY_DELAYS_MS: [1000, 3000, 10000, 30000, 60000],
  // Liveness check between host and guests: ping every interval, give up on a peer that has not
  // answered a ping for the timeout (a vanished peer may never close its connection cleanly).
  HEARTBEAT_INTERVAL_MS: 5000,
  HEARTBEAT_TIMEOUT_MS: 20000,
};

/**
 * Limits for messages received from other players (security S3/S4/S7).
 * Every peer message is untrusted: anything outside these limits is dropped before it is applied.
 */
export const NET_LIMITS = {
  // Largest puzzle the game can build (cols * rows); also bounds every piece list in a message.
  MAX_PIECES: 3000,
  // Coordinates must be finite and within this distance of the board origin (world units).
  MAX_ABS_COORD: 100000,
  // Strings shown to other players.
  MAX_NAME_LENGTH: 20,
  MAX_TEXT_LENGTH: 200,
  // Guest -> host rate limit (token bucket per guest). Normal play sends at most ~45 messages/s.
  RATE_TOKENS_PER_SEC: 60,
  RATE_BURST: 120,
  // Sustained flooding (messages dropped for this long) gets the guest removed from the room.
  FLOOD_KICK_AFTER_MS: 5000,
  // Host -> guest transfers (image and full state); sized from IMAGE_MAX_BYTES with headroom.
  MAX_IMAGE_CHUNKS: 256,
  MAX_STATE_CHUNKS: 32,
  MAX_IMAGE_DIM: 4096,
  IMAGE_MIME_TYPES: ['image/webp', 'image/jpeg', 'image/png'],
  // Ojama values relayed by the host.
  MAX_OJAMA_DURATION_SEC: 600,
  MAX_SUPERCHAT_HP: 10000,
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
