import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER_CONFIG } from '../../src/config/constants.js';
import { MSG } from '../../src/net/protocol.js';
import { decodeBase64ToCanvas, encodeCanvasToWebP } from '../../src/net/imageTransfer.js';
import { loadSampleImageCanvas } from '../../src/services/sampleImage.js';
import { boardState, createFakeImage } from '../helpers/coreEngine.js';
import { memoryNetwork as net } from '../helpers/memoryTransport.js';
import { closeNodeRooms, installNodeRoomGlobals, joinNode, openHost } from '../helpers/nodeRoom.js';

// How a guest gets the picture: the host's own image sent in chunks, or a sample the guest makes
// (or loads) itself. Encoding, decoding and drawing samples need a canvas, so those three
// functions are replaced; everything around them is the real host and guest.

vi.mock('../../src/net/transport.js', async () => {
  const { memoryNetwork } = await import('../helpers/memoryTransport.js');
  return {
    createTransport: () => memoryNetwork.createTransport(),
    getTransportModeFromUrl: () => 'memory',
  };
});

const CHUNK = MULTIPLAYER_CONFIG.IMAGE_CHUNK_BYTES;
const IMAGE_BASE64 = 'QUJD'.repeat(Math.ceil((CHUNK * 2.5) / 4));

vi.mock('../../src/net/imageTransfer.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    encodeCanvasToWebP: vi.fn(() => ({
      base64: IMAGE_BASE64,
      byteLength: 1000,
      mimeType: 'image/webp',
      width: 320,
      height: 240,
    })),
    decodeBase64ToCanvas: vi.fn(() => Promise.resolve({ width: 320, height: 240 })),
  };
});

vi.mock('../../src/services/sampleImage.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    generateSampleImageCanvas: vi.fn(() => ({ width: 1, height: 1 })),
    loadSampleImageCanvas: vi.fn(() => Promise.resolve({ width: 2, height: 2 })),
  };
});

const IMAGE_REJECTED = 'ホストから受信した画像が不正なため切断しました';

beforeEach(() => {
  vi.useFakeTimers();
  installNodeRoomGlobals();
  vi.clearAllMocks();
});

afterEach(() => {
  closeNodeRooms();
  vi.useRealTimers();
});

/** A guest whose own image differs from the host's, so the host must send it. */
function guestNeedingImage(host, options = {}) {
  return joinNode(host.room.roomId, { flush: false, ...options });
}

