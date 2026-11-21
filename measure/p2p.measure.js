/**
 * P2P transfer volume between players (consumption measurement, not a pass/fail test).
 * Runs on the local BroadcastChannel transport in one headless Chromium page. No network.
 * Output: measure/.latest/p2p.json
 */
import { it } from 'vitest';
import { GameSession } from '../src/app/gameSession.js';
import { PUZZLE_CONFIG } from '../src/config/constants.js';
import { computeGridForPieceCount } from '../src/core/jigsawPath.js';
import { SMALL_PUZZLE } from '../tests/helpers/puzzle.js';
import { nextEvent } from '../tests/helpers/wait.js';
import { kib, round, seededRandom, sleep, utf8Bytes, writeResult } from './measureUtils.js';

const NOTE =
  'Counts every lc_msg frame posted by the local BroadcastChannel transport (wrapper on ' +
  'BroadcastChannel.prototype.postMessage); a host broadcast counts once per recipient. ' +
  'Bytes = UTF-8 length of JSON.stringify(payload). Production uses PeerJS with binary ' +
  'serialization, so these JSON sizes are an approximation; PeerJS framing, WebRTC/ICE and ' +
  'signaling traffic are not included. Headless Chromium, one page, all players in-page. ' +
  'Control frames (lc_connect/lc_accept/lc_bye/lc_kick) are not counted as messages. ' +
  'The per-op scenarios use host + 2 guests: one acting guest and one observer.';

const SETTLE_MS = 150; // lets host reactions be delivered before counters are read
const PER_OP_STEP_MS = 50;
const SCENARIO_TIMEOUT_MS = 110000;

/* ---------- transport counter ---------- */

const frames = [];
const originalPostMessage = BroadcastChannel.prototype.postMessage;

function countingPostMessage(frame) {
  if (frame?.kind === 'lc_msg') {
    frames.push({
      from: frame.from,
      to: frame.to,
      dir: frame.to === 'host' ? 'guest->host' : 'host->guest',
      type: frame.payload?.type ?? 'unknown',
      bytes: utf8Bytes(JSON.stringify(frame.payload ?? null)),
    });
  }
  return originalPostMessage.call(this, frame);
}

function summarizeFrames(list) {
  const byType = new Map();
  const byDirection = {
    'guest->host': { messages: 0, bytes: 0 },
    'host->guest': { messages: 0, bytes: 0 },
  };
  let bytes = 0;
  for (const f of list) {
    bytes += f.bytes;
    byDirection[f.dir].messages += 1;
    byDirection[f.dir].bytes += f.bytes;
    const t = byType.get(f.type) ?? { messages: 0, bytes: 0 };
    t.messages += 1;
    t.bytes += f.bytes;
    byType.set(f.type, t);
  }
  const sortedTypes = [...byType.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
  return {
    messages: list.length,
    bytes,
    byDirection,
    byType: Object.fromEntries(sortedTypes),
  };
}

/** Clears the frame log, runs fn, waits for reactions, then summarizes what was posted. */
async function measureOp(fn) {
  frames.length = 0;
  const extra = (await fn()) ?? {};
  await sleep(SETTLE_MS);
  return { ...extra, ...summarizeFrames(frames) };
}

/* ---------- sessions (same page, local transport) ---------- */

const sessions = [];

function createSession() {
  const app = new GameSession();
  app.room.transportMode = 'local';
  sessions.push(app);
  return app;
}

function closeAllSessions() {
  for (const app of sessions.splice(0)) {
    try {
      app.room.close();
    } catch {
      // already closed
    }
  }
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith('cj_rejoin_')) sessionStorage.removeItem(key);
  }
}

async function startHost(puzzle = {}) {
  const host = createSession();
  host.patchSettings({ ...SMALL_PUZZLE, allowRotation: true, ...puzzle });
  host.startNewPuzzle();
  await host.startHostRoom({
    displayName: 'ホスト',
    passcode: '',
    requireApproval: false,
    capacity: 8,
  });
  return host;
}

