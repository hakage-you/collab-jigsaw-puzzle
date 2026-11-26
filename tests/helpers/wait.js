import { expect } from 'vitest';

/**
 * Polls `predicate` until it returns a truthy value or the timeout expires. A wait that succeeds
 * counts as an assertion (expect.requireAssertions in vitest.config.mjs): the wait is the check.
 */
export async function waitFor(predicate, { timeout = 3000, interval = 10, message = '' } = {}) {
  const start = performance.now();
  /* eslint-disable no-await-in-loop -- polling must be sequential */
  for (;;) {
    const value = await predicate();
    if (value) {
      expect(value, message || 'waitFor').toBeTruthy();
      return value;
    }
    if (performance.now() - start > timeout) {
      throw new Error(`waitFor timed out after ${timeout}ms${message ? `: ${message}` : ''}`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, interval);
    });
  }
  /* eslint-enable no-await-in-loop */
}

/** Resolves on the next emission of `event` from a GameSession-like emitter. */
export function nextEvent(app, event, { timeout = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`event "${event}" not emitted within ${timeout}ms`));
    }, timeout);
    const off = app.on(event, (payload) => {
      clearTimeout(timer);
      off();
      resolve(payload);
    });
  });
}
