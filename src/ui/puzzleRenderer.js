import { RendererHost } from '../render/rendererHost.js';

/**
 * Creates the renderer for the game page's puzzle canvas: WebGL2 when available, Canvas 2D
 * otherwise or when the player chose compatibility mode (settings.rendererMode).
 * `onChange({ kind, reason })` is told which renderer is in use, also after a fallback.
 */
export function createPuzzleRenderer({ engine, room, getSettings, onChange }) {
  return new RendererHost({
    canvasStage: document.getElementById('canvasStage'),
    canvas: document.getElementById('puzzleCanvas'),
    engine,
    room,
    getSettings,
    mode: getSettings().rendererMode,
    onChange,
  });
}
