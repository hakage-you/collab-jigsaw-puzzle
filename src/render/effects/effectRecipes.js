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
  /** Celebration colours (completion). */
  gold: '--fx-gold',
  rose: '--fx-rose',
  mint: '--fx-mint',
});
