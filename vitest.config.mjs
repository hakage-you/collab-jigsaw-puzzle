import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// All tests run in a real headless Chromium so Canvas, crypto.subtle and BroadcastChannel behave as in production.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 1280, height: 800 },
    },
  },
});
