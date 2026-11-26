// Mutation testing of src/core (npm run test:mutation). Not part of npm test or the pre-commit hook.
// Only the Node tests (*.node.test.js) run: the Stryker Vitest runner can't drive browser mode, so
// kills by browser-only tests (tests/sync etc.) don't count.
// Plan: _plan/20261125_1835_core_mutation_test_plan.md
export default {
  mutate: ['src/core/**/*.js'],
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutation.config.mjs' },
  reporters: ['html', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/core.html' },
  // Later runs re-test only mutants whose code or covering tests changed.
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  // Record only for now; break is decided after the first baseline.
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: '.stryker-tmp',
  // Keep the sandbox copy small: the Node tests need only src, tests and the configs.
  ignorePatterns: [
    '_plan',
    '_walkthrough',
    '.claude',
    '.vitest',
    'assets',
    'docs',
    'measure',
    'review',
    'styles',
    'vendor',
  ],
};
