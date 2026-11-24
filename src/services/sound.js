import { COMFORT_CONFIG } from '../config/constants.js';

/**
 * Lightweight WebAudio sound synthesizer (no external audio files required).
 * Every sound is of a kind (COMFORT_CONFIG.VOLUME_KINDS) with its own volume, the player's own
 * "演出と音" setting (settings.volume).
 */
class SoundManager {
  constructor() {
    this.ctx = null;
    /** Volume per kind, 0-100 (0: that kind is silent). */
    this.volumes = Object.fromEntries(
      COMFORT_CONFIG.VOLUME_KINDS.map((kind) => [kind, COMFORT_CONFIG.DEFAULT_VOLUME]),
    );
  }

  /** Sets the volume of the kinds given (settings.volume). */
  setVolumes(volumes) {
    this.volumes = { ...this.volumes, ...volumes };
  }

  /** How much louder or quieter a kind plays: (volume / 100)², as the ear hears loudness. */
  gainFor(kind) {
    const v = Math.min(100, Math.max(0, Number(this.volumes[kind]) || 0));
    return (v / 100) ** 2;
  }

  _ensureCtx() {
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

  /**
   * One tone of a kind (`type` the waveform, `gain` its loudness at full volume, `delay` in s);
   * nothing at all (not even an AudioContext) when that kind is silent.
   */
  _tone(kind, freq, duration, { type = 'sine', gain: gainVal = 0.08, delay = 0 } = {}) {
    const k = this.gainFor(kind);
    if (k <= 0) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const peak = gainVal * k;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(peak * 0.01, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  playSnap() {
    this._tone('normal', 520, 0.07, { type: 'triangle', gain: 0.1 });
    this._tone('normal', 780, 0.09, { gain: 0.09, delay: 0.04 });
  }

  playMerge() {
    this._tone('normal', 440, 0.06, { gain: 0.08 });
    this._tone('normal', 620, 0.08, { gain: 0.07, delay: 0.03 });
  }

  /** A short tick: turning or flipping a piece ('normal'), hitting a superchat ('ojama'). */
  playTick(kind = 'normal') {
    this._tone(kind, 340, 0.04, { type: 'triangle', gain: 0.05 });
  }

  playOjama() {
    this._tone('ojama', 240, 0.14, { type: 'sawtooth', gain: 0.07 });
    this._tone('ojama', 180, 0.2, { type: 'sawtooth', gain: 0.07, delay: 0.1 });
  }

  playWin() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, idx) =>
      this._tone('normal', f, 0.25, { type: 'triangle', gain: 0.1, delay: idx * 0.09 }),
    );
  }

  /** A sample of a kind, to hear its volume (the "演出と音" sliders play it when let go). */
  playSample(kind) {
    if (kind === 'ojama') this.playOjama();
    else this.playSnap();
  }
}

export const sound = new SoundManager();