describe('the host’s own image', () => {
  it('is sent in chunks the guest puts together, then the board follows', async () => {
    const host = await openHost();
    host.engine.moveGroup(host.engine.pieces[0].groupId, 400, 400);
    const guest = await guestNeedingImage(host);
    guest.engine.imageHash = 'another-image';
    await net.flush();

    expect(encodeCanvasToWebP).toHaveBeenCalledTimes(1);
    const start = net.sentOf(MSG.IMAGE_START)[0].msg;
    expect(start).toEqual({
      type: MSG.IMAGE_START,
      totalChunks: 3,
      byteLength: 1000,
      mimeType: 'image/webp',
      width: 320,
      height: 240,
    });
    const chunks = net.sentOf(MSG.IMAGE_CHUNK).map((e) => e.msg);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(chunks.map((c) => c.data).join('')).toBe(IMAGE_BASE64);
    expect(decodeBase64ToCanvas).toHaveBeenCalledWith(IMAGE_BASE64, 'image/webp');

    expect(guest.callsOf('onImageProgress')).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(guest.callsOf('onReceiveImage')).toEqual([
      [{ width: 320, height: 240 }, 'ホスト共有画像', false],
    ]);
    const acks = net.sentOf(MSG.IMAGE_ACK).map((e) => e.msg.needImage);
    expect(acks).toEqual([true, false]);
    expect(boardState(guest.engine)).toEqual(boardState(host.engine));
  });

  it('counts a repeated chunk once', async () => {
    const host = await openHost();
    const guest = await guestNeedingImage(host);
    guest.engine.imageHash = 'another-image';
    const gs = guest.room.guestSession;
    // Stop the host's chunks; feed them by hand.
    host.room.hostSession._sendImageToGuest = () => {};
    await net.flush();
    const data = IMAGE_BASE64.slice(0, 8);
    await gs.onMessage({
      type: MSG.IMAGE_START,
      totalChunks: 2,
      mimeType: 'image/webp',
      width: 9,
      height: 9,
    });
    await gs.onMessage({ type: MSG.IMAGE_CHUNK, index: 0, data });
    await gs.onMessage({ type: MSG.IMAGE_CHUNK, index: 0, data });
    expect(gs.incomingImage.received).toBe(1);
    expect(decodeBase64ToCanvas).not.toHaveBeenCalled();
    await gs.onMessage({ type: MSG.IMAGE_CHUNK, index: 1, data: 'QUJD' });
    expect(decodeBase64ToCanvas).toHaveBeenCalledWith(`${data}QUJD`, 'image/webp');
    expect(gs.incomingImage).toBeNull();
  });

  it('a picture that does not decode ends the join with the reason logged', async () => {
    const host = await openHost();
    const guest = await guestNeedingImage(host);
    guest.engine.imageHash = 'another-image';
    decodeBase64ToCanvas.mockRejectedValueOnce(
      Object.assign(new Error('x'), { reason: 'too_big' }),
    );
    await net.flush();
    expect(guest.room.role).toBe('solo');
    expect(guest.callsOf('onDisconnected')).toEqual([[IMAGE_REJECTED]]);
    expect(guest.callsOf('onReceiveImage')).toEqual([]);
  });

  it('a decoding error without a reason is reported as decode_failed', async () => {
    const { getDiagnosticsState } = await import('../../src/services/diagnostics.js');
    const host = await openHost();
    const guest = await guestNeedingImage(host);
    guest.engine.imageHash = 'another-image';
    decodeBase64ToCanvas.mockRejectedValueOnce(new Error('broken'));
    await net.flush();
    expect(getDiagnosticsState().entries.at(-1)).toMatchObject({
      message: 'host_transfer_rejected',
      meta: { type: MSG.IMAGE_CHUNK, reason: 'decode_failed' },
    });
  });
});

