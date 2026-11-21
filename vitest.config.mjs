import path from 'node:path';
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
      expect: {
        toMatchScreenshot: {
          // Effect review images live in review/ (one folder, easy to leave out of the published
          // site later), named by what they show: review/effects/<style>/... See tests/effects.
          resolveScreenshotPath: (d) =>
            d.testFileDirectory.split(path.sep).join('/').startsWith('tests/effects')
              ? path.resolve(d.root, 'review/effects', `${d.arg}${d.ext}`)
              : path.resolve(
                  d.root,
                  d.testFileDirectory,
                  d.screenshotDirectory,
                  d.testFileName,
                  `${d.arg}-${d.browserName}-${d.platform}${d.ext}`,
                ),
        },
      },
    },
  },
});
