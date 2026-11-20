/**
 * Prints the latest consumption measurements and appends them to measure/history.jsonl.
 * Each system (p2p, youtube, hosting, client) has its own unit and its own budget; they are never summed.
 */
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LATEST = join(process.cwd(), 'measure', '.latest');
const HISTORY = join(process.cwd(), 'measure', 'history.jsonl');
const SYSTEMS = ['p2p', 'youtube', 'hosting', 'client'];

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

function load(system) {
  const file = join(LATEST, `${system}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function summarize(system, r) {
  if (!r) return [[system, '(not measured)']];
  if (system === 'hosting') {
    return [
      [
        'hosting',
        `first visit: ${kib(r.perVisit.total.gzip)} gzip, ${r.perVisit.total.files} files`,
      ],
      [
        'hosting',
        `visits per 100 GB (Pages soft limit): ${r.visitsPerGitHubPages100GB.toLocaleString()}`,
      ],
      [
        'hosting',
        `signaling: ${r.signaling.websocketsPerPlayer} ws/player, heartbeat ${r.signaling.heartbeatIntervalMs} ms, public TURN: ${r.signaling.publicTurnRelayConfigured}`,
      ],
    ];
  }
  return (r.summary ?? []).map((line) => [system, line]);
}

const results = Object.fromEntries(SYSTEMS.map((s) => [s, load(s)]));
console.log('\n=== Consumption measurements ===');
for (const s of SYSTEMS) {
  for (const [sys, line] of summarize(s, results[s])) console.log(`${sys.padEnd(8)} ${line}`);
}

let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  // not a git checkout
}
const entry = { date: new Date().toISOString(), commit, ...results };
if (entry.hosting) delete entry.hosting.files; // per-file detail stays in .latest only
appendFileSync(HISTORY, `${JSON.stringify(entry)}\n`);
console.log(`\nappended to ${HISTORY}`);
