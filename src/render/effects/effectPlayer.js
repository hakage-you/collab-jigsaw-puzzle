import { EFFECTS, FX_BODY_COLORS } from './effectRecipes.js';
import { paperStyle } from './paperStyle.js';
import { SHAPES } from './shapes.js';

/** The design style in use (swap it here; shapes and recipes stay as they are). */
export const ACTIVE_STYLE = paperStyle;

/**
 * Most effect stamps alive at once. An effect that would go over it is skipped whole, so a flood
 * of events (many snaps at once, a stream of interference) cannot pile up on a slow PC.
 */
export const MAX_PARTICLES = 120;

/** How the effect-strength setting scales every effect ('off' shows nothing). */
const INTENSITY = Object.freeze({
  normal: Object.freeze({ count: 1, travel: 1, spin: 1 }),
  reduced: Object.freeze({ count: 0.5, travel: 0.6, spin: 0 }),
  off: null,
});

/**
 * Adds one effect's stamps to `list`, at world point (x, y). Returns how many were added.
 * @param {object[]} list particles (ViewState.particles)
 * @param {string} name a key of EFFECTS
 * @param {object} [opts] { intensity, random, style }
 */
export function spawnEffect(list, name, x, y, opts = {}) {
  const { intensity = 'normal', random = Math.random, style = ACTIVE_STYLE } = opts;
  const recipe = EFFECTS[name];
  const k = INTENSITY[intensity];
  if (!recipe || !k) return 0;
  const count = Math.max(1, Math.round(recipe.count * k.count));
  if (list.length + count > MAX_PARTICLES) return 0;
  const duration = style.tokens.durations[recipe.duration];
  const turn = random() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    list.push({
      name,
      x,
      y,
      angle:
        recipe.motion === 'hop'
          ? // Upwards, leaning up to about 15 degrees to either side.
            -Math.PI / 2 + (random() - 0.5) * 0.5
          : // 'spread': even directions around the point, a little uneven.
            turn + (i * Math.PI * 2) / count + (random() - 0.5) * 0.6,
      travel: recipe.travelPx * k.travel * (0.8 + 0.4 * random()),
      spin: recipe.spinTurns * k.spin * (random() < 0.5 ? -1 : 1),
      age: 0,
      duration,
    });
  }
  return count;
}

/**
 * How a stamp looks at its age: offset from its point (CSS px), scale, rotation and size.
 * A pure function of age, sampled in the style's frame steps, so the motion is the same at
 * any frame rate.
 */
export function sampleParticle(p, style = ACTIVE_STYLE) {
  const recipe = EFFECTS[p.name];
  const fps = style.tokens.framesPerSec;
  const t = Math.floor(p.age * fps + 1e-6) / fps;
  const u = Math.min(1, t / p.duration);
  const d = p.travel * style.easings[recipe.travel](u);
  return {
    dx: Math.cos(p.angle) * d,
    dy: Math.sin(p.angle) * d,
    scale: Math.max(0, style.easings[recipe.scale](u)),
    rotation: p.spin * Math.PI * 2 * u,
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

/** Resolves the colours an effect needs: its body role plus the style's own colours. */
export function stampColors(recipe, fx) {
  return { body: fx[recipe.color], paper: fx.paper, shadow: fx.shadow };
}

/** CSS custom properties every effect colour comes from (body roles and the style's colours). */
export const FX_COLOR_VARS = Object.freeze({
  ...FX_BODY_COLORS,
  paper: '--fx-paper',
  shadow: '--fx-shadow',
});

/** Stamps drawn once per shape and colour set, then reused (the theme changes the key). */
export class StampCache {
  constructor(style = ACTIVE_STYLE) {
    this.style = style;
    this.stamps = new Map();
  }

  get(recipe, fx) {
    const colors = stampColors(recipe, fx);
    const key = `${recipe.shape}|${colors.body}|${colors.paper}|${colors.shadow}`;
    let stamp = this.stamps.get(key);
    if (!stamp) {
      stamp = this.style.finish(SHAPES[recipe.shape], colors);
      this.stamps.set(key, stamp);
    }
    return stamp;
  }
}
