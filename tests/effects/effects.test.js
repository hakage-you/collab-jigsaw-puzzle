import { afterAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import '../../styles/tokens.css';
import { EffectsLayer } from '../../src/render/canvas2d/effectsLayer.js';
import {
  ACTIVE_STYLE,
  FX_COLOR_VARS,
  spawnEffect,
  stampColors,
} from '../../src/render/effects/effectPlayer.js';
import { EFFECTS, FX_BODY_COLORS } from '../../src/render/effects/effectRecipes.js';
import { SHAPES } from '../../src/render/effects/shapes.js';
import { createRandom } from '../helpers/determinism.js';
import {
  checkFlashRate,
  checkFrameRateIndependent,
  checkIntensity,
  checkParticleCap,
  checkRecipe,
  checkStampImage,
  checkVisibleOn,
} from './invariants.js';
import { paperChecks } from './paper.checks.js';

// Every effect stamp and recipe is checked in two parts (_plan/20261121_1900_effects_stamp_plan.md):
// - invariants.js: health, load and consistency rules that hold for any design style;
// - <style>.checks.js: rules of the design style in use.
// It also writes review images to review/effects/<style>/ (stamps, a sheet of all stamps, and
// frame strips of every effect) and compares against them. After an intended change, update
// them with `npx vitest run tests/effects -u` and look at the image diff before committing.

const STYLE = ACTIVE_STYLE;
const STYLE_CHECKS = { paper: paperChecks }[STYLE.name];
const THEMES = ['light', 'dark'];
const shown = [];
afterAll(() => {
  for (const el of shown.splice(0)) el.remove();
  document.documentElement.setAttribute('data-theme', 'light');
});

function useTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const cs = getComputedStyle(document.documentElement);
  const read = (name) => cs.getPropertyValue(name).trim();
  const fx = Object.fromEntries(Object.entries(FX_COLOR_VARS).map(([k, v]) => [k, read(v)]));
  // The table under effects: the board colour over the desk.
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext('2d');
  ctx.fillStyle = read('--desk-bg');
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = read('--canvas-board-bg');
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return { fx, table: { r, g, b, css: `rgb(${r} ${g} ${b})` } };
}

function pixels(canvas) {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
}

function newCanvas(w, h, bg) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.style.cssText = `width:${w}px;height:${h}px;display:block;`;
  if (bg) {
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  return c;
}

/** Puts review canvases on the page in a row (themes stacked) and returns the wrapper. */
function showForReview(canvases) {
  const el = document.createElement('div');
  el.style.cssText = 'display:inline-flex;flex-direction:column;gap:0;';
  for (const c of canvases) el.appendChild(c);
  document.body.appendChild(el);
  shown.push(el);
  return el;
}

async function expectReview(el, name) {
  await expect.element(page.elementLocator(el)).toMatchScreenshot(`${STYLE.name}/${name}`, {
    comparatorName: 'pixelmatch',
    comparatorOptions: { allowedMismatchedPixelRatio: 0.002 },
  });
}

/**
 * Plays an effect with the real effects layer and returns one composited canvas per frame
 * (`frames` frames at `fps`, the effect started at the centre, drawn at `dpr` zoom).
 */
function playFrames(name, { theme, fps, frames, size, dpr }) {
  const { fx, table } = useTheme(theme);
  const layerCanvas = document.createElement('canvas');
  const layer = new EffectsLayer(layerCanvas);
  layer.resize(size, size, dpr);
  const particles = [];
  spawnEffect(particles, name, 0, 0, { random: createRandom(7) });
  const vs = {
    camera: { x: 0, y: 0, scale: 1 },
    snapFlashes: [],
    confetti: [],
    particles,
    get hasEffects() {
      return particles.length > 0;
    },
  };
  const out = [];
  for (let f = 0; f < frames; f++) {
    layer.render({
      viewState: vs,
      room: null,
      pal: { accent: table.css, fx },
      rect: { width: size, height: size },
      dpr,
      dtSec: 1 / fps,
    });
    const frame = newCanvas(size * dpr, size * dpr, table.css);
    frame.getContext('2d').drawImage(layerCanvas, 0, 0);
    out.push(frame);
  }
  return out;
}

