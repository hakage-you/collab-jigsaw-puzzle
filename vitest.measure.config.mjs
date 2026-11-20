import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// Consumption measurements (npm run measure). Not part of npm test: they record numbers, they do not pass/fail on budgets.
export default defineConfig({
  test: {
    include: ['measure/**/*.measure.js'],
    testTimeout: 120000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 1280, height: 800 },
    },
  },
});
