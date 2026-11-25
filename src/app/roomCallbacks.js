import { sound } from '../services/sound.js';
import { disconnectNotice, kickedNotice } from './connectionNotices.js';

/** Lobby, connection and roster callbacks from RoomController. */
function lobbyCallbacks(session) {
  return {
    onError: (msg) => session.emit('toast', { message: msg, kind: 'ojama' }),
    onToast: (msg, kind) => session.emit('toast', { message: msg, kind }),
    onOjamaNotice: (notice) => session.emit('ojamaNotice', notice),
    onRenderNeeded: () => session.emit('renderNeeded'),
    onRosterUpdate: () => session.emit('hudUpdate'),
    onRecruitChange: (status) => session.emit('recruitChange', status),
    onKnockRequest: (req) => {
      if (!session.knockQueue.some((item) => item.connId === req.connId)) {
        session.knockQueue.push(req);
      }
      session.emit('knockChange', [...session.knockQueue]);
    },
    onKnockResolved: (connId) => {
      const idx = session.knockQueue.findIndex((item) => item.connId === connId);
      if (idx !== -1) session.knockQueue.splice(idx, 1);
      session.emit('knockChange', [...session.knockQueue]);
    },
    onGuestStatus: (text) => session.emit('guestStatus', { text, isError: false }),
    onAuthRejected: (reason, { kicked = false } = {}) => {
      session._emitRoleChange();
      session.emit('authRejected', { reason });
      if (kicked) session.emit('notice', kickedNotice(reason));
    },
    onDisconnected: (reason) => {
      session._emitRoleChange();
      session.emit('disconnected', { reason });
      session.emit('notice', disconnectNotice(reason, session.canRejoinLastRoom()));
    },
    onGuestAdmitted: () => {
      session._emitRoleChange();
      session.emit('hudUpdate');
    },
  };
}

/** Board state callbacks: patches, locks, image and full state sync. */
function boardCallbacks(session) {
  return {
    onHostPatchApplied: (pieces, res) => {
      if (res?.type === 'snap') {
        sound.playSnap();
        session.emit('snapEffect', { pieces });
        if (res.completed) {
          session.completePuzzle();
          session.room.broadcastCompletion();
        }
      } else if (res?.type === 'merge') {
        sound.playMerge();
      }
      session.emit('hudUpdate');
      session.emit('renderNeeded');
    },
    onImageProgress: (received, total) => session.emit('imageProgress', { received, total }),
    onReceiveImage: (srcCanvas, imgName, isSample, sampleId) => {
      session._replaceSourceImage(srcCanvas, imgName, isSample, sampleId);
      session.emit('puzzleReset', { ...session.sourceImage, resetEffects: false });
    },
    onFullStateSynced: () => {
      session.highlightFilter = 'all';
      session.emit('puzzleReset', {
        ...session.sourceImage,
        resetEffects: true,
        fitView: true,
        animateDeal: session.engine.stats.placedCount === 0,
      });
      session._emitRoleChange();
      session.emit('fullStateSynced');
      session.emit('hudUpdate');
      session.emit('toast', { message: 'ホストの盤面と同期しました', kind: 'success' });
    },
    onLockDenied: (groupId) => {
      sound.playOjama();
      session.emit('lockDenied', { groupId });
      session.emit('toast', {
        message: '他のメンバーが操作中のためロックできませんでした',
        kind: 'ojama',
      });
      session.emit('renderNeeded');
    },
    onGuestPatchApplied: (pieces, res, _actorId, before) => {
      if (res?.type === 'snap') {
        sound.playSnap();
        session.emit('snapEffect', { pieces });
      } else if (res?.type === 'merge') {
        sound.playMerge();
      } else if (res?.type === 'ojama_drop') {
        // The patch carries positions only; the effect also needs each piece's board spot.
        const dropped = pieces.map((p) => session.engine.getPieceById(p.id)).filter(Boolean);
        session.emit('ojamaDropEffect', { pieces: dropped });
      } else if (res?.type === 'ojama_prank' && before) {
        const changed = pieces.map((p) => session.engine.getPieceById(p.id)).filter(Boolean);
        session.emit('ojamaPrankEffect', { pieces: changed, before });
      }
      session.emit('hudUpdate');
      session.emit('renderNeeded');
    },
    onRemoteCompleted: () => session.completePuzzle(),
  };
}

/** Sabotage (ojama) and shared superchat callbacks. */
function ojamaCallbacks(session) {
  return {
    onRemoteVisualOjama: (visualType, duration) => {
      session.emit('remoteVisualOjama', { visualType, duration });
    },
    onRemoteVisualClear: () => session.emit('remoteVisualClear'),
    onRemoteSuperchat: (msg) => session.emit('remoteSuperchat', msg),
    onRemoteSuperchatState: (hp, maxHp) => session.emit('remoteSuperchatHp', { hp, maxHp }),
    onLocalSuperchatHp: (hp, maxHp) => session.emit('remoteSuperchatHp', { hp, maxHp }),
    onRemoteSuperchatDismiss: () => session.emit('remoteSuperchatDismiss'),
    onRemoteTimedOjama: (msg) => session.emit('remoteTimedOjama', msg),
    onPieceHop: (hop) => session.emit('pieceHop', hop),
  };
}

/** Builds the callback table passed to RoomController; `session` is the GameSession. */
export function createRoomCallbacks(session) {
  return {
    ...lobbyCallbacks(session),
    ...boardCallbacks(session),
    ...ojamaCallbacks(session),
  };
}
