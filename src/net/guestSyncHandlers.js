import { turnStates } from '../core/pieceOjamaOps.js';
import { MSG } from './protocol.js';

/** True when the guest's optimistic lock rollback is pending for this group. */
export function isRollbackFor(session, groupId) {
  return session.optimisticRollback?.groupId === groupId;
}

function handleRosterUpdate(session, msg) {
  const room = session.room;
  room.roster = msg.roster || [];
  room.cb.onRosterUpdate(room.roster);
}

function handleCursorMove(session, msg) {
  const room = session.room;
  if (msg.playerId === room.myPlayerId) return;
  const existing = room.remoteCursors.get(msg.playerId);
  if (existing) {
    existing.targetX = msg.x;
    existing.targetY = msg.y;
    existing.name = msg.name;
    existing.color = msg.color;
  } else {
    room.remoteCursors.set(msg.playerId, {
      playerId: msg.playerId,
      x: msg.x,
      y: msg.y,
      targetX: msg.x,
      targetY: msg.y,
      name: msg.name,
      color: msg.color,
    });
  }
  room.cb.onRenderNeeded();
}

function applyGroupZOrder(room, groupId, zOrder) {
  for (const p of room.engine.getGroupPieces(groupId)) {
    p.zOrder = zOrder;
  }
  room.engine.maxZ = Math.max(room.engine.maxZ, zOrder + 1);
  room.engine.bumpZVersion();
}

function handleLockGranted(session, msg) {
  const room = session.room;
  room.groupLocks.set(msg.groupId, msg.ownerId);
  if (typeof msg.zOrder === 'number') {
    applyGroupZOrder(room, msg.groupId, msg.zOrder);
  }
  if (msg.ownerId === room.myPlayerId && isRollbackFor(session, msg.groupId)) {
    session.optimisticRollback = null;
  }
  room.cb.onRenderNeeded();
}

function handleLockDenied(session, msg) {
  const room = session.room;
  if (msg.ownerId) room.groupLocks.set(msg.groupId, msg.ownerId);
  else room.groupLocks.delete(msg.groupId);
  if (Array.isArray(msg.pieces)) {
    room.engine.applyPiecePatches(msg.pieces);
  } else if (isRollbackFor(session, msg.groupId)) {
    room.applyPositionsOnly(session.optimisticRollback.snapshot);
  }
  session.optimisticRollback = null;
  room.cb.onLockDenied(msg.groupId);
}

/** A runaway group hopped: it is nobody's any more, and lands at the host's positions. */
function handlePieceHop(session, msg) {
  const room = session.room;
  room.groupLocks.delete(msg.groupId);
  room.remoteDragTargets.delete(msg.groupId);
  if (isRollbackFor(session, msg.groupId)) session.optimisticRollback = null;
  const from = new Map(
    room.engine.getGroupPieces(msg.groupId).map((p) => [p.id, { x: p.x, y: p.y }]),
  );
  room.applyPositionsOnly(msg.positions);
  room.cb.onPieceHop({ groupId: msg.groupId, from, byPlayerId: msg.byPlayerId });
}

function handleLockRelease(session, msg) {
  const room = session.room;
  room.groupLocks.delete(msg.groupId);
  room.remoteDragTargets.delete(msg.groupId);
  room.cb.onRenderNeeded();
}

function handleDragPreview(session, msg) {
  const room = session.room;
  if (msg.ownerId === room.myPlayerId || !Array.isArray(msg.positions)) return;
  let targetMap = room.remoteDragTargets.get(msg.groupId);
  if (!targetMap) {
    targetMap = new Map();
    room.remoteDragTargets.set(msg.groupId, targetMap);
  }
  for (const pos of msg.positions) {
    targetMap.set(pos.id, { x: pos.x, y: pos.y });
  }
  room.cb.onRenderNeeded();
}

/** Drops a patch that is older than a local operation still awaiting its echo. */
function isStalePatch(session, msg, targetGroupId) {
  const patchOpSeq = msg.actionResult?.opSeq;
  const isOwnPatch =
    msg.actorId === session.room.myPlayerId &&
    typeof patchOpSeq === 'number' &&
    targetGroupId != null;
  if (!isOwnPatch) return false;
  const latestSeq = session.pendingGroupOpSeq.get(targetGroupId);
  if (latestSeq && patchOpSeq < latestSeq) return true;
  if (latestSeq && patchOpSeq >= latestSeq) {
    session.pendingGroupOpSeq.delete(targetGroupId);
  }
  return false;
}

