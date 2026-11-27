// What the keyword guide says while streaming: which keywords set off which ojama. Pure: the UI
// (src/ui/keywordGuideUI.js) shows it and decides when.
import { OJAMA_CONFIG } from '../config/constants.js';
import { TRIGGER_ACTIONS, normalizeKeyword, randomTargets } from './ojamaRules.js';

/**
 * The comment a keyword sets off an ojama in, per settings.ojama.matchMode: shown right under the
 * keywords, so that they read on ("!drop" or "落" から始まるコメント).
 */
const LEADS = Object.freeze({
  any: 'を含むコメント',
  start: 'から始まるコメント',
  whole: 'だけのコメント',
});

/** What follows the keywords in the guide: which comments they work in (`matchMode`). */
export function guideLead(matchMode) {
  return LEADS[matchMode] ?? LEADS[OJAMA_CONFIG.DEFAULT_MATCH_MODE];
}

/**
 * Keywords as the guide shows them: all of them, in the streamer's order, full-width letters as
 * half-width (as they are compared), a word once when it is compared the same (case ignored).
 */
export function guideWords(triggerWords) {
  const seen = new Set();
  const words = [];
  for (const raw of String(triggerWords ?? '')
    .normalize('NFKC')
    .split(',')) {
    const word = raw.trim();
    const key = normalizeKeyword(word);
    if (!word || seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  return words;
}

/** Whether keywords of `action` can set something off now. */
function canFire(ojama, action) {
  if (action === 'random') return randomTargets(ojama).length > 0;
  return ojama.enabled?.[action] !== false;
}

/**
 * The guide's lines, in the order they take turns: one per ojama type in use that has keywords
 * (random when it has something to pick), then the giant superchat while YouTube is linked and it
 * is in use (only a real superchat brings it: it has no keywords).
 * @param {{ ojama: object, youtubeLive?: boolean }} input  settings.ojama; YouTube linked or not
 * @returns {{ type: string, words: string[] }[]}
 */
export function buildKeywordGuide({ ojama, youtubeLive = false }) {
  const lines = TRIGGER_ACTIONS.filter((action) => canFire(ojama, action))
    .map((type) => ({ type, words: guideWords(ojama.triggers?.[type]) }))
    .filter((line) => line.words.length > 0);
  if (youtubeLive && ojama.enabled?.superchat !== false) {
    lines.push({ type: 'superchat', words: [] });
  }
  return lines;
}
