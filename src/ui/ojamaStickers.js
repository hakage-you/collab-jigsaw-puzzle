import { h } from './domBuild.js';
import { OJAMA_INFO } from './ojamaRulesSpec.js';

/** How long a sticker stays before it peels off, and how long the peel takes (ms). */
const SHOW_MS = 2600;
const PEEL_MS = 350;
/** Stickers on screen at once; a new one peels the oldest off early. */
const MAX_SHOWN = 3;
/** Each sticker is stuck on at a slight, random angle, up to this much either way (deg). */
const MAX_TILT_DEG = 4;

/**
 * An ojama's notice as a paper sticker slapped on above the board (styles: .ojama-sticker): the
 * one line on what happened, on the ojama's colour. No heading with the ojama's name: seen on
 * every notice, it only gets in the way. Who set it off (when shown) comes first, on a line of
 * its own in smaller, lighter type, so that what happened stands out. It peels off after a few seconds. Clicks go through
 * it, so it never stops play.
 */
export class OjamaStickers {
  constructor() {
    this.el = document.getElementById('ojamaStickers');
  }

  /**
   * @param {{kind: string, text: string, lead?: string}} notice  kind: an ojama type (OJAMA_INFO);
   *   text: what happened; lead: who set it off ("〇〇さんの叫びで、"), or none
   */
  show({ kind, text, lead = '' }) {
    if (!this.el) return;
    const sticker = h(
      'div',
      { class: `ojama-sticker is-${OJAMA_INFO[kind] ? kind : 'other'}` },
      lead && h('span', { class: 'ojama-sticker-lead', text: lead }),
      h('strong', { class: 'ojama-sticker-effect', text }),
    );
    const tilt = (Math.random() * 2 - 1) * MAX_TILT_DEG;
    sticker.style.setProperty('--tilt', `${tilt.toFixed(1)}deg`);
    this.el.append(sticker);
    const shown = [...this.el.querySelectorAll('.ojama-sticker:not(.is-peeling)')];
    for (const old of shown.slice(0, Math.max(0, shown.length - MAX_SHOWN))) this._peel(old);
    sticker.peelTimer = setTimeout(() => this._peel(sticker), SHOW_MS);
  }

  _peel(sticker) {
    if (sticker.classList.contains('is-peeling')) return;
    clearTimeout(sticker.peelTimer);
    sticker.classList.add('is-peeling');
    setTimeout(() => sticker.remove(), PEEL_MS);
  }

  /** Takes every sticker off at once (a new puzzle). */
  clear() {
    if (this.el) this.el.replaceChildren();
  }
}
