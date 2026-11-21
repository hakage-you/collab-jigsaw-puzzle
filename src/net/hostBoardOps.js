import { MSG } from './protocol.js';
import { serializePieces, broadcastPiecesPatch } from './hostSyncHelper.js';

/**
 * Keeps only the positions of pieces that belong to the group. A guest can never move a piece
 * outside the group whose lock it holds.
 */
function keepGroupPositions(room, groupId, positions) {
  const members = new Set(room.engine.getGroupPieces(groupId).map((p) => p.id));
  return positions.filter((pos) => members.has(pos.id));
}

/** Guest cursor position: stored locally and relayed to the other participants. */
export function handleCursorMove(session, { connId, playerId, guest, msg }) {
  const room = session.room;
  const cursor = {
    playerId,
    x: msg.x,
    y: msg.y,
    name: guest.name,
    color: guest.color,
  };
  room.remoteCursors.set(playerId, { ...cursor, targetX: cursor.x, targetY: cursor.y });
  room.transport.broadcast({ type: MSG.CURSOR_MOVE, ...cursor }, connId);
  room.cb.onRenderNeeded();
}

/** Live drag positions of a group the guest currently holds. */
export function handleDragPreview(session, { connId, playerId, msg }) {
  const room = session.room;
  const { groupId } = msg;
  if (room.groupLocks.get(groupId) !== playerId) return;
  const positions = keepGroupPositions(room, groupId, msg.positions);
  room.applyPositionsOnly(positions);
  room.transport.broadcast(
    { type: MSG.DRAG_PREVIEW, groupId, ownerId: playerId, positions },
    connId,
  );
  room.cb.onRenderNeeded();
}

/** Grants a group lock, or denies it with the current owner and piece state. */
export function handleLockRequest(session, { connId, playerId, msg }) {
  const room = session.room;
  const { groupId } = msg;
  const group = room.engine.getGroupPieces(groupId);
  if (group.length === 0 || group.some((p) => p.isLocked)) {
    room.transport.sendTo(connId, {
      type: MSG.LOCK_DENIED,
      groupId,
      ownerId: null,
      pieces: serializePieces(group),
    });
    return;
  }
  const currentOwner = room.groupLocks.get(groupId);
  if (currentOwner && currentOwner !== playerId) {
    room.transport.sendTo(connId, {
      type: MSG.LOCK_DENIED,
      groupId,
      ownerId: currentOwner,
      pieces: serializePieces(group),
    });
    return;
  }
  const from = typeof msg.x === 'number' ? { x: msg.x, y: msg.y } : null;
  if (room.runaway.onGrab(groupId, playerId, from)) return;
  for (const [heldGid, owner] of room.groupLocks.entries()) {
    if (owner === playerId && heldGid !== groupId) {
      room.groupLocks.delete(heldGid);
      room.transport.broadcast({ type: MSG.LOCK_RELEASE, groupId: heldGid });
    }
  }
  room.groupLocks.set(groupId, playerId);
  room.engine.bringGroupToFront(groupId);
  const zOrder = group[0]?.zOrder || 1;
  room.transport.broadcast({ type: MSG.LOCK_GRANTED, groupId, ownerId: playerId, zOrder });
  room.cb.onRenderNeeded();
}

/** Releases a guest's group after a drop, resolves snapping and broadcasts the result. */
export function handleDropRequest(session, { connId, playerId, guest, msg }) {
  const room = session.room;
  const { groupId } = msg;
  const currentOwner = room.groupLocks.get(groupId);
  // Only the lock owner may drop. A denial carries the authoritative pieces so the guest resyncs.
  if (currentOwner !== playerId) {
    room.transport.sendTo(connId, {
      type: MSG.LOCK_DENIED,
      groupId,
      ownerId: currentOwner ?? null,
      pieces: serializePieces(room.engine.getGroupPieces(groupId)),
    });
    return;
  }
  room.groupLocks.delete(groupId);
  room.runaway.onRelease(groupId);
  room.applyPositionsOnly(keepGroupPositions(room, groupId, msg.positions));
  const res = room.engine.resolveDrop(groupId);
  if (res.type === 'snap') {
    guest.contrib += res.count;
  }
  const affected = room.engine.getGroupPieces(groupId);
  session.syncRoster();
  broadcastPiecesPatch(room, affected, res, playerId);
  room.cb.onHostPatchApplied(affected, res, playerId);
  session.scheduleAutoBackup();
}

/** Rotates or flips a guest's piece group when not locked by someone else. */
export function handleRotateOrFlip(session, { connId, playerId, msg }) {
  const room = session.room;
  const piece = room.engine.getPieceById(msg.pieceId);
  if (!piece || piece.isLocked) return;
  const owner = room.groupLocks.get(piece.groupId);
  if (owner && owner !== playerId) {
    room.transport.sendTo(connId, {
      type: MSG.LOCK_DENIED,
      groupId: piece.groupId,
      ownerId: owner,
      pieces: serializePieces(room.engine.getGroupPieces(piece.groupId)),
    });
    return;
  }
  const settings = room.getSettings();
  const isRotate = msg.type === MSG.ROTATE_REQUEST;
  const changed = isRotate
    ? room.engine.rotateGroup(piece, settings.allowRotation)
    : room.engine.flipPiece(piece, settings.allowFlip);
  if (changed) {
    const affected = room.engine.getGroupPieces(piece.groupId);
    broadcastPiecesPatch(
      room,
      affected,
      { type: isRotate ? 'rotate' : 'flip', opSeq: msg.opSeq },
      playerId,
    );
    room.cb.onRenderNeeded();
    session.scheduleAutoBackup();
  }
}
