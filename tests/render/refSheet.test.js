import { describe, expect, it } from 'vitest';
import { ViewState, refSheetFrame } from '../../src/render/viewState.js';
import { createEngine } from '../helpers/puzzle.js';

// The reference sheet is the default way to show the reference image, so a new puzzle must not
// scatter pieces on top of it, and "fit to view" must show it.

const VIEWPORT = { width: 1280, height: 720 };

function setup(grid) {
  const engine = createEngine({ ...grid, allowRotation: true });
  const vs = new ViewState({
    getViewportSize: () => VIEWPORT,
    engine,
    getSettings: () => ({ referenceMode: 'sheet' }),
  });
  vs.resetRefSheetGeometry(engine.sourceCanvas);
  return { engine, vs };
}

/** The sheet's paper (image, margin, title strip) as a box in world units. */
function sheetBox(sheet) {
  const { pad, header } = refSheetFrame(sheet);
  return {
    minX: sheet.x - sheet.w / 2 - pad,
    maxX: sheet.x + sheet.w / 2 + pad,
    minY: sheet.y - sheet.h / 2 - pad - header,
    maxY: sheet.y + sheet.h / 2 + pad,
  };
}

describe('reference sheet placement', () => {
  it.each([
    ['6x4', { cols: 6, rows: 4 }],
    ['30x20', { cols: 30, rows: 20 }],
    ['60x50 (3000 pieces)', { cols: 60, rows: 50 }],
  ])('%s: no scattered piece reaches the sheet', (_name, grid) => {
    const { engine, vs } = setup(grid);
    const box = sheetBox(vs.refSheet);
    const reach = Math.max(engine.pieceW, engine.pieceH) / 2 + engine.spritePad;
    const leftmostEdge = Math.min(...engine.pieces.map((p) => p.x - reach));
    expect(leftmostEdge).toBeGreaterThan(box.maxX);
  });

  it.each([
    ['6x4', { cols: 6, rows: 4 }],
    ['60x50 (3000 pieces)', { cols: 60, rows: 50 }],
  ])('%s: fit to view shows the whole sheet', (_name, grid) => {
    const { vs } = setup(grid);
    vs.fitView();
    const box = sheetBox(vs.refSheet);
    const { x, y, scale } = vs.camera;
    expect(box.minX).toBeGreaterThanOrEqual(x - VIEWPORT.width / (2 * scale));
    expect(box.maxX).toBeLessThanOrEqual(x + VIEWPORT.width / (2 * scale));
    expect(box.minY).toBeGreaterThanOrEqual(y - VIEWPORT.height / (2 * scale));
    expect(box.maxY).toBeLessThanOrEqual(y + VIEWPORT.height / (2 * scale));
  });

  it('the sheet can be grabbed by its title strip', () => {
    const { vs } = setup({ cols: 6, rows: 4 });
    const box = sheetBox(vs.refSheet);
    expect(vs.isPointInRefSheet(vs.refSheet.x, box.minY + 1)).toBe(true);
    expect(vs.isPointInRefSheet(box.maxX + 1, vs.refSheet.y)).toBe(false);
  });
});
