import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MSG } from '../../src/net/protocol.js';
import { RunawayHost } from '../../src/net/runawayHost.js';
import { dropNearTarget } from '../helpers/coreEngine.js';
import { createFakeHost } from '../helpers/fakeHost.js';

// The host's rules for the runaway ojama: when a grab makes a group hop away and when a held
// group slips out of the hand. Where it hops is covered in tests/core/runawayOps.node.test.js.

const RULES = { chance: 0.3, gripMinSec: 3, gripMaxSec: 6 };

/** random() returning the given values in turn, then the last one again. */
function sequence(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

function setup(random = () => 0.5) {
  const host = createFakeHost();
  const runaway = new RunawayHost(host.room, random);
  const engine = host.room.engine;
  return { ...host, engine, runaway, gid: engine.pieces[0].groupId };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RunawayHost', () => {
  it('lets everything be grabbed while the rules are off', () => {
    const { runaway, gid, broadcasts } = setup();
    expect(runaway.onGrab(gid, 'g1')).toBe(false);
    expect(runaway.held.size).toBe(0);
    expect(broadcasts).toEqual([]);
  });

  it('makes the first grab hop, frees the group and tells everyone and this screen', () => {
    const { runaway, room, engine, gid, broadcasts, calls } = setup();
    runaway.set(RULES);
    room.groupLocks.set(gid, 'g1');
    const piece = engine.pieces[0];
    const before = { x: piece.x, y: piece.y };
    expect(runaway.onGrab(gid, 'g1', { x: piece.x - 1, y: piece.y })).toBe(true);
    expect(room.groupLocks.has(gid)).toBe(false);
    expect(broadcasts).toEqual([
      [
        {
          type: MSG.PIECE_HOP,
          groupId: gid,
          positions: [{ id: piece.id, x: piece.x, y: piece.y }],
          byPlayerId: 'g1',
        },
        undefined,
      ],
    ]);
    expect(calls.hops).toEqual([
      { groupId: gid, from: new Map([[piece.id, before]]), byPlayerId: 'g1' },
    ]);
    expect(Math.hypot(piece.x - before.x, piece.y - before.y)).toBeGreaterThan(0);
  });

  it('after the first, hops by chance and otherwise holds the group for a while', () => {
    // First grab hops (a hop draws 3 numbers); then 0.2 < 0.3 hops; then 0.9 holds.
    const { runaway, gid, broadcastsOf } = setup(
      sequence(0.5, 0.5, 0.5, 0.2, 0.5, 0.5, 0.5, 0.9, 0.5),
    );
    runaway.set(RULES);
    expect(runaway.onGrab(gid, 'g1')).toBe(true);
    expect(runaway.onGrab(gid, 'g1')).toBe(true);
    expect(runaway.onGrab(gid, 'g1')).toBe(false);
    expect(runaway.held.get(gid).playerId).toBe('g1');
    expect(broadcastsOf(MSG.PIECE_HOP)).toHaveLength(2);
  });

  it('makes a held group slip out after its grip time, if still held', () => {
    const { runaway, room, gid, broadcastsOf } = setup(sequence(0.9, 0.5));
    runaway.set(RULES);
    runaway.firstPending = false;
    room.groupLocks.set(gid, 'g1');
    runaway.onGrab(gid, 'g1');
    vi.advanceTimersByTime(4499);
    expect(broadcastsOf(MSG.PIECE_HOP)).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(broadcastsOf(MSG.PIECE_HOP)).toHaveLength(1);
    expect(runaway.held.size).toBe(0);
    expect(room.groupLocks.has(gid)).toBe(false);
  });

  it.each([
    ['dropped', (r) => r.runaway.onRelease(r.gid)],
    ['taken by someone else', (r) => r.room.groupLocks.set(r.gid, 'g2')],
    ['placed on the board', (r) => dropNearTarget(r.engine, r.engine.pieces[0])],
    ['no longer under the rules', (r) => r.runaway.set(null)],
  ])('does not slip out once %s', (_, change) => {
    const r = setup(sequence(0.9, 0.5));
    r.runaway.set(RULES);
    r.runaway.firstPending = false;
    r.room.groupLocks.set(r.gid, 'g1');
    r.runaway.onGrab(r.gid, 'g1');
    change(r);
    vi.advanceTimersByTime(10000);
    expect(r.broadcastsOf(MSG.PIECE_HOP)).toHaveLength(0);
  });

  it('slips out of a solo player hand without a lock table entry', () => {
    const r = setup(sequence(0.9, 0.5));
    r.room.role = 'solo';
    r.runaway.set(RULES);
    r.runaway.firstPending = false;
    r.runaway.onGrab(r.gid, 'solo');
    vi.advanceTimersByTime(4500);
    expect(r.calls.hops).toHaveLength(1);
  });

  it('leaves placed pieces and big groups alone', () => {
    const { runaway, engine, broadcasts } = setup();
    runaway.set(RULES);
    const [placed, ...rest] = engine.pieces;
    dropNearTarget(engine, placed);
    expect(runaway.onGrab(placed.groupId, 'g1')).toBe(false);
    for (const p of rest) p.groupId = rest[0].groupId;
    expect(runaway.onGrab(rest[0].groupId, 'g1')).toBe(false);
    expect(broadcasts).toEqual([]);
    expect(runaway.firstPending).toBe(true);
  });

  it('restarts the grip on a new grab and forgets everything when cleared', () => {
    const { runaway, gid, broadcastsOf } = setup(sequence(0.9, 0.5));
    runaway.set(RULES);
    runaway.firstPending = false;
    runaway.onGrab(gid, 'g1');
    runaway.onGrab(gid, 'g1');
    expect(runaway.held.size).toBe(1);
    runaway.clear();
    vi.advanceTimersByTime(10000);
    expect(runaway.held.size).toBe(0);
    expect(broadcastsOf(MSG.PIECE_HOP)).toHaveLength(0);
  });

  it('makes the first grab hop again after the rules are set anew', () => {
    const { runaway } = setup();
    runaway.set(RULES);
    expect(runaway.firstPending).toBe(true);
    runaway.set(null);
    expect([runaway.rules, runaway.firstPending]).toEqual([null, false]);
  });
});
