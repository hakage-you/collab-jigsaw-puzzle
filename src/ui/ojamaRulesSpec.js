/**
 * What the ojama rules screen shows: each ojama's name and one-line description, and the fields
 * of its "効果の内容" (settings.ojama keys). Number fields are read as whole numbers kept within
 * [min, max].
 */

export const OJAMA_INFO = Object.freeze({
  drop: { name: '落下', desc: 'はまったピースが外れる' },
  visual: { name: '視覚妨害', desc: '画面の色や明るさが変わる' },
  ghost: { name: '透明化', desc: 'ピースが透けて見えにくくなる' },
  prank: { name: 'いたずら', desc: 'まだはまっていないピースが回ったり裏返ったりする' },
  superchat: { name: '巨大スパチャ', desc: '連打で倒すまで盤面をふさぐ' },
  fake: { name: '偽ピース', desc: 'はまらないピースが混ざる' },
  heavy: { name: '重い', desc: 'ピースが重くなり、ゆっくり動く' },
  runaway: { name: '逃げる', desc: 'つかんだピースが逃げる' },
});

const REDUCE = { label: '1個はめるごとに残り時間を減らす（秒）', min: 0, max: 60 };

/**
 * Per type: { key, label, hint?, min, max } (number), { key, label, options: [[value, text]] }
 * (select), { key, label, bool: true } (switch) or { keys: [minKey, maxKey], label, min, max }
 * (a range of two numbers).
 */
export const EFFECT_FIELDS = Object.freeze({
  drop: [{ key: 'dropCount', label: '外れるピースの数', min: 1, max: 20 }],
  visual: [
    {
      key: 'visualType',
      label: '種類',
      options: [
        ['random', 'ランダム（毎回どれか）'],
        ['grayscale', 'モノクロ（白黒）'],
        ['sepia', 'セピア色'],
        ['hue', '色相シャッフル'],
        ['spotlight', '暗闇スポットライト'],
      ],
    },
    { key: 'visualDuration', label: '続く時間（秒）', min: 2, max: 30 },
  ],
  ghost: [{ key: 'ghostDuration', label: '続く時間（秒）', min: 2, max: 30 }],
  prank: [{ key: 'prankCount', label: '動くピースの数', min: 1, max: 20 }],
  superchat: [
    {
      key: 'superchatDuration',
      label: '続く時間（秒）',
      hint: '0なら倒すまで消えない',
      min: 0,
      max: 600,
    },
    { key: 'superchatScaleByTier', label: '金額が高いほど倒しにくくする', bool: true },
  ],
  fake: [
    { key: 'fakeAddCount', label: '一度に混ぜる数', min: 1, max: 16 },
    { key: 'fakeDuration', label: '続く時間（秒）', hint: '0ならずっと残る', min: 0, max: 600 },
    { key: 'fakeMaxCount', label: '同時に出せる上限', min: 1, max: 16 },
  ],
  heavy: [
    {
      key: 'heavyLevel',
      label: '重さ',
      options: [
        ['strong', 'やや重い（約1秒で追いつく）'],
        ['heavier', '重い（約2秒）'],
        ['heaviest', '激重（約3.5秒）'],
      ],
    },
    { key: 'heavyDuration', label: '続く時間（秒）', min: 5, max: 300 },
    { key: 'heavyReduceSec', ...REDUCE },
  ],
  runaway: [
    { key: 'runawayChance', label: 'つかんだとき逃げる確率（%）', min: 0, max: 100 },
    { key: 'runawayDuration', label: '続く時間（秒）', min: 5, max: 300 },
    {
      keys: ['runawayGripMinSec', 'runawayGripMaxSec'],
      label: 'つかんでから逃げるまで（秒・この範囲でランダム）',
      min: 1,
      max: 30,
    },
    { key: 'runawayReduceSec', ...REDUCE },
  ],
});

/** The whole-screen settings' number fields. */
export const GLOBAL_NUMBERS = Object.freeze({
  cooldownSec: { min: 0, max: 120 },
  perViewerCooldownSec: { min: 0, max: 600 },
  commentThreshold: { min: 1, max: 100 },
});

export const MATCH_CHOICES = Object.freeze([
  {
    value: 'any',
    label: 'コメントのどこかに含む',
    badge: '賑やかにしたい場合におすすめ',
    example: '例: 「!drop」は「みんな !drop して」にも反応する',
  },
  {
    value: 'start',
    label: 'コメントの先頭',
    example: '例: 「!drop お願い」には反応し、「お願い !drop」には反応しない',
  },
  {
    value: 'whole',
    label: 'コメント全体がそのキーワード',
    example: '例: 「!drop」とだけ書いたコメントにだけ反応する',
  },
]);

/** Whole number from an input value, kept within [min, max]; null when not a number. */
export function readWholeNumber(value, { min, max }) {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