describe(`effect recipes (${STYLE.name} style)`, () => {
  it('never lets the number of stamps grow without limit', () => {
    expect(checkParticleCap()).toEqual([]);
  });

  describe.each(Object.keys(EFFECTS))('%s', (name) => {
    it('uses only known names and stays within the shared limits', () => {
      expect(checkRecipe(name, EFFECTS[name], STYLE)).toEqual([]);
    });

    it('plays the same at any frame rate, less when reduced, not at all when off', () => {
      expect([...checkFrameRateIndependent(name, STYLE), ...checkIntensity(name, STYLE)]).toEqual(
        [],
      );
    });

    it(`follows the ${STYLE.name} style's motion rules`, () => {
      expect(STYLE_CHECKS.motion(name, STYLE)).toEqual([]);
    });

    it.each(THEMES)('does not flash (%s theme)', (theme) => {
      const fps = 60;
      const frames = playFrames(name, { theme, fps, frames: fps * 2, size: 160, dpr: 1 });
      expect(checkFlashRate(name, frames.map(pixels), fps)).toEqual([]);
    });

    it('matches its review strip', async () => {
      const recipe = EFFECTS[name];
      const fps = STYLE.tokens.framesPerSec;
      const count = Math.ceil(STYLE.tokens.durations[recipe.duration] * fps) + 1;
      const cell = 80;
      // Frames wrap onto more lines so a long effect still fits the page (at 2x zoom).
      const perLine = 7;
      const lines = Math.ceil(count / perLine);
      const rows = THEMES.map((theme) => {
        const frames = playFrames(name, { theme, fps, frames: count, size: cell, dpr: 2 });
        const bg = useTheme(theme).table.css;
        const row = newCanvas(cell * 2 * Math.min(count, perLine), cell * 2 * lines, bg);
        frames.forEach((f, i) => {
          const x = (i % perLine) * cell * 2;
          const y = Math.floor(i / perLine) * cell * 2;
          row.getContext('2d').drawImage(f, x, y);
        });
        return row;
      });
      await expectReview(showForReview(rows), `strips/${name}`);
    });
  });
});

describe(`effect stamps (${STYLE.name} style)`, () => {
  const roles = Object.keys(FX_BODY_COLORS);
  const variants = Object.keys(SHAPES).flatMap((shape) => roles.map((color) => ({ shape, color })));

  describe.each(variants)('$shape in $color', ({ shape, color }) => {
    it.each(THEMES)('passes the shared and style checks (%s theme)', (theme) => {
      const { fx, table } = useTheme(theme);
      const colors = stampColors({ color }, fx);
      const image = pixels(STYLE.finish(SHAPES[shape], colors));
      const label = `${shape}/${color}/${theme}`;
      expect([
        ...checkStampImage(label, image),
        ...checkVisibleOn(label, image, table),
        ...STYLE_CHECKS.stamp(label, image, colors, STYLE),
      ]).toEqual([]);
    });

    it('draws the same stamp every time', () => {
      const { fx } = useTheme('light');
      const colors = stampColors({ color }, fx);
      const a = pixels(STYLE.finish(SHAPES[shape], colors)).data;
      const b = pixels(STYLE.finish(SHAPES[shape], colors)).data;
      expect(a.every((v, i) => v === b[i])).toBe(true);
    });

    it('matches its review image', async () => {
      const rows = THEMES.map((theme) => stampRow(shape, color, theme));
      await expectReview(showForReview(rows), `stamps/${shape}-${color}`);
    });
  });

  it('matches the review sheet of every stamp side by side', async () => {
    const rows = THEMES.map((theme) => {
      const px = STYLE.tokens.stampPx;
      const row = newCanvas(px * variants.length, px, useTheme(theme).table.css);
      variants.forEach((v, i) => {
        const { fx } = useTheme(theme);
        row
          .getContext('2d')
          .drawImage(STYLE.finish(SHAPES[v.shape], stampColors(v, fx)), i * px, 0);
      });
      return row;
    });
    await expectReview(showForReview(rows), 'sheet');
  });
});

/** One theme's row of a stamp: full size, then at the sizes effects show it (32, 16, 11 px). */
function stampRow(shape, color, theme) {
  const { fx, table } = useTheme(theme);
  const px = STYLE.tokens.stampPx;
  const stamp = STYLE.finish(SHAPES[shape], stampColors({ color }, fx));
  const row = newCanvas(px + 80, px, table.css);
  const ctx = row.getContext('2d');
  ctx.drawImage(stamp, 0, 0);
  let x = px + 4;
  for (const size of [32, 16, 11]) {
    ctx.drawImage(stamp, x, (px - size) / 2, size, size);
    x += size + 4;
  }
  return row;
}
