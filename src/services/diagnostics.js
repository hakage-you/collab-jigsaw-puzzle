/**
 * In-memory local diagnostic ring buffer (max 200 entries, zero storage, zero network).
 * Automatically captures uncaught errors, unhandled rejections, console errors/warns,
 * and sanitizes all secrets (API keys, room IDs, tokens, passcodes, data URLs).
 */

const MAX_ENTRIES = 200;
const SENSITIVE_KEY_RE = /^(?:apiKey|passcode|password|reconnectToken|token|secret)$/i;
const GOOGLE_KEY_RE = /AIza[0-9A-Za-z_-]{20,}/g;
const QUERY_SECRET_RE = /([?&](?:key|room|token|passcode|password|reconnectToken|secret)=)[^&#\s"'`]+/gi;
const KV_SECRET_RE = /(?<![a-zA-Z0-9_])((?:apiKey|passcode|password|reconnectToken|secret|room)=)([^\s&#"'`]+)/gi;
const DATA_IMAGE_RE = /data:image\/[^\s"'`]+/gi;

const entries = [];
const listeners = new Set();
let errorCount = 0;
let initialized = false;

export function sanitizeText(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  text = text.replace(DATA_IMAGE_RE, '[REDACTED]');
  text = text.replace(GOOGLE_KEY_RE, '[REDACTED]');
  text = text.replace(QUERY_SECRET_RE, '$1[REDACTED]');
  text = text.replace(KV_SECRET_RE, '$1[REDACTED]');
  if (text.length > 1000) {
    text = `${text.slice(0, 1000)}…[truncated]`;
  }
  return text;
}

export function sanitizeMeta(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string') return sanitizeText(value);
  if (t === 'number' || t === 'boolean') return value;
  if (t !== 'object') return sanitizeText(value);

  if (value instanceof Error) {
    return {
      name: sanitizeText(value.name),
      message: sanitizeText(value.message),
      stack: sanitizeText(value.stack),
    };
  }

  if (seen.has(value) || depth >= 4) return '[Object]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMeta(item, depth + 1, seen));
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = sanitizeMeta(v, depth + 1, seen);
    }
  }
  return out;
}

function getDiagnosticsSummary() {
  return {
    entries: [...entries],
    totalCount: entries.length,
    errorCount,
  };
}

function notifyListeners(isUnexpectedError = false) {
  const state = getDiagnosticsSummary();
  for (const fn of listeners) {
    fn({ state, isUnexpectedError });
  }
}

export function recordDiagnostic(category, message, meta = null, level = 'info') {
  const entry = {
    time: new Date().toISOString(),
    level: level === 'error' || level === 'warn' ? level : 'info',
    category: sanitizeText(category || 'app'),
    message: sanitizeText(message),
    meta: meta !== null && meta !== undefined ? sanitizeMeta(meta) : null,
  };
  if (entries.length >= MAX_ENTRIES) {
    entries.shift();
  }
  entries.push(entry);
  if (entry.level === 'error' && (category === 'error' || category === 'unhandledrejection')) {
    errorCount += 1;
  }
  notifyListeners(category === 'error' || category === 'unhandledrejection');
  return entry;
}

export function getDiagnosticsState() {
  return getDiagnosticsSummary();
}

export function clearDiagnostics() {
  entries.length = 0;
  errorCount = 0;
  notifyListeners(false);
}

export function subscribeDiagnostics(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function buildDiagnosticReport(snapshot = {}) {
  const perfMem = globalThis.performance?.memory;
  const jsHeapMB = perfMem
    ? Math.round((perfMem.usedJSHeapSize / (1024 * 1024)) * 100) / 100
    : null;
  const cleanSnapshot = sanitizeMeta(snapshot) || {};
  const environment = {
    timestamp: new Date().toISOString(),
    userAgent: sanitizeText(globalThis.navigator?.userAgent || ''),
    viewport: `${globalThis.innerWidth || 0}x${globalThis.innerHeight || 0}`,
    dpr: globalThis.devicePixelRatio || 1,
    protocol: globalThis.location?.protocol || '',
    jsHeapMB,
    ...cleanSnapshot,
  };

  return {
    generatedAt: environment.timestamp,
    environment,
    summary: {
      totalCount: entries.length,
      errorCount,
    },
    logs: [...entries],
  };
}

export function formatDiagnosticText(snapshot = {}) {
  const report = buildDiagnosticReport(snapshot);
  const env = report.environment;
  const lines = [
    `Collab Jigsaw Diagnostics (${report.generatedAt})`,
    `Env: role=${env.role || 'solo'} puzzle=${env.puzzleSize || '-'} locked=${env.lockedCount ?? 0} viewport=${env.viewport} dpr=${env.dpr} heap=${env.jsHeapMB ?? '-'}MB`,
    `Summary: errors=${report.summary.errorCount}, entries=${report.summary.totalCount}`,
    '--- Logs ---',
  ];
  for (const item of report.logs) {
    const metaStr = item.meta ? ` ${JSON.stringify(item.meta)}` : '';
    lines.push(`[${item.time}] [${item.level}] [${item.category}] ${item.message}${metaStr}`);
  }
  return lines.join('\n');
}

function formatConsoleArgs(args) {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === 'object' && a !== null) {
        try {
          return JSON.stringify(sanitizeMeta(a));
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
}

export function initDiagnostics() {
  if (initialized) return;
  initialized = true;

  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('error', (ev) => {
      recordDiagnostic(
        'error',
        ev?.message || ev?.error?.message || 'Uncaught error',
        {
          filename: ev?.filename || '',
          lineno: ev?.lineno || 0,
          colno: ev?.colno || 0,
          stack: ev?.error?.stack || '',
        },
        'error'
      );
    });

    globalThis.addEventListener('unhandledrejection', (ev) => {
      const reason = ev?.reason;
      recordDiagnostic(
        'unhandledrejection',
        reason?.message || String(reason || 'Unhandled promise rejection'),
        reason instanceof Error ? { stack: reason.stack || '' } : { reason },
        'error'
      );
    });
  }

  const origError = console.error;
  const origWarn = console.warn;

  console.error = (...args) => {
    origError.apply(console, args);
    recordDiagnostic('console.error', formatConsoleArgs(args), null, 'error');
  };

  console.warn = (...args) => {
    origWarn.apply(console, args);
    recordDiagnostic('console.warn', formatConsoleArgs(args), null, 'warn');
  };
}
