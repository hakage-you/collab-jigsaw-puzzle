import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// Tests named *.node.test.js run in Node: pure logic only (src/core uses the canvas-free fakes in
// tests/helpers/coreEngine.js).
const NODE_TESTS = 'tests/**/*.node.test.js';

// A test without a single assertion fails (tests/helpers/wait.js counts a successful wait as one).
const EXPECT = { requireAssertions: true };

export default defineConfig({
  test: {
    // npm run test:coverage only (not npm test): which src lines the tests run at all.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: 'reports/coverage',
    },
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: [NODE_TESTS],
          expect: EXPECT,
        },
      },
      {
        // Every other test runs in a real headless Chromium so Canvas, crypto.subtle and
        // BroadcastChannel behave as in production.
        test: {
          name: 'browser',
          include: ['tests/**/*.test.js'],
          exclude: [...configDefaults.exclude, NODE_TESTS],
          expect: EXPECT,
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
      },
    ],
  },
});
