// Pure comment -> interference decision logic. No DOM, no timers, no side effects.
// The UI layer (src/ui/ojamaController.js) executes the returned action.
import { OJAMA_CONFIG } from '../config/constants.js';

export const COMPLETED_NOTICE = 'パズル完成済みのためお邪魔は発動しません';

/**
 * Comment ojama types in tie-break order: when two trigger words of the same length match, the
 * earlier type wins. Each type has its own editable list of trigger words (settings.ojama.triggers).
 */
export const TRIGGER_ACTIONS = Object.freeze(Object.keys(OJAMA_CONFIG.DEFAULT_TRIGGERS));

// Trigger words: split on ',', trimmed, lowercased, empties dropped, longest first
// so that '!spin' wins over '!sp'.
export function parseTriggerWords(triggerWords) {
  return String(triggerWords ?? '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

/** Every { word, action } of the per-type trigger lists, longest word first (ties: type order). */
export function buildTriggerTable(triggers = {}) {
  const table = TRIGGER_ACTIONS.flatMap((action) =>
    parseTriggerWords(triggers[action]).map((word) => ({ word, action })),
  );
  return table.sort((a, b) => b.word.length - a.word.length);
}

/** The first (longest) trigger in `table` contained in the lowercased text, or null. */
export function findTrigger(table, lowerText) {
  return table.find((t) => lowerText.includes(t.word)) ?? null;
}

function completedResult(matchedWord, state) {
  return {
    action: null,
    matchedWord,
    nextState: { ...state },
    notice: matchedWord ? COMPLETED_NOTICE : null,
  };
}

// Comment-count branch: reaching the threshold always resets the counter,
// but a random interference only fires when the cooldown is ready.
function thresholdResult({ matchedWord, state, cooldownReady, now }) {
  const nextState = { commentCounter: 0, lastOjamaTime: state.lastOjamaTime };
  if (cooldownReady) {
    nextState.lastOjamaTime = now;
    return { action: 'random', matchedWord, nextState, notice: null };
  }
  return { action: null, matchedWord, nextState, notice: null };
}

/**
 * @param {{ text: string, settings: object, now: number,
 *           state: { commentCounter: number, lastOjamaTime: number },
 *           isCompleted: boolean }} input
 * @returns {{ action: string|null, matchedWord: string|null,
 *            nextState: { commentCounter: number, lastOjamaTime: number },
 *            notice: string|null }}
 */
export function decideCommentOjama({ text, settings, now, state, isCompleted }) {
  const { commentThreshold, cooldownSec } = settings.ojama;
  const cooldownMs = cooldownSec * 1000;
  const lowerText = text.toLowerCase();
  const trigger = findTrigger(buildTriggerTable(settings.ojama.triggers), lowerText);
  const matchedWord = trigger?.word ?? null;

  if (isCompleted) return completedResult(matchedWord, state);

  const commentCounter = state.commentCounter + 1;
  const cooldownReady = now - state.lastOjamaTime >= cooldownMs;

  if (matchedWord && cooldownReady) {
    return {
      action: trigger.action,
      matchedWord,
      nextState: { commentCounter, lastOjamaTime: now },
      notice: null,
    };
  }
  if (commentCounter >= commentThreshold) {
    return thresholdResult({ matchedWord, state, cooldownReady, now });
  }
  return {
    action: null,
    matchedWord,
    nextState: { commentCounter, lastOjamaTime: state.lastOjamaTime },
    notice: null,
  };
}
