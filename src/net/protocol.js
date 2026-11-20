/**
 * P2P Multiplayer Protocol definitions, message validation, and SHA-256 challenge auth.
 */

export const MSG = {
  // Handshake & Auth
  AUTH_CHALLENGE: 'auth_challenge',
  AUTH_RESPONSE: 'auth_response',
  REJOIN: 'rejoin',
  AUTH_ERROR: 'auth_error',
  KNOCK_PENDING: 'knock_pending',
  JOIN_REJECTED: 'join_rejected',
  WELCOME: 'welcome',
  KICKED: 'kicked',

  // Image Transfer
  IMAGE_ACK: 'image_ack',
  IMAGE_START: 'image_start',
  IMAGE_CHUNK: 'image_chunk',

  // Authoritative Game State & Optimistic Locking
  FULL_STATE: 'full_state',
  FULL_STATE_CHUNK: 'full_state_chunk',
  PIECES_PATCH: 'pieces_patch',
  LOCK_REQUEST: 'lock_request',
  LOCK_GRANTED: 'lock_granted',
  LOCK_DENIED: 'lock_denied',
  LOCK_RELEASE: 'lock_release',
  DRAG_PREVIEW: 'drag_preview',
  DROP_REQUEST: 'drop_request',
  ROTATE_REQUEST: 'rotate_request',
  FLIP_REQUEST: 'flip_request',

  // Realtime Presence & Sabotage
  CURSOR_MOVE: 'cursor_move',
  ROSTER_UPDATE: 'roster_update',
  OJAMA_VISUAL: 'ojama_visual',
  OJAMA_VISUAL_CLEAR: 'ojama_visual_clear',
  OJAMA_FAKE_PIECES: 'ojama_fake_pieces',
  OJAMA_SUPERCHAT: 'ojama_superchat',
  SUPERCHAT_HIT: 'superchat_hit',
  SUPERCHAT_STATE: 'superchat_state',
  SUPERCHAT_DISMISS: 'superchat_dismiss',
  OJAMA_NOTICE: 'ojama_notice',
  PUZZLE_COMPLETED: 'puzzle_completed',
};

export function generateRoomId() {
  if (globalThis.crypto?.randomUUID) {
    return `cj-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `cj-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function generateToken() {
  if (globalThis.crypto?.getRandomValues) {
    const buf = new Uint8Array(16);
    globalThis.crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * Pure-JS SHA-256 fallback when crypto.subtle is unavailable (e.g. non-localhost HTTP).
 */
function sha256FallbackHex(ascii) {
  const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';
  const words = [];
  const asciiBitLength = ascii.length * 8;

  const hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += '\x80';
  while ((ascii.length % 64) - 56) ascii += '\x00';
  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (let j = 0; j < words.length;) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }
    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

export async function sha256Hex(input) {
  const text = String(input);
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  const utf8 = unescape(encodeURIComponent(text));
  return sha256FallbackHex(utf8);
}

export async function computeChallengeHash(nonce, passcode = '') {
  return sha256Hex(`${nonce}:${passcode || ''}`);
}

export function isValidMessage(msg) {
  return Boolean(msg && typeof msg === 'object' && typeof msg.type === 'string');
}
