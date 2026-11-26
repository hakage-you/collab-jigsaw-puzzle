import { afterEach, describe, expect, it } from 'vitest';
import { GameSession } from '../../src/app/gameSession.js';
import { generateSampleImageCanvas } from '../../src/services/sampleImage.js';
import { SaveLoadUI } from '../../src/ui/saveLoadUI.js';
import { loadAutoBackup, clearAutoBackup, saveAutoBackup } from '../../src/services/storage.js';
import { MSG } from '../../src/net/protocol.js';
import { closeAllSessions, joinGuest, startHost } from '../helpers/room.js';
import { boardState, createEngine } from '../helpers/puzzle.js';
import { nextEvent, waitFor } from '../helpers/wait.js';

// S1 (security assessment 2026-11-21): save files are untrusted. Malformed or hostile data must be
// rejected, or reduced to known fields, before it reaches the engine or the screen.
// This file checks that every call site refuses invalid data; the validator itself is checked in
// Node by tests/core/saveValidation.node.test.js.

const SETTINGS = { cutComplexity: 'standard', allowRotation: false, allowFlip: false };

/** A real save written by the game (JSON round trip, exactly what a file contains). */
function realSave() {
  const engine = createEngine();
  return JSON.parse(JSON.stringify(engine.exportSaveData(SETTINGS)));
}

afterEach(() => {
  closeAllSessions();
  clearAutoBackup();
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
