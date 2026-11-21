import { OJAMA_CONFIG } from '../config/constants.js';
import { TRIGGER_ACTIONS, parseTriggerWords } from '../app/ojamaRules.js';
import { h, switchEl } from './domBuild.js';
import { KeywordEditor } from './keywordEditor.js';
import { EFFECT_FIELDS, OJAMA_INFO, readWholeNumber } from './ojamaRulesSpec.js';
import { buildGlobalDetail } from './ojamaRulesGlobal.js';

const COMMON = 'common';

/**
 * The stream modal's "お邪魔ルール" tab: a list on the left (the whole-screen settings, then each
 * ojama with its on/off switch) and, on the right, the settings of the one picked. Every change is
 * saved at once (app.patchSettings).
 */
export class OjamaRulesPanel {
  /**
   * @param {object} deps
   * @param {object} deps.app  GameSession (getSettings, patchSettings, on)
   * @param {(type: string) => void} deps.tryNow  sets off one ojama to look at it on the board
   * @param {() => void} deps.openTest  opens the test palette ("動作確認")
   */
  constructor({ app, tryNow, openTest }) {
    this.app = app;
    this.tryNow = tryNow;
    this.openTest = openTest;
    this.selected = 'drop';
    this.elRoot = document.getElementById('ojamaRules');
    this.elList = document.getElementById('ojamaRulesList');
    this.elDetail = document.getElementById('ojamaRulesDetail');
    if (!this.elRoot) return;
    /** True while this panel saves a change: its own controls already show it. */
    this.ownPatch = false;
    this.app.on('settingsChange', () => {
      this.renderList();
      if (!this.ownPatch) this.renderDetail();
    });
    this.render();
  }

  get ojama() {
    return this.app.getSettings().ojama;
  }

  /** Saves a change; `refresh` redraws the right side too (its controls depend on it). */
  patch(partial, { refresh = false } = {}) {
    this.ownPatch = !refresh;
    try {
      this.app.patchSettings({ ojama: partial });
    } finally {
      this.ownPatch = false;
    }
  }

  isOn(type) {
    return this.ojama.enabled?.[type] !== false;
  }

  render() {
    this.renderList();
    this.renderDetail();
  }

  select(key) {
    this.selected = key;
    this.render();
    if (this.elRoot.clientWidth < 600) this.elDetail.scrollIntoView({ block: 'start' });
  }

  renderList() {
    const items = OJAMA_CONFIG.TYPES.map((type) => this._typeItem(type));
    this.elList.replaceChildren(
      h('div', { class: 'rules-list-head', text: '動作確認' }),
      h(
        'button',
        { type: 'button', class: 'rules-test', onClick: () => this.openTest() },
        h('span', { class: 'rules-test-icon', 'aria-hidden': 'true', text: '▶' }),
        this._itemText('パレットを開く', '盤面でお邪魔を試す'),
      ),
      h('div', { class: 'rules-list-head', text: '全体' }),
      this._item(COMMON, [
        h('span', { class: 'rules-item-icon', 'aria-hidden': 'true', text: '⚙' }),
        this._itemText('全体の設定', '連発の制限・ランダム発動・キーワードの一致のしかた'),
      ]),
      h(
        'div',
        { class: 'rules-list-head' },
        h('span', { class: 'rules-list-use', text: '使う' }),
        'お邪魔',
      ),
      ...items,
    );
  }

  _typeItem(type) {
    const on = this.isOn(type);
    const sw = switchEl({
      checked: on,
      small: true,
      label: `${OJAMA_INFO[type].name}を使う`,
      onChange: (checked) =>
        this.patch(
          { enabled: { [type]: checked } },
          { refresh: this.selected === type || this.selected === COMMON },
        ),
    });
    const item = this._item(type, [sw, this._itemText(OJAMA_INFO[type].name, this._summary(type))]);
    item.classList.toggle('is-off', !on);
    return item;
  }

  _summary(type) {
    if (!this.isOn(type)) return 'オフ';
    if (type === 'superchat') return 'スパチャで出る';
    const words = parseTriggerWords(this.ojama.triggers?.[type]);
    if (words.length === 0) return 'キーワードなし';
    return words.length > 1 ? `${words[0]} ほか${words.length - 1}個` : words[0];
  }

