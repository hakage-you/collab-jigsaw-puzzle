import { buildKeywordGuide, guideLead } from '../app/keywordGuide.js';
import { OJAMA_CONFIG } from '../config/constants.js';
import { h } from './domBuild.js';
import { OJAMA_INFO } from './ojamaRulesSpec.js';

/** A line too long for the guide stays still this long, then slides, then stays again (ms). */
const SLIDE_HOLD_MS = 1200;
/** How fast a long line slides to show the rest (px per second): slow enough to read along. */
const SLIDE_PX_PER_SEC = 50;

/** Where the guide comes back after its × (the ojama rules' "全体の設定"), said step by step. */
const WAY_BACK = '配信・お邪魔設定 → お邪魔ルール → 全体の設定';
/** The way back in bold: it is what to remember. */
const TURNED_OFF_NOTICE = [
  'キーワードの案内をオフにしました。',
  { strong: WAY_BACK },
  'で戻せます。',
];
/** Long enough to read the way back. */
const TURNED_OFF_NOTICE_MS = 6000;

/** What each line calls its ojama (OJAMA_INFO has no random). */
const lineName = (type) => (type === 'random' ? 'ランダム' : OJAMA_INFO[type].name);

/** A keyword as a viewer's comment (a small speech bubble). */
const bubble = (text) => h('span', { class: 'keyword-guide-word', text });

/** The keywords, "or" between them; the giant superchat comes from sending one, not a word. */
function commentsFor({ type, words }) {
  if (type === 'superchat') return [bubble('スパチャを送る')];
  return words.flatMap((word, i) => [
    i > 0 && h('span', { class: 'keyword-guide-or', text: 'or' }),
    bubble(word),
  ]);
}

/** The page's own motions are off ("演出と音": reduced or off; styles: .effects-reduced). */
const motionReduced = () => document.documentElement.classList.contains('effects-reduced');

/**
 * The keyword guide at the board's top left: while comments come in (YouTube linked or the CPU's
 * comments) and the guide is on (settings.ojama.keywordGuideOn, on by default), it tells viewers
 * which keywords do what, one ojama at a time: its keywords as comments ("!drop" or "落"), under
 * them which comments they work in ("を含むコメント", per the match mode), then
 * "→ 発動するお邪魔: 落下". Only on the host's (or a solo player's) screen: the ojama
 * come from the host's comments.
 *
 * The guide keeps its size. Keywords too long for it (many or long ones) slide left to show the
 * rest, and the next ojama comes once they have; with the page's motions off they wrap instead.
 * Its × turns it off (the setting), as the switch in the ojama rules does.
 */
export class KeywordGuideUI {
  constructor({ app, showToast }) {
    this.app = app;
    this.showToast = showToast;
    this.el = document.getElementById('keywordGuide');
    this.elLine = document.getElementById('keywordGuideLine');
    document
      .getElementById('btnCloseKeywordGuide')
      ?.addEventListener('click', () => this.turnOff());
    /** Where comments come from now (YouTubeUI.onLiveChange). */
    this.live = { youtube: false, autoComments: false };
    this.lines = [];
    this.linesKey = '';
    this.index = 0;
    this.intervalMs = 0;
    /** Which comments the keywords work in (guideLead), shown under them. */
    this.lead = '';
    this.timerId = null;
    this.slide = null;

    app.on('settingsChange', () => this.sync());
    app.on('roleChange', () => this.sync());
    this.sync();
  }

  /** Comments started or stopped coming in (YouTube, the CPU's comments). */
  setLive({ youtube = false, autoComments = false } = {}) {
    this.live = { youtube, autoComments };
    this.sync();
  }

  isShown() {
    return !this.el.classList.contains('hidden');
  }

  /** The ×: the guide goes for good (settings), and the toast says the way back to it. */
  turnOff() {
    this.app.patchSettings({ ojama: { keywordGuideOn: false } });
    this.showToast(TURNED_OFF_NOTICE, 'info', { durationMs: TURNED_OFF_NOTICE_MS });
  }

