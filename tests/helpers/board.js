import { boardState } from './puzzle.js';

// Board driver for the acceptance tests (tests/acceptance/): reads a session's board and
// performs the pointer gestures the canvas would, through GameSession's public methods.
// Reading pieces needs GameSession.engine, which acceptance tests may not touch, so it stays
// here. When the engine's shape changes, fix it here.

/** Offset (world units) large enough that a dropped piece never snaps or merges. */
export const FAR = 500;

/** A comparable copy of the whole board: every piece's position, rotation, flip and lock. */
export function boardOf(app) {
  return boardState(app.engine);
}

/** A copy of one piece as the player sees it, looked up in that session's own board by id. */
export function pieceOf(app, id) {
  const p = app.engine.getPieceById(id);
  if (!p) throw new Error(`piece ${id} not found`);
  const { groupId, x, y, targetX, targetY, rotation, isLocked } = p;
  return { id, groupId, x, y, targetX, targetY, rotation, isLocked: Boolean(isLocked) };
}

/** Ids of the pieces not yet in place. */
export function looseIds(app) {
  return app.engine.pieces.filter((p) => !p.isLocked).map((p) => p.id);
}

/** How many pieces are in place, and how many there are. */
export function progressOf(app) {
  return { placed: app.engine.getLockedCount(), total: app.engine.pieces.length };
}

/** The id of the player holding the piece's group, or null. */
export function holderOf(app, id) {
  return app.getHolder(pieceOf(app, id).groupId);
}

/** Grabs a piece's group (pointer down). Returns GameSession.requestLock's answer. */
export function grab(app, id) {
  return app.requestLock(pieceOf(app, id).groupId);
}

/** Moves the held group so that the piece sits at (x, y), and shows it to the others. */
export function moveHeld(app, id, x, y) {
  const piece = pieceOf(app, id);
  app.moveGroup(piece.groupId, x - piece.x, y - piece.y);
  app.sendDragPreview(piece.groupId, true);
}

/** Lets go of the held group (pointer up). Returns GameSession.submitDrop's answer. */
export function release(app, id) {
  return app.submitDrop(pieceOf(app, id).groupId);
}

/** A whole drag: grab, move to (x, y), release. Null when the grab was refused. */
function dragTo(app, id, x, y) {
  if (!grab(app, id).allowed) return null;
  moveHeld(app, id, x, y);
  return release(app, id);
}

/** Drags a piece onto its correct position, where it snaps into place. */
export function dragIntoPlace(app, id) {
  const { targetX, targetY } = pieceOf(app, id);
  return dragTo(app, id, targetX, targetY);
}

/** Drags a piece far from its correct position, where it stays loose. */
export function dragAway(app, id, dx = FAR) {
  const { targetX, targetY } = pieceOf(app, id);
  return dragTo(app, id, targetX + dx, targetY + FAR);
}

/** Turns a piece a quarter turn (right click). Returns GameSession.submitRotate's answer. */
export function rotate(app, id) {
  return app.submitRotate(app.engine.getPieceById(id));
}

/** Turns a piece until it is upright; only upright pieces snap into place. */
export function turnUpright(app, id) {
  while (pieceOf(app, id).rotation !== 0) {
    if (!rotate(app, id)) throw new Error(`piece ${id} cannot be turned`);
  }
}
