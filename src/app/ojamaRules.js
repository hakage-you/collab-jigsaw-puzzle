// Pure comment -> interference decision logic. No DOM, no timers, no side effects.
// The UI layer (src/ui/ojamaController.js) executes the returned action.
import { OJAMA_CONFIG } from '../config/constants.js';

export const COMPLETED_NOTICE = 'パズル完成済みのためお邪魔は発動しません';

/**
 * Comment ojama types in tie-break order: when two keywords of the same length match, the
 * earlier type wins. Each type has its own editable keyword list (settings.ojama.triggers), and
 * `random` fires a random ojama. The giant superchat is not here: only real superchats bring it.
 */
export const TRIGGER_ACTIONS = Object.freeze(Object.keys(OJAMA_CONFIG.DEFAULT_TRIGGERS));

/**
 * Text as keywords are compared: full-width letters and signs as half-width ("！ＤＲＯＰ" is
 * "!drop"), lower case.
 */
export function normalizeKeyword(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase();
}

// Keywords: split on ',', normalized, trimmed, empties dropped, longest first
// so that '!spin' wins over '!sp'.
export function parseTriggerWords(triggerWords) {
  return normalizeKeyword(triggerWords)
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

/**
 * Every { word, action } of the per-type keyword lists, longest word first (ties: type order).
 * Types switched off in `enabled` are left out.
 */
export function buildTriggerTable(triggers = {}, enabled = {}) {
  const table = TRIGGER_ACTIONS.filter((action) => enabled[action] !== false).flatMap((action) =>
    parseTriggerWords(triggers[action]).map((word) => ({ word, action })),
  );
  return table.sort((a, b) => b.word.length - a.word.length);
}

/** Whether `word` appears in the (normalized) comment the way `mode` asks. */
function keywordMatches(comment, word, mode) {
  if (mode === 'start') return comment.startsWith(word);
  if (mode === 'whole') return comment === word;
  return comment.includes(word);
}

/**
 * The first (longest) keyword in `table` found in the comment, or null.
 * `mode`: 'any' (anywhere in it), 'start' (it starts with the keyword) or 'whole' (it is the
 * keyword and nothing else).
 */
export function findTrigger(table, text, mode = 'any') {
  const comment = normalizeKeyword(text).trim();
  return table.find((t) => keywordMatches(comment, t.word, mode)) ?? null;
}

/**
 * The type a random ojama picks: one of the types in use and in the random pool, chosen by
 * `random()` (0 <= x < 1). Pieces can only drop when some are placed. Null when none can.
 */
export function pickRandomOjama({ ojama, hasLocked, random = Math.random }) {
  const pool = { ...OJAMA_CONFIG.DEFAULT_RANDOM_POOL, ...(ojama.randomPool || {}) };
  const options = OJAMA_CONFIG.TYPES.filter(
    (t) => ojama.enabled?.[t] !== false && pool[t] && (t !== 'drop' || hasLocked),
  );
  if (options.length === 0) return null;
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

function completedResult(matchedWord, state) {
  return {
    action: null,
    matchedWord,
    nextState: { ...state },
    notice: matchedWord ? COMPLETED_NOTICE : null,
    viewerFired: false,
  };
}

// Comment-count branch: reaching the threshold always resets the counter,
// but a random interference only fires when the cooldown is ready.
function thresholdResult({ matchedWord, state, cooldownReady, now }) {
  const nextState = { commentCounter: 0, lastOjamaTime: state.lastOjamaTime };
  const base = { matchedWord, nextState, notice: null, viewerFired: false };
  if (cooldownReady) {
    nextState.lastOjamaTime = now;
    return { ...base, action: 'random' };
  }
  return { ...base, action: null };
}

/** Whether this viewer's own wait (perViewerCooldownSec since their last ojama) is over. */
function viewerReady(o, viewerLastTime, now) {
  const waitMs = (o.perViewerCooldownSec || 0) * 1000;
  return waitMs <= 0 || viewerLastTime == null || now - viewerLastTime >= waitMs;
}

/**
 * @param {{ text: string, settings: object, now: number,
 *           state: { commentCounter: number, lastOjamaTime: number },
 *           isCompleted: boolean, viewerLastTime?: number|null }} input
 *   `viewerLastTime`: when this comment's author last set off an ojama by keyword (or null).
 * @returns {{ action: string|null, matchedWord: string|null,
 *            nextState: { commentCounter: number, lastOjamaTime: number },
 *            notice: string|null, viewerFired: boolean }}
 *   `viewerFired`: the author's keyword set it off (the caller notes the time for the author).
 */
export function decideCommentOjama({ text, settings, now, state, isCompleted, viewerLastTime }) {
  const o = settings.ojama;
  const cooldownMs = o.cooldownSec * 1000;
  const table = buildTriggerTable(o.triggers, o.enabled);
  const trigger = findTrigger(table, text, o.matchMode);
  const matchedWord = trigger?.word ?? null;

  if (isCompleted) return completedResult(matchedWord, state);

  const counting = o.commentCountOn !== false;
  const commentCounter = counting ? state.commentCounter + 1 : state.commentCounter;
  const cooldownReady = now - state.lastOjamaTime >= cooldownMs;

  if (matchedWord && cooldownReady && viewerReady(o, viewerLastTime, now)) {
    return {
      action: trigger.action,
      matchedWord,
      nextState: { commentCounter, lastOjamaTime: now },
      notice: null,
      viewerFired: true,
    };
  }
  if (counting && commentCounter >= o.commentThreshold) {
    return thresholdResult({ matchedWord, state, cooldownReady, now });
  }
  return {
    action: null,
    matchedWord,
    nextState: { commentCounter, lastOjamaTime: state.lastOjamaTime },
    notice: null,
    viewerFired: false,
  };
}
