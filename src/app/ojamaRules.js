// Pure comment -> interference decision logic. No DOM, no timers, no side effects.
// The UI layer (src/ui/ojamaController.js) executes the returned action.

export const COMPLETED_NOTICE = 'パズル完成済みのためお邪魔は発動しません';

// Trigger words: split on ',', trimmed, lowercased, empties dropped, longest first
// so that '!spin' wins over '!sp'.
export function parseTriggerWords(triggerWords) {
  return triggerWords
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

export function findMatchedWord(words, lowerText) {
  return words.find((w) => lowerText.includes(w)) ?? null;
}

// Keyword branch: the matched trigger word and Japanese words in the comment both count.
export function resolveKeywordAction(matchedWord, lowerText) {
  if (matchedWord.includes('drop') || lowerText.includes('落と')) return 'drop';
  if (matchedWord.includes('ghost') || lowerText.includes('透明')) return 'ghost';
  if (matchedWord.includes('fake') || lowerText.includes('偽')) return 'fake';
  if (matchedWord.includes('color') || lowerText.includes('色')) return 'visual';
  if (matchedWord.includes('spin') || lowerText.includes('回')) return 'prank';
  if (matchedWord.includes('sp') || lowerText.includes('スパ')) return 'superchat';
  return 'random';
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
  const matchedWord = findMatchedWord(parseTriggerWords(settings.ojama.triggerWords), lowerText);

  if (isCompleted) return completedResult(matchedWord, state);

  const commentCounter = state.commentCounter + 1;
  const cooldownReady = now - state.lastOjamaTime >= cooldownMs;

  if (matchedWord && cooldownReady) {
    return {
      action: resolveKeywordAction(matchedWord, lowerText),
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
