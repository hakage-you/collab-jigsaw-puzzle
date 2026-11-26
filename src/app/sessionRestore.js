import { validateSaveData } from '../core/saveValidation.js';
import {
  generateSampleImageCanvas,
  getSamplePreset,
  normalizeSampleImageId,
} from '../services/sampleImage.js';

function resolveRestoredImage(saveData, customCanvas, useSample, fallbackName) {
  const sampleId = useSample ? normalizeSampleImageId(saveData.puzzle?.sampleImageId) : null;
  const canvas = useSample
    ? generateSampleImageCanvas(undefined, undefined, sampleId)
    : customCanvas;
  const name = useSample ? getSamplePreset(sampleId).name : fallbackName;
  return { canvas, name, sampleId };
}

function validateSaveOrToast(session, rawSaveData) {
  const checked = validateSaveData(rawSaveData);
  if (!checked.ok) {
    session.emit('toast', { message: checked.error, kind: 'ojama' });
    return null;
  }
  return checked.data;
}

function buildRestoredSettingsPatch(saveData, currentOjama) {
  if (!saveData.settings) return null;
  return {
    ...saveData.settings,
    // Validation has already filled in and normalized the cut in the puzzle header.
    cutComplexity: saveData.puzzle.cutComplexity,
    ojama: {
      ...currentOjama,
      ...(saveData.settings.ojama || {}),
    },
  };
}

/** GameSession.restoreFromSaveData: the board, its image and the settings from a save file. */
export function restoreSessionFromSave(session, rawSaveData, customCanvas, useSample, imgName) {
  const saveData = validateSaveOrToast(session, rawSaveData);
  if (!saveData) return;
  const {
    canvas: srcCanvas,
    name: baseName,
    sampleId,
  } = resolveRestoredImage(saveData, customCanvas, useSample, imgName || 'ローカル画像（復元）');
  if (!srcCanvas) return;
  const resolvedName = useSample ? `${baseName}（復元）` : baseName;
  const settingsPatch = buildRestoredSettingsPatch(saveData, session.settings.ojama);
  if (settingsPatch) session.patchSettings(settingsPatch);

  session.engine.restoreFromSave(saveData, srcCanvas, useSample);
  session.room.applySavedContributions(saveData.contributions, session.engine.stats.placedCount);
  session._replaceSourceImage(srcCanvas, resolvedName, useSample, sampleId);
  session.highlightFilter = 'all';
  session.emit('puzzleReset', { ...session.sourceImage, resetEffects: true, fitView: true });
  session.emit('hudUpdate');
  if (session.room.role === 'host') session.room.broadcastFullState();
  session.emit('toast', { message: 'セーブデータからパズルを復元しました', kind: 'success' });
}

/** GameSession.resumeHostFromBackup: reopens the room with the board of an automatic backup. */
export async function resumeHostSessionFromBackup(session, rawBackup, imgCanvas, isSample, room) {
  const { displayName, passcode, requireApproval, capacity } = room;
  const backup = validateSaveOrToast(session, rawBackup);
  if (!backup) return;
  session.emit('stopYoutubePolling', { reason: null });
  const nameFallback = imgCanvas?._fileName || backup.puzzle?.imageName || '復元画像';
  const restored = resolveRestoredImage(backup, imgCanvas, isSample, nameFallback);
  session.engine.restoreFromSave(backup, restored.canvas, isSample);
  session.room.applySavedContributions(backup.contributions, session.engine.stats.placedCount);
  session.patchSettings({ ...(backup.settings || {}), playerName: displayName });
  session._replaceSourceImage(restored.canvas, restored.name, isSample, restored.sampleId);
  session.highlightFilter = 'all';
  session.emit('puzzleReset', { ...session.sourceImage, resetEffects: true, fitView: true });
  await session.room.startHostRoom({ passcode, requireApproval, capacity });
  session._resetLobbyState();
  session.emit('toast', { message: '自動バックアップから部屋を再開しました', kind: 'success' });
}
