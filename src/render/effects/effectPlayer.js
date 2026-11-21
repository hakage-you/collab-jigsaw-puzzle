import { EFFECTS, FX_BODY_COLORS } from './effectRecipes.js';
import { paperStyle } from './paperStyle.js';
import { SHAPES } from './shapes.js';

/** The design style in use (swap it here; shapes and recipes stay as they are). */
export const ACTIVE_STYLE = paperStyle;

/**
 * Most effect stamps alive at once. An effect that would go over it is cut down to what fits,
 * so a flood of events (many snaps, a stream of interference) cannot pile up on a slow PC.
 */
export const MAX_PARTICLES = 240;

/**
 * When this many frames in a row each take longer than SLOW_FRAME_SEC, the PC is struggling:
 * stamps of later waves that have not started yet are dropped (dropLaterWaves), so a big effect
 * thins itself out instead of freezing the game. One slow frame alone (a hiccup when the
 * result screen opens, a tab coming back) does not count.
 */
export const SLOW_FRAME_SEC = 1 / 24;
export const SLOW_FRAMES_IN_A_ROW = 3;

/** How the effect-strength setting scales every effect ('off' shows nothing). */
const INTENSITY = Object.freeze({
  normal: Object.freeze({ count: 1, travel: 1, spin: 1 }),
  reduced: Object.freeze({ count: 0.5, travel: 0.6, spin: 0 }),
  off: null,
});

/** Screen area used for screen-wide effects when none is given (CSS px). */
const DEFAULT_AREA = Object.freeze({ width: 800, height: 600 });

/** Start direction (radians) of the i-th of `count` stamps. */
function startAngle(motion, i, count, turn, random) {
  if (motion === 'hop') return -Math.PI / 2 + (random() - 0.5) * 0.5; // up, leaning a little
  if (motion === 'rain') return random() * Math.PI * 2; // sway phase
  return turn + (i * Math.PI * 2) / count + (random() - 0.5) * 0.6; // 'spread': even directions
}

/** The i-th stamp of an effect (see spawnEffect). */
function makeStamp(name, recipe, i, at) {
  const { x, y, area, k, perWave, duration, turn, random, direction } = at;
  const rain = recipe.motion === 'rain';
  const stamp = {
    name,
    screen: rain || at.screen,
    x: rain ? random() * area.width : x,
    y: rain ? -recipe.sizePx * (1 + random() * 3) : y,
    // Rain falls past the bottom of the area; other motions travel travelPx.
    fall: rain ? (area.height + recipe.sizePx * 5) * (0.75 + 0.25 * random()) : 0,
    color: recipe.colors[i % recipe.colors.length],
    angle: startAngle(recipe.motion, i % perWave, perWave, turn, random),
    travel: recipe.travelPx * k.travel * (0.8 + 0.4 * random()),
  };
  // Which way it turns; `dir` is kept even when spinning is off, so an arrow still points right.
  stamp.dir = direction ?? (random() < 0.5 ? -1 : 1);
  stamp.spin = recipe.spinTurns * k.spin * stamp.dir;
  // Later waves wait their turn (a negative age is "not started yet").
  stamp.age = -Math.floor(i / perWave) * (recipe.waveGapSec || 0) - (rain ? random() * 0.15 : 0);
  stamp.duration = duration;
  return stamp;
}

/**
 * Adds one effect's stamps to `list`. Returns how many were added.
 * Point effects start at world point (x, y), or at screen point (x, y) with `opts.screen`;
 * 'rain' effects cover the screen area `opts.area` (x and y are ignored), in screen px.
 * @param {object[]} list particles (ViewState.particles)
 * @param {string} name a key of EFFECTS
 * @param {object} [opts] { intensity, random, style, area, direction, screen }
 *   `direction`: 1 or -1 for 'turn' (clockwise or anticlockwise); random when left out.
 */
export function spawnEffect(list, name, x, y, opts = {}) {
  const { intensity = 'normal', random = Math.random, style = ACTIVE_STYLE } = opts;
  const area = opts.area || DEFAULT_AREA;
  const recipe = EFFECTS[name];
  const k = INTENSITY[intensity];
  if (!recipe || !k) return 0;
  const perWave = Math.max(1, Math.round(recipe.count * k.count));
  const waves = recipe.waves || 1;
  const total = Math.min(perWave * waves, MAX_PARTICLES - list.length);
  const at = {
    x,
    y,
    area,
    k,
    perWave,
    duration: style.tokens.durations[recipe.duration],
    turn: random() * Math.PI * 2,
    random,
    screen: Boolean(opts.screen),
  };
  for (let i = 0; i < total; i++) {
    list.push(makeStamp(name, recipe, i, { ...at, direction: opts.direction }));
  }
  return total;
}

