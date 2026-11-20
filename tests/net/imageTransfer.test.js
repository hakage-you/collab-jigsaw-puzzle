import { describe, expect, it } from 'vitest';
import { NET_LIMITS } from '../../src/config/constants.js';
import {
  ImageRejectedError,
  decodeBase64ToCanvas,
  isImageSizeAllowed,
  readImageHeaderSize,
} from '../../src/net/imageTransfer.js';

// S7: the guest reads an image's size from its header before decoding, so a small file that
// declares a huge canvas is refused without allocating it. The headers below come from the
// browser's own encoders, so they match what the host really sends.

function encode(width, height, type) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').fillRect(0, 0, width, height);
  return canvas.toDataURL(type);
}

function bytesOf(dataUrl) {
  return Uint8Array.from(atob(dataUrl.split(',')[1]), (ch) => ch.charCodeAt(0));
}

function base64Of(dataUrl) {
  return dataUrl.split(',')[1];
}

describe('readImageHeaderSize', () => {
  it('reads the size of PNG, JPEG and WebP files without decoding them', () => {
    expect(readImageHeaderSize(bytesOf(encode(5000, 10, 'image/png')))).toEqual({
      width: 5000,
      height: 10,
    });
    expect(readImageHeaderSize(bytesOf(encode(300, 200, 'image/jpeg')))).toEqual({
      width: 300,
      height: 200,
    });
    expect(readImageHeaderSize(bytesOf(encode(321, 123, 'image/webp')))).toEqual({
      width: 321,
      height: 123,
    });
  });

  it('returns null for bytes that are not a known image format', () => {
    expect(readImageHeaderSize(new TextEncoder().encode('<html></html>'))).toBeNull();
    expect(readImageHeaderSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(readImageHeaderSize(new Uint8Array(0))).toBeNull();
  });
});

describe('isImageSizeAllowed', () => {
  it('accepts integer sides in [1, MAX_IMAGE_DIM] only', () => {
    expect(isImageSizeAllowed(1, NET_LIMITS.MAX_IMAGE_DIM)).toBe(true);
    expect(isImageSizeAllowed(NET_LIMITS.MAX_IMAGE_DIM + 1, 1)).toBe(false);
    expect(isImageSizeAllowed(0, 1)).toBe(false);
    expect(isImageSizeAllowed(1.5, 1)).toBe(false);
    expect(isImageSizeAllowed(undefined, 1)).toBe(false);
  });
});

describe('decodeBase64ToCanvas', () => {
  it('refuses an image wider than MAX_IMAGE_DIM before decoding it', async () => {
    const base64 = base64Of(encode(NET_LIMITS.MAX_IMAGE_DIM + 904, 10, 'image/png'));
    const error = await decodeBase64ToCanvas(base64, 'image/png').catch((err) => err);
    expect(error).toBeInstanceOf(ImageRejectedError);
    expect(error.reason).toBe('size_exceeded');
  });

  it('refuses bytes whose format is unknown', async () => {
    const error = await decodeBase64ToCanvas(btoa('not an image at all'), 'image/png').catch(
      (err) => err,
    );
    expect(error.reason).toBe('unknown_format');
  });

  it('decodes an image within the limit to a canvas of the same size', async () => {
    const canvas = await decodeBase64ToCanvas(base64Of(encode(64, 32, 'image/png')), 'image/png');
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(32);
  });
});
