import { OJAMA_CONFIG } from '../config/constants.js';

const SAMPLE_AUTO_COMMENTS = [
  'がんばえー！',
  'そこ右上の角じゃない？',
  'きれいな色だね〜',
  'おお、進んだ！',
  'ナイス配置！',
  '!drop お邪魔いれちゃうぞｗ',
  '!color 見づらくなれ！',
  '!spin 回しちゃえ〜',
  '!ghost 透明になっちゃえ！',
  '!fake 偽ピース混ぜちゃうぞ！',
  '!heavy 重くなれ〜！',
  '!run 逃げろー！',
];

/**
 * Generates simulated viewer comments on a timer (CPU auto-ojama mode) with pace presets and
 * a live-adjustable interval slider.
 */
export class CpuAutoCommentController {
  constructor({ guardIfCompleted, onComment }) {
    this.guardIfCompleted = guardIfCompleted;
    this.onComment = onComment;
    this.intervalId = null;
    this.pace = OJAMA_CONFIG.DEFAULT_AUTO_COMMENT_PACE;
    this.intervalMs = OJAMA_CONFIG.AUTO_COMMENT_INTERVALS_MS[this.pace];
    this.onChange = null;

    this.elBtnAutoComments = document.getElementById('btnToggleAutoComments');
    this.elToggleCpuAutoOjama = document.getElementById('toggleCpuAutoOjama');
    this.elRange = document.getElementById('cpuAutoOjamaIntervalRange');
    this.elValue = document.getElementById('cpuAutoOjamaIntervalValue');

    this._bindEvents();
    this.syncUI();
  }

  _bindEvents() {
    this.elBtnAutoComments?.addEventListener('click', () => {
      if (this.isRunning()) this.stop();
      else this.start(null, { immediate: true });
    });

    this.elToggleCpuAutoOjama?.addEventListener('change', () => {
      if (this.elToggleCpuAutoOjama.checked) this.start();
      else this.stop();
    });

    document.querySelectorAll('#cpuAutoOjamaPace [data-cpu-pace]').forEach((btn) => {
      btn.addEventListener('click', () => this.setPace(btn.dataset.cpuPace));
    });

    this.elRange?.addEventListener('input', () => {
      this.setIntervalSec(Number(this.elRange.value));
    });
  }

  isRunning() {
    return Boolean(this.intervalId);
  }

  _getIntervalMs() {
    return this.intervalMs || OJAMA_CONFIG.AUTO_COMMENT_INTERVALS_MS.normal;
  }

  _emitSample() {
    const msg = SAMPLE_AUTO_COMMENTS[Math.floor(Math.random() * SAMPLE_AUTO_COMMENTS.length)];
    const user = `視聴者${Math.floor(10 + Math.random() * 90)}`;
    this.onComment(user, msg);
  }

  _restartIfRunning() {
    if (!this.intervalId) return;
    clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this._emitSample(), this._getIntervalMs());
  }

  syncUI() {
    const running = this.isRunning();
    if (this.elBtnAutoComments) {
      this.elBtnAutoComments.textContent = running ? '自動コメント停止' : '自動コメント開始';
    }
    if (this.elToggleCpuAutoOjama) {
      this.elToggleCpuAutoOjama.checked = running;
    }
    document.querySelectorAll('#cpuAutoOjamaPace [data-cpu-pace]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.cpuPace === this.pace);
    });
    const sec = Math.round(this._getIntervalMs() / 1000);
    if (this.elRange) this.elRange.value = String(sec);
    if (this.elValue) this.elValue.textContent = `${sec}秒ごと`;
  }

  start(pace = null, { immediate = false } = {}) {
    if (this.guardIfCompleted()) {
      this.syncUI();
      return;
    }
    if (pace && OJAMA_CONFIG.AUTO_COMMENT_INTERVALS_MS[pace]) {
      this.pace = pace;
      this.intervalMs = OJAMA_CONFIG.AUTO_COMMENT_INTERVALS_MS[pace];
    }
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this._emitSample(), this._getIntervalMs());
    this.syncUI();
    this.onChange?.(true);
    if (immediate) this._emitSample();
  }

  stop() {
    const wasRunning = Boolean(this.intervalId);
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.syncUI();
    if (wasRunning) this.onChange?.(false);
  }

  setPace(pace) {
    const ms = OJAMA_CONFIG.AUTO_COMMENT_INTERVALS_MS[pace];
    if (!ms) return;
    this.pace = pace;
    this.intervalMs = ms;
    this._restartIfRunning();
    this.syncUI();
  }

  setIntervalSec(sec) {
    const clampedSec = Math.min(
      OJAMA_CONFIG.AUTO_COMMENT_MAX_SEC,
      Math.max(OJAMA_CONFIG.AUTO_COMMENT_MIN_SEC, Math.round(sec)),
    );
    if (!Number.isFinite(clampedSec)) return;
    const ms = clampedSec * 1000;
    this.intervalMs = ms;
    const matched = Object.entries(OJAMA_CONFIG.AUTO_COMMENT_INTERVALS_MS).find(
      ([, val]) => val === ms,
    );
    this.pace = matched ? matched[0] : 'custom';
    this._restartIfRunning();
    this.syncUI();
  }
}
