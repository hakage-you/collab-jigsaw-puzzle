import { COMFORT_CONFIG } from '../config/constants.js';

/**
 * "演出と音": each player's own effect strength and volumes (settings.effectStrength,
 * settings.volume; COMFORT_CONFIG). They stay in this browser: saves and the board sent to guests
 * leave them out.
 */

/** The media query for the OS's "reduce motion" setting. */
export const OS_REDUCE_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * The effect strength in effect: the player's own choice once they made one; until then
 * (null) 'reduced' while the OS asks to reduce motion, else 'normal'.
 */
export function resolveEffectStrength(effectStrength, osReducesMotion) {
  if (COMFORT_CONFIG.EFFECT_STRENGTHS.includes(effectStrength)) return effectStrength;
  return osReducesMotion ? 'reduced' : 'normal';
}
