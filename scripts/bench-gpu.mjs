import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const ARG_HANDLERS = {
  '--power': (val) => ({ power: val }),
  '--dpr': (val) => ({ dpr: Number(val) || 1 }),
  '--pieces': (val) => ({ pieces: Number(val) || 3000 }),
  '--cpu-throttle': (val) => ({ cpuThrottle: Number(val) || 1 }),
  '--modes': (val) => ({ modes: val.split(',').filter(Boolean) }),
  '--luid': (val) => ({ luid: val }),
};

function parseArgs(argv) {
  const opts = {
    power: 'low-power',
    dpr: 1,
    pieces: 3000,
    cpuThrottle: 4,
    modes: ['webgl2', 'webgpu'],
    luid: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const handler = ARG_HANDLERS[argv[i]];
    const next = argv[i + 1];
    if (handler && next) {
      Object.assign(opts, handler(next));
      i++;
    }
  }
  return opts;
}

function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
      if (rel === 'favicon.ico') {
        res.writeHead(204).end();
        return;
      }
      const fullPath = path.resolve(ROOT, rel);
      if (!fullPath.startsWith(ROOT)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const data = await fs.readFile(fullPath);
      const ext = path.extname(fullPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function launchGpuBrowser(luid) {
  const args = ['--enable-unsafe-webgpu', '--enable-dawn-features=allow_unsafe_apis'];
  if (luid) args.push(`--use-adapter-luid=${luid}`);
  try {
    return await chromium.launch({ headless: true, channel: 'chromium', args });
  } catch {
    return chromium.launch({ headless: true, args });
  }
}

function formatGpuCell(v) {
  return v == null ? '-' : `${v}ms`;
}

function printSummary(report, errors, opts) {
  console.log('=== GPU Bench Result ===');
  console.log(
    `Options: power=${opts.power}, dpr=${opts.dpr}, pieces=${opts.pieces}, cpu=x${opts.cpuThrottle}`,
  );
  console.log(`WebGL2 GPU: ${report.gpu}`);
  console.log(`WebGPU Adapter: ${report.webgpuAdapterText || 'N/A'}`);
  console.log(`WebGPU Details: ${JSON.stringify(report.webgpuAdapter)}`);
  console.log(`Console/Page Errors: ${errors.length}`);
  if (errors.length > 0) {
    for (const err of errors) console.error('  ERROR:', err);
  }
  console.log('');
  console.log('| mode | scene | frameMed | frameP95 | drop% | jsMed | jsP95 | gpuMed | gpuP95 |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of report.results) {
    console.log(
      `| ${r.mode} | ${r.scene} | ${r.frameMsMedian}ms | ${r.frameMsP95}ms | ${r.droppedPct}% | ${r.workMsMedian}ms | ${r.workMsP95}ms | ${formatGpuCell(r.gpuMsMedian)} | ${formatGpuCell(r.gpuMsP95)} |`,
    );
  }
}

async function configurePage(page, opts) {
  await page.evaluate((cfg) => {
    const doc = globalThis.document;
    doc.getElementById('pieceCount').value = String(cfg.pieces);
    doc.getElementById('dpr').value = String(cfg.dpr);
    const pp = doc.getElementById('powerPreference');
    pp.value = cfg.power;
    pp.dispatchEvent(new Event('change'));
    for (const m of ['app', 'c2d', 'webgl2', 'webgpu']) {
      const cb = doc.getElementById(`mode-${m}`);
      if (cb) cb.checked = cfg.modes.includes(m);
    }
    doc.getElementById('note').value = `bench-gpu power=${cfg.power} cpu=x${cfg.cpuThrottle}`;
  }, opts);
}

async function runBench() {
  const opts = parseArgs(process.argv.slice(2));
  const { server, port } = await startStaticServer();
  const browser = await launchGpuBrowser(opts.luid);
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    page.on('response', (res) => {
      if (res.status() >= 400) errors.push(`http ${res.status()}: ${res.url()}`);
    });
    await page.goto(`http://127.0.0.1:${port}/measure/bench/render.html`, {
      waitUntil: 'networkidle',
    });
    await configurePage(page, opts);
    if (opts.cpuThrottle > 1) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.cpuThrottle });
    }
    await page.click('#btnRun');
    await page.waitForFunction(
      () => {
        const st = globalThis.document.getElementById('status')?.textContent || '';
        const btn = globalThis.document.getElementById('btnRun');
        return Boolean(btn && !btn.disabled && (st.startsWith('完了') || st.startsWith('失敗')));
      },
      null,
      { timeout: 180_000 },
    );
    const statusText = await page.textContent('#status');
    const jsonText = await page.inputValue('#json');
    const report = JSON.parse(jsonText);
    const outDir = path.join(ROOT, 'measure', '.latest');
    await fs.mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, `bench-gpu-${opts.power}-dpr${opts.dpr}.json`);
    await fs.writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    printSummary(report, errors, opts);
    console.log(`\nStatus: ${statusText}`);
    console.log(`Saved: ${path.relative(ROOT, outFile)}`);
    if (errors.length > 0 || statusText?.startsWith('失敗')) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    server.close();
  }
}

runBench().catch((err) => {
  console.error(err);
  process.exit(1);
});
