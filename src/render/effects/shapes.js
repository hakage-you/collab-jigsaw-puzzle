/**
 * Effect shapes: outlines only, in a box from -1 to 1 (y down). No colour, border or shadow:
 * the design style (paperStyle.js) finishes every shape the same way, so a new shape cannot
 * drift from the look of the others. Commands use the same format as piece outlines
 * ({ op: 'M' | 'L' | 'C', ... }), so pieceSpriteBuilder's outlineToPath2D draws them.
 */

/** A star with `points` tips; `inner` is the radius of the notches (outer radius is 1). */
function starOutline(points, inner) {
  const commands = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 1 : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    commands.push({ op: i === 0 ? 'M' : 'L', x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return { commands };
}

/**
 * A puff of smoke: a lumpy cloud. `bumps` lists each bulge as [share of the way round, how far
 * it reaches]; uneven bulges keep it from looking like a flower. Bulges meet at radius `inner`.
 */
function puffOutline(bumps, inner) {
  const total = bumps.reduce((sum, [share]) => sum + share, 0);
  const at = (r, a) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
  let a0 = -Math.PI / 2;
  const commands = [{ op: 'M', ...at(inner, a0) }];
  for (const [share, reach] of bumps) {
    const step = (share / total) * Math.PI * 2;
    const a1 = a0 + step;
    const c1 = at(reach, a0 + step * 0.1);
    const c2 = at(reach, a1 - step * 0.1);
    commands.push({ op: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, ...at(inner, a1) });
    a0 = a1;
  }
  return { commands };
}

/** A strip of paper, gently bent (confetti). */
function stripOutline() {
  return {
    commands: [
      { op: 'M', x: -1, y: -0.32 },
      { op: 'C', x1: -0.35, y1: -0.52, x2: 0.35, y2: -0.12, x: 1, y: -0.32 },
      { op: 'L', x: 1, y: 0.32 },
      { op: 'C', x1: 0.35, y1: 0.12, x2: -0.35, y2: 0.52, x: -1, y: 0.32 },
    ],
  };
}

/**
 * A curled arrow going clockwise round most of a circle, head at the end (a piece was turned).
 * Mirror it for anticlockwise.
 */
function curlOutline() {
  const outer = 0.8;
  const inner = 0.3;
  const start = Math.PI * 0.8;
  const end = Math.PI * 2.1;
  const steps = 16;
  const at = (r, a) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
  const commands = [];
  for (let i = 0; i <= steps; i++) {
    commands.push({ op: i === 0 ? 'M' : 'L', ...at(outer, start + ((end - start) * i) / steps) });
  }
  commands.push({ op: 'L', ...at(outer + 0.2, end) });
  commands.push({ op: 'L', ...at((outer + inner) / 2, end + 0.75) });
  commands.push({ op: 'L', ...at(inner - 0.2, end) });
  for (let i = steps; i >= 0; i--) {
    commands.push({ op: 'L', ...at(inner, start + ((end - start) * i) / steps) });
  }
  return { commands };
}

export const SHAPES = Object.freeze({
  star: starOutline(5, 0.5),
  curl: curlOutline(),
  strip: stripOutline(),
  puff: puffOutline(
    [
      [1.3, 1.2],
      [0.8, 1.0],
      [1.1, 1.12],
      [0.7, 0.95],
      [1.2, 1.15],
      [0.9, 1.02],
    ],
    0.6,
  ),
});
