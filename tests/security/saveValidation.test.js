import { afterEach, describe, expect, it } from 'vitest';
import { GameSession } from '../../src/app/gameSession.js';
import { generateSampleImageCanvas } from '../../src/core/sampleImage.js';
import {
  MAX_SAVE_TEXT_LENGTH,
  parseSaveText,
  validateSaveData,
} from '../../src/core/saveValidation.js';
import { SaveLoadUI } from '../../src/ui/saveLoadUI.js';
import { loadAutoBackup, clearAutoBackup, saveAutoBackup } from '../../src/services/storage.js';
import { MSG } from '../../src/net/protocol.js';
import { closeAllSessions, joinGuest, startHost } from '../helpers/room.js';
import { boardState, createEngine, movePieceTo } from '../helpers/puzzle.js';
import { nextEvent, waitFor } from '../helpers/wait.js';

// S1 (security assessment 2026-11-21): save files are untrusted. Malformed or hostile data must be
// rejected, or reduced to known fields, before it reaches the engine or the screen.

const SETTINGS = { cutComplexity: 'standard', allowRotation: false, allowFlip: false };

/** A real save written by the game (JSON round trip, exactly what a file contains). */
function realSave() {
  const engine = createEngine();
  return JSON.parse(JSON.stringify(engine.exportSaveData(SETTINGS)));
}

function expectRejected(raw) {
  const result = validateSaveData(raw);
  expect(result.ok).toBe(false);
  expect(typeof result.error).toBe('string');
  expect(result.error.length).toBeGreaterThan(0);
}

afterEach(() => {
  closeAllSessions();
  clearAutoBackup();
});

describe('validateSaveData: accepted input', () => {
  it('accepts a real save and restores the same board', () => {
    const original = createEngine();
    movePieceTo(original, original.pieces[0], 50, 60);
    const result = validateSaveData(JSON.parse(JSON.stringify(original.exportSaveData(SETTINGS))));
    expect(result.ok).toBe(true);

    const restored = createEngine();
    restored.restoreFromSave(result.data, generateSampleImageCanvas(), true);
    expect(boardState(restored)).toEqual(boardState(original));
  });

  it('returns a new object and does not pass the raw input through', () => {
    const raw = realSave();
    const { data } = validateSaveData(raw);
    expect(data).not.toBe(raw);
    expect(data.pieces).not.toBe(raw.pieces);
  });
});

describe('validateSaveData: structure', () => {
  it.each([
    ['null', null],
    ['a string', 'save'],
    ['an array', []],
    ['a number', 42],
  ])('rejects %s at the top level', (_, raw) => {
    expectRejected(raw);
  });

  it('rejects a missing puzzle block', () => {
    const raw = realSave();
    delete raw.puzzle;
    expectRejected(raw);
  });

  it('rejects pieces that are not an array', () => {
    const raw = realSave();
    raw.pieces = {};
    expectRejected(raw);
  });

  it('rejects a piece count that does not match cols * rows', () => {
    const raw = realSave();
    raw.pieces = raw.pieces.slice(1);
    expectRejected(raw);
  });

  it('rejects a non-integer or non-number grid size', () => {
    const fractional = realSave();
    fractional.puzzle.cols = 4.5;
    expectRejected(fractional);

    const text = realSave();
    text.puzzle.cols = '4';
    expectRejected(text);
  });

  it('rejects grid sizes beyond the engine limits', () => {
    const tooWide = realSave();
    tooWide.puzzle.cols = 81;
    expectRejected(tooWide);

    const tooMany = realSave();
    tooMany.puzzle.cols = 80;
    tooMany.puzzle.rows = 80;
    expectRejected(tooMany);
  });

  it('rejects a version other than 1', () => {
    const raw = realSave();
    raw.version = 2;
    expectRejected(raw);
  });
});

describe('validateSaveData: puzzle header', () => {
  it('rejects a seed string that carries markup', () => {
    const raw = realSave();
    raw.puzzle.seed = '<img src=x onerror="window.__xss=1">';
    expectRejected(raw);
  });

  it('rejects an unknown cutComplexity', () => {
    const raw = realSave();
    raw.puzzle.cutComplexity = 'wavy';
    expectRejected(raw);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a huge value', 1e7],
  ])('rejects a piece coordinate that is %s', (_, value) => {
    const raw = realSave();
    raw.pieces[0].x = value;
    expectRejected(raw);
  });

  it('rejects an oversized board dimension', () => {
    const raw = realSave();
    raw.puzzle.boardW = 1e9;
    expectRejected(raw);
  });
});

