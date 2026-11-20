import { PUZZLE_CONFIG } from '../config/constants.js';
import { buildPiecePath } from './jigsawPath.js';
import { renderPieceBackSprite, renderPieceSprites } from './pieceSpriteBuilder.js';

/**
 * Scatters `count` piece positions around the board perimeter and shuffles them.
 * Consumes rng in the same order as before the extraction.
 */
function generatePerimeterScatterPositions(engine, count, rng) {
  const positions = [];
  const marginX = engine.boardW / 2 + engine.pieceW * 0.95;
  const marginY = engine.boardH / 2 + engine.pieceH * 0.95;
  const perimeterSpan = 2 * (engine.boardW + engine.boardH);
  const neededArea = count * engine.pieceW * engine.pieceH * 1.45;
  const idealBand = Math.ceil(neededArea / Math.max(1, perimeterSpan));
  const bandW = Math.max(engine.pieceW * 3.0, Math.min(engine.boardW * 0.48, idealBand));
  const bandH = Math.max(engine.pieceH * 2.4, Math.min(engine.boardH * 0.48, idealBand));

  for (let i = 0; i < count; i++) {
    positions.push(scatterPoint(engine, i % 4, { marginX, marginY, bandW, bandH }, rng));
  }

  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions;
}

function scatterPoint(engine, side, band, rng) {
  const { marginX, marginY, bandW, bandH } = band;
  if (side === 0) {
    return {
      x: (rng() - 0.5) * (engine.boardW + bandW * 1.4),
      y: -marginY - rng() * bandH,
    };
  }
  if (side === 1) {
    return {
      x: marginX + rng() * bandW,
      y: (rng() - 0.5) * (engine.boardH + bandH * 0.8),
    };
  }
  if (side === 2) {
    return {
      x: (rng() - 0.5) * (engine.boardW + bandW * 1.4),
      y: marginY + rng() * bandH,
    };
  }
  return {
    x: -marginX - rng() * bandW,
    y: (rng() - 0.5) * (engine.boardH + bandH * 0.8),
  };
}

/**
 * Creates every piece for the engine's grid and pushes it onto engine.pieces.
 * opts: { layout, colorInfos, rng, atlas, savedMap, allowRotation, allowFlip,
 *         coordScaleX, coordScaleY }
 * Returns the highest group id and z order seen (used when restoring a save).
 */
export function buildPieceSet(engine, opts) {
  const total = engine.cols * engine.rows;
  const positions = opts.savedMap
    ? null
    : generatePerimeterScatterPositions(engine, total, opts.rng);
  const state = { opts, positions, highestGroup: 0, highestZ: 1 };

  for (let r = 0; r < engine.rows; r++) {
    for (let c = 0; c < engine.cols; c++) {
      const piece = createPiece(engine, state, r, c);
      renderPieceImages(engine, piece, opts.atlas, total);
      engine.pieces.push(piece);
    }
  }
  return { highestGroup: state.highestGroup, highestZ: state.highestZ };
}

function targetCenter(engine, r, c) {
  return {
    targetX: -engine.boardW / 2 + (c + 0.5) * engine.pieceW,
    targetY: -engine.boardH / 2 + (r + 0.5) * engine.pieceH,
  };
}

function createPiece(engine, state, r, c) {
  const { opts } = state;
  const id = r * engine.cols + c;
  const { targetX, targetY } = targetCenter(engine, r, c);
  const path = buildPiecePath({
    row: r,
    col: c,
    cols: engine.cols,
    rows: engine.rows,
    targetX,
    targetY,
    layout: opts.layout,
    tabSize: engine.tabSize,
  });

  const sp = opts.savedMap ? opts.savedMap.get(id) : null;
  const pos = state.positions ? state.positions[id] : null;
  const isLocked = sp ? Boolean(sp.isLocked) : false;
  const groupId = sp ? sp.groupId : engine.nextGroupId++;
  const zOrder = sp ? (isLocked ? 0 : ++state.highestZ) : engine.maxZ++;
  state.highestGroup = Math.max(state.highestGroup, groupId);

  return {
    id,
    row: r,
    col: c,
    isEdge: r === 0 || r === engine.rows - 1 || c === 0 || c === engine.cols - 1,
    targetX,
    targetY,
    x: sp ? restoredCoord(isLocked, targetX, sp.x, opts.coordScaleX) : pos.x,
    y: sp ? restoredCoord(isLocked, targetY, sp.y, opts.coordScaleY) : pos.y,
    rotation: pickRotation(sp, opts),
    isFlipped: pickFlip(sp, opts),
    groupId,
    isLocked,
    zOrder,
    colorInfo: opts.colorInfos[id],
    path,
    frontSprite: null,
    backSprite: null,
    spriteHalfW: engine.pieceW / 2 + engine.spritePad,
    spriteHalfH: engine.pieceH / 2 + engine.spritePad,
  };
}

function restoredCoord(isLocked, target, savedValue, scale) {
  return isLocked ? target : savedValue * scale;
}

function pickRotation(sp, opts) {
  if (sp) return ((sp.rotation % 4) + 4) % 4;
  return opts.allowRotation ? Math.floor(opts.rng() * 4) : 0;
}

function pickFlip(sp, opts) {
  if (sp) return Boolean(sp.isFlipped);
  if (!opts.allowFlip) return false;
  return opts.rng() < PUZZLE_CONFIG.FLIP_INITIAL_PROB;
}

function renderPieceImages(engine, piece, atlas, total) {
  renderPieceSprites(piece, {
    sourceCanvas: engine.sourceCanvas,
    boardW: engine.boardW,
    boardH: engine.boardH,
    pieceW: engine.pieceW,
    pieceH: engine.pieceH,
    spritePad: engine.spritePad,
    atlas,
    totalPieces: total,
  });
  if (piece.isFlipped) {
    renderPieceBackSprite(piece, {
      pieceW: engine.pieceW,
      pieceH: engine.pieceH,
      spritePad: engine.spritePad,
      backPatternCanvas: engine.backPatternCanvas,
      atlas,
    });
  }
}
