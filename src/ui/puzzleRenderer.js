import { RendererHost } from '../render/rendererHost.js';

/**
 * Creates the renderer for the game page's puzzle canvas: WebGL2 when available, Canvas 2D
 * otherwise or when the player chose compatibility mode (settings.rendererMode).
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
  // Smaller effects when the player turned on "演出を控えめに" (settings.reduceEffects) or the
  // OS asks to reduce motion, whichever says so.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const applyMotion = () => {
    const reduced = reduceMotion.matches || Boolean(getSettings().reduceEffects);
    host.viewState.effectIntensity = reduced ? 'reduced' : 'normal';
    // The page's own small motions (styles: .effects-reduced) follow the same switch.
    document.documentElement.classList.toggle('effects-reduced', reduced);
  };
  applyMotion();
  reduceMotion.addEventListener('change', applyMotion);
  watchSettings?.(applyMotion);
  return host;
}
