import { describe, expect, it } from 'vitest';
import { PieceMotion } from '../../src/render/effects/pieceMotion.js';
import { ViewState } from '../../src/render/viewState.js';

function createFakeEngine(count = 6) {
  const pieces = Array.from({ length: count }, (_, id) => ({
    id,
    groupId: id,
    x: (id % 3) * 120 - 120,
    y: Math.floor(id / 3) * 90 - 45,
    isLocked: false,
  }));
  return {
    pieces,
    pieceW: 100,
    pieceH: 80,
    boardW: 300,
    boardH: 160,
    spritePad: 20,
    getGroupPieces: (gid) => pieces.filter((p) => p.groupId === gid),
    getPieceById: (id) => pieces.find((p) => p.id === id) || null,
  };
}

describe('PieceMotion opening deal animation', () => {
  it('waits one frame, animates staggered drop with fade/scale, and finishes cleanly', () => {
    const engine = createFakeEngine(6);
    const motion = new PieceMotion();

    motion.playDeal(engine.pieces, engine.pieceW, engine.pieceH);
    expect(motion.deal).not.toBeNull();
    expect(motion.hasPieceMotion).toBe(true);

    // Frame 1: pendingFrames = 1 -> all items wait at alpha 0 above their spot
    expect(motion.step(1000, engine, 0.016)).toBe(true);
    expect(motion.deal.start).toBeNull();
    expect(motion.offsets.get(0).alpha).toBe(0);
    expect(motion.offsets.get(0).dy).toBeLessThan(0);

    // Frame 2: start is anchored
    motion.step(1016, engine, 0.016);
    expect(motion.deal.start).toBe(1016);

    // Mid-flight: at least one piece is dropping with partial alpha and scale > 1
    motion.step(1016 + 150, engine, 0.016);
    const activeOffsets = [...motion.offsets.values()].filter((o) => o.alpha > 0 && o.alpha <= 1);
    expect(activeOffsets.length).toBeGreaterThan(0);
    expect(activeOffsets[0].dy).toBeLessThan(0);
    expect(activeOffsets[0].scale).toBeGreaterThan(1);

    // Past endMs: deal clears and offsets become empty
    const doneAt = 1016 + motion.deal.endMs + 10;
    expect(motion.step(doneAt, engine, 0.016)).toBe(false);
    expect(motion.deal).toBeNull();
    expect(motion.offsets.size).toBe(0);
  });

  it('cancels immediately when cancelDeal is called', () => {
    const engine = createFakeEngine(4);
    const motion = new PieceMotion();
    motion.playDeal(engine.pieces, engine.pieceW, engine.pieceH);
    motion.step(100, engine, 0.016);
    expect(motion.offsets.size).toBe(4);

    motion.cancelDeal();
    expect(motion.deal).toBeNull();
    expect(motion.hasPieceMotion).toBe(false);
    expect(motion.offsets.size).toBe(0);
  });

  it('skips opening deal animation when ViewState effectIntensity is reduced or off', () => {
    const engine = createFakeEngine(4);
    const vs = new ViewState({
      getViewportSize: () => ({ width: 800, height: 600 }),
      engine,
      getSettings: () => ({}),
    });

    vs.effectIntensity = 'reduced';
    expect(vs.playDealAnimation()).toBe(false);
    expect(vs.motion.deal).toBeNull();

    vs.effectIntensity = 'off';
    expect(vs.playDealAnimation()).toBe(false);
    expect(vs.motion.deal).toBeNull();

    vs.effectIntensity = 'normal';
    expect(vs.playDealAnimation()).toBe(true);
    expect(vs.motion.deal).not.toBeNull();
  });
});

describe('ViewState ephemeral sort zone labels', () => {
  it('holds for 5s, fades over 1s, re-shows on re-sort, and clears on completion or reduced mode', () => {
    let completed = false;
    const engine = {
      ...createFakeEngine(2),
      zoneLabels: [{ text: '左上エリア (2)', x: -100, y: -100 }],
      isCompleted: () => completed,
    };
    const vs = new ViewState({
      getViewportSize: () => ({ width: 800, height: 600 }),
      engine,
      getSettings: () => ({}),
    });

    vs.stepZoneLabels(1000);
    expect(vs.zoneLabelAlpha).toBe(1);

    vs.stepZoneLabels(5900);
    expect(vs.zoneLabelAlpha).toBe(1);

    vs.stepZoneLabels(6500);
    expect(vs.zoneLabelAlpha).toBeCloseTo(0.5, 2);

    vs.stepZoneLabels(7100);
    expect(vs.zoneLabelAlpha).toBe(0);

    // Re-sort replaces zoneLabels array reference -> shows again at 1
    engine.zoneLabels = [{ text: '右上エリア (2)', x: 100, y: -100 }];
    vs.stepZoneLabels(7200);
    expect(vs.zoneLabelAlpha).toBe(1);

    // Reduced intensity drops immediately after 5s hold without fading
    vs.effectIntensity = 'reduced';
    vs.stepZoneLabels(12300);
    expect(vs.zoneLabelAlpha).toBe(0);

    // Completion hides immediately
    vs.effectIntensity = 'normal';
    engine.zoneLabels = [{ text: '外枠ピース (2)', x: 0, y: 0 }];
    vs.stepZoneLabels(13000);
    expect(vs.zoneLabelAlpha).toBe(1);
    completed = true;
    vs.stepZoneLabels(13100);
    expect(vs.zoneLabelAlpha).toBe(0);
  });
});
