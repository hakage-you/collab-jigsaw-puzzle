/**
 * Hosting consumption (GitHub Pages): bytes served for one visit, and signaling-server usage.
 * Runs in Node; reads files only, makes no network requests.
 * Output: measure/.latest/hosting.json
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'measure', '.latest');

/** Files referenced by index.html (<link href>, <script src>), plus the ES module graph of module scripts. */
function collectPageFiles() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const files = new Set(['index.html']);
  const moduleEntries = [];
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) files.add(normalize(m[1]));
  for (const m of html.matchAll(/<script([^>]*)src="([^"]+)"/g)) {
    const path = normalize(m[2]);
    files.add(path);
    if (/type="module"/.test(m[1])) moduleEntries.push(path);
  }
  const queue = [...moduleEntries];
  while (queue.length > 0) {
    const file = queue.shift();
    const src = readFileSync(join(ROOT, file), 'utf8');
    for (const m of src.matchAll(
      /(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s*['"](\.[^'"]+)['"]/g,
    )) {
      const dep = normalize(join(dirname(file), m[1] || m[2]));
      if (!files.has(dep)) {
        files.add(dep);
        queue.push(dep);
      }
    }
  }
  return [...files].map((f) => relative(ROOT, join(ROOT, f)).split(sep).join('/'));
}

function categoryOf(file) {
  if (file.startsWith('vendor/')) return 'vendor (PeerJS)';
  if (file.endsWith('.css')) return 'css';
  if (file.endsWith('.html')) return 'html';
  return 'js (app)';
}

function sizesOf(file) {
  const buf = readFileSync(join(ROOT, file));
  return {
    raw: statSync(join(ROOT, file)).size,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf).length,
  };
}

function signalingProfile() {
  const vendor = readFileSync(join(ROOT, 'vendor', 'peerjs.min.js'), 'utf8');
  const ping = vendor.match(
    /constructor\(e,t,n,r,i,s=(\d+e?\d*)\)\{super\(\),this\.pingInterval=s/,
  );
  const pingMs = ping ? Number(ping[1]) : null;
  return {
    server: vendor.includes('0.peerjs.com') ? '0.peerjs.com (PeerJS public cloud)' : 'custom',
    websocketsPerPlayer: 1,
    heartbeatIntervalMs: pingMs,
    heartbeatsPerPlayerHour: pingMs ? Math.round(3600000 / pingMs) : null,
    publicTurnRelayConfigured: /turn:[a-z0-9-]+\.turn\.peerjs\.com/.test(vendor),
  };
}

const files = collectPageFiles();
const perFile = files.map((file) => ({ file, category: categoryOf(file), ...sizesOf(file) }));
const byCategory = {};
for (const f of perFile) {
  const c = (byCategory[f.category] ??= { files: 0, raw: 0, gzip: 0, brotli: 0 });
  c.files += 1;
  c.raw += f.raw;
  c.gzip += f.gzip;
  c.brotli += f.brotli;
}
const total = Object.values(byCategory).reduce(
  (t, c) => ({
    files: t.files + c.files,
    raw: t.raw + c.raw,
    gzip: t.gzip + c.gzip,
    brotli: t.brotli + c.brotli,
  }),
  { files: 0, raw: 0, gzip: 0, brotli: 0 },
);

const result = {
  system: 'hosting',
  note: 'GitHub Pages serves gzip. One first visit downloads every file below; repeat visits may hit the browser cache.',
  perVisit: { total, byCategory },
  visitsPerGitHubPages100GB: Math.floor((100 * 1024 ** 3) / total.gzip),
  signaling: signalingProfile(),
  files: perFile,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'hosting.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(
  `hosting: ${total.files} files, ${(total.gzip / 1024).toFixed(1)} KiB gzip per first visit`,
);
