import { h } from './domBuild.js';

/**
 * Text with some parts in bold, without markup strings: a plain string, or an array of strings
 * and { strong } parts, e.g. ['…オフにしました。', { strong: '配信・お邪魔設定 → …' }, 'で戻せます。'].
 * Returns children for h() (strings go in as text, never as markup).
 * @param {string | (string | { strong: string })[]} message
 */
export function richText(message) {
  const parts = Array.isArray(message) ? message : [message];
  return parts.map((part) =>
    typeof part === 'string' ? part : h('strong', { text: String(part.strong) }),
  );
}
