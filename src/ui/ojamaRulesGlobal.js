import { OJAMA_CONFIG } from '../config/constants.js';
import { h, switchEl } from './domBuild.js';
import { GLOBAL_NUMBERS, MATCH_CHOICES, OJAMA_INFO, readWholeNumber } from './ojamaRulesSpec.js';

/**
 * The right side of the ojama rules tab when "全体の設定" is picked: the wait between ojama,
 * random ojama (by keyword and by comment count, and which types it may pick) and how keywords
 * must appear in a comment.
 * @param {object} deps
 * @param {object} deps.ojama  settings.ojama
 * @param {(partial: object) => void} deps.patch
 * @param {(key: string) => HTMLElement} deps.keywordEditor  a keyword editor for a list
 * @param {(type: string) => void} deps.open  opens one ojama's settings
 */
export function buildGlobalDetail({ ojama, patch, keywordEditor, open }) {
  const number = (key) => {
    const spec = GLOBAL_NUMBERS[key];
    const input = h('input', { type: 'number', min: spec.min, max: spec.max, value: ojama[key] });
    input.addEventListener('change', () => {
      const n = readWholeNumber(input.value, spec);
      if (n === null) input.value = ojama[key];
      else patch({ [key]: n });
    });
    return input;
  };
  return h(
    'div',
    { class: 'rules-detail-body' },
    waitCard(number),
    randomCard({ ojama, patch, keywordEditor, open, number }),
    matchCard(ojama, patch),
  );
}

function card(title, lead, ...children) {
  return h(
    'section',
    { class: 'rules-card' },
    h('h4', { text: title }),
    lead && h('p', { class: 'rules-lead', text: lead }),
    ...children,
  );
}

const zero = () => h('span', { class: 'rules-note', text: '（0＝なし）' });

function waitCard(number) {
  return card(
    '連発の制限',
    'キーワードとコメントの数で出るお邪魔に効きます（スパチャは除く）。',
    h(
      'p',
      { class: 'rules-line' },
      'お邪魔が出たら、次まで ',
      number('cooldownSec'),
      ' 秒あける ',
      zero(),
    ),
    h(
      'p',
      { class: 'rules-line' },
      '同じ視聴者のコメントでは、次まで ',
      number('perViewerCooldownSec'),
      ' 秒あける ',
      zero(),
    ),
  );
}

function randomCard({ ojama, patch, keywordEditor, open, number }) {
  const countOn = ojama.commentCountOn !== false;
  const count = number('commentThreshold');
  count.disabled = !countOn;
  const pool = { ...OJAMA_CONFIG.DEFAULT_RANDOM_POOL, ...ojama.randomPool };
  const targets = OJAMA_CONFIG.TYPES.filter((t) => ojama.enabled?.[t] !== false && pool[t]);
  return card(
    'ランダム発動',
    '対象のお邪魔の中から、ランダムに1つ出します。',
    h('h5', { text: 'キーワードで出す' }),
    keywordEditor('random'),
    h('h5', { text: 'コメントの数で出す' }),
    h(
      'div',
      { class: 'rules-line' },
      switchEl({
        checked: countOn,
        label: 'コメントの数で出す',
        onChange: (v) => {
          count.disabled = !v;
          patch({ commentCountOn: v });
        },
      }),
      ' 視聴者のコメント（すべて）が ',
      count,
      ' 件たまるごとに、ランダムに1つ出す',
    ),
    h(
      'h5',
      {},
      'ランダム発動の対象 ',
      h('span', { class: 'rules-note', text: '（各お邪魔の画面で変えます）' }),
    ),
    h(
      'div',
      { class: 'rules-links' },
      targets.length === 0
        ? h('span', { class: 'rules-note', text: 'なし' })
        : targets.map((t) =>
            h('button', {
              type: 'button',
              class: 'rules-link',
              text: OJAMA_INFO[t].name,
              onClick: () => open(t),
            }),
          ),
    ),
  );
}

function matchCard(ojama, patch) {
  const current = ojama.matchMode || OJAMA_CONFIG.DEFAULT_MATCH_MODE;
  return card(
    'キーワードの一致のしかた',
    '大文字・小文字、全角・半角は区別しません。',
    h(
      'div',
      { class: 'rules-radios', role: 'radiogroup', 'aria-label': 'キーワードの一致のしかた' },
      MATCH_CHOICES.map((c) => {
        const input = h('input', {
          type: 'radio',
          name: 'ojamaMatchMode',
          value: c.value,
          onChange: () => patch({ matchMode: c.value }),
        });
        input.checked = c.value === current;
        return h(
          'label',
          { class: 'rules-radio' },
          input,
          h(
            'span',
            {},
            c.label,
            c.badge && h('span', { class: 'rules-badge', text: c.badge }),
            h('small', { text: c.example }),
          ),
        );
      }),
    ),
  );
}