/**
 * How a stamp looks at its age: offset from its point (CSS px), scale, rotation, horizontal
 * flip (paper turning over) and size. A pure function of age, sampled in the style's frame
 * steps, so the motion is the same at any frame rate. Not started yet: scale 0.
 */
export function sampleParticle(p, style = ACTIVE_STYLE) {
  const recipe = EFFECTS[p.name];
  const fps = style.tokens.framesPerSec;
  if (p.age < 0) return { dx: 0, dy: 0, scale: 0, rotation: 0, flip: 1, sizePx: recipe.sizePx };
  const t = Math.floor(p.age * fps + 1e-6) / fps;
  const u = Math.min(1, t / p.duration);
  const scale = Math.max(0, style.easings[recipe.scale](u));
  const rotation = p.spin * Math.PI * 2 * u;
  if (recipe.motion === 'rain') {
    return {
      dx: Math.sin(p.angle + u * Math.PI * 4) * p.travel,
      dy: p.fall * style.easings[recipe.travel](u),
      scale,
      rotation,
      // Paper turning over as it falls (none when spinning is off).
      flip: p.spin === 0 ? 1 : Math.cos(p.angle + u * Math.PI * 6),
      sizePx: recipe.sizePx,
    };
  }
  if (recipe.motion === 'turn' || recipe.motion === 'flip') {
    return sampleInPlace(p, recipe, u, scale, style);
  }
  const d = p.travel * style.easings[recipe.travel](u);
  return {
    dx: Math.cos(p.angle) * d,
    dy: Math.sin(p.angle) * d,
    scale,
    rotation,
    flip: 1,
    sizePx: recipe.sizePx,
  };
}

/** 'turn' and 'flip': the stamp stays at its point and turns (eased by the travel curve). */
function sampleInPlace(p, recipe, u, scale, style) {
  const k = style.easings[recipe.travel](u);
  const turning = recipe.motion === 'turn';
  return {
    dx: 0,
    dy: 0,
    scale,
    rotation: turning ? p.spin * Math.PI * 2 * k : 0,
    // 'flip' turns the card over. 'turn' uses the mirrored shape for anticlockwise instead of
    // flipping the stamp, so the shadow stays to the lower right.
    flip: turning ? 1 : Math.cos(Math.abs(p.spin) * Math.PI * 2 * k),
    mirror: turning && p.dir < 0,
    sizePx: recipe.sizePx,
  };
}

/** Ages every stamp by dtSec and drops finished ones. */
export function advanceParticles(list, dtSec) {
  for (let i = list.length - 1; i >= 0; i--) {
    list[i].age += dtSec;
    if (list[i].age >= list[i].duration) list.splice(i, 1);
  }
}

/** Drops stamps of waves that have not started yet (the first wave's small stagger stays). */
export function dropLaterWaves(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].age < -0.2) list.splice(i, 1);
  }
}

/** Resolves the colours of a stamp: its body colour role plus the style's own colours. */
export function stampColors(role, fx) {
  return { body: fx[role], paper: fx.paper, shadow: fx.shadow };
}

/** CSS custom properties every effect colour comes from (body roles and the style's colours). */
export const FX_COLOR_VARS = Object.freeze({
  ...FX_BODY_COLORS,
  paper: '--fx-paper',
  shadow: '--fx-shadow',
});

/** A shape turned left to right. */
function mirrorShape(shape) {
  const flipX = (c) => {
    const m = { ...c, x: -c.x };
    if (c.x1 !== undefined) Object.assign(m, { x1: -c.x1, x2: -c.x2 });
    return m;
  };
  return { commands: shape.commands.map(flipX) };
}

/** Stamps drawn once per shape and colour set, then reused (the theme changes the key). */
export class StampCache {
  constructor(style = ACTIVE_STYLE) {
    this.style = style;
    this.stamps = new Map();
  }

  /** `mirrored`: the shape turned left to right before finishing (its shadow still lower right). */
  get(shape, role, fx, mirrored = false) {
    const colors = stampColors(role, fx);
    const key = `${shape}|${mirrored}|${colors.body}|${colors.paper}|${colors.shadow}`;
    let stamp = this.stamps.get(key);
    if (!stamp) {
      stamp = this.style.finish(mirrored ? mirrorShape(SHAPES[shape]) : SHAPES[shape], colors);
      this.stamps.set(key, stamp);
    }
    return stamp;
  }
}