function applyPatchPieces(room, msg, targetGroupId) {
  const isRotateOrFlip = msg.actionResult?.type === 'rotate' || msg.actionResult?.type === 'flip';
  const isLockedByMe =
    targetGroupId != null && room.groupLocks.get(targetGroupId) === room.myPlayerId;
  room.engine.applyPiecePatches(msg.pieces, {
    preservePositions: isRotateOrFlip && isLockedByMe,
  });
}

function handlePiecesPatch(session, msg) {
  const room = session.room;
  if (Array.isArray(msg.locks)) room.groupLocks = new Map(msg.locks);
  const targetGroupId = msg.pieces?.[0]?.groupId;
  const skipStaleLocalPatch = isStalePatch(session, msg, targetGroupId);
  // A prank effect shows how each group turned, so keep how the pieces were before the patch.
  const before =
    msg.actionResult?.type === 'ojama_prank' && Array.isArray(msg.pieces)
      ? turnStates(msg.pieces.map((p) => room.engine.getPieceById(p.id)).filter(Boolean))
      : null;
  if (!skipStaleLocalPatch && Array.isArray(msg.pieces)) {
    applyPatchPieces(room, msg, targetGroupId);
  }
  if (msg.stats) room.engine.stats = msg.stats;
  if (Array.isArray(msg.zoneLabels)) room.engine.zoneLabels = msg.zoneLabels;
  if (msg.isFinalChunk !== false) {
    room.remoteDragTargets.clear();
    room.cb.onGuestPatchApplied(msg.pieces || [], msg.actionResult, msg.actorId, before);
  }
}

function handleOjamaFakePieces(session, msg) {
  const room = session.room;
  room.engine.syncFakePiecesFromSpecs(msg.fakePieces || []);
  if (msg.stats) room.engine.stats = msg.stats;
  room.cb.onRosterUpdate(room.roster);
  room.cb.onRenderNeeded();
}

/** Realtime (non-authoritative-state) messages handled after the session is established. */
export const REALTIME_HANDLERS = new Map([
  [MSG.ROSTER_UPDATE, handleRosterUpdate],
  [MSG.CURSOR_MOVE, handleCursorMove],
  [MSG.LOCK_GRANTED, handleLockGranted],
  [MSG.LOCK_DENIED, handleLockDenied],
  [MSG.LOCK_RELEASE, handleLockRelease],
  [MSG.DRAG_PREVIEW, handleDragPreview],
  [MSG.PIECES_PATCH, handlePiecesPatch],
  [MSG.OJAMA_VISUAL, (s, msg) => s.room.cb.onRemoteVisualOjama(msg.visualType, msg.duration)],
  [MSG.OJAMA_VISUAL_CLEAR, (s) => s.room.cb.onRemoteVisualClear()],
  [MSG.OJAMA_FAKE_PIECES, handleOjamaFakePieces],
  [MSG.OJAMA_SUPERCHAT, (s, msg) => s.room.cb.onRemoteSuperchat(msg)],
  [MSG.SUPERCHAT_STATE, (s, msg) => s.room.cb.onRemoteSuperchatState(msg.hp, msg.maxHp)],
  [MSG.SUPERCHAT_DISMISS, (s) => s.room.cb.onRemoteSuperchatDismiss()],
  // With the ojama's type (newer hosts) it is shown as its sticker, else as a plain notice.
  [
    MSG.OJAMA_NOTICE,
    (s, msg) =>
      msg.kind && s.room.cb.onOjamaNotice
        ? s.room.cb.onOjamaNotice({ kind: msg.kind, text: msg.text })
        : s.room.cb.onToast(msg.text, 'ojama'),
  ],
  [MSG.PUZZLE_COMPLETED, (s) => s.room.cb.onRemoteCompleted()],
  [MSG.OJAMA_TIMED, (s, msg) => s.room.cb.onRemoteTimedOjama(msg)],
  [MSG.PIECE_HOP, handlePieceHop],
]);
