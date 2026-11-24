import { OS_REDUCE_MOTION_QUERY, resolveEffectStrength } from '../app/comfortSettings.js';
import { RendererHost } from '../render/rendererHost.js';

/**
 * Creates the renderer for the game page's puzzle canvas: WebGPU -> WebGL2 -> Canvas 2D
 * according to settings.rendererMode.
 * `onChange({ kind, reason })` is told which renderer is in use, also after a fallback.
 * `watchSettings(fn)` calls `fn` whenever the settings change.
 */
export function createPuzzleRenderer({ engine, room, getSettings, onChange, watchSettings }) {
  const host = new RendererHost({
    canvasStage: document.getElementById('canvasStage'),
    canvas: document.getElementById('puzzleCanvas'),
    engine,
    room,
    getSettings,
    mode: getSettings().rendererMode,
    onChange,
  });
  // The effect strength of "演出と音" (settings.effectStrength), or the OS's reduce motion until
  // the player chose one.
  const reduceMotion = window.matchMedia(OS_REDUCE_MOTION_QUERY);
  const applyMotion = () => {
    const strength = resolveEffectStrength(getSettings().effectStrength, reduceMotion.matches);
    host.viewState.effectIntensity = strength;
    // The page's own motions (styles: .effects-reduced) stop when reduced and when off.
    document.documentElement.classList.toggle('effects-reduced', strength !== 'normal');
  };
  applyMotion();
  reduceMotion.addEventListener('change', applyMotion);
  watchSettings?.(applyMotion);
  return host;
}
