/**
 * Scenes for the render bench. Each scene moves pieces through the engine's public methods,
 * the way play or interference would, so every renderer redraws the same thing.
 * `s` is the scene state: { engine, view, overlay, setDragging, worldToScreen, rng, pieceCanvas }.
 */

/** Loose pieces that are alone in their group, in a stable order. */
function looseSingles(engine) {
  const counts = engine.getGroupCounts();
  return engine.pieces.filter((p) => !p.isLocked && counts.get(p.groupId) === 1);
}

function moveTo(engine, piece, x, y) {
  engine.moveGroup(piece.groupId, x - piece.x, y - piece.y);
}

/** Pieces that orbit around where they started, like players dragging them around. */
function orbitSetup(s, count) {
  const singles = looseSingles(s.engine);
  s.orbit = singles.slice(0, count).map((piece, i) => ({
    piece,
    cx: piece.x,
    cy: piece.y,
    phase: (i * Math.PI * 2) / count,
  }));
  s.engine.bringGroupToFront(s.orbit[0].piece.groupId);
  s.setDragging(s.orbit[0].piece.groupId);
}

function orbitStep(s, t) {
  const radius = s.engine.pieceW * 3;
  for (const o of s.orbit) {
    const a = t * 2 + o.phase;
    moveTo(s.engine, o.piece, o.cx + Math.cos(a) * radius, o.cy + Math.sin(a) * radius);
  }
}

/** Every 0.25 s four pieces hop away; each hop takes 0.3 s ("pieces run away"). */
function fleeStep(s, t) {
  const { engine } = s;
  if (t >= s.nextHopAt) {
    s.nextHopAt = t + 0.25;
    const singles = looseSingles(engine);
    for (let i = 0; i < 4; i++) {
      const piece = singles[Math.floor(s.rng() * singles.length)];
      const angle = s.rng() * Math.PI * 2;
      const dist = engine.pieceW * (1.5 + s.rng() * 1.5);
      s.hops.push({
        piece,
        t0: t,
        x0: piece.x,
        y0: piece.y,
        x1: piece.x + Math.cos(angle) * dist,
        y1: piece.y + Math.sin(angle) * dist,
      });
      engine.bringGroupToFront(piece.groupId);
    }
  }
  s.hops = s.hops.filter((h) => {
    const k = Math.min(1, (t - h.t0) / 0.3);
    const ease = 1 - (1 - k) * (1 - k);
    moveTo(engine, h.piece, h.x0 + (h.x1 - h.x0) * ease, h.y0 + (h.y1 - h.y0) * ease);
    return k < 1;
  });
}

/** The cursor circles; the heavy piece follows it with a lag and a line shows the link. */
function heavyStep(s, t, dt) {
  const { engine } = s;
  const o = s.orbit[0];
  const radius = engine.pieceW * 4;
  const cursor = { x: o.cx + Math.cos(t * 2) * radius, y: o.cy + Math.sin(t * 2) * radius };
  const follow = 1 - Math.exp(-dt * 4);
  moveTo(
    engine,
    o.piece,
    o.piece.x + (cursor.x - o.piece.x) * follow,
    o.piece.y + (cursor.y - o.piece.y) * follow,
  );
  const a = s.worldToScreen(cursor.x, cursor.y);
  const b = s.worldToScreen(o.piece.x, o.piece.y);
  s.overlay.setLine({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
}

/** Remembers the fitted view and centres on a loose piece; teardown restores the view. */
function zoomSetup(s) {
  s.savedView = { ...s.view };
  const piece = looseSingles(s.engine)[0];
  s.zoomCenter = { x: piece.x, y: piece.y };
}

function restoreView(s) {
  Object.assign(s.view, s.savedView);
}

/** Wheel-like zooming in and out between the fitted scale and 6x it, once every 2 s. */
function zoomStep(s, t) {
  const k = (1 - Math.cos(t * Math.PI)) / 2;
  const scale = s.savedView.scale * (1 + 5 * k);
  Object.assign(s.view, {
    scale,
    x: s.savedView.x + (s.zoomCenter.x - s.savedView.x) * k,
    y: s.savedView.y + (s.zoomCenter.y - s.savedView.y) * k,
  });
}

export const SCENES = [
  {
    id: 'redraw',
    label: '再描画のみ（何も動かない状態で毎フレーム描く）',
    setup() {},
    step() {},
  },
  {
    id: 'drag1',
    label: '自分が1個ドラッグ',
    setup: (s) => orbitSetup(s, 1),
    step: orbitStep,
  },
  {
    id: 'drag4',
    label: '4人が同時にドラッグ（他人の分は補間と同じく毎フレーム動く）',
    setup: (s) => orbitSetup(s, 4),
    step: orbitStep,
  },
  {
    id: 'zoom',
    label: '拡大縮小を繰り返す（全体表示 ⇔ 6倍）',
    setup: zoomSetup,
    step: zoomStep,
    teardown: restoreView,
  },
  {
    id: 'zoomDrag',
    label: '3倍に拡大してドラッグ',
    setup(s) {
      zoomSetup(s);
      orbitSetup(s, 1);
      Object.assign(s.view, { scale: s.savedView.scale * 3, x: s.zoomCenter.x, y: s.zoomCenter.y });
    },
    step: orbitStep,
    teardown: restoreView,
  },
  {
    id: 'flee',
    label: '逃げる（0.25秒ごとに4個が跳ねる）',
    setup(s) {
      s.hops = [];
      s.nextHopAt = 0;
    },
    step: fleeStep,
  },
  {
    id: 'heavy',
    label: '重い（遅れて追うドラッグ＋つながりの線）',
    setup: (s) => orbitSetup(s, 1),
    step: heavyStep,
  },
  {
    id: 'particles150',
    label: 'ドラッグ＋粒子150個（紙吹雪程度）',
    setup(s) {
      orbitSetup(s, 1);
      s.overlay.setParticleCount(150);
    },
    step: orbitStep,
  },
  {
    id: 'particles1500',
    label: 'ドラッグ＋粒子1500個（爆発の連続程度）',
    setup(s) {
      orbitSetup(s, 1);
      s.overlay.setParticleCount(1500);
    },
    step: orbitStep,
  },
  {
    id: 'filter',
    label: 'ドラッグ＋色の妨害（CSSフィルター）',
    setup(s) {
      orbitSetup(s, 1);
      s.pieceCanvas.classList.add('sabotage-hue');
    },
    step: orbitStep,
  },
];
