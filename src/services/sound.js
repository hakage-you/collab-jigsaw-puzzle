/**
 * Lightweight WebAudio sound synthesizer (no external audio files required).
 */

class SoundManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  _ensureCtx() {
    if (!this.enabled) return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  _tone(freq, duration, type = 'sine', gainVal = 0.08, delay = 0) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  playSnap() {
    this._tone(520, 0.07, 'triangle', 0.1);
    this._tone(780, 0.09, 'sine', 0.09, 0.04);
  }

  playMerge() {
    this._tone(440, 0.06, 'sine', 0.08);
    this._tone(620, 0.08, 'sine', 0.07, 0.03);
  }

  playTick() {
    this._tone(340, 0.04, 'triangle', 0.05);
  }

  playOjama() {
    this._tone(240, 0.14, 'sawtooth', 0.07);
    this._tone(180, 0.2, 'sawtooth', 0.07, 0.1);
  }

  playWin() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, idx) => this._tone(f, 0.25, 'triangle', 0.1, idx * 0.09));
  }
}

export const sound = new SoundManager();
