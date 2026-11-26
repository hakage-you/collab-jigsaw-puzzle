import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDiagnosticReport,
  clearDiagnostics,
  formatDiagnosticText,
  getDiagnosticsState,
  initDiagnostics,
  recordDiagnostic,
  sanitizeMeta,
  sanitizeText,
  subscribeDiagnostics,
} from '../../src/services/diagnostics.js';

// The local diagnostic log (README "ローカル診断ログ"): users copy or save it by hand, so every
// secret must already be masked as [REDACTED] when it is recorded.

const R = '[REDACTED]';

beforeEach(() => {
  clearDiagnostics();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sanitizeText', () => {
  it.each([
    ['an image data URI', 'img data:image/png;base64,AAAA end', `img ${R} end`],
    ['a Google API key', `key AIza${'x'.repeat(35)} end`, `key ${R} end`],
    ['a short AIza word', `AIza${'x'.repeat(19)}`, `AIza${'x'.repeat(19)}`],
    [
      'secrets in a query string',
      'https://x.test/?key=k1&room=r1&token=t1&passcode=p1#frag',
      `https://x.test/?key=${R}&room=${R}&token=${R}&passcode=${R}#frag`,
    ],
    [
      'more query secrets, in any case',
      '?PASSWORD=a&reconnectToken=b&Secret=c&name=bob',
      `?PASSWORD=${R}&reconnectToken=${R}&Secret=${R}&name=bob`,
    ],
    [
      'key=value secrets in text',
      'apiKey=a1 passcode=p2 password=p3 reconnectToken=r4 secret=s5 room=ab12',
      `apiKey=${R} passcode=${R} password=${R} reconnectToken=${R} secret=${R} room=${R}`,
    ],
    ['a secret up to a quote', `say "room=abc" now`, `say "room=${R}" now`],
    ['words that only end in a secret name', 'myroom=abc xapiKey=def', 'myroom=abc xapiKey=def'],
    ['nothing secret', 'name=bob size=3', 'name=bob size=3'],
    ['a number', 42, '42'],
    ['null', null, ''],
    ['undefined', undefined, ''],
  ])('masks %s', (_, input, expected) => {
    expect(sanitizeText(input)).toBe(expected);
  });

  // Fixed 2026-11-26: token= and key= in free text, and secrets in JSON text, used to slip through.
  it.each([
    ['token= in free text', 'invalid token=abc', `invalid token=${R}`],
    ['key= in free text', 'key=abc', `key=${R}`],
    [
      'apiKey in a query string',
      'https://x.test/?apiKey=abc&n=1',
      `https://x.test/?apiKey=${R}&n=1`,
    ],
    [
      'words that only start with a secret name',
      'tokenizer=a keyboard=b',
      'tokenizer=a keyboard=b',
    ],
    [
      'secrets in JSON text',
      '{"token":"abc","passcode":"1234","name":"bob"}',
      `{"token":"${R}","passcode":"${R}","name":"bob"}`,
    ],
    ['a JSON number, with spaces', '{"passcode" : 1234, "n": 1}', `{"passcode" : "${R}", "n": 1}`],
    ['a JSON string with escaped quotes', '{"secret":"a\\"b","x":1}', `{"secret":"${R}","x":1}`],
    ['JSON names in any case', '{"ROOM":"abc","apikey":"k"}', `{"ROOM":"${R}","apikey":"${R}"}`],
    ['a JSON name that only contains a secret name', '{"tokenizer":"a"}', '{"tokenizer":"a"}'],
  ])('masks %s', (_, input, expected) => {
    expect(sanitizeText(input)).toBe(expected);
  });

  it('cuts text after 1000 characters', () => {
    expect(sanitizeText('a'.repeat(1000))).toBe('a'.repeat(1000));
    expect(sanitizeText('a'.repeat(1001))).toBe(`${'a'.repeat(1000)}…[truncated]`);
  });
});

