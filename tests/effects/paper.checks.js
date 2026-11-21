import { sampleParticle, spawnEffect } from '../../src/render/effects/effectPlayer.js';
import { createRandom } from '../helpers/determinism.js';

/**
 * Checks that belong to the paper cut-out style (src/render/effects/paperStyle.js) only.
 * Another style would bring its own file; tests/effects/invariants.js stays the same.
 * Every check returns a list of problems (empty when it passes).
 */

/** Parses a CSS colour into {r, g, b, a} using the browser. */
function parse(color) {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a };
}

/**
 * The white paper border goes all the way round: no part of the coloured body is near the
 * stamp's transparent outside or its translucent shadow.
 */
function checkBorder(label, image, colors, style) {
  const { width: w, height: h, data } = image;
  const body = parse(colors.body);
  const reach = Math.max(1, Math.floor(style.tokens.stampPx * style.tokens.borderRatio * 0.6));
  const at = (x, y) => (y * w + x) * 4;
  const isBody = (i) =>
    data[i + 3] > 250 &&
    Math.abs(data[i] - body.r) + Math.abs(data[i + 1] - body.g) + Math.abs(data[i + 2] - body.b) <
      40;
  let bodyPixels = 0;
  let exposed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isBody(at(x, y))) continue;
      bodyPixels++;
      if (nearSeeThrough(image, x, y, reach)) exposed++;
    }
  }
  if (bodyPixels === 0) return [`${label}: no body colour found`];
  return exposed === 0 ? [] : [`${label}: ${exposed} body pixels have no paper border around them`];
}

/** True when a see-through pixel (outside or shadow) is within `reach` of (x, y). */
function nearSeeThrough({ width: w, height: h, data }, x, y, reach) {
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true;
      if (data[(ny * w + nx) * 4 + 3] < 200) return true;
    }
  }
  return false;
}

/** The shadow is a translucent cut-out offset to the lower right. */
function checkShadow(label, image) {
  const { width: w, data } = image;
  const centre = (keep) => {
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (!keep(data[i + 3])) continue;
      const p = i / 4;
      sx += p % w;
      sy += Math.floor(p / w);
      n++;
    }
    return n ? { x: sx / n, y: sy / n, n } : null;
  };
  const shadow = centre((a) => a > 20 && a < 220);
  const solid = centre((a) => a >= 250);
  if (!shadow || shadow.n < 10) return [`${label}: no shadow`];
  return shadow.x > solid.x && shadow.y > solid.y
    ? []
    : [`${label}: shadow is not to the lower right`];
}

/** Stamps move in steps (style.tokens.framesPerSec), not smoothly. */
function checkStepped(name, style) {
  const list = [];
  spawnEffect(list, name, 0, 0, { random: createRandom(7), style });
  const p = list[0];
  const poses = new Set();
  for (let age = 0; age < p.duration; age += 1 / 240) {
    const s = sampleParticle({ ...p, age }, style);
    poses.add(`${s.dx.toFixed(4)},${s.dy.toFixed(4)},${s.scale.toFixed(4)}`);
  }
  const most = Math.ceil(p.duration * style.tokens.framesPerSec) + 1;
  return poses.size <= most ? [] : [`${name}: ${poses.size} poses (stepped motion allows ${most})`];
}

export const paperChecks = {
  /** Checks on one finished stamp image. */
  stamp(label, image, colors, style) {
    return [...checkBorder(label, image, colors, style), ...checkShadow(label, image)];
  },
  /** Checks on one effect's motion. */
  motion(name, style) {
    return checkStepped(name, style);
  },
};
