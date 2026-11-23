import { normalizeCutComplexity } from '../core/jigsawPath.js';
import { validateSaveData } from '../core/saveValidation.js';
import {
  generateSampleImageCanvas,
  getSamplePreset,
  normalizeSampleImageId,
} from '../services/sampleImage.js';

export function resolveRestoredImage(saveData, customCanvas, useSample, fallbackName) {
  const sampleId = useSample ? normalizeSampleImageId(saveData.puzzle?.sampleImageId) : null;
  const canvas = useSample
    ? generateSampleImageCanvas(undefined, undefined, sampleId)
    : customCanvas;
  const name = useSample ? getSamplePreset(sampleId).name : fallbackName;
  return { canvas, name, sampleId };
}

export function validateSaveOrToast(session, rawSaveData) {
  const checked = validateSaveData(rawSaveData);
  if (!checked.ok) {
    session.emit('toast', { message: checked.error, kind: 'ojama' });
    return null;
  }
  return checked.data;
}

export function buildRestoredSettingsPatch(saveData, currentOjama) {
  if (!saveData.settings) return null;
  return {
    ...saveData.settings,
    cutComplexity: normalizeCutComplexity(
      saveData.puzzle?.cutComplexity || saveData.settings.cutComplexity,
    ),
    ojama: {
      ...currentOjama,
      ...(saveData.settings.ojama || {}),
    },
  };
}
