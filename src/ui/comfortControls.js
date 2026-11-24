import { COMFORT_CONFIG } from '../config/constants.js';
import { OS_REDUCE_MOTION_QUERY, resolveEffectStrength } from '../app/comfortSettings.js';
import { sound } from '../services/sound.js';
import { h } from './domBuild.js';

const STRENGTH_LABELS = Object.freeze({ normal: '標準', reduced: '控えめ', off: 'オフ' });

const VOLUME_LABELS = Object.freeze({
  normal: '通常音（はまる音・完成音）',
  ojama: 'おじゃま音（おじゃま・スパチャ）',
});

const STRENGTH_HINT =
  'ピースの持ち上げや星・紙吹雪などの動きの量です。端末で動きを減らす設定をしていると、最初は「控えめ」になります。';

/** A volume as shown next to its slider. */
function volumeText(value) {
  return value === 0 ? '消音' : `${value}%`;
}

/**
 * "演出と音": the effect strength and the volume of each kind of sound, this player's own
 * settings (settings.effectStrength, settings.volume). Built into every `[data-comfort-controls]`
 * box (the lobby's "演出と音" dialog and the menu's 表示・サウンド); all of them show the same
 * settings, and a change is saved at once.
 */
export class ComfortControls {
  constructor({ app }) {
    this.app = app;
    this.osReduce = window.matchMedia(OS_REDUCE_MOTION_QUERY);
    this.views = [...document.querySelectorAll('[data-comfort-controls]')].map((box) =>
      this._build(box),
    );
    this.app.on('settingsChange', () => this.sync());
    // Until the player chooses a strength, the one shown follows the OS.
    this.osReduce.addEventListener('change', () => this.sync());
    this.sync();
  }

  _build(box) {
    const strengthButtons = COMFORT_CONFIG.EFFECT_STRENGTHS.map((strength) =>
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-xs btn-seg',
          dataset: { effectStrength: strength },
          'aria-pressed': 'false',
          onClick: () => this.app.patchSettings({ effectStrength: strength }),
        },
        STRENGTH_LABELS[strength],
      ),
    );
    const ranges = {};
    const values = {};
    const volumeRows = COMFORT_CONFIG.VOLUME_KINDS.map((kind) => {
      values[kind] = h('strong', { class: 'comfort-volume-value' });
      ranges[kind] = h('input', {
        type: 'range',
        min: 0,
        max: 100,
        step: COMFORT_CONFIG.VOLUME_STEP,
        'aria-label': VOLUME_LABELS[kind],
        onInput: () => this._setVolume(kind, Number(ranges[kind].value)),
        // Let go (or a key step): a sample of that kind, to hear how loud it is now.
        onChange: () => sound.playSample(kind),
      });
      return h(
        'label',
        { class: 'range-row comfort-volume' },
        h(
          'span',
          { class: 'comfort-volume-head' },
          h('span', { text: VOLUME_LABELS[kind] }),
          values[kind],
        ),
        ranges[kind],
      );
    });
    box.replaceChildren(
      h(
        'div',
        { class: 'setting-row' },
        h('span', { class: 'setting-row-label', text: '演出の強さ' }),
        h(
          'div',
          { class: 'setting-seg-group', role: 'group', 'aria-label': '演出の強さ' },
          strengthButtons,
        ),
      ),
      h('p', { class: 'hint-text comfort-hint', text: STRENGTH_HINT }),
      h('div', { class: 'comfort-volumes' }, volumeRows),
    );
    return { strengthButtons, ranges, values };
  }

  _setVolume(kind, value) {
    const volume = { ...this.app.getSettings().volume, [kind]: value };
    this.app.patchSettings({ volume });
  }

  /** Shows the settings in every box: the strength in effect, and each volume. */
  sync() {
    const settings = this.app.getSettings();
    const strength = resolveEffectStrength(settings.effectStrength, this.osReduce.matches);
    for (const view of this.views) {
      for (const btn of view.strengthButtons) {
        const on = btn.dataset.effectStrength === strength;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
      }
      for (const kind of COMFORT_CONFIG.VOLUME_KINDS) {
        const value = settings.volume?.[kind] ?? COMFORT_CONFIG.DEFAULT_VOLUME;
        if (Number(view.ranges[kind].value) !== value) view.ranges[kind].value = String(value);
        view.values[kind].textContent = volumeText(value);
      }
    }
  }
}
