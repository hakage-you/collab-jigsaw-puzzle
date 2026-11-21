/**
 * Every effect, written only with names: a shape (shapes.js), a colour role (FX_BODY_COLORS),
 * a duration and easings from the design style (paperStyle.js). Sizes and distances are CSS px
 * on screen, so an effect looks the same at every zoom. tests/effects checks every recipe
 * against the limits shared by all styles (invariants.js) and against the style in use.
 *
 * Motions:
 * - 'hop': `count` stamps jump up from a point, `travelPx` high, leaning a little to either side.
 * - 'spread': `count` stamps move apart from a point in even directions, `travelPx` far.
 */
export const EFFECTS = Object.freeze({
  /** One star hopping out where pieces snap into place: small and short, never in the way. */
  snapStar: Object.freeze({
    shape: 'star',
    color: 'quiet',
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
    color: 'smoke',
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
    color: 'smoke',
    motion: 'spread',
    count: 1,
    sizePx: 16,
    travelPx: 0,
    spinTurns: 0,
    duration: 'short',
    scale: 'pop',
    travel: 'out',
  }),
});

/** Colour roles an effect may fill a shape with, and the CSS custom property each comes from. */
export const FX_BODY_COLORS = Object.freeze({
  /** Effects that happen often (every snap): low-key in both themes, never in the way. */
  quiet: '--fx-quiet',
  /** Smoke and dust: grey, a little stronger than `quiet` (something happened to a piece). */
  smoke: '--fx-smoke',
  gold: '--fx-gold',
});