/** Joins a guest and waits until its board is synced. Returns { guest, joinMs }. */
async function joinGuest(host, name) {
  sessionStorage.removeItem(`cj_rejoin_${host.room.roomId}`);
  const guest = createSession();
  const started = performance.now();
  const synced = nextEvent(guest, 'fullStateSynced', { timeout: 120000 });
  await guest.joinGuestRoom({ roomId: host.room.roomId, displayName: name, passcode: '' });
  await synced;
  return { guest, joinMs: performance.now() - started };
}

/**
 * Drags a piece the way the canvas does: requestLock, then per step sendCursorMove,
 * moveGroup, sendDragPreview (throttled inside the app), and finally submitDrop.
 */
async function dragLikeCanvas(app, pieceId, { dx, dy, steps, stepMs = PER_OP_STEP_MS }) {
  const first = app.engine.getPieceById(pieceId);
  const { groupId } = first;
  if (!app.requestLock(groupId).allowed) return 'denied';
  for (let i = 0; i < steps; i += 1) {
    const piece = app.engine.getPieceById(pieceId);
    app.sendCursorMove(piece.x, piece.y);
    app.moveGroup(groupId, dx / steps, dy / steps);
    app.sendDragPreview(groupId);
    await sleep(stepMs);
  }
  app.submitDrop(groupId);
  return 'dropped';
}

/** Places the first `count` pieces on their targets via the host (puts the room "in progress"). */
function snapFirstPieces(host, count) {
  const pieces = host.engine.pieces.slice(0, count);
  for (const p of pieces) {
    const { groupId } = host.engine.getPieceById(p.id);
    host.requestLock(groupId);
    const current = host.engine.getPieceById(p.id);
    host.moveGroup(groupId, current.targetX - current.x, current.targetY - current.y);
    host.sendDragPreview(groupId, true);
    host.submitDrop(groupId);
  }
}

/* ---------- scenarios ---------- */

const results = {};

async function scenarioDrag() {
  const host = await startHost();
  const { guest } = await joinGuest(host, 'ゲスト');
  await joinGuest(host, '観客');
  await sleep(SETTLE_MS);
  const rng = seededRandom(101);
  const loose = guest.engine.pieces.filter((p) => !p.isLocked);
  const piece = loose[Math.floor(rng() * loose.length)];
  results.a = await measureOp(async () => ({
    pieceId: piece.id,
    outcome: await dragLikeCanvas(guest, piece.id, { dx: 300, dy: 200, steps: 30 }),
  }));
  closeAllSessions();
}

async function scenarioRotation() {
  const host = await startHost();
  const { guest } = await joinGuest(host, 'ゲスト');
  await joinGuest(host, '観客');
  await sleep(SETTLE_MS);
  const piece = guest.engine.pieces.find((p) => !p.isLocked);
  results.b = await measureOp(() => ({
    applied: guest.submitRotate(piece) === true,
  }));
  closeAllSessions();
}

async function scenarioCursor() {
  const host = await startHost();
  const { guest } = await joinGuest(host, 'ゲスト');
  await joinGuest(host, '観客');
  await sleep(SETTLE_MS);
  results.c = await measureOp(async () => {
    const t0 = performance.now();
    let calls = 0;
    while (performance.now() - t0 < 1000) {
      guest.sendCursorMove(100 + ((calls * 7) % 400), 100 + ((calls * 5) % 300));
      calls += 1;
      await sleep(16);
    }
    return { sendCursorMoveCalls: calls, callIntervalMs: 16, windowMs: 1000 };
  });
  closeAllSessions();
}

/** Late join into a room with some progress. Reports what the new guest receives. */
async function scenarioLateJoin(label, cols, rows, pieceCount) {
  const host = await startHost({ cols, rows });
  await joinGuest(host, '既存A');
  await joinGuest(host, '既存B');
  const snapCount = Math.max(3, Math.floor(pieceCount * 0.1));
  snapFirstPieces(host, snapCount);
  await sleep(SETTLE_MS * 2);

  frames.length = 0;
  const { guest, joinMs } = await joinGuest(host, '新規');
  await sleep(SETTLE_MS);
  const newId = guest.room.transport.clientId;
  const received = frames.filter((f) => f.to === newId);
  const sent = frames.filter((f) => f.from === newId);
  const room = summarizeFrames(frames);
  const toNew = summarizeFrames(received);
  results[label] = {
    grid: `${cols}x${rows}`,
    pieces: host.engine.pieces.length,
    piecesSnappedBeforeJoin: snapCount,
    joinToSyncMs: round(joinMs, 0),
    newGuestReceived: { messages: toNew.messages, bytes: toNew.bytes, byType: toNew.byType },
    newGuestSent: { messages: sent.length, bytes: summarizeFrames(sent).bytes },
    roomWideDuringJoin: { messages: room.messages, bytes: room.bytes, byType: room.byType },
  };
  closeAllSessions();
}

