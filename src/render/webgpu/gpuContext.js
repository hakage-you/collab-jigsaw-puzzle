/**
 * WebGPU device acquisition, canvas configuration, and optional timestamp-query profiler.
 * Kept isolated so RendererHost and bench tools can request adapters with clean diagnostics.
 */

const TIMESTAMP_COUNT = 2;
const TIMESTAMP_BYTES = TIMESTAMP_COUNT * 8;
const ZERO_COLOR = Object.freeze([0, 0, 0, 0]);
const colorCache = new Map();
let colorCtx = null;

/** Parses any CSS color string into normalized sRGB `[r, g, b, a]` in `0..1`, cached. */
export function parseCssColor(raw) {
  if (!raw) return ZERO_COLOR;
  const cached = colorCache.get(raw);
  if (cached) return cached;
  if (!colorCtx) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    colorCtx = c.getContext('2d', { willReadFrequently: true });
  }
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = '#000000';
  colorCtx.fillStyle = raw;
  colorCtx.fillRect(0, 0, 1, 1);
  const d = colorCtx.getImageData(0, 0, 1, 1).data;
  const rgba = Object.freeze([d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255]);
  colorCache.set(raw, rgba);
  return rgba;
}

function checkFallbackAdapter(adapter) {
  return Boolean(adapter?.info?.isFallbackAdapter ?? adapter?.isFallbackAdapter);
}

async function acquireDevice(adapter, enableTimestampQuery) {
  const canTimestamp = Boolean(enableTimestampQuery && adapter.features?.has('timestamp-query'));
  if (canTimestamp) {
    try {
      const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] });
      return { device, hasTimestampQuery: true };
    } catch {
      // Fall back to standard device without timestamp-query if feature request fails.
    }
  }
  const device = await adapter.requestDevice();
  return { device, hasTimestampQuery: false };
}

/**
 * Requests a WebGPU adapter and device.
 * @param {object} [options]
 * @param {'low-power'|'high-performance'} [options.powerPreference]
 * @param {boolean} [options.enableTimestampQuery=true]
 * @param {boolean} [options.allowFallbackAdapter=true]
 */
export async function requestWebGPUDevice({
  powerPreference,
  enableTimestampQuery = true,
  allowFallbackAdapter = true,
} = {}) {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new Error('WebGPU is not supported in this browser');
  }
  const adapterOpts = powerPreference ? { powerPreference } : undefined;
  const adapter = await navigator.gpu.requestAdapter(adapterOpts);
  if (!adapter) {
    throw new Error('WebGPU adapter is not available');
  }
  const isFallbackAdapter = checkFallbackAdapter(adapter);
  if (!allowFallbackAdapter && isFallbackAdapter) {
    throw new Error('Only a software fallback WebGPU adapter is available');
  }
  const { device, hasTimestampQuery } = await acquireDevice(adapter, enableTimestampQuery);
  return { adapter, device, hasTimestampQuery, isFallbackAdapter };
}

/**
 * Acquires and configures a WebGPU canvas context with premultiplied alpha.
 */
export function configureWebGPUCanvas(canvas, device) {
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('WebGPU canvas context is not available');
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });
  return { context, format };
}

/**
 * Non-blocking GPU render-pass duration profiler backed by WebGPU timestamp-query.
 * Returns null when the device does not have the `timestamp-query` feature enabled.
 */
export function createTimestampProfiler(device) {
  if (!device.features?.has('timestamp-query') || typeof GPUQuerySet === 'undefined') {
    return null;
  }
  const querySet = device.createQuerySet({ type: 'timestamp', count: TIMESTAMP_COUNT });
  const resolveBuf = device.createBuffer({
    size: TIMESTAMP_BYTES,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const readbackBuf = device.createBuffer({
    size: TIMESTAMP_BYTES,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  let pending = false;
  let needsRead = false;
  let disposed = false;
  let lastMs = null;

  return {
    get lastMs() {
      return lastMs;
    },
    get timestampWrites() {
      return { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
    },
    get beginPassWrites() {
      return { querySet, beginningOfPassWriteIndex: 0 };
    },
    get endPassWrites() {
      return { querySet, endOfPassWriteIndex: 1 };
    },
    resolve(encoder) {
      if (disposed || pending) return;
      encoder.resolveQuerySet(querySet, 0, TIMESTAMP_COUNT, resolveBuf, 0);
      encoder.copyBufferToBuffer(resolveBuf, 0, readbackBuf, 0, TIMESTAMP_BYTES);
      needsRead = true;
    },
    kickReadback() {
      if (disposed || pending || !needsRead) return;
      pending = true;
      needsRead = false;
      readbackBuf
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          if (!disposed) {
            const times = new BigUint64Array(readbackBuf.getMappedRange());
            const deltaNs = Number(times[1] - times[0]);
            if (Number.isFinite(deltaNs) && deltaNs >= 0) {
              lastMs = Math.round((deltaNs / 1e6) * 1000) / 1000;
            }
            readbackBuf.unmap();
          }
          pending = false;
        })
        .catch(() => {
          pending = false;
        });
    },
    dispose() {
      disposed = true;
      querySet.destroy?.();
      resolveBuf.destroy?.();
      readbackBuf.destroy?.();
    },
  };
}
