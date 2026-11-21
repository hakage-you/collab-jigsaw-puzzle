import { EFFECTS, FX_BODY_COLORS } from '../../src/render/effects/effectRecipes.js';
import {
  advanceParticles,
  MAX_PARTICLES,
  sampleParticle,
  spawnEffect,
} from '../../src/render/effects/effectPlayer.js';
import { SHAPES } from '../../src/render/effects/shapes.js';
import { createRandom } from '../helpers/determinism.js';

/**
 * Checks every effect must pass, whatever the design style (_plan/20261121_1900_effects_stamp_plan.md).
 * Health, load and the rules that keep effects consistent. A style adds its own checks next to
 * this file (paper.checks.js); changing the style must not change anything here.
 * Every check returns a list of problems (empty when it passes).
 */
const LIMITS = Object.freeze({
  /** Longest one stamp may play (s); only a celebration should come near it. */
  maxDurationSec: 3.5,
  /** Most stamps in one wave of an effect. */
  maxCount: 30,
  /** Largest stamp on screen (CSS px) and farthest it may travel. */
  maxSizePx: 32,
  maxTravelPx: 120,
  /** Large-area flashes allowed in any one second (WCAG 2.3.1), for every viewer. */
  maxFlashesPerSec: 3,
  /** Share of the area that must change brightness at once to count as a flash. */
  flashAreaShare: 0.25,
  /** A stamp must stand out from the table: this share of it at this contrast ratio, at least. */
  minVisibleShare: 0.35,
  minContrast: 1.5,
});

const MOTIONS = ['hop', 'spread', 'rain', 'turn', 'flip'];

/** Names a recipe refers to: shape, colour roles, motion, duration and easings. */
function checkNames(recipe, style, fail) {
  if (!SHAPES[recipe.shape]) fail(`unknown shape "${recipe.shape}"`);
  if (!Array.isArray(recipe.colors) || recipe.colors.length === 0) fail('no colour roles');
  for (const role of recipe.colors || []) {
    if (!FX_BODY_COLORS[role]) fail(`unknown colour role "${role}"`);
  }
  if (!MOTIONS.includes(recipe.motion)) fail(`unknown motion "${recipe.motion}"`);
  if (style.tokens.durations[recipe.duration] === undefined) {
    fail(`duration "${recipe.duration}" is not a ${style.name} duration`);
  }
  for (const key of ['scale', 'travel']) {
    if (!style.easings[recipe[key]]) {
      fail(`${key} easing "${recipe[key]}" is not a ${style.name} easing`);
    }
  }
}

/** Amounts: how many, how big, how far, how long. */
function checkAmounts(recipe, style, fail) {
  const inRange = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;
  const waves = recipe.waves ?? 1;
  if (!Number.isInteger(waves) || waves < 1) fail(`waves ${waves}`);
  if (!Number.isInteger(recipe.count) || !inRange(recipe.count, 1, LIMITS.maxCount)) {
    fail(`count ${recipe.count} (1..${LIMITS.maxCount})`);
  }
  if (recipe.count * waves > MAX_PARTICLES / 2) {
    fail(`${recipe.count * waves} stamps in all (max ${MAX_PARTICLES / 2}, half the live cap)`);
  }
  const duration = style.tokens.durations[recipe.duration];
  if (duration > LIMITS.maxDurationSec) fail(`plays ${duration}s (max ${LIMITS.maxDurationSec}s)`);
  if (!inRange(recipe.sizePx, 1, LIMITS.maxSizePx)) fail(`sizePx ${recipe.sizePx}`);
  if (!inRange(recipe.travelPx, 0, LIMITS.maxTravelPx)) fail(`travelPx ${recipe.travelPx}`);
}

/** A recipe uses only names that exist, and stays within the limits. */
export function checkRecipe(name, recipe, style) {
  const problems = [];
  const fail = (msg) => problems.push(`${name}: ${msg}`);
  checkNames(recipe, style, fail);
  checkAmounts(recipe, style, fail);
  return problems;
}

/** A stamp image is not empty and leaves a transparent margin (nothing is cut off). */
export function checkStampImage(label, image) {
  const { width: w, height: h, data } = image;
  const alpha = (x, y) => data[(y * w + x) * 4 + 3];
  const problems = [];
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
  if (opaque === 0) problems.push(`${label}: stamp is empty`);
  for (let i = 0; i < w; i++) {
    if (alpha(i, 0) || alpha(i, h - 1) || alpha(0, i) || alpha(w - 1, i)) {
      problems.push(`${label}: stamp touches its edge (cut off)`);
      break;
    }
  }
  return problems;
}

