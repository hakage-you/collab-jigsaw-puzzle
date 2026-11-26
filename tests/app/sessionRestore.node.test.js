import { describe, expect, it } from 'vitest';
import {
  restoreSessionFromSave,
  resumeHostSessionFromBackup,
} from '../../src/app/sessionRestore.js';
import { boardState, createEngine, createFakeImage, movePieceTo } from '../helpers/coreEngine.js';

// Restoring a game from a save file and reopening a room from an automatic backup, with an own
// image. The sample-image path draws on a canvas and is covered by the browser tests.

/** The part of GameSession the restore functions use, recording what they do. */
function fakeSession({ role = 'solo' } = {}) {
  const log = { events: [], patches: [], contributions: [], started: [], broadcasts: 0, resets: 0 };
  const session = {
    engine: createEngine(),
    settings: { ojama: { dropCount: 2, cooldownSec: 3 } },
    highlightFilter: 'red',
    sourceImage: { name: 'before' },
    patchSettings: (patch) => log.patches.push(patch),
    emit: (name, payload) => log.events.push([name, payload]),
    room: {
      role,
      applySavedContributions: (list, placed) => log.contributions.push([list, placed]),
      broadcastFullState: () => {
        log.broadcasts += 1;
      },
      startHostRoom: (options) => {
        log.started.push(options);
        return Promise.resolve();
      },
    },
    _replaceSourceImage(canvas, name, isSample, sampleId) {
      session.sourceImage = { canvas, name, isSample, sampleId };
    },
    _resetLobbyState: () => {
      log.resets += 1;
    },
  };
  return { session, log };
}

/** A save of a game with one piece moved and one placed, plus settings and contributions. */
function gameSave(over = {}) {
  const engine = createEngine({ cutComplexity: 'complex' });
  movePieceTo(engine, engine.pieces[0], 123, 45);
  engine.resolveDrop(engine.pieces[0].groupId);
  const save = JSON.parse(
    JSON.stringify(
      engine.exportSaveData({ theme: 'dark', cutComplexity: 'standard', ojama: { dropCount: 5 } }, [
        { name: 'A', role: 'guest', contrib: 2 },
      ]),
    ),
  );
  return { engine, save: { ...save, ...over } };
}

const eventNames = (log) => log.events.map(([name]) => name);

describe('restoreSessionFromSave', () => {
  it('restores the board, settings, contributions and image, then announces it', () => {
    const { session, log } = fakeSession();
    const { engine, save } = gameSave();
    const image = createFakeImage();
    restoreSessionFromSave(session, save, image, false, 'photo.jpg');

    expect(boardState(session.engine)).toEqual(boardState(engine));
    expect(log.patches).toEqual([
      {
        theme: 'dark',
        cutComplexity: 'complex',
        ojama: { dropCount: 5, cooldownSec: 3 },
      },
    ]);
    expect(log.contributions).toEqual([[save.contributions, session.engine.stats.placedCount]]);
    expect(session.sourceImage).toEqual({
      canvas: image,
      name: 'photo.jpg',
      isSample: false,
      sampleId: null,
    });
    expect(session.highlightFilter).toBe('all');
    expect(eventNames(log)).toEqual(['puzzleReset', 'hudUpdate', 'toast']);
    expect(log.events[0][1]).toMatchObject({
      name: 'photo.jpg',
      resetEffects: true,
      fitView: true,
    });
    expect(log.events[2][1]).toEqual({
      message: 'セーブデータからパズルを復元しました',
      kind: 'success',
    });
    expect(log.broadcasts).toBe(0);
  });

  it('names an unnamed own image and sends the board to guests when hosting', () => {
    const { session, log } = fakeSession({ role: 'host' });
    restoreSessionFromSave(session, gameSave().save, createFakeImage(), false);
    expect(session.sourceImage.name).toBe('ローカル画像（復元）');
    expect(log.broadcasts).toBe(1);
  });

  it('restores a save without a cut in its header as the standard cut', () => {
    // Validation fills in 'standard', so the fallback to settings.cutComplexity in
    // sessionRestore never runs (every save since the first release has the cut in its header).
    const { session, log } = fakeSession();
    const { save } = gameSave();
    delete save.puzzle.cutComplexity;
    save.settings.cutComplexity = 'uniform';
    restoreSessionFromSave(session, save, createFakeImage(), false);
    expect(log.patches[0].cutComplexity).toBe('standard');
    expect(session.engine.cutComplexity).toBe('standard');
  });

  it('keeps the settings of a save without settings', () => {
    const { session, log } = fakeSession();
    const { save } = gameSave();
    delete save.settings;
    restoreSessionFromSave(session, save, createFakeImage(), false);
    expect(log.patches).toEqual([]);
    expect(eventNames(log)).toContain('puzzleReset');
  });

  it('refuses a broken save with a toast and changes nothing', () => {
    const { session, log } = fakeSession();
    const before = boardState(session.engine);
    restoreSessionFromSave(session, { version: 99 }, createFakeImage(), false);
    expect(log.events).toEqual([['toast', { message: expect.any(String), kind: 'ojama' }]]);
    expect(boardState(session.engine)).toEqual(before);
    expect(session.highlightFilter).toBe('red');
  });

  it('does nothing without an image', () => {
    const { session, log } = fakeSession();
    restoreSessionFromSave(session, gameSave().save, null, false);
    expect([log.events, log.patches]).toEqual([[], []]);
  });
});

