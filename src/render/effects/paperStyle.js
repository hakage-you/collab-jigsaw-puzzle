import { outlineToPath2D } from '../pieceSpriteBuilder.js';

/** Stamps are drawn once at this size (px) and scaled down when shown. */
const STAMP_PX = 64;

/** Ease-out (fast start, gentle stop). */
function out(u) {
  return 1 - (1 - u) ** 3;
}

/** A hop: rises quickly to the top, then drops back a little. */
function jump(u) {
  const top = 0.55;
  if (u < top) return 1 - (1 - u / top) ** 2;
  return 1 - 0.3 * ((u - top) / (1 - top)) ** 2;
}

/** Appears quickly, stays, and shrinks away only at the very end. */
function settle(u) {
  if (u < 0.06) return u / 0.06;
  if (u < 0.9) return 1;
  return 1 - (u - 0.9) / 0.1;
}

/** Falling: starts gently and speeds up a little, like paper in the air. */
function fall(u) {
  return 0.6 * u + 0.4 * u * u;
}

/** Pops up slightly too big, settles, then shrinks away at the end. */
function pop(u) {
  if (u < 0.2) return 1.2 * Math.sin((u / 0.2) * (Math.PI / 2));
  if (u < 0.35) return 1.2 - 0.2 * ((u - 0.2) / 0.15);
  if (u < 0.7) return 1;
  const k = (u - 0.7) / 0.3;
  return 1 - k * k;
}

/**
 * The paper cut-out design style: flat colour, a white paper border and a shadow offset to the
 * lower right, moving in steps (like frames cut by hand) rather than smoothly.
 *
 * Every design style provides the same things, so a style can be swapped without touching the
 * shapes, the effect recipes or the style-independent checks (tests/effects/invariants.js):
 * - `tokens`: sizes and timings every effect must use (`durations` are the only lengths allowed).
 * - `easings`: named motion curves recipes refer to.
 * - `finish(shape, colors)`: draws a shape as a stamp (a canvas).
 * Checks specific to this style live in tests/effects/paper.checks.js.
 */
export const paperStyle = Object.freeze({
  name: 'paper',
  tokens: Object.freeze({
    stampPx: STAMP_PX,
    /** White border width, as a share of the stamp size. */
    borderRatio: 0.09,
    /** Shadow offset (to the lower right), as a share of the stamp size. */
    shadowOffsetRatio: 0.06,
    /** Animation steps per second. */
    framesPerSec: 12,
    durations: Object.freeze({ short: 0.4, medium: 0.7, long: 1.2, celebrate: 3 }),
  }),
  easings: Object.freeze({ out, pop, jump, settle, fall }),

  /**
   * @param {{commands: object[]}} shape outline in a -1..1 box (shapes.js)
   * @param {{body: string, paper: string, shadow: string}} colors resolved theme colours
   * @returns {HTMLCanvasElement} a STAMP_PX square stamp, shape centred
   */
  finish(shape, colors) {
    const px = STAMP_PX;
    const border = px * this.tokens.borderRatio;
    const offset = px * this.tokens.shadowOffsetRatio;
    const radius = px / 2 - border - offset - 2;
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    const path = outlineToPath2D(shape);
    const centre = px / 2 - offset / 2;
    const layer = (dx, fill, stroke) => {
      ctx.setTransform(radius, 0, 0, radius, centre + dx, centre + dx);
      ctx.lineJoin = 'round';
      ctx.lineWidth = (border * 2) / radius;
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.stroke(path);
      }
      ctx.fillStyle = fill;
      ctx.fill(path);
    };
    // The shadow is one even cut-out: drawn opaque first, then recoloured (a translucent stroke
    // and fill would overlap and come out patchy).
    layer(offset, 'black', 'black');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = colors.shadow;
    ctx.fillRect(0, 0, px, px);
    ctx.globalCompositeOperation = 'source-over';
    layer(0, colors.paper, colors.paper);
    layer(0, colors.body, null);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  },
});