  _item(key, children) {
    const selected = this.selected === key;
    return h(
      'div',
      {
        class: selected ? 'rules-item is-selected' : 'rules-item',
        role: 'button',
        tabindex: '0',
        'aria-current': selected ? 'true' : null,
        onClick: (e) => {
          if (!e.target.closest('label')) this.select(key);
        },
        onKeydown: (e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault();
            this.select(key);
          }
        },
      },
      ...children,
    );
  }

  _itemText(name, sub) {
    const warn = sub === 'キーワードなし';
    return h(
      'span',
      { class: 'rules-item-text' },
      h('span', { class: 'rules-item-name', text: name }),
      h('span', { class: warn ? 'rules-item-sub is-warn' : 'rules-item-sub', text: sub }),
    );
  }

  renderDetail() {
    const type = this.selected === COMMON ? null : this.selected;
    const head = h(
      'div',
      { class: 'rules-detail-head' },
      h('h3', { text: type ? `${OJAMA_INFO[type].name}の設定` : '全体の設定' }),
      h('button', {
        type: 'button',
        class: 'btn btn-xs rules-back',
        text: '↑ 一覧へ',
        onClick: () => this.elList.scrollIntoView({ block: 'start' }),
      }),
      type && h('p', { class: 'rules-detail-desc', text: OJAMA_INFO[type].desc }),
    );
    const body = type
      ? this._typeDetail(type)
      : buildGlobalDetail({
          ojama: this.ojama,
          patch: (p) => this.patch(p),
          keywordEditor: (key) => this._keywordEditor(key).el,
          open: (t) => this.select(t),
        });
    this.elDetail.replaceChildren(head, body);
  }

  _keywordEditor(key) {
    return new KeywordEditor({
      load: () => this.ojama.triggers?.[key] ?? '',
      save: (text) => this.patch({ triggers: { [key]: text } }),
      ownerOf: (word) => {
        const owner = TRIGGER_ACTIONS.find((a) =>
          parseTriggerWords(this.ojama.triggers?.[a]).includes(word),
        );
        if (!owner) return null;
        return owner === 'random' ? 'ランダム発動' : OJAMA_INFO[owner].name;
      },
    });
  }

  _typeDetail(type) {
    const on = this.isOn(type);
    const pool = { ...OJAMA_CONFIG.DEFAULT_RANDOM_POOL, ...this.ojama.randomPool };
    const trigger =
      type === 'superchat'
        ? row(
            'スパチャ・スーパーステッカー',
            h('span', { class: 'rules-note', text: '届くと必ず出ます（連発の制限なし）' }),
          )
        : row('キーワード', this._keywordEditor(type).el, true);
    return h(
      'div',
      { class: on ? 'rules-detail-body' : 'rules-detail-body is-off' },
      h('h4', { text: '出るきっかけ' }),
      trigger,
      row(
        'ランダム発動の対象',
        switchEl({
          checked: pool[type],
          label: 'ランダム発動の対象',
          onChange: (checked) => this.patch({ randomPool: { [type]: checked } }),
        }),
      ),
      h('h4', { text: '効果の内容' }),
      ...EFFECT_FIELDS[type].map((f) => this._effectField(f)),
      h(
        'div',
        { class: 'rules-try' },
        h('button', {
          type: 'button',
          class: 'btn btn-secondary btn-sm',
          text: '今すぐ出す',
          disabled: !on,
          onClick: () => this.tryNow(type),
        }),
      ),
    );
  }

  _effectField(f) {
    const o = this.ojama;
    if (f.bool) {
      return row(
        f.label,
        switchEl({
          checked: o[f.key] !== false,
          label: f.label,
          onChange: (v) => this.patch({ [f.key]: v }),
        }),
      );
    }
    if (f.options) {
      const select = h('select', { onChange: () => this.patch({ [f.key]: select.value }) });
      select.append(...f.options.map(([value, text]) => h('option', { value, text })));
      select.value = o[f.key];
      return row(f.label, select);
    }
    if (f.keys) return this._rangeField(f);
    return row(f.label, this._number(f.key, f), false, f.hint);
  }

  _number(key, spec) {
    const input = h('input', {
      type: 'number',
      min: spec.min,
      max: spec.max,
      value: this.ojama[key],
    });
    input.addEventListener('change', () => {
      const n = readWholeNumber(input.value, spec);
      if (n === null) input.value = this.ojama[key];
      else this.patch({ [key]: n });
    });
    return input;
  }

  _rangeField(f) {
    const [minKey, maxKey] = f.keys;
    const warn = h('span', { class: 'rules-warn hidden', text: '最短が最長を超えています' });
    const check = () => warn.classList.toggle('hidden', this.ojama[minKey] <= this.ojama[maxKey]);
    const lo = this._number(minKey, f);
    const hi = this._number(maxKey, f);
    for (const input of [lo, hi]) input.addEventListener('change', check);
    check();
    return row(f.label, h('span', { class: 'rules-range' }, lo, ' 〜 ', hi, warn), true);
  }
}

/** One label + control line; `top` aligns the label to the top (for tall controls). */
function row(label, control, top = false, hint = null) {
  return h(
    'div',
    { class: top ? 'rules-row is-top' : 'rules-row' },
    h('span', { class: 'rules-row-label' }, label, hint && h('small', { text: hint })),
    control,
  );
}