describe('sanitizeMeta', () => {
  it('masks secret keys whatever their value, and secrets inside other values', () => {
    const meta = {
      apiKey: 'k',
      PASSCODE: 1234,
      password: 'p',
      reconnectToken: { a: 1 },
      token: 't',
      secret: 's',
      room: 'r',
      Key: 'k',
      tokenizer: 'kept',
      roomName: 'kept',
      url: 'https://x.test/?room=abc',
    };
    expect(sanitizeMeta(meta)).toEqual({
      apiKey: R,
      PASSCODE: R,
      password: R,
      reconnectToken: R,
      token: R,
      secret: R,
      room: R,
      Key: R,
      tokenizer: 'kept',
      roomName: 'kept',
      url: `https://x.test/?room=${R}`,
    });
  });

  it('keeps numbers, booleans, null and undefined and turns other things into text', () => {
    expect(sanitizeMeta(3)).toBe(3);
    expect(sanitizeMeta(false)).toBe(false);
    expect(sanitizeMeta(null)).toBeNull();
    expect(sanitizeMeta(undefined)).toBeUndefined();
    expect(sanitizeMeta(Symbol('s'))).toBe('Symbol(s)');
    expect(sanitizeMeta(10n)).toBe('10');
  });

  it('keeps the name, message and stack of an error, masked', () => {
    const err = new TypeError('bad room=abc');
    err.stack = 'at passcode=xyz';
    expect(sanitizeMeta(err)).toEqual({
      name: 'TypeError',
      message: `bad room=${R}`,
      stack: `at passcode=${R}`,
    });
  });

  it('stops at four levels, at loops and after 50 list items', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(sanitizeMeta(deep)).toEqual({ a: { b: { c: { d: '[Object]' } } } });
    const loop = { name: 'x' };
    loop.self = loop;
    expect(sanitizeMeta(loop)).toEqual({ name: 'x', self: '[Object]' });
    const list = sanitizeMeta(Array.from({ length: 60 }, (_, i) => i));
    expect(list).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
});

describe('recordDiagnostic', () => {
  it('records a masked entry with a level of error, warn or info', () => {
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-11-26T00:00:00.000Z');
    expect(recordDiagnostic('net', 'join room=abc', { passcode: '1' }, 'warn')).toEqual({
      time: '2026-11-26T00:00:00.000Z',
      level: 'warn',
      category: 'net',
      message: `join room=${R}`,
      meta: { passcode: R },
    });
    expect(recordDiagnostic('net', 'x', null, 'error').level).toBe('error');
    expect(recordDiagnostic('net', 'x', null, 'debug').level).toBe('info');
    expect(recordDiagnostic('', 'x').category).toBe('app');
    expect(recordDiagnostic('net', 'x', undefined).meta).toBeNull();
    expect(getDiagnosticsState().entries).toHaveLength(5);
  });

  it('keeps the last 200 entries', () => {
    for (let i = 0; i < 205; i++) recordDiagnostic('app', `m${i}`);
    const { entries, totalCount } = getDiagnosticsState();
    expect(totalCount).toBe(200);
    expect(entries[0].message).toBe('m5');
    expect(entries.at(-1).message).toBe('m204');
  });

  it('counts only uncaught errors and rejections as errors', () => {
    recordDiagnostic('error', 'boom', null, 'error');
    recordDiagnostic('unhandledrejection', 'boom', null, 'error');
    recordDiagnostic('error', 'just a warning', null, 'warn');
    recordDiagnostic('net', 'handled', null, 'error');
    expect(getDiagnosticsState().errorCount).toBe(2);
    clearDiagnostics();
    expect(getDiagnosticsState()).toEqual({ entries: [], totalCount: 0, errorCount: 0 });
  });

  it('tells listeners, marking uncaught errors, until they unsubscribe', () => {
    const listener = vi.fn();
    const off = subscribeDiagnostics(listener);
    recordDiagnostic('net', 'x');
    recordDiagnostic('error', 'y', null, 'error');
    clearDiagnostics();
    off();
    recordDiagnostic('net', 'z');
    expect(listener.mock.calls.map(([e]) => [e.state.totalCount, e.isUnexpectedError])).toEqual([
      [1, false],
      [2, true],
      [0, false],
    ]);
    expect(subscribeDiagnostics('not a function')()).toBeUndefined();
  });

  it('hands out copies of the entry list', () => {
    recordDiagnostic('net', 'x');
    getDiagnosticsState().entries.length = 0;
    expect(getDiagnosticsState().entries).toHaveLength(1);
  });
});

describe('buildDiagnosticReport and formatDiagnosticText', () => {
  it('adds the environment and the masked snapshot to the log', () => {
    vi.stubGlobal('navigator', { userAgent: 'Agent room=xyz' });
    vi.stubGlobal('innerWidth', 800);
    vi.stubGlobal('innerHeight', 600);
    vi.stubGlobal('devicePixelRatio', 2);
    vi.stubGlobal('location', { protocol: 'https:' });
    vi.stubGlobal('performance', { memory: { usedJSHeapSize: 1.2345 * 1024 * 1024 } });
    recordDiagnostic('net', 'hello');
    const report = buildDiagnosticReport({ role: 'host', passcode: '1234' });
    expect(report.environment).toMatchObject({
      userAgent: `Agent room=${R}`,
      viewport: '800x600',
      dpr: 2,
      protocol: 'https:',
      jsHeapMB: 1.23,
      role: 'host',
      passcode: R,
    });
    expect(report.generatedAt).toBe(report.environment.timestamp);
    expect(report.summary).toEqual({ totalCount: 1, errorCount: 0 });
    expect(report.logs.map((l) => l.message)).toEqual(['hello']);
  });

  it('fills in defaults where the environment has nothing', () => {
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('location', undefined);
    vi.stubGlobal('performance', {});
    vi.stubGlobal('innerWidth', undefined);
    vi.stubGlobal('devicePixelRatio', undefined);
    const { environment } = buildDiagnosticReport();
    expect(environment).toMatchObject({
      userAgent: '',
      viewport: '0x0',
      dpr: 1,
      protocol: '',
      jsHeapMB: null,
    });
  });

  it('writes a plain text report line by line', () => {
    vi.stubGlobal('performance', {});
    recordDiagnostic('net', 'first');
    recordDiagnostic('app', 'second', { n: 1 }, 'warn');
    const lines = formatDiagnosticText({ role: 'guest', puzzleSize: '4x3', lockedCount: 5 }).split(
      '\n',
    );
    expect(lines[0]).toMatch(/^Collab Jigsaw Diagnostics \(\d{4}-/);
    expect(lines[1]).toMatch(/^Env: role=guest puzzle=4x3 locked=5 viewport=\S+ dpr=\S+ heap=-MB$/);
    expect(lines[2]).toBe('Summary: errors=0, entries=2');
    expect(lines[3]).toBe('--- Logs ---');
    expect(lines[4]).toMatch(/^\[.+\] \[info\] \[net\] first$/);
    expect(lines[5]).toMatch(/^\[.+\] \[warn\] \[app\] second \{"n":1\}$/);
    expect(formatDiagnosticText().split('\n')[1]).toMatch(/^Env: role=solo puzzle=- locked=0 /);
  });
});

describe('initDiagnostics', () => {
  it('records console errors and warnings and uncaught errors, once', () => {
    const handlers = {};
    vi.stubGlobal('addEventListener', (type, fn) => {
      handlers[type] = fn;
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initDiagnostics();
    initDiagnostics();

    console.error(new RangeError('bad'), { token: 't', n: 1 }, 'room=abc');
    console.warn('careful');
    handlers.error({ message: 'Uncaught x', filename: 'a.js', lineno: 3, colno: 4 });
    handlers.unhandledrejection({ reason: new Error('lost') });
    handlers.unhandledrejection({ reason: 'plain' });
    handlers.error({});

    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('careful');
    const entries = getDiagnosticsState().entries.map((e) => [e.category, e.level, e.message]);
    expect(entries).toEqual([
      ['console.error', 'error', `RangeError: bad {"token":"${R}","n":1} room=${R}`],
      ['console.warn', 'warn', 'careful'],
      ['error', 'error', 'Uncaught x'],
      ['unhandledrejection', 'error', 'lost'],
      ['unhandledrejection', 'error', 'plain'],
      ['error', 'error', 'Uncaught error'],
    ]);
    const metas = getDiagnosticsState().entries.map((e) => e.meta);
    expect(metas[2]).toEqual({ filename: 'a.js', lineno: 3, colno: 4, stack: '' });
    expect(metas[4]).toEqual({ reason: 'plain' });
    expect(getDiagnosticsState().errorCount).toBe(4);
  });
});
