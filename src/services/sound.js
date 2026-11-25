import { COMFORT_CONFIG } from '../config/constants.js';

/**
 * Lightweight WebAudio sound synthesizer (no external audio files required).
 * Every sound is of a kind (COMFORT_CONFIG.VOLUME_KINDS) with its own volume, the player's own
 * "演出と音" setting (settings.volume).
 */
class SoundManager {
  constructor() {
    this.ctx = null;
    this._noiseBuffer = null;
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

  /** Resumes the audio context during a user gesture when that kind is audible. */
  unlock(kind = 'normal') {
    if (this.gainFor(kind) <= 0) return;
    this._ensureCtx();
  }

  _ensureNoiseBuffer(ctx) {
    if (this._noiseBuffer && this._noiseBuffer.sampleRate === ctx.sampleRate) {
      return this._noiseBuffer;
    }
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.04));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this._noiseBuffer = buf;
    return buf;
  }

  _playPaperTap(ctx, when, peak, pitch) {
    const src = ctx.createBufferSource();
    src.buffer = this._ensureNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(pitch * 2.4, when);
    filter.Q.setValueAtTime(2.2, when);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(peak, when);
    nGain.gain.exponentialRampToValueAtTime(peak * 0.01, when + 0.026);
    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    src.start(when);
    src.stop(when + 0.03);

    const osc = ctx.createOscillator();
    const tGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch, when);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.68, when + 0.035);
    tGain.gain.setValueAtTime(peak * 0.55, when);
    tGain.gain.exponentialRampToValueAtTime(peak * 0.01, when + 0.036);
    osc.connect(tGain);
    tGain.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.04);
  }

  /** Soft staggered cardboard-on-wood landing taps when a new puzzle is dealt. */
  playDeal(pieceCount = 24) {
    const k = this.gainFor('normal');
    if (k <= 0) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const taps = Math.max(6, Math.min(12, Math.round(5 + Math.sqrt(pieceCount) * 0.65)));
    const baseGain = 0.065 * k;
    const baseTime = ctx.currentTime + 0.04;
    for (let i = 0; i < taps; i++) {
      const u = i / Math.max(1, taps - 1);
      const jitter = (((i * 37) % 11) / 11 - 0.5) * 0.018;
      const delay = u * 0.34 + jitter;
      const env = u < 0.4 ? 0.7 + u * 0.75 : 1 - (u - 0.4) * 0.65;
      const pitch = 210 + ((i * 53) % 7) * 24;
      this._playPaperTap(ctx, Math.max(ctx.currentTime, baseTime + delay), baseGain * env, pitch);
    }
  }

  /** A sample of a kind, to hear its volume (the "演出と音" sliders play it when let go). */
  playSample(kind) {
    if (kind === 'ojama') this.playOjama();
    else this.playSnap();
  }
}

export const sound = new SoundManager();
