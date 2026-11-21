import { CanvasRenderer } from '../render/canvas2d/canvasRenderer.js';

/** Creates the renderer for the game page's puzzle canvas. */
export function createPuzzleRenderer({ engine, room, getSettings }) {
  return new CanvasRenderer({
    canvasStage: document.getElementById('canvasStage'),
    canvas: document.getElementById('puzzleCanvas'),
    engine,
    room,
    getSettings,
  });
}
