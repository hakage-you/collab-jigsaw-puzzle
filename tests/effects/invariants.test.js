import { describe, expect, it } from 'vitest';
import { checkFlashRate } from './invariants.js';

// The flash check guards every viewer of a stream (they cannot change settings), so make sure it
// really catches flashing: no effect today flashes, so it is tried on made-up frames.

function frame(gray, w = 20, h = 20) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}

/** `seconds` of frames at 60 fps, switching between dark and light `perSec` times a second. */
function blinking(perSec, seconds = 2) {
  const fps = 60;
  return Array.from({ length: fps * seconds }, (_, f) =>
    frame(Math.floor((f * perSec) / fps) % 2 === 0 ? 20 : 235),
  );
}

describe('checkFlashRate', () => {
  it('fails a screen that blinks 5 times a second', () => {
    expect(checkFlashRate('blink', blinking(5), 60)).not.toEqual([]);
  });

  it('passes a screen that changes 3 times a second or less', () => {
    expect(checkFlashRate('slow', blinking(3), 60)).toEqual([]);
    expect(checkFlashRate('still', blinking(0), 60)).toEqual([]);
  });
});