function luminance(r, g, b) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Share of the stamp's (mostly opaque) pixels that stand out from background `bg` ({r,g,b}). */
function visibleShare(image, bg) {
  const { data } = image;
  const bgL = luminance(bg.r, bg.g, bg.b);
  let covered = 0;
  let visible = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < 0.5) continue;
    covered++;
    const mix = (c, k) => c * a + k * (1 - a);
    const l = luminance(mix(data[i], bg.r), mix(data[i + 1], bg.g), mix(data[i + 2], bg.b));
    if (contrast(l, bgL) >= LIMITS.minContrast) visible++;
  }
  return covered ? visible / covered : 0;
}

/** The stamp does not disappear into the table in this theme. */
export function checkVisibleOn(label, image, bg) {
  const share = visibleShare(image, bg);
  return share >= LIMITS.minVisibleShare
    ? []
    : [`${label}: only ${(share * 100).toFixed(0)}% stands out from the table`];
}

/** Plays an effect at a fixed frame rate; returns the stamps' samples at time `atSec`, and its length. */
function playAt(name, style, fps, atSec) {
  const list = [];
  spawnEffect(list, name, 0, 0, { random: createRandom(7), style });
  const steps = Math.round(atSec * fps);
  for (let i = 0; i < steps; i++) advanceParticles(list, 1 / fps);
  const samples = list.map((p) => sampleParticle(p, style));
  let lifeSteps = steps;
  while (list.length > 0 && lifeSteps < fps * 10) {
    advanceParticles(list, 1 / fps);
    lifeSteps++;
  }
  return { samples, lifeSec: lifeSteps / fps };
}

/** The effect moves at the same speed and lasts as long on 60 Hz and 144 Hz screens. */
export function checkFrameRateIndependent(name, style) {
  const a = playAt(name, style, 60, 0.25);
  const b = playAt(name, style, 144, 0.25);
  const problems = [];
  const same = (x, y) => Math.abs(x - y) < 1e-6;
  const differs = a.samples.some((s, i) => {
    const t = b.samples[i];
    return !t || !same(s.dx, t.dx) || !same(s.dy, t.dy) || !same(s.scale, t.scale);
  });
  if (differs || a.samples.length !== b.samples.length) {
    problems.push(`${name}: looks different at 60 Hz and 144 Hz`);
  }
  if (Math.abs(a.lifeSec - b.lifeSec) > 1 / 60 + 1e-9) {
    problems.push(`${name}: lasts ${a.lifeSec}s at 60 Hz but ${b.lifeSec}s at 144 Hz`);
  }
  return problems;
}

/** "Reduced" plays less (fewer stamps, shorter travel, no spin); "off" plays nothing. */
export function checkIntensity(name, style) {
  const spawn = (intensity) => {
    const list = [];
    spawnEffect(list, name, 0, 0, { intensity, random: createRandom(7), style });
    return list;
  };
  const normal = spawn('normal');
  const reduced = spawn('reduced');
  const problems = [];
  if (spawn('off').length !== 0) problems.push(`${name}: plays with effects off`);
  if (reduced.length === 0 || reduced.length > normal.length) {
    problems.push(`${name}: "reduced" spawns ${reduced.length} (normal ${normal.length})`);
  }
  const most = (list, key) => Math.max(...list.map((p) => Math.abs(p[key])));
  if (most(reduced, 'travel') >= most(normal, 'travel') && most(normal, 'travel') > 0) {
    problems.push(`${name}: "reduced" does not travel less`);
  }
  if (most(reduced, 'spin') > 0) problems.push(`${name}: "reduced" still spins`);
  return problems;
}

/** However many events arrive, no more than MAX_PARTICLES stamps are alive. */
export function checkParticleCap() {
  const list = [];
  for (const name of Object.keys(EFFECTS)) {
    for (let i = 0; i < 1000; i++) spawnEffect(list, name, 0, 0, { random: createRandom(i) });
  }
  return list.length <= MAX_PARTICLES ? [] : [`${list.length} stamps alive (max ${MAX_PARTICLES})`];
}

/**
 * Counts large-area flashes in a played sequence of frames (ImageData at `fps`): frames where
 * more than LIMITS.flashAreaShare of the area changes brightness noticeably. No one-second
 * window may hold more than LIMITS.maxFlashesPerSec.
 */
export function checkFlashRate(name, frames, fps) {
  const flashes = [];
  for (let f = 1; f < frames.length; f++) {
    const a = frames[f - 1].data;
    const b = frames[f].data;
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) {
      const la = luminance(a[i], a[i + 1], a[i + 2]);
      const lb = luminance(b[i], b[i + 1], b[i + 2]);
      if (Math.abs(la - lb) > 0.1) changed++;
    }
    if (changed / (a.length / 4) > LIMITS.flashAreaShare) flashes.push(f);
  }
  const worst = Math.max(
    0,
    ...flashes.map((f) => flashes.filter((g) => g >= f && g < f + fps).length),
  );
  return worst <= LIMITS.maxFlashesPerSec ? [] : [`${name}: ${worst} flashes in one second`];
}
