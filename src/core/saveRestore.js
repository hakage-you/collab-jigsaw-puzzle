import { PUZZLE_CONFIG } from '../config/constants.js';

/** Indexes saved piece records by piece id. */
export function buildSavedMap(savedPieces) {
  const savedMap = new Map();
  for (const sp of savedPieces) {
    savedMap.set(sp.id, sp);
  }
  return savedMap;
}

/**
 * Scale factors that map saved piece coordinates onto the current board size.
 * Saves without board dimensions use the legacy reference board size.
 */
export function computeCoordScale(engine, pInfo, sourceCanvas) {
  if (pInfo.boardW > 0 && pInfo.boardH > 0) {
    return {
      coordScaleX: engine.boardW / pInfo.boardW,
      coordScaleY: engine.boardH / pInfo.boardH,
    };
  }
  const refW = Math.max(1, Number(pInfo.imageWidth) || sourceCanvas.width);
  const refH = Math.max(1, Number(pInfo.imageHeight) || sourceCanvas.height);
  const legacyScale = Math.min(
    PUZZLE_CONFIG.BOARD_MAX_WIDTH / refW,
    PUZZLE_CONFIG.BOARD_MAX_HEIGHT / refH,
  );
  const oldW = Math.max(1, Math.round(refW * legacyScale));
  const oldH = Math.max(1, Math.round(refH * legacyScale));
  return {
    coordScaleX: engine.boardW / oldW,
    coordScaleY: engine.boardH / oldH,
  };
}

const BREAKDOWN_KEYS = ['drop', 'visual', 'superchat', 'prank', 'fake', 'heavy', 'runaway'];

/** Normalises the saved stats block, defaulting every counter to 0. */
export function restoreStats(saveStats) {
  const st = saveStats || {};
  return {
    elapsedMs: Number(st.elapsedMs) || 0,
    placedCount: Number(st.placedCount) || 0,
    ojamaTotal: Number(st.ojamaTotal) || 0,
    ojamaBreakdown: Object.fromEntries(
      BREAKDOWN_KEYS.map((key) => [key, Number(st.ojamaBreakdown?.[key]) || 0]),
    ),
  };
}
