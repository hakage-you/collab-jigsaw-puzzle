import { describe, expect, it } from 'vitest';
import { computeImageSignature } from '../../src/services/imagePixels.js';
import {
  DEFAULT_SAMPLE_IMAGE_ID,
  SAMPLE_IMAGE_PRESETS,
  generateSampleImageCanvas,
  getSampleCaption,
  getSamplePreset,
  normalizeSampleImageId,
} from '../../src/services/sampleImage.js';

describe('sample image presets', () => {
  it('defines presets including artworks and falls back unknown ids to the default', () => {
    expect(SAMPLE_IMAGE_PRESETS).toHaveLength(8);
    expect(DEFAULT_SAMPLE_IMAGE_ID).toBe('met-seaside');
    expect(normalizeSampleImageId('met-irises')).toBe('met-irises');
    expect(normalizeSampleImageId('starry')).toBe('starry');
    expect(normalizeSampleImageId('delaunay-lowpoly')).toBe('delaunay-lowpoly');
    expect(normalizeSampleImageId('bauhaus-quadtree')).toBe('bauhaus-quadtree');
    expect(normalizeSampleImageId('hexagon-pinwheel')).toBe('hexagon-pinwheel');
    expect(normalizeSampleImageId('unknown-id')).toBe(DEFAULT_SAMPLE_IMAGE_ID);
    expect(getSamplePreset('unknown-id').id).toBe(DEFAULT_SAMPLE_IMAGE_ID);
    expect(getSampleCaption('met-seaside')?.artist).toBe('William Merritt Chase');
    expect(getSampleCaption('met-irises')?.artist).toBe('Vincent van Gogh');
  });

  it('generates distinct deterministic artwork for each procedural preset', () => {
    const procedural = SAMPLE_IMAGE_PRESETS.filter((p) => p.kind === 'procedural');
    const signatures = procedural.map((preset) =>
      computeImageSignature(generateSampleImageCanvas(undefined, undefined, preset.id)),
    );
    expect(new Set(signatures).size).toBe(procedural.length);
  });
});