describe('validateSaveData: pieces', () => {
  it('rejects rotation 7', () => {
    const raw = realSave();
    raw.pieces[0].rotation = 7;
    expectRejected(raw);
  });

  it('rejects duplicate piece ids', () => {
    const raw = realSave();
    raw.pieces[1].id = raw.pieces[0].id;
    expectRejected(raw);
  });

  it('rejects a piece id outside the grid', () => {
    const raw = realSave();
    raw.pieces[0].id = raw.puzzle.cols * raw.puzzle.rows;
    expectRejected(raw);
  });

  it('rejects non-boolean flags', () => {
    const raw = realSave();
    raw.pieces[0].isLocked = 'yes';
    expectRejected(raw);
  });
});

describe('validateSaveData: prototype keys', () => {
  it('drops a __proto__ key on the top level without polluting Object.prototype', () => {
    const text = JSON.stringify(realSave()).replace('{', '{"__proto__":{"polluted":true},');
    const result = parseSaveText(text);
    expect(result.ok).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result.data, '__proto__')).toBe(false);
    expect({}.polluted).toBeUndefined();
  });

  it('drops a __proto__ key on a piece record', () => {
    const raw = realSave();
    Object.defineProperty(raw.pieces[0], '__proto__', {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const result = validateSaveData(raw);
    expect(result.ok).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result.data.pieces[0], '__proto__')).toBe(false);
    expect({}.polluted).toBeUndefined();
  });

  it('drops constructor keys in settings', () => {
    const raw = realSave();
    raw.settings.constructor = { prototype: { polluted: true } };
    const result = validateSaveData(raw);
    expect(result.ok).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result.data.settings, 'constructor')).toBe(false);
    expect({}.polluted).toBeUndefined();
  });
});

describe('validateSaveData: settings, stats and contributions', () => {
  it('keeps only known settings keys and drops wrong types', () => {
    const raw = realSave();
    raw.settings = {
      ...raw.settings,
      evil: '<b>x</b>',
      cols: '9',
      showStats: 'yes',
      theme: 'neon',
      guideOpacity: 30,
    };
    const { data } = validateSaveData(raw);
    expect(data.settings).not.toHaveProperty('evil');
    expect(data.settings).not.toHaveProperty('cols');
    expect(data.settings).not.toHaveProperty('showStats');
    expect(data.settings).not.toHaveProperty('theme');
    expect(data.settings.guideOpacity).toBe(30);
  });

  it('truncates long strings to their maximum length', () => {
    const raw = realSave();
    raw.settings.playerName = 'あ'.repeat(50);
    raw.settings.ojama = { triggerWords: 'x'.repeat(2000), dropCount: 'two' };
    const { data } = validateSaveData(raw);
    expect(data.settings.playerName).toHaveLength(20);
    expect(data.settings.ojama.triggerWords).toHaveLength(500);
    expect(data.settings.ojama).not.toHaveProperty('dropCount');
  });

  it('drops invalid stats counters and keeps valid ones', () => {
    const raw = realSave();
    raw.stats = { placedCount: 3, elapsedMs: -5, ojamaTotal: Number.NaN };
    const { data } = validateSaveData(raw);
    expect(data.stats.placedCount).toBe(3);
    expect(data.stats).not.toHaveProperty('elapsedMs');
    expect(data.stats).not.toHaveProperty('ojamaTotal');
  });

  it('drops contributions with a javascript: or url() colour but keeps the entry', () => {
    const raw = realSave();
    raw.contributions = [
      { name: 'A', role: 'guest', contrib: 2, color: 'javascript:alert(1)' },
      { name: 'B', role: 'guest', contrib: 1, color: 'url(https://example.test/x)' },
      { name: 'C', role: 'guest', contrib: 4, color: '#1d4ed8' },
      { name: 'D', role: 'host', contrib: 0, color: 'var(--accent)' },
    ];
    const { data } = validateSaveData(raw);
    expect(data.contributions).toHaveLength(4);
    expect(data.contributions[0]).not.toHaveProperty('color');
    expect(data.contributions[1]).not.toHaveProperty('color');
    expect(data.contributions[2].color).toBe('#1d4ed8');
    expect(data.contributions[3].color).toBe('var(--accent)');
  });

  it('drops malformed contribution entries and rejects more than 64 entries', () => {
    const raw = realSave();
    raw.contributions = [
      { name: 'A', role: 'admin', contrib: 1 },
      { name: 'B', role: 'guest', contrib: -1 },
      { name: 'C', role: 'guest', contrib: 1 },
    ];
    const { data } = validateSaveData(raw);
    expect(data.contributions.map((c) => c.name)).toEqual(['C']);

    raw.contributions = Array.from({ length: 65 }, (_, i) => ({
      name: `P${i}`,
      role: 'guest',
      contrib: 0,
    }));
    expectRejected(raw);
  });
});

