import { describe, expect, it } from 'vitest';
import { DESK_CONFIG } from '../../src/config/constants.js';
import { DESK_TEXTURES, drawTexturedDesk } from '../../src/render/deskTextures.js';

// Every desk a player can pick has its texture, and the texture loads and is drawn.

const RECT = { width: 200, height: 120 };
const VIEW = { x: 0, y: 0, scale: 1 };

function centrePixel(ctx) {
  return [...ctx.getImageData(100, 60, 1, 1).data];
}

describe('desk textures', () => {
  it('every desk style but the grid has a texture, and nothing else does', () => {
    const textured = DESK_CONFIG.STYLES.filter((s) => s !== 'grid');
    expect(Object.keys(DESK_TEXTURES).sort()).toEqual([...textured].sort());
    expect(DESK_CONFIG.STYLES).toContain(DESK_CONFIG.DEFAULT_STYLE);
  });

  it('the grid (and an unknown style) leaves the desk to the grid drawing', () => {
    const ctx = document.createElement('canvas').getContext('2d');
    expect(drawTexturedDesk(ctx, { rect: RECT, view: VIEW, style: 'grid' })).toBe(false);
    expect(drawTexturedDesk(ctx, { rect: RECT, view: VIEW, style: undefined })).toBe(false);
  });

  it.each(Object.keys(DESK_TEXTURES))('%s loads and is drawn', async (style) => {
    const canvas = document.createElement('canvas');
    canvas.width = RECT.width;
    canvas.height = RECT.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const ready = new Promise((resolve) => {
      const drawn = drawTexturedDesk(ctx, { rect: RECT, view: VIEW, style, onReady: resolve });
      expect(drawn).toBe(true);
      // The first draw already covers the desk (with the texture's average colour).
      expect(centrePixel(ctx)[3]).toBe(255);
    });
    await ready;
    drawTexturedDesk(ctx, { rect: RECT, view: VIEW, style });
    expect(centrePixel(ctx)[3]).toBe(255);
  });
});
