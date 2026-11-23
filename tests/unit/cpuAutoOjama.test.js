import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OJAMA_CONFIG } from '../../src/config/constants.js';
import { OjamaController } from '../../src/ui/ojamaController.js';

function mountOjamaDom() {
  document.body.innerHTML = `
    <canvas id="puzzleCanvas"></canvas>
    <div id="visualSabotageBanner" class="hidden"></div>
    <span id="visualSabotageLabel"></span>
    <span id="visualSabotageTimer"></span>
    <div id="spotlightOverlay" class="hidden"></div>
    <div id="superchatLayer" class="hidden">
      <div id="superchatCard"></div>
      <span id="superchatAuthor"></span>
      <span id="superchatAmount"></span>
      <span id="superchatMessage"></span>
      <span id="superchatCountdown"></span>
      <div id="superchatHpFill"></div>
      <span id="superchatHpText"></span>
      <button type="button" id="btnHitSuperchat"></button>
    </div>
    <div id="timedOjamaBanner" class="hidden"></div>
    <span id="commentTriggerCounter"></span>
    <div id="miniChatLog"></div>
    <input type="text" id="dummyCommentInput" />
    <button type="button" id="btnSendDummyComment"></button>
    <button type="button" id="btnToggleAutoComments">自動コメント開始</button>
    <input type="checkbox" id="toggleCpuAutoOjama" />
    <div id="cpuAutoOjamaPace">
      <button type="button" class="btn-seg" data-cpu-pace="slow">ゆるめ（30秒）</button>
      <button type="button" class="btn-seg active" data-cpu-pace="normal">標準（15秒）</button>
      <button type="button" class="btn-seg" data-cpu-pace="fast">激しめ（6秒）</button>
    </div>
    <input type="range" id="cpuAutoOjamaIntervalRange" min="3" max="60" step="1" value="15" />
    <strong id="cpuAutoOjamaIntervalValue">15秒ごと</strong>
  `;
}

function createController() {
  const settings = {
    ojama: {
      commentThreshold: 5,
      commentCountOn: true,
      cooldownSec: 0,
      triggers: { ...OJAMA_CONFIG.DEFAULT_TRIGGERS },
      enabled: Object.fromEntries(OJAMA_CONFIG.TYPES.map((t) => [t, true])),
      randomPool: { ...OJAMA_CONFIG.DEFAULT_RANDOM_POOL },
    },
  };
  const app = {
    engine: { isCompleted: () => false },
    room: { role: 'solo' },
    getSettings: () => settings,
    on: vi.fn(),
  };
  const controller = new OjamaController({
    app,
    updateHUD: vi.fn(),
    requestRender: vi.fn(),
    showToast: vi.fn(),
  });
  return { controller };
}

beforeEach(() => {
  vi.useFakeTimers();
  mountOjamaDom();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('CPU auto ojama pace presets and live interval slider', () => {
  it('relaxes default presets and allows live interval adjustment after starting', () => {
    const { controller } = createController();
    const commentSpy = vi.spyOn(controller, 'processIncomingComment').mockImplementation(() => {});
    const onStateChange = vi.fn();
    controller.onAutoCommentsChange = onStateChange;

    const toggle = document.getElementById('toggleCpuAutoOjama');
    const range = document.getElementById('cpuAutoOjamaIntervalRange');
    const valueEl = document.getElementById('cpuAutoOjamaIntervalValue');
    const slowBtn = document.querySelector('[data-cpu-pace="slow"]');
    const fastBtn = document.querySelector('[data-cpu-pace="fast"]');

    expect(range.value).toBe('15');
    expect(valueEl.textContent).toBe('15秒ごと');

    slowBtn.click();
    expect(range.value).toBe('30');
    expect(valueEl.textContent).toBe('30秒ごと');
    expect(slowBtn.classList.contains('active')).toBe(true);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(controller.isAutoCommentsRunning()).toBe(true);
    expect(onStateChange).toHaveBeenLastCalledWith(true);

    vi.advanceTimersByTime(29_000);
    expect(commentSpy).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1_000);
    expect(commentSpy).toHaveBeenCalledTimes(1);

    // Adjust slider to 5 seconds while already running
    range.value = '5';
    range.dispatchEvent(new Event('input'));
    expect(valueEl.textContent).toBe('5秒ごと');
    expect(slowBtn.classList.contains('active')).toBe(false);
    expect(fastBtn.classList.contains('active')).toBe(false);

    vi.advanceTimersByTime(10_000);
    expect(commentSpy).toHaveBeenCalledTimes(3);

    // Matching preset button re-highlights when slider matches preset value (6s)
    range.value = '6';
    range.dispatchEvent(new Event('input'));
    expect(fastBtn.classList.contains('active')).toBe(true);

    controller.stopAutoComments();
    expect(toggle.checked).toBe(false);
    expect(onStateChange).toHaveBeenLastCalledWith(false);
  });
});
