import { sound } from '../services/sound.js';

const TEXTS = {
  heavy: {
    label: '重い',
    start: 'ピースが重くて持ち上げられない！',
    end: 'ピースの重さがもとに戻った',
  },
  runaway: {
    label: '逃げる',
    start: 'ピースは自由を謳歌している！',
    end: 'ピースたちはおとなしくなった',
  },
};

/**
 * Synchronizes the stage edge vignette (#ojamaVignette) from timed and visual ojama state.
 * Timed ojama ('heavy' / 'runaway') takes priority over 'visual'.
 */
export function syncOjamaVignette({ timed = undefined, visual = undefined } = {}) {
  const el = document.getElementById('ojamaVignette');
  if (!el) return;
  if (timed !== undefined) el.dataset.timedVignette = timed;
  if (visual !== undefined) el.dataset.visualVignette = visual;
  const active = el.dataset.timedVignette || el.dataset.visualVignette || '';
  if (active) {
    el.dataset.vignette = active;
    el.classList.add('is-active');
  } else {
    delete el.dataset.vignette;
    el.classList.remove('is-active');
  }
}

/**
 * Shows heavy and runaway pieces (ojama that last a while; GameSession runs their countdown):
 * the banner with the time left, the stage vignette, and a notice when one starts or ends.
 */
export class TimedOjamaController {
  /**
   * @param {object} deps
   * @param {(kind: string, text: string, author: string|null) => void} deps.announce  shows the
   *   start of one (the ojama sticker); its end is a plain notice (`showToast`)
   */
  constructor({ app, showToast, announce }) {
    this.showToast = showToast;
    this.announce = announce;
    this.elBanner = document.getElementById('timedOjamaBanner');

    app.on('timedOjamaChange', (change) => this._notify(change));
    app.on('timedOjamaState', ({ active }) => this._render(active));
  }

  /** The notice of one that started or ended, when the session asks for one. */
  _notify({ kind, active, announce, author }) {
    if (!announce) return;
    if (active) {
      sound.playOjama();
      this.announce(kind, TEXTS[kind].start, author);
    } else {
      this.showToast(TEXTS[kind].end, 'success');
    }
  }

  _render(active) {
    const kinds = active.map((s) => s.kind);
    syncOjamaVignette({
      timed: kinds.includes('heavy') ? 'heavy' : kinds.includes('runaway') ? 'runaway' : '',
    });
    if (!this.elBanner) return;
    const parts = active.map(
      ({ kind, remaining }) => `${TEXTS[kind].label} 残り${Math.max(0, Math.ceil(remaining))}秒`,
    );
    this.elBanner.textContent = parts.join('・');
    this.elBanner.classList.toggle('hidden', parts.length === 0);
  }
}
