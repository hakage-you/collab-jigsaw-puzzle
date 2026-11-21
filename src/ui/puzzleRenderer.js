import { RendererHost } from '../render/rendererHost.js';

/**
 * Creates the renderer for the game page's puzzle canvas: WebGL2 when available, Canvas 2D
 * otherwise or when the player chose compatibility mode (settings.rendererMode).
 * `onChange({ kind, reason })` is told which renderer is in use, also after a fallback.
 */
export function createPuzzleRenderer({ engine, room, getSettings, onChange }) {
  const host = new RendererHost({
    canvasStage: document.getElementById('canvasStage'),
    canvas: document.getElementById('puzzleCanvas'),
    engine,
    room,
    getSettings,
    mode: getSettings().rendererMode,
    onChange,
  });
  // Until the effect-strength setting exists (_plan/open_issues.md 7), follow the OS:
  // "reduce motion" plays smaller effects.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const applyMotion = () => {
    host.viewState.effectIntensity = reduceMotion.matches ? 'reduced' : 'normal';
  };
  applyMotion();
  reduceMotion.addEventListener('change', applyMotion);
  return host;
}