  /** Shows, updates or hides the guide for the settings and the live state now. */
  sync() {
    const ojama = this.app.getSettings().ojama || {};
    const lines = buildKeywordGuide({ ojama, youtubeLive: this.live.youtube });
    const streaming = this.live.youtube || this.live.autoComments;
    const show =
      ojama.keywordGuideOn === true &&
      streaming &&
      this.app.room.role !== 'guest' &&
      lines.length > 0;
    if (!show) {
      this._hide();
      return;
    }
    const wasShown = this.isShown();
    // Shown before measuring: a hidden line has no width.
    this.el.classList.remove('hidden');
    const lead = guideLead(ojama.matchMode);
    const intervalMs =
      (ojama.keywordGuideIntervalSec || OJAMA_CONFIG.DEFAULT_KEYWORD_GUIDE_INTERVAL_SEC) * 1000;
    const linesChanged = this._setLines(lines);
    if (!wasShown || linesChanged || intervalMs !== this.intervalMs || lead !== this.lead) {
      this.intervalMs = intervalMs;
      this.lead = lead;
      this._showLine();
    }
  }

  /** New lines start from the first; the same lines keep their place. True when they changed. */
  _setLines(lines) {
    const key = JSON.stringify(lines);
    if (key === this.linesKey) return false;
    this.linesKey = key;
    this.lines = lines;
    this.index = 0;
    return true;
  }

  /** Puts the current line in, slides it if it is too long, and sets when the next one comes. */
  _showLine() {
    this._stop();
    const current = this.lines[this.index];
    const track = h('span', { class: 'keyword-guide-track' }, commentsFor(current));
    const viewport = h('span', { class: 'keyword-guide-viewport' }, track);
    // The giant superchat is sent, not written: no "…を含むコメント" (its row stays, empty).
    const note = h('p', {
      class: 'keyword-guide-note',
      text: current.type === 'superchat' ? '' : this.lead,
    });
    const result = h(
      'p',
      { class: 'keyword-guide-result' },
      h('span', { class: 'keyword-guide-arrow', 'aria-hidden': 'true' }),
      '発動するお邪魔: ',
      h('span', { class: 'keyword-guide-name', text: lineName(current.type) }),
    );
    // A new node each time, so its fade-in (styles: .keyword-guide-line) plays again.
    const line = h(
      'div',
      { class: `keyword-guide-line is-${current.type}`, id: 'keywordGuideLine' },
      viewport,
      note,
      result,
    );
    this.elLine.replaceWith(line);
    this.elLine = line;

    const overflow = motionReduced() ? 0 : track.scrollWidth - viewport.clientWidth;
    const stayMs = overflow > 0 ? this._slide(track, overflow) : this.intervalMs;
    // One line that fits stays as it is; anything else moves on (a long single line slides again).
    if (this.lines.length > 1 || overflow > 0) {
      this.timerId = setTimeout(() => this._next(), stayMs);
    }
  }

  /** Slides `track` left by `overflow` px after a pause; returns how long the line stays (ms). */
  _slide(track, overflow) {
    const slideMs = (overflow / SLIDE_PX_PER_SEC) * 1000;
    this.slide = track.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(${-overflow}px)` }],
      { duration: slideMs, delay: SLIDE_HOLD_MS, easing: 'ease-in-out', fill: 'forwards' },
    );
    return Math.max(this.intervalMs, SLIDE_HOLD_MS + slideMs + SLIDE_HOLD_MS);
  }

  _next() {
    this.index = (this.index + 1) % this.lines.length;
    this._showLine();
  }

  _stop() {
    if (this.timerId) clearTimeout(this.timerId);
    this.timerId = null;
    this.slide?.cancel();
    this.slide = null;
  }

  _hide() {
    this._stop();
    this.el.classList.add('hidden');
    // Shown again later, it starts from the first line.
    this.linesKey = '';
  }
}
