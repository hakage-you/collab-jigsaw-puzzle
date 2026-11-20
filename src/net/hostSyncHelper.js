import { MULTIPLAYER_CONFIG, PUZZLE_CONFIG } from '../config/constants.js';
import { MSG } from './protocol.js';
import { encodeCanvasToWebP, chunkBase64 } from './imageTransfer.js';

export function serializePieces(pieces) {
  return pieces.map((p) => ({
    id: p.id,
    x: Math.round(p.x * 100) / 100,
    y: Math.round(p.y * 100) / 100,
    rotation: p.rotation,
    isFlipped: p.isFlipped,
    groupId: p.groupId,
    isLocked: p.isLocked,
    zOrder: p.zOrder,
  }));
}

/**
 * Builds the room rules payload sent to guests.
 * @public
 */
export function buildRoomRules(room) {
  const settings = room.getSettings();
  const eng = room.engine;
  return {
    cols: eng.cols,
    rows: eng.rows,
    cutComplexity: eng.cutComplexity,
    allowRotation: settings.allowRotation,
    allowFlip: settings.allowFlip,
    showStats: settings.showStats,
  };
}

export function sendWelcomeToGuest(room, guest, roster) {
  const { isSampleImage } = room.getSourceState();
  const eng = room.engine;
  room.transport.sendTo(guest.connId, {
    type: MSG.WELCOME,
    playerId: guest.id,
    reconnectToken: guest.reconnectToken,
    color: guest.color,
    isSampleImage,
    imageHash: eng.imageHash,
    imageWidth: eng.sourceCanvas?.width || PUZZLE_CONFIG.SAMPLE_IMAGE_WIDTH,
    imageHeight: eng.sourceCanvas?.height || PUZZLE_CONFIG.SAMPLE_IMAGE_HEIGHT,
    roomRules: buildRoomRules(room),
    roster,
  });
}

export function sendImageToGuest(room, connId) {
  const { sourceCanvas } = room.getSourceState();
  if (!sourceCanvas) return;
  const encoded = encodeCanvasToWebP(sourceCanvas);
  const chunks = chunkBase64(encoded.base64, MULTIPLAYER_CONFIG.IMAGE_CHUNK_BYTES);

  room.transport.sendTo(connId, {
    type: MSG.IMAGE_START,
    totalChunks: chunks.length,
    byteLength: encoded.byteLength,
    mimeType: encoded.mimeType,
    width: encoded.width,
    height: encoded.height,
  });
  chunks.forEach((chunk, index) => {
    room.transport.sendTo(connId, { type: MSG.IMAGE_CHUNK, index, data: chunk });
  });
}

export function sendFullStateToGuest(room, connId, roster) {
  const settings = room.getSettings();
  const eng = room.engine;
  const saveData = eng.exportSaveData(settings);
  const chunkSize = MULTIPLAYER_CONFIG.STATE_CHUNK_PIECES || 200;
  const allPieces = saveData.pieces || [];

  if (allPieces.length <= chunkSize) {
    room.transport.sendTo(connId, {
      type: MSG.FULL_STATE,
      saveData,
      zoneLabels: eng.zoneLabels,
      fakePieces: eng.serializeFakePieces(),
      locks: Array.from(room.groupLocks.entries()),
      roster,
      roomRules: buildRoomRules(room),
    });
    return;
  }

  const totalPieceChunks = Math.ceil(allPieces.length / chunkSize);
  room.transport.sendTo(connId, {
    type: MSG.FULL_STATE,
    saveData: { ...saveData, pieces: [] },
    totalPieceChunks,
    zoneLabels: eng.zoneLabels,
    fakePieces: eng.serializeFakePieces(),
    locks: Array.from(room.groupLocks.entries()),
    roster,
    roomRules: buildRoomRules(room),
  });

  for (let i = 0; i < totalPieceChunks; i++) {
    room.transport.sendTo(connId, {
      type: MSG.FULL_STATE_CHUNK,
      chunkIndex: i,
      totalChunks: totalPieceChunks,
      pieces: allPieces.slice(i * chunkSize, (i + 1) * chunkSize),
    });
  }
}

export function broadcastPiecesPatch(room, pieces, actionResult, actorId) {
  const serialized = serializePieces(pieces);
  const chunkSize = MULTIPLAYER_CONFIG.STATE_CHUNK_PIECES || 200;

  if (serialized.length <= chunkSize) {
    room.transport?.broadcast({
      type: MSG.PIECES_PATCH,
      pieces: serialized,
      stats: structuredClone(room.engine.stats),
      actionResult,
      actorId,
      locks: Array.from(room.groupLocks.entries()),
      zoneLabels: room.engine.zoneLabels,
      isFinalChunk: true,
    });
    return;
  }

  const totalChunks = Math.ceil(serialized.length / chunkSize);
  const locks = Array.from(room.groupLocks.entries());
  const stats = structuredClone(room.engine.stats);
  for (let i = 0; i < totalChunks; i++) {
    const isFinalChunk = i === totalChunks - 1;
    room.transport?.broadcast({
      type: MSG.PIECES_PATCH,
      pieces: serialized.slice(i * chunkSize, (i + 1) * chunkSize),
      stats: isFinalChunk ? stats : undefined,
      actionResult: isFinalChunk ? actionResult : undefined,
      actorId,
      locks: isFinalChunk ? locks : undefined,
      zoneLabels: isFinalChunk ? room.engine.zoneLabels : undefined,
      isFinalChunk,
    });
  }
}