describe('parseSaveText', () => {
  it('rejects text larger than the size limit before parsing', () => {
    const text = `{"pad":"${'x'.repeat(MAX_SAVE_TEXT_LENGTH)}"}`;
    expect(parseSaveText(text).ok).toBe(false);
  });

  it('rejects text that is not JSON', () => {
    expect(parseSaveText('{not json').ok).toBe(false);
  });

  it('accepts the JSON text of a real save', () => {
    const text = JSON.stringify(realSave());
    expect(parseSaveText(text).ok).toBe(true);
  });
});

describe('call sites refuse invalid save data', () => {
  it('restoreFromSaveData shows an error toast and leaves the board untouched', () => {
    const app = new GameSession();
    const before = app.engine.pieces.length;
    const toasts = [];
    app.on('toast', (t) => toasts.push(t));

    const bad = realSave();
    bad.pieces[0].rotation = 9;
    app.restoreFromSaveData(bad, generateSampleImageCanvas(), true);

    expect(toasts.at(-1)?.kind).toBe('ojama');
    expect(app.engine.pieces.length).toBe(before);
  });

  it('resumeHostFromBackup refuses an invalid backup and does not start a room', async () => {
    const app = new GameSession();
    const toasts = [];
    app.on('toast', (t) => toasts.push(t));

    const bad = realSave();
    bad.puzzle.cols = 'many';
    await app.resumeHostFromBackup(bad, null, true, {
      displayName: 'ホスト',
      passcode: '',
      requireApproval: false,
      capacity: 8,
    });

    expect(toasts.at(-1)?.kind).toBe('ojama');
    expect(app.room.role).toBe('solo');
  });

  it('loadAutoBackup returns null for an invalid backup and the data for a valid one', () => {
    saveAutoBackup({ puzzle: { cols: 'x' }, pieces: [] });
    expect(loadAutoBackup()).toBeNull();

    saveAutoBackup(realSave());
    expect(loadAutoBackup()?.puzzle.cols).toBeGreaterThan(0);
  });

  it('the save file input shows an error toast for a hostile file and keeps nothing pending', async () => {
    const ids = [
      'loadJsonInput',
      'loadImageInput',
      'loadedJsonSummary',
      'btnApplyLoad',
      'btnApplyLoadSample',
      'btnDownloadSave',
      'btnResetSettings',
    ];
    const root = document.createElement('div');
    for (const id of ids) {
      const el = document.createElement(
        id.endsWith('Input') ? 'input' : id.startsWith('btn') ? 'button' : 'div',
      );
      el.id = id;
      if (id.endsWith('Input')) el.type = 'file';
      root.appendChild(el);
    }
    document.body.appendChild(root);
    try {
      const toasts = [];
      const ui = new SaveLoadUI({
        app: { verifySaveImageMatch: () => true, exportSaveData: () => ({}) },
        showToast: (message, kind) => toasts.push({ message, kind }),
      });
      const bad = JSON.stringify({ puzzle: { cols: 4, rows: 3, seed: '<b>x</b>' }, pieces: [] });
      const input = document.getElementById('loadJsonInput');
      const dt = new DataTransfer();
      dt.items.add(new File([bad], 'bad.json', { type: 'application/json' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));

      await waitFor(() => toasts.length > 0, { message: 'toast not shown' });
      expect(toasts[0].kind).toBe('ojama');
      expect(ui.pendingSaveData).toBeNull();
    } finally {
      root.remove();
    }
  });
});

describe('multiplayer: guest applying a host full state', () => {
  it('leaves the room and keeps its board when the host state holds an invalid piece', async () => {
    const { host, roomId } = await startHost({ name: 'ホスト' });
    const guest = await joinGuest(roomId, { name: 'アリス' });
    const before = boardState(guest.engine);

    const bad = JSON.parse(JSON.stringify(host.engine.exportSaveData(host.settings)));
    bad.pieces[0].rotation = 7;

    const disconnected = nextEvent(guest, 'disconnected', { timeout: 3000 });
    await guest.room.guestSession.onMessage({
      type: MSG.FULL_STATE,
      saveData: bad,
      roster: [],
      locks: [],
      zoneLabels: [],
      roomRules: guest.room.roomRules,
    });

    await expect(disconnected).resolves.toMatchObject({ reason: expect.any(String) });
    expect(guest.room.role).toBe('solo');
    expect(boardState(guest.engine)).toEqual(before);
  });
});
