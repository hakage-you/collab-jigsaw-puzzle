import { PuzzleEngine } from '../../src/core/puzzleEngine.js';
import { imageAnalyzer } from '../../src/services/imagePixels.js';
import { generateSampleImageCanvas } from '../../src/services/sampleImage.js';
import { SMALL_PUZZLE } from './coreEngine.js';

// Board helpers shared with the Node tests live in coreEngine.js (canvas-free).
export { SMALL_PUZZLE, boardState, dropNearTarget, movePieceTo } from './coreEngine.js';

/** Creates an engine with a fresh puzzle built from the real sample image (canvas). */
export function createEngine(options = {}) {
  const engine = new PuzzleEngine({ imageAnalyzer });
  engine.initPuzzle({
    sourceCanvas: generateSampleImageCanvas(),
    isSampleImage: true,
    ...SMALL_PUZZLE,
    ...options,
  });
  return engine;
}