/** Physical interference on the host (pieces knocked off the board), host + 2 guests. */
async function scenarioPhysicalOjama(label, cols, rows) {
  const host = await startHost({ cols, rows });
  await joinGuest(host, 'ゲストA');
  await joinGuest(host, 'ゲストB');
  snapFirstPieces(host, 10);
  await sleep(SETTLE_MS * 2);
  results[label] = await measureOp(() => {
    const dropped = host.engine.dropLockedPieces(3, false);
    host.room.broadcastPhysicalOjama('measure', dropped);
    return { grid: `${cols}x${rows}`, pieces: host.engine.pieces.length, dropped: dropped.length };
  });
  closeAllSessions();
}

/** 4 players (host + 3 guests), each picks a random loose piece every second and drags it 10 steps. */
async function playerLoop(app, index, { seconds, t0, stats }) {
  const rng = seededRandom(7000 + index);
  for (let s = 0; s < seconds; s += 1) {
    await sleep(t0 + s * 1000 - performance.now());
    const loose = app.engine.pieces.filter((p) => !p.isLocked);
    const pool = loose.length > 0 ? loose : app.engine.pieces;
    const piece = pool[Math.floor(rng() * pool.length)];
    const dx = (rng() - 0.5) * 400;
    const dy = (rng() - 0.5) * 300;
    stats.attempts += 1;
    const outcome = await dragLikeCanvas(app, piece.id, { dx, dy, steps: 10 });
    if (outcome === 'denied') stats.denied += 1;
  }
}

async function scenarioFourPlayers(seconds) {
  const host = await startHost();
  const guests = [];
  for (const name of ['ゲストA', 'ゲストB', 'ゲストC']) {
    guests.push((await joinGuest(host, name)).guest);
  }
  await sleep(SETTLE_MS * 2);
  const players = [host, ...guests];
  const stats = { attempts: 0, denied: 0 };
  frames.length = 0;
  const t0 = performance.now();
  await Promise.all(players.map((app, i) => playerLoop(app, i, { seconds, t0, stats })));
  await sleep(SETTLE_MS * 2);
  const wallSec = (performance.now() - t0) / 1000;
  const total = summarizeFrames(frames);
  const topTypes = Object.entries(total.byType)
    .slice(0, 3)
    .map(([type, v]) => ({
      type,
      bytes: v.bytes,
      share: round((v.bytes / total.bytes) * 100, 1),
    }));
  results.e = {
    players: players.length,
    seconds: round(wallSec, 1),
    actions: stats.attempts,
    lockDenied: stats.denied,
    messages: total.messages,
    bytes: total.bytes,
    bytesPerPlayerPerMinute: round(total.bytes / players.length / (wallSec / 60), 0),
    byDirection: total.byDirection,
    topTypes,
    byType: total.byType,
    piecesLockedAtEnd: host.engine.pieces.filter((p) => p.isLocked).length,
  };
  closeAllSessions();
}

/* ---------- summary ---------- */

