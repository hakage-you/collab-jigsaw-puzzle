import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The real styles: the guide's size and what overflows it are measured.
import '../../styles/tokens.css';
import '../../styles/base.css';
import '../../styles/app.css';
import { OJAMA_CONFIG, STORAGE_KEYS } from '../../src/config/constants.js';
import { loadSavedSettings } from '../../src/services/storage.js';
import { KeywordGuideUI } from '../../src/ui/keywordGuideUI.js';
import { buildGlobalDetail } from '../../src/ui/ojamaRulesGlobal.js';

// The keyword guide at the board's top left while comments come in (keywordGuideUI.js), and its
// card in the ojama rules' "全体の設定" (ojamaRulesGlobal.js).

function mountGuideDom() {
  document.body.innerHTML = `
    <div id="keywordGuide" class="keyword-guide hidden" role="note" aria-label="お邪魔のキーワード">
      <p class="keyword-guide-title">コメントでお邪魔効果が発動！</p>
      <button type="button" class="keyword-guide-close" id="btnCloseKeywordGuide">×</button>
      <div class="keyword-guide-line" id="keywordGuideLine"></div>
    </div>
  `;
}

/** A stand-in for GameSession: settings, role, and the events the guide listens to. */
function createApp({ ojama = {}, role = 'host' } = {}) {
  const listeners = new Map();
  const settings = {
    ojama: {
      triggers: { ...OJAMA_CONFIG.DEFAULT_TRIGGERS },
      enabled: Object.fromEntries(OJAMA_CONFIG.TYPES.map((t) => [t, true])),
      randomPool: { ...OJAMA_CONFIG.DEFAULT_RANDOM_POOL },
      matchMode: 'any',
      keywordGuideOn: true,
      keywordGuideIntervalSec: 4,
      ...ojama,
    },
  };
  const app = {
    room: { role },
    getSettings: () => settings,
    on: (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
    fire: (name, payload) => (listeners.get(name) ?? []).forEach((fn) => fn(payload)),
    /** Changes the ojama settings as GameSession.patchSettings would, then tells the listeners. */
    patchSettings({ ojama: partial }) {
      Object.assign(settings.ojama, partial);
      app.fire('settingsChange', settings);
    },
    patchOjama: (partial) => app.patchSettings({ ojama: partial }),
  };
  return app;
}

const guide = () => document.getElementById('keywordGuide');
const shown = () => !guide().classList.contains('hidden');
/** The current line as "keywords → ojama", e.g. "!drop or 落 → 落下". */
function lineText() {
  const line = document.getElementById('keywordGuideLine');
  const words = [...line.querySelectorAll('.keyword-guide-word')].map((el) => el.textContent);
  return `${words.join(' or ')} → ${line.querySelector('.keyword-guide-name').textContent}`;
}
/** Which comments the keywords work in, under them ("から始まるコメント"). */
const lead = () => document.querySelector('#keywordGuideLine .keyword-guide-note').textContent;

beforeEach(() => {
  vi.useFakeTimers();
  mountGuideDom();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.classList.remove('effects-reduced');
  document.body.innerHTML = '';
});

/** Many keywords for one ojama: too long for one line of the guide. */
const MANY = '!drop, 落, おちろ, ポロッと, 外れろ, もっと外れろ, ぜんぶ外れろ';

/** How far the current line's keywords reach past the guide (px). */
function overflowNow() {
  const viewport = document.querySelector('.keyword-guide-viewport');
  return viewport.firstElementChild.scrollWidth - viewport.clientWidth;
}

/** How long a line that overflows by `px` stays: a pause, the slide, a pause (ms). */
const slideStayMs = (px) => 1200 + (px / 50) * 1000 + 1200;

describe('KeywordGuideUI', () => {
  it('shows while the CPU comments come in, and goes when they stop', () => {
    const ui = new KeywordGuideUI({ app: createApp() });
    expect(shown()).toBe(false);

    ui.setLive({ autoComments: true });
    expect(shown()).toBe(true);
    expect(lineText()).toBe('!drop or 落 → 落下');
    expect(document.getElementById('keywordGuideLine').textContent).toBe(
      '!dropor落を含むコメント発動するお邪魔: 落下',
    );
    expect(lead()).toBe('を含むコメント');

    ui.setLive({ autoComments: false });
    expect(shown()).toBe(false);
  });

  it('shows while YouTube is linked', () => {
    const ui = new KeywordGuideUI({ app: createApp() });
    ui.setLive({ youtube: true });
    expect(shown()).toBe(true);
  });

  it('stays hidden when the streamer has not turned it on', () => {
    const app = createApp({ ojama: { keywordGuideOn: false } });
    const ui = new KeywordGuideUI({ app });
    ui.setLive({ autoComments: true });
    expect(shown()).toBe(false);

    app.patchOjama({ keywordGuideOn: true });
    expect(shown()).toBe(true);
    app.patchOjama({ keywordGuideOn: false });
    expect(shown()).toBe(false);
  });

  it('is never shown on a guest screen', () => {
    const app = createApp({ role: 'guest' });
    const ui = new KeywordGuideUI({ app });
    ui.setLive({ autoComments: true });
    expect(shown()).toBe(false);

    // Hosting again (a new room): it comes back.
    app.room.role = 'host';
    app.fire('roleChange', { role: 'host', isGuest: false });
    expect(shown()).toBe(true);
  });

  it('stays hidden when no keyword can set anything off', () => {
    const triggers = Object.fromEntries(
      Object.keys(OJAMA_CONFIG.DEFAULT_TRIGGERS).map((k) => [k, '']),
    );
    const ui = new KeywordGuideUI({ app: createApp({ ojama: { triggers } }) });
    ui.setLive({ autoComments: true });
    expect(shown()).toBe(false);
  });

  it('goes through the lines every few seconds, and back to the first', () => {
    const triggers = { drop: '!drop', ghost: '!ghost' };
    const ui = new KeywordGuideUI({ app: createApp({ ojama: { triggers } }) });
    ui.setLive({ autoComments: true });
    expect(lineText()).toBe('!drop → 落下');

    vi.advanceTimersByTime(3999);
    expect(lineText()).toBe('!drop → 落下');
    vi.advanceTimersByTime(1);
    expect(lineText()).toBe('!ghost → 透明化');
    vi.advanceTimersByTime(4000);
    expect(lineText()).toBe('!drop → 落下');
  });

  it('takes the time between lines from the settings', () => {
    const triggers = { drop: '!drop', ghost: '!ghost' };
    const app = createApp({ ojama: { triggers, keywordGuideIntervalSec: 10 } });
    const ui = new KeywordGuideUI({ app });
    ui.setLive({ autoComments: true });
    vi.advanceTimersByTime(9999);
    expect(lineText()).toBe('!drop → 落下');
    vi.advanceTimersByTime(1);
    expect(lineText()).toBe('!ghost → 透明化');

    app.patchOjama({ keywordGuideIntervalSec: 3 });
    vi.advanceTimersByTime(3000);
    expect(lineText()).toBe('!drop → 落下');
  });

  it('shows new keywords at once, from the first line', () => {
    const app = createApp({ ojama: { triggers: { drop: '!drop', ghost: '!ghost' } } });
    const ui = new KeywordGuideUI({ app });
    ui.setLive({ autoComments: true });
    vi.advanceTimersByTime(4000);
    expect(lineText()).toBe('!ghost → 透明化');

    app.patchOjama({ triggers: { drop: '!down', ghost: '!ghost' } });
    expect(lineText()).toBe('!down → 落下');
  });

  it('keeps its place when other settings change', () => {
    const app = createApp({ ojama: { triggers: { drop: '!drop', ghost: '!ghost' } } });
    const ui = new KeywordGuideUI({ app });
    ui.setLive({ autoComments: true });
    vi.advanceTimersByTime(4000);
    app.patchOjama({ cooldownSec: 10 });
    expect(lineText()).toBe('!ghost → 透明化');
  });

  it('starts from the first line when shown again', () => {
    const app = createApp({ ojama: { triggers: { drop: '!drop', ghost: '!ghost' } } });
    const ui = new KeywordGuideUI({ app });
    ui.setLive({ autoComments: true });
    vi.advanceTimersByTime(4000);
    ui.setLive({ autoComments: false });
    ui.setLive({ autoComments: true });
    expect(lineText()).toBe('!drop → 落下');
  });

  it('runs no timer while hidden, nor for a single line', () => {
    const app = createApp({ ojama: { triggers: { drop: '!drop' } } });
    const ui = new KeywordGuideUI({ app });
    ui.setLive({ autoComments: true });
    expect(vi.getTimerCount()).toBe(0);

    app.patchOjama({ triggers: { drop: '!drop', ghost: '!ghost' } });
    expect(vi.getTimerCount()).toBe(1);
    ui.setLive({ autoComments: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('adds the giant superchat while YouTube is linked', () => {
    const ui = new KeywordGuideUI({ app: createApp({ ojama: { triggers: { drop: '!drop' } } }) });
    ui.setLive({ youtube: true });
    vi.advanceTimersByTime(4000);
    expect(lineText()).toBe('スパチャを送る → 巨大スパチャ');
    // A superchat is sent, not written in a comment.
    expect(lead()).toBe('');

    ui.setLive({ autoComments: true });
    expect(lineText()).toBe('!drop → 落下');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('says how to write a keyword for the way keywords are matched', () => {
    const app = createApp({ ojama: { matchMode: 'start' } });
    const ui = new KeywordGuideUI({ app });
    ui.setLive({ autoComments: true });
    expect(lead()).toBe('から始まるコメント');
    app.patchOjama({ matchMode: 'whole' });
    expect(lead()).toBe('だけのコメント');
  });

  it('puts keywords in as text, never as markup', () => {
    const ui = new KeywordGuideUI({
      app: createApp({ ojama: { triggers: { drop: '<img src=x onerror=alert(1)>' } } }),
    });
    ui.setLive({ autoComments: true });
    expect(guide().querySelector('img')).toBeNull();
    expect(lineText()).toBe('<img src=x onerror=alert(1)> → 落下');
  });
});

describe('KeywordGuideUI: lines too long for it', () => {
  it('keeps its size from line to line', () => {
    const app = createApp({ ojama: { triggers: { drop: MANY, ghost: '!ghost' } } });
    const ui = new KeywordGuideUI({ app });
    ui.setLive({ autoComments: true });
    const first = guide().getBoundingClientRect();

    vi.advanceTimersByTime(slideStayMs(overflowNow()));
    expect(lineText()).toBe('!ghost → 透明化');
    const second = guide().getBoundingClientRect();
    expect(second.width).toBe(first.width);
    expect(second.height).toBe(first.height);
  });

  it('shows every keyword, sliding the line to show the rest', () => {
    const animate = vi.spyOn(Element.prototype, 'animate');
    const app = createApp({ ojama: { triggers: { drop: MANY, ghost: '!ghost' } } });
    const ui = new KeywordGuideUI({ app });
    ui.setLive({ autoComments: true });

    expect(lineText()).toBe(
      '!drop or 落 or おちろ or ポロッと or 外れろ or もっと外れろ or ぜんぶ外れろ → 落下',
    );
    const px = overflowNow();
    expect(px).toBeGreaterThan(0);
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, options] = animate.mock.calls[0];
    expect(frames.at(-1).transform).toBe(`translateX(${-px}px)`);
    expect(options).toMatchObject({ delay: 1200, duration: (px / 50) * 1000 });
  });

  it('moves on once the slide is done, even past the time between lines', () => {
    const app = createApp({ ojama: { triggers: { drop: MANY, ghost: '!ghost' } } });
    const ui = new KeywordGuideUI({ app });
    ui.setLive({ autoComments: true });
    const stay = slideStayMs(overflowNow());
    expect(stay).toBeGreaterThan(4000);

    vi.advanceTimersByTime(stay - 1);
    expect(lineText()).toContain('→ 落下');
    vi.advanceTimersByTime(1);
    expect(lineText()).toBe('!ghost → 透明化');
    // A line that fits stays the set time.
    vi.advanceTimersByTime(4000);
    expect(lineText()).toContain('→ 落下');
  });

  it('slides a long single line again and again', () => {
    const animate = vi.spyOn(Element.prototype, 'animate');
    const ui = new KeywordGuideUI({ app: createApp({ ojama: { triggers: { drop: MANY } } }) });
    ui.setLive({ autoComments: true });
    const firstLine = document.getElementById('keywordGuideLine');

    vi.advanceTimersByTime(slideStayMs(overflowNow()));
    expect(document.getElementById('keywordGuideLine')).not.toBe(firstLine);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it('stops sliding when it goes', () => {
    const animate = vi.spyOn(Element.prototype, 'animate');
    const ui = new KeywordGuideUI({ app: createApp({ ojama: { triggers: { drop: MANY } } }) });
    ui.setLive({ autoComments: true });
    const slide = animate.mock.results[0].value;

    ui.setLive({ autoComments: false });
    expect(slide.playState).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('wraps instead of sliding when the page motions are off', () => {
    document.documentElement.classList.add('effects-reduced');
    const animate = vi.spyOn(Element.prototype, 'animate');
    const app = createApp({ ojama: { triggers: { drop: MANY, ghost: '!ghost' } } });
    const ui = new KeywordGuideUI({ app });
    ui.setLive({ autoComments: true });

    expect(animate).not.toHaveBeenCalled();
    expect(overflowNow()).toBeLessThanOrEqual(0);
    vi.advanceTimersByTime(4000);
    expect(lineText()).toBe('!ghost → 透明化');
  });
});

describe('the keyword guide card (全体の設定)', () => {
  function buildCard(ojama) {
    const patch = vi.fn();
    const root = buildGlobalDetail({
      ojama: {
        ...createApp().getSettings().ojama,
        cooldownSec: 3,
        perViewerCooldownSec: 0,
        commentThreshold: 5,
        ...ojama,
      },
      patch,
      keywordEditor: () => document.createElement('div'),
      open: vi.fn(),
    });
    document.body.append(root);
    const card = [...root.querySelectorAll('.rules-card')].find(
      (c) => c.querySelector('h4').textContent === 'キーワードの案内',
    );
    return {
      patch,
      toggle: card.querySelector('input[type="checkbox"]'),
      interval: card.querySelector('input[type="number"]'),
    };
  }

  it('turns the guide on and off, and the time field with it', () => {
    const { patch, toggle, interval } = buildCard({ keywordGuideOn: false });
    expect(toggle.checked).toBe(false);
    expect(interval.disabled).toBe(true);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(patch).toHaveBeenCalledWith({ keywordGuideOn: true });
    expect(interval.disabled).toBe(false);
  });

  it('keeps the time between lines within 3 to 15 seconds', () => {
    const { patch, interval } = buildCard({ keywordGuideOn: true, keywordGuideIntervalSec: 4 });
    expect(interval.value).toBe('4');

    interval.value = '60';
    interval.dispatchEvent(new Event('change'));
    expect(patch).toHaveBeenLastCalledWith({ keywordGuideIntervalSec: 15 });
    interval.value = '1';
    interval.dispatchEvent(new Event('change'));
    expect(patch).toHaveBeenLastCalledWith({ keywordGuideIntervalSec: 3 });
  });
});

describe('KeywordGuideUI: its ×', () => {
  it('turns the guide off for good, and says where it comes back', () => {
    const app = createApp();
    const showToast = vi.fn();
    const ui = new KeywordGuideUI({ app, showToast });
    ui.setLive({ autoComments: true });

    document.getElementById('btnCloseKeywordGuide').click();
    expect(app.getSettings().ojama.keywordGuideOn).toBe(false);
    expect(shown()).toBe(false);
    // Step by step to where it comes back, shown long enough to read.
    expect(showToast).toHaveBeenCalledWith(
      [
        'キーワードの案内をオフにしました。',
        { strong: '配信・お邪魔設定 → お邪魔ルール → 全体の設定' },
        'で戻せます。',
      ],
      'info',
      { durationMs: 6000 },
    );
    // Comments starting again do not bring it back.
    ui.setLive({ autoComments: false });
    ui.setLive({ autoComments: true });
    expect(shown()).toBe(false);
  });

  it('takes the pointer, while the rest of the guide lets it through to the board', () => {
    const ui = new KeywordGuideUI({ app: createApp() });
    ui.setLive({ autoComments: true });
    expect(getComputedStyle(guide()).pointerEvents).toBe('none');
    const close = document.getElementById('btnCloseKeywordGuide');
    expect(getComputedStyle(close).pointerEvents).toBe('auto');
  });
});

describe('the keyword guide setting', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('is on by default, also with settings saved before it existed', () => {
    expect(loadSavedSettings().ojama.keywordGuideOn).toBe(true);
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ ojama: { cooldownSec: 5 } }));
    expect(loadSavedSettings().ojama.keywordGuideOn).toBe(true);
  });

  it('stays off once the streamer turned it off', () => {
    localStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({ ojama: { keywordGuideOn: false } }),
    );
    expect(loadSavedSettings().ojama.keywordGuideOn).toBe(false);
  });
});
