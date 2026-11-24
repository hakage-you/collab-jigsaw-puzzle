/**
 * Every effect, written only with names: a shape (shapes.js), colour roles (FX_BODY_COLORS,
 * used in turn),
 * a duration and easings from the design style (paperStyle.js). Sizes and distances are CSS px
 * on screen, so an effect looks the same at every zoom. tests/effects checks every recipe
 * against the limits shared by all styles (invariants.js) and against the style in use.
 *
 * Motions:
 * - 'hop': `count` stamps jump up from a point, `travelPx` high, leaning a little to either side.
 * - 'spread': `count` stamps move apart from a point in even directions, `travelPx` far.
 * - 'rain': `count` stamps fall across the whole screen, swaying `travelPx` to the sides.
 * - 'turn': `count` stamps stay at a point and turn `spinTurns` in the direction given when the
 *   effect is played (spawnEffect `direction`: 1 clockwise, -1 anticlockwise, drawn mirrored).
 * - 'flip': `count` stamps stay at a point and turn over `spinTurns` times, like a card.
 * `waves` (default 1) repeats the stamps `waveGapSec` apart; later waves are dropped when the PC
 * is struggling (effectPlayer.js SLOW_FRAME_SEC), so a big effect cannot freeze a slow PC.
 */
export const EFFECTS = Object.freeze({
  /** One star hopping out where pieces snap into place: small and short, never in the way. */
  snapStar: Object.freeze({
    shape: 'star',
    colors: ['quiet'],
    motion: 'hop',
    count: 1,
    sizePx: 13,
    travelPx: 26,
    spinTurns: 0.1,
    duration: 'short',
    scale: 'pop',
    travel: 'jump',
  }),
  /** A puff of smoke: a piece knocked off the board ("drop"), a fake piece vanishing. */
  smokePuff: Object.freeze({
    shape: 'puff',
    colors: ['smoke'],
    motion: 'spread',
    count: 3,
    sizePx: 18,
    travelPx: 16,
    spinTurns: 0.05,
    duration: 'medium',
    scale: 'pop',
    travel: 'out',
  }),
  /** One small puff: where a knocked-off piece lands, so players see where it went. */
  smallPuff: Object.freeze({
    shape: 'puff',
    colors: ['smoke'],
    motion: 'spread',
    count: 1,
    sizePx: 16,
    travelPx: 0,
    spinTurns: 0,
    duration: 'short',
    scale: 'pop',
    travel: 'out',
  }),
  /** Dust kicked up under a heavy piece while it is dragged (a few every second). */
  heavyDust: Object.freeze({
    shape: 'puff',
    colors: ['smoke'],
    motion: 'spread',
    count: 2,
    sizePx: 12,
    travelPx: 10,
    spinTurns: 0.05,
    duration: 'short',
    scale: 'pop',
    travel: 'out',
  }),
  /** A curled arrow turning over a group that interference ("prank") turned round. */
  prankTurn: Object.freeze({
    shape: 'curl',
    colors: ['mischief'],
    motion: 'turn',
    count: 1,
    sizePx: 24,
    travelPx: 0,
    spinTurns: 0.25,
    duration: 'medium',
    scale: 'pop',
    travel: 'out',
  }),
  /** The same arrow turning over like a card, over a piece that interference flipped. */
  prankFlip: Object.freeze({
    shape: 'curl',
    colors: ['mischief'],
    motion: 'flip',
    count: 1,
    sizePx: 24,
    travelPx: 0,
    spinTurns: 1,
    duration: 'medium',
    scale: 'pop',
    travel: 'out',
  }),
  /** A few small stars popping where the superchat card was hit: a hit you can feel. */
  superchatHit: Object.freeze({
    shape: 'star',
    colors: ['gold'],
    motion: 'spread',
    count: 3,
    sizePx: 12,
    travelPx: 24,
    spinTurns: 0.15,
    duration: 'short',
    scale: 'pop',
    travel: 'out',
  }),
  /** The superchat card driven off: a cloud of smoke where it was (with superchatBurstStars). */
  superchatBurstPuff: Object.freeze({
    shape: 'puff',
    colors: ['smoke'],
    motion: 'spread',
    count: 5,
    sizePx: 28,
    travelPx: 40,
    spinTurns: 0.05,
    duration: 'medium',
    scale: 'pop',
    travel: 'out',
  }),
  /** Stars flying out of the smoke when the superchat card is driven off, and on completion. */
  superchatBurstStars: Object.freeze({
    shape: 'star',
    colors: ['gold', 'rose', 'mint'],
    motion: 'spread',
    count: 12,
    sizePx: 18,
    travelPx: 100,
    spinTurns: 0.3,
    duration: 'medium',
    scale: 'pop',
    travel: 'out',
  }),
  /** Confetti when the puzzle is completed: once per game, so it may be lavish. */
  confetti: Object.freeze({
    shape: 'strip',
    colors: ['gold', 'rose', 'mint', 'quiet'],
    motion: 'rain',
    count: 20,
    waves: 6,
    waveGapSec: 0.25,
    sizePx: 16,
    travelPx: 28,
    spinTurns: 1.5,
    duration: 'celebrate',
    scale: 'settle',
    travel: 'fall',
  }),
});

/** Colour roles an effect may fill a shape with, and the CSS custom property each comes from. */
export const FX_BODY_COLORS = Object.freeze({
  /** Effects that happen often (every snap): low-key in both themes, never in the way. */
  quiet: '--fx-quiet',
  /** Smoke and dust: grey, a little stronger than `quiet` (something happened to a piece). */
  smoke: '--fx-smoke',
  /** Interference that changes pieces (prank): purple, clearly "someone did this". */
  mischief: '--fx-mischief',
  /** Celebration colours (completion). */
  gold: '--fx-gold',
  rose: '--fx-rose',
  mint: '--fx-mint',
});