function buildSummary() {
  const lines = [];
  const { a, b, c, e } = results;
  lines.push(
    `drag 1 piece, 30 steps by a guest + drop: ${a.messages} msgs, ${kib(a.bytes)} ` +
      `(guest->host ${kib(a.byDirection['guest->host'].bytes)}, host->guest ${kib(a.byDirection['host->guest'].bytes)})`,
  );
  lines.push(
    `rotate by a guest: ${b.messages} msgs, ${b.bytes} B (applied: ${b.applied ? 'yes' : 'no'})`,
  );
  lines.push(
    `cursor moves, 1 s at 16 ms calls: ${c.messages} msgs (${c.messages} per s), ${c.bytes} B`,
  );
  for (const [key, label] of [
    ['d_small', 'late join, sample 4x3'],
    ['d_500', 'late join, ~500 pieces'],
    ['d_3000', 'late join, ~3000 pieces'],
  ]) {
    const d = results[key];
    if (d) {
      lines.push(
        `${label} (${d.pieces} pcs): new guest receives ${kib(d.newGuestReceived.bytes)} in ${d.newGuestReceived.messages} msgs, sync ${Math.round(d.joinToSyncMs)} ms`,
      );
    }
  }
  const f = results.f_3000;
  if (f) {
    lines.push(
      `drop ojama (${f.dropped} pcs) on ~3000 pieces, host + 2 guests: ${f.messages} msgs, ${kib(f.bytes)} sent by the host in total`,
    );
  }
  const top = e.topTypes.map((t) => `${t.type} ${t.share}%`).join(', ');
  lines.push(
    `4 players, ${e.seconds} s: ${kib(e.bytes)} total, ${kib(e.bytesPerPlayerPerMinute)}/player/min; top types by bytes: ${top}`,
  );
  return lines;
}

/* ---------- test entries ---------- */

it(
  'per-operation volume: one drag, one rotation, cursor movement',
  async () => {
    globalThis.BroadcastChannel.prototype.postMessage = countingPostMessage;
    try {
      await scenarioDrag();
      await scenarioRotation();
      await scenarioCursor();
    } finally {
      globalThis.BroadcastChannel.prototype.postMessage = originalPostMessage;
    }
  },
  SCENARIO_TIMEOUT_MS,
);

/** Grid sizes for the late-join runs: the sample-size grid, ~500 and ~3000 pieces on the sample aspect. */
const { SAMPLE_IMAGE_WIDTH: SAMPLE_W, SAMPLE_IMAGE_HEIGHT: SAMPLE_H } = PUZZLE_CONFIG;
const GRID_500 = computeGridForPieceCount(500, SAMPLE_W, SAMPLE_H);
const GRID_3000 = computeGridForPieceCount(PUZZLE_CONFIG.MAX_TOTAL_PIECES, SAMPLE_W, SAMPLE_H);

async function withCounter(fn) {
  globalThis.BroadcastChannel.prototype.postMessage = countingPostMessage;
  try {
    await fn();
  } finally {
    globalThis.BroadcastChannel.prototype.postMessage = originalPostMessage;
  }
}

it(
  'late join volume, sample-size grid',
  () => withCounter(() => scenarioLateJoin('d_small', SMALL_PUZZLE.cols, SMALL_PUZZLE.rows, 12)),
  SCENARIO_TIMEOUT_MS,
);

it(
  'late join volume, ~500 pieces',
  () =>
    withCounter(() =>
      scenarioLateJoin('d_500', GRID_500.cols, GRID_500.rows, GRID_500.cols * GRID_500.rows),
    ),
  SCENARIO_TIMEOUT_MS,
);

it(
  'late join volume, ~3000 pieces',
  () =>
    withCounter(() =>
      scenarioLateJoin('d_3000', GRID_3000.cols, GRID_3000.rows, GRID_3000.cols * GRID_3000.rows),
    ),
  SCENARIO_TIMEOUT_MS,
);

it(
  'physical interference volume, ~3000 pieces',
  () => withCounter(() => scenarioPhysicalOjama('f_3000', GRID_3000.cols, GRID_3000.rows)),
  SCENARIO_TIMEOUT_MS,
);

it(
  '4 players for 60 s, each dragging a random loose piece every second',
  async () => {
    globalThis.BroadcastChannel.prototype.postMessage = countingPostMessage;
    try {
      await scenarioFourPlayers(60);
    } finally {
      globalThis.BroadcastChannel.prototype.postMessage = originalPostMessage;
    }
    const summary = buildSummary();
    await writeResult({
      system: 'p2p',
      note: NOTE,
      summary,
      details: {
        grid: `${SMALL_PUZZLE.cols}x${SMALL_PUZZLE.rows} unless noted`,
        scenarios: {
          drag30Steps: results.a,
          rotation: results.b,
          cursor1s: results.c,
          lateJoin: { d_small: results.d_small, d_500: results.d_500, d_3000: results.d_3000 },
          physicalOjama3000: results.f_3000,
          fourPlayers60s: results.e,
        },
      },
    });
  },
  SCENARIO_TIMEOUT_MS,
);
