/**
 * Shared helpers for the consumption measurements (measure/*.measure.js).
 * Measurements record numbers. They never assert budgets.
 */
import { commands } from 'vitest/browser';

// Resolved by Vitest's writeFile command relative to the project root (E:\Dev\puzzle).
const LATEST_DIR = 'measure/.latest';

export function utf8Bytes(text) {
  return new TextEncoder().encode(text).length;
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

export function median(values) {
  return percentile(values, 50);
}

export function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

/** Seeded PRNG (mulberry32). Returns a function producing numbers in [0, 1). */
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Writes measure/.latest/<system>.json as { system, note, summary, details }. */
export async function writeResult(result) {
  const path = `${LATEST_DIR}/${result.system}.json`;
  await commands.writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
  return path;
}
