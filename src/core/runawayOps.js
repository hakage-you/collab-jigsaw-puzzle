import { OJAMA_CONFIG } from '../config/constants.js';

/**
 * Runaway pieces (_plan/open_issues.md section 9): while it lasts, loose pieces and small groups
 * hop away when someone grabs them, and slip out of the hand after a few seconds. The host decides
 * (rules below) and sends the new positions; these helpers only do the board side.
 */

/** Whether the group runs away: loose (none placed on the board) and at most `maxGroup` pieces. */
export function canRunAway(engine, groupId, maxGroup = OJAMA_CONFIG.RUNAWAY_MAX_GROUP) {
  const group = engine.getGroupPieces(groupId);
  return group.length > 0 && group.length <= maxGroup && !group.some((p) => p.isLocked);
}

/** The desk area pieces may hop within: the board and every piece, with a piece of margin. */
function deskBounds(engine) {
  const padX = engine.pieceW;
  const padY = engine.pieceH;
  let minX = -engine.boardW / 2 - padX;
  let maxX = engine.boardW / 2 + padX;
  let minY = -engine.boardH / 2 - padY;
  let maxY = engine.boardH / 2 + padY;
  for (const p of engine.pieces) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Moves the group 1.5 to 3 piece sizes away from `from` (the grab point; a random way when not
 * given), kept on the desk and never snapped into place. Returns the new positions.
 * @returns {{id: number, x: number, y: number}[]}
 */
export function hopGroup(engine, groupId, from = null, random = Math.random) {
  const group = engine.getGroupPieces(groupId);
  if (group.length === 0) return [];
  const cx = group.reduce((s, p) => s + p.x, 0) / group.length;
  const cy = group.reduce((s, p) => s + p.y, 0) / group.length;
  const away = from && Math.hypot(cx - from.x, cy - from.y) > 1e-3;
  const base =
    (away ? Math.atan2(cy - from.y, cx - from.x) : random() * Math.PI * 2) + (random() - 0.5) * 1.2;
  const C = OJAMA_CONFIG;
  const size = Math.max(engine.pieceW, engine.pieceH);
  const minDist = size * C.RUNAWAY_HOP_MIN_PIECES;
  const dist = minDist + size * random() * (C.RUNAWAY_HOP_MAX_PIECES - C.RUNAWAY_HOP_MIN_PIECES);
  const b = deskBounds(engine);
  // Away from the grab first; at the desk's edge, the first other way that still goes far enough.
  let best = { dx: 0, dy: 0, len: -1 };
  for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2]) {
    const a = base + turn * (Math.PI / 2);
    const nx = Math.max(b.minX, Math.min(b.maxX, cx + Math.cos(a) * dist));
    const ny = Math.max(b.minY, Math.min(b.maxY, cy + Math.sin(a) * dist));
    const len = Math.hypot(nx - cx, ny - cy);
    if (len > best.len) best = { dx: nx - cx, dy: ny - cy, len };
    if (len >= minDist * 0.99) break;
  }
  const { dx, dy } = best;
  for (const p of group) {
    p.x += dx;
    p.y += dy;
  }
  engine.bringGroupToFront(groupId);
  return group.map((p) => ({ id: p.id, x: p.x, y: p.y }));
}
