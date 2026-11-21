import { PieceSpriteStore } from '../../src/render/pieceSpriteStore.js';

/**
 * Helper layers for the render bench (measure/bench/render.html). Not part of the game.
 * - MinimalCanvas2DPieces: the same "pieces only" drawing as the WebGL2 prototype, with
 *   Canvas 2D drawImage, so the two can be compared like for like.
 * - EffectsOverlay: a separate transparent Canvas 2D layer for particles and the "heavy" line,
 *   the way the planned effects layer would work (pieces are not redrawn for effects).
 */

function sizeCanvas(canvas, cssWidth, cssHeight, dpr) {
  const w = Math.max(1, Math.floor(cssWidth * dpr));
  const h = Math.max(1, Math.floor(cssHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

export class MinimalCanvas2DPieces {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;
    this.sprites = new PieceSpriteStore();
    this.sprites.sync(engine);
  }

  _draw(p) {
    const sprite = p.isFlipped ? this.sprites.backSprite(p) : this.sprites.frontSprite(p);
    const m = this.sprites.metrics;
    const { ctx } = this;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((p.rotation * Math.PI) / 2);
    if (p.isFlipped) ctx.scale(-1, 1);
    ctx.drawImage(
      sprite.canvas,
      sprite.sx,
      sprite.sy,
      sprite.sw,
      sprite.sh,
      -m.halfW,
      -m.halfH,
      m.logicalW,
      m.logicalH,
    );
    ctx.restore();
  }

  render(view, cssWidth, cssHeight, dpr) {
    sizeCanvas(this.canvas, cssWidth, cssHeight, dpr);
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.translate(cssWidth / 2, cssHeight / 2);
    ctx.scale(view.scale, view.scale);
    ctx.translate(-view.x, -view.y);
    for (const p of this.engine.pieces) if (p.isLocked) this._draw(p);
    for (const p of this.engine.getSortedLoosePieces()) if (!p.isFake) this._draw(p);
  }
}

const COLORS = ['#1565c0', '#6d28d9', '#166534', '#92400e', '#c62828'];

export class EffectsOverlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.targetCount = 0;
    this.line = null;
    this.rng = Math.random;
  }

  /** Keeps about `count` particles alive (respawning at the top as they fall out). */
  setParticleCount(count) {
    this.targetCount = count;
    if (count === 0) this.particles = [];
  }

  /** A line from the cursor to the dragged piece, in screen coordinates (or null). */
  setLine(line) {
    this.line = line;
  }

  get active() {
    return this.targetCount > 0 || this.line !== null;
  }

  _spawn(cssWidth) {
    const r = this.rng;
    return {
      x: r() * cssWidth,
      y: -10 - r() * 80,
      vx: (r() - 0.5) * 300,
      vy: 120 + r() * 240,
      rot: r() * Math.PI,
      vr: (r() - 0.5) * 12,
      size: 7 + r() * 6,
      color: COLORS[Math.floor(r() * COLORS.length)],
    };
  }

  _step(dtSec, cssWidth, cssHeight) {
    while (this.particles.length < this.targetCount) this.particles.push(this._spawn(cssWidth));
    for (let i = 0; i < this.particles.length; i++) {
      const c = this.particles[i];
      c.x += c.vx * dtSec;
      c.y += c.vy * dtSec;
      c.vy += 500 * dtSec;
      c.rot += c.vr * dtSec;
      if (c.y > cssHeight + 30) this.particles[i] = this._spawn(cssWidth);
    }
  }

  render(dtSec, cssWidth, cssHeight, dpr) {
    sizeCanvas(this.canvas, cssWidth, cssHeight, dpr);
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    this._step(dtSec, cssWidth, cssHeight);
    for (const c of this.particles) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.6);
      ctx.restore();
    }
    if (this.line) {
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.line.x1, this.line.y1);
      ctx.lineTo(this.line.x2, this.line.y2);
      ctx.stroke();
    }
  }

  clear() {
    this.particles = [];
    this.targetCount = 0;
    this.line = null;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
