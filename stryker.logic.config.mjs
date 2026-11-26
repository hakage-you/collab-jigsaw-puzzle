import core from './stryker.config.mjs';

// Mutation testing of the browser-independent logic outside src/core
// (npm run test:mutation:logic; layers A and B of _plan/20261125_1903_browser_test_quality_plan.md).
// Same Node tests and settings as stryker.config.mjs, with its own report, incremental file and
// thresholds so that core's threshold keeps its meaning.
export default {
  ...core,
  mutate: [
    'src/app/ojamaNotice.js',
    'src/app/ojamaRules.js',
    'src/app/timedOjama.js',
    'src/net/guestMessageGuard.js',
    'src/net/heartbeat.js',
    'src/net/hostAdmission.js',
    'src/net/hostBoardOps.js',
    'src/net/hostMessageGuard.js',
    'src/net/hostSyncHelper.js',
    'src/net/messageFieldChecks.js',
    'src/net/recruitment.js',
    'src/net/runawayHost.js',
    'src/render/effects/pieceMotion.js',
    'src/services/diagnostics.js',
    'src/services/youtubeLiveClient.js',
    'src/ui/touchGestures.js',
  ],
  htmlReporter: { fileName: 'reports/mutation/logic.html' },
  incrementalFile: 'reports/stryker-incremental-logic.json',
  // Same thresholds as core. The score was 91.2% on 2026-11-26.
  thresholds: { high: 90, low: 80, break: 85 },
};