describe('a sample image', () => {
  it('a drawn sample is made by the guest itself; nothing is sent', async () => {
    const host = await openHost({ isSampleImage: true, sampleImageId: 'delaunay-lowpoly' });
    const guest = await joinNode(host.room.roomId);
    expect(guest.callsOf('onReceiveImage')).toEqual([
      [{ width: 1, height: 1 }, expect.any(String), true, 'delaunay-lowpoly'],
    ]);
    expect(net.sentOf(MSG.IMAGE_START)).toEqual([]);
    expect(net.sentOf(MSG.IMAGE_ACK).map((e) => e.msg)).toEqual([
      { type: MSG.IMAGE_ACK, needImage: false },
    ]);
    expect(guest.callsOf('onFullStateSynced')).toHaveLength(1);
  });

  it('an artwork sample is loaded first, then the guest asks for the board', async () => {
    const host = await openHost({ isSampleImage: true, sampleImageId: 'met-seaside' });
    const guest = await joinNode(host.room.roomId);
    expect(loadSampleImageCanvas).toHaveBeenCalledWith('met-seaside');
    expect(guest.callsOf('onReceiveImage')).toEqual([
      [{ width: 2, height: 2 }, expect.any(String), true, 'met-seaside'],
    ]);
    expect(guest.callsOf('onFullStateSynced')).toHaveLength(1);
  });

  it('an artwork that finishes loading after the guest left is dropped', async () => {
    let finish;
    loadSampleImageCanvas.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const host = await openHost({ isSampleImage: true, sampleImageId: 'met-seaside' });
    const guest = await joinNode(host.room.roomId);
    guest.room.close();
    finish(createFakeImage());
    await net.flush();
    expect(guest.callsOf('onReceiveImage')).toEqual([]);
    expect(net.sentOf(MSG.IMAGE_ACK)).toEqual([]);
  });

  it('switching to another sample puzzle mid-room reloads the guest image and board geometry', async () => {
    const seasideImg = createFakeImage(2048, 1230);
    const irisesImg = createFakeImage(2018, 1600);
    loadSampleImageCanvas.mockImplementation((id) =>
      Promise.resolve(id === 'met-irises' ? irisesImg : seasideImg),
    );

    const host = await openHost({
      isSampleImage: true,
      sampleImageId: 'met-seaside',
      puzzle: { sourceCanvas: seasideImg, isSampleImage: true, sampleImageId: 'met-seaside' },
    });
    const hostSource = {
      sourceCanvas: seasideImg,
      isSampleImage: true,
      sampleImageId: 'met-seaside',
    };
    host.room.getSourceState = () => hostSource;

    const guest = await joinNode(host.room.roomId, { flush: false });
    const guestSource = {
      sourceCanvas: createFakeImage(),
      isSampleImage: false,
      sampleImageId: null,
    };
    guest.room.getSourceState = () => guestSource;
    const baseCb = guest.room.cb;
    guest.room.cb = new Proxy(baseCb, {
      get(target, prop) {
        if (prop === 'onReceiveImage') {
          return (canvas, name, isSample, sampleId) => {
            guestSource.sourceCanvas = canvas;
            guestSource.isSampleImage = isSample;
            guestSource.sampleImageId = sampleId ?? null;
            target.onReceiveImage(canvas, name, isSample, sampleId);
          };
        }
        return target[prop];
      },
    });
    await net.flush();

    expect(guest.engine.sourceCanvas).toBe(seasideImg);
    expect(guest.engine.sampleImageId).toBe('met-seaside');

    // Host switches to another sample artwork mid-room.
    hostSource.sourceCanvas = irisesImg;
    hostSource.sampleImageId = 'met-irises';
    host.engine.initPuzzle({
      sourceCanvas: irisesImg,
      isSampleImage: true,
      sampleImageId: 'met-irises',
      cols: 4,
      rows: 3,
      seed: 99,
      cutComplexity: 'standard',
      allowRotation: false,
      allowFlip: false,
    });
    host.room.broadcastFullState();
    await net.flush();

    expect(loadSampleImageCanvas).toHaveBeenLastCalledWith('met-irises');
    expect(guest.engine.sourceCanvas).toBe(irisesImg);
    expect(guest.engine.sampleImageId).toBe('met-irises');
    expect(guest.engine.boardW).toBeCloseTo(host.engine.boardW, 5);
    expect(guest.engine.boardH).toBeCloseTo(host.engine.boardH, 5);
    expect(boardState(guest.engine)).toEqual(boardState(host.engine));
  });

  it('drops a slow sample artwork load superseded by a newer puzzle switch', async () => {
    const resolves = [];
    loadSampleImageCanvas.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolves.push(resolve);
        }),
    );

    const host = await openHost({ isSampleImage: true, sampleImageId: 'met-seaside' });
    const hostSource = {
      sourceCanvas: createFakeImage(),
      isSampleImage: true,
      sampleImageId: 'met-seaside',
    };
    host.room.getSourceState = () => hostSource;

    const guest = await joinNode(host.room.roomId);
    expect(resolves).toHaveLength(1);

    // Host switches again before the first artwork finishes loading on the guest.
    hostSource.sampleImageId = 'met-irises';
    host.room.broadcastFullState();
    await net.flush();
    expect(resolves).toHaveLength(2);

    const staleImg = createFakeImage(100, 100);
    const latestImg = createFakeImage(200, 200);
    resolves[0](staleImg);
    await net.flush();
    expect(guest.callsOf('onReceiveImage')).toEqual([]);

    resolves[1](latestImg);
    await net.flush();
    expect(guest.callsOf('onReceiveImage')).toEqual([
      [latestImg, expect.any(String), true, 'met-irises'],
    ]);
  });
});
