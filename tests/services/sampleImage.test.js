import { describe, expect, it } from 'vitest';
import { computeImageSignature } from '../../src/services/imagePixels.js';
import {
  DEFAULT_SAMPLE_IMAGE_ID,
  SAMPLE_IMAGE_PRESETS,
  generateSampleImageCanvas,
  getSamplePreset,
  normalizeSampleImageId,
} from '../../src/services/sampleImage.js';

describe('sample image presets', () => {
  it('defines four distinct presets and falls back unknown ids to the default', () => {
    expect(SAMPLE_IMAGE_PRESETS).toHaveLength(4);
    expect(normalizeSampleImageId('starry')).toBe('starry');
    expect(normalizeSampleImageId('unknown-id')).toBe(DEFAULT_SAMPLE_IMAGE_ID);
    expect(getSamplePreset('unknown-id').id).toBe(DEFAULT_SAMPLE_IMAGE_ID);
  });

  it('generates distinct deterministic artwork for each preset', () => {
    const signatures = SAMPLE_IMAGE_PRESETS.map((preset) =>
      computeImageSignature(generateSampleImageCanvas(undefined, undefined, preset.id)),
    );
    expect(new Set(signatures).size).toBe(SAMPLE_IMAGE_PRESETS.length);
    expect(signatures[0]).toBe(computeImageSignature(generateSampleImageCanvas()));
  });
});
