import { describe, expect, it } from 'vitest';
import { createEngine } from '../helpers/coreEngine.js';

// Agreement with canvas isPointInPath needs a real canvas: tests/render/pieceHitTestCanvas.test.js.

describe('engine.hitTest with rotated and flipped pieces', () => {
  it('finds the piece at its own center for every rotation and flip', () => {
    const engine = createEngine({ cols: 5, rows: 4, allowRotation: true, allowFlip: true });
    for (const piece of engine.pieces) {
      // Move pieces far apart so no other piece covers the center.
      piece.x = piece.id * 1000;
      piece.y = 0;
    }
    engine.bumpZVersion();
    for (const piece of engine.pieces) {
      for (let rotation = 0; rotation < 4; rotation++) {
        for (const isFlipped of [false, true]) {
          piece.rotation = rotation;
          piece.isFlipped = isFlipped;
          expect(engine.hitTest(piece.x, piece.y)).toBe(piece);
        }
      }
    }
  });
});