describe('resumeHostSessionFromBackup', () => {
  const ROOM = { displayName: 'ホスト', passcode: 'pw', requireApproval: true, capacity: 5 };

  it('restores the backup and reopens the room with its rules', async () => {
    const { session, log } = fakeSession();
    const { engine, save } = gameSave();
    const image = createFakeImage();
    image._fileName = 'saved.png';
    await resumeHostSessionFromBackup(session, save, image, false, ROOM);

    expect(boardState(session.engine)).toEqual(boardState(engine));
    expect(log.contributions).toEqual([[save.contributions, session.engine.stats.placedCount]]);
    expect(log.patches).toEqual([{ ...save.settings, playerName: 'ホスト' }]);
    expect(session.sourceImage).toMatchObject({
      canvas: image,
      name: 'saved.png',
      isSample: false,
    });
    expect(session.highlightFilter).toBe('all');
    expect(log.started).toEqual([{ passcode: 'pw', requireApproval: true, capacity: 5 }]);
    expect(log.resets).toBe(1);
    expect(eventNames(log)).toEqual(['stopYoutubePolling', 'puzzleReset', 'toast']);
    expect(log.events[0][1]).toEqual({ reason: null });
    expect(log.events[2][1]).toEqual({
      message: '自動バックアップから部屋を再開しました',
      kind: 'success',
    });
  });

  it('names the image from the backup, or generically', async () => {
    const named = fakeSession();
    await resumeHostSessionFromBackup(
      named.session,
      gameSave({ puzzle: { ...gameSave().save.puzzle, imageName: 'from-backup.jpg' } }).save,
      createFakeImage(),
      false,
      ROOM,
    );
    expect(named.session.sourceImage.name).toBe('from-backup.jpg');

    const plain = fakeSession();
    const { save } = gameSave();
    delete save.settings;
    await resumeHostSessionFromBackup(plain.session, save, createFakeImage(), false, ROOM);
    expect(plain.session.sourceImage.name).toBe('復元画像');
    expect(plain.log.patches).toEqual([{ playerName: 'ホスト' }]);
  });

  it('refuses a broken backup with a toast and does not open the room', async () => {
    const { session, log } = fakeSession();
    await resumeHostSessionFromBackup(session, { pieces: 'x' }, createFakeImage(), false, ROOM);
    expect(eventNames(log)).toEqual(['toast']);
    expect([log.started, log.resets]).toEqual([[], 0]);
  });
});
