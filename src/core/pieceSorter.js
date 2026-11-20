import { PUZZLE_CONFIG, COLOR_BUCKETS } from '../config/constants.js';

export function getSingleLoosePieces(engine, excludedGroupIds = null) {
  const counts = engine.getGroupCounts();
  return engine.pieces.filter(
    (p) =>
      !p.isLocked &&
      counts.get(p.groupId) === 1 &&
      (!excludedGroupIds || !excludedGroupIds.has(p.groupId)),
  );
}

function layoutGrid(
  engine,
  pieces,
  originX,
  originY,
  maxPerRow,
  stepX,
  stepY,
  alignRight = false,
  alignBottom = false,
) {
  if (pieces.length === 0) return;
  const colsUsed = Math.min(maxPerRow, pieces.length);
  const rowsUsed = Math.ceil(pieces.length / maxPerRow);
  const totalW = (colsUsed - 1) * stepX;
  const totalH = (rowsUsed - 1) * stepY;

  const startX = alignRight ? originX - totalW : originX;
  const startY = alignBottom ? originY - totalH : originY;

  pieces.forEach((p, idx) => {
    const c = idx % maxPerRow;
    const r = Math.floor(idx / maxPerRow);
    p.x = startX + c * stepX;
    p.y = startY + r * stepY;
    p.zOrder = engine.maxZ++;
  });
  engine.bumpZVersion();
}

export function sortEdgesPieces(engine, excludedGroupIds = null) {
  const singles = getSingleLoosePieces(engine, excludedGroupIds);
  const edges = singles.filter((p) => p.isEdge);
  const inner = singles.filter((p) => !p.isEdge);

  const stepX = engine.pieceW * PUZZLE_CONFIG.SORT_EDGE_STEP_RATIO;
  const stepY = engine.pieceH * PUZZLE_CONFIG.SORT_EDGE_STEP_RATIO;
  const maxCols = singles.length > 100 ? 40 : 10;
  const perRow = Math.max(4, Math.min(maxCols, Math.ceil(Math.sqrt(singles.length) * 1.3)));

  engine.zoneLabels = [];
  if (edges.length > 0) {
    const colsUsed = Math.min(perRow, edges.length);
    const rowsUsed = Math.ceil(edges.length / perRow);
    const startX = -((colsUsed - 1) * stepX) / 2;
    const bottomEdgeY = -engine.boardH / 2 - engine.pieceH * 1.05;
    const startY = bottomEdgeY - (rowsUsed - 1) * stepY;
    layoutGrid(engine, edges, startX, startY, perRow, stepX, stepY);
    engine.zoneLabels.push({
      text: `外枠ピース (${edges.length})`,
      x: 0,
      y: startY - engine.pieceH * 0.85,
    });
  }

  if (inner.length > 0) {
    const colsUsed = Math.min(perRow, inner.length);
    const startX = -((colsUsed - 1) * stepX) / 2;
    const startY = engine.boardH / 2 + engine.pieceH * 1.15;
    layoutGrid(engine, inner, startX, startY, perRow, stepX, stepY);
    engine.zoneLabels.push({
      text: `内側ピース (${inner.length})`,
      x: 0,
      y: startY - engine.pieceH * 0.72,
    });
  }

  return { total: singles.length, edges: edges.length, inner: inner.length };
}

export function sortByColorPieces(engine, excludedGroupIds = null) {
  const singles = getSingleLoosePieces(engine, excludedGroupIds);
  const groups = new Map();
  for (const b of COLOR_BUCKETS) {
    groups.set(b.id, []);
  }
  for (const p of singles) {
    const list = groups.get(p.colorInfo.bucket) || groups.get('neutral');
    list.push(p);
  }

  const activeBuckets = COLOR_BUCKETS.filter((b) => groups.get(b.id).length > 0);
  const stepX = engine.pieceW * PUZZLE_CONFIG.SORT_STEP_RATIO;
  const stepY = engine.pieceH * PUZZLE_CONFIG.SORT_STEP_RATIO;
  engine.zoneLabels = [];

  const padX = engine.boardW / 2 + engine.pieceW * 1.2;
  const padY = engine.boardH / 2 + engine.pieceH * 1.2;
  const anchors = [
    { x: -padX, y: -padY, alignR: true, alignB: true },
    { x: 0, y: -padY - engine.pieceH * 0.4, alignR: false, alignB: true, center: true },
    { x: padX, y: -padY, alignR: false, alignB: true },
    { x: padX, y: 0, alignR: false, alignB: false },
    { x: padX, y: padY, alignR: false, alignB: false },
    { x: 0, y: padY + engine.pieceH * 0.4, alignR: false, alignB: false, center: true },
    { x: -padX, y: padY, alignR: true, alignB: false },
  ];

  activeBuckets.forEach((b, idx) => {
    const list = groups.get(b.id);
    const anchor = anchors[idx % anchors.length];
    const perRow = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(list.length))));
    const colsUsed = Math.min(perRow, list.length);
    const rowsUsed = Math.ceil(list.length / perRow);

    let ox = anchor.x;
    if (anchor.center) ox -= ((colsUsed - 1) * stepX) / 2;
    layoutGrid(
      engine,
      list,
      ox,
      anchor.y,
      perRow,
      stepX,
      stepY,
      anchor.alignR && !anchor.center,
      anchor.alignB,
    );

    const labelX = anchor.center
      ? 0
      : anchor.alignR
        ? anchor.x - ((colsUsed - 1) * stepX) / 2
        : anchor.x + ((colsUsed - 1) * stepX) / 2;
    const topMostY = anchor.alignB ? anchor.y - (rowsUsed - 1) * stepY : anchor.y;
    engine.zoneLabels.push({
      text: `${b.label} (${list.length})`,
      x: labelX,
      y: topMostY - engine.pieceH * 0.78,
      color: b.swatch,
    });
  });

  return { total: singles.length, bucketCount: activeBuckets.length };
}

export function sortByQuadrantPieces(engine, excludedGroupIds = null) {
  const singles = getSingleLoosePieces(engine, excludedGroupIds);
  const quads = { NW: [], NE: [], SW: [], SE: [] };

  for (const p of singles) {
    const isLeft = p.col < engine.cols / 2;
    const isTop = p.row < engine.rows / 2;
    if (isTop && isLeft) quads.NW.push(p);
    else if (isTop && !isLeft) quads.NE.push(p);
    else if (!isTop && isLeft) quads.SW.push(p);
    else quads.SE.push(p);
  }

  const stepX = engine.pieceW * PUZZLE_CONFIG.SORT_QUADRANT_STEP_RATIO;
  const stepY = engine.pieceH * PUZZLE_CONFIG.SORT_QUADRANT_STEP_RATIO;
  const padX = engine.boardW / 2 + engine.pieceW * 1.1;
  const padY = engine.boardH / 2 + engine.pieceH * 0.65;
  engine.zoneLabels = [];

  const specs = [
    { key: 'NW', label: '左上エリア', x: -padX, y: -padY, alignR: true, alignB: true },
    { key: 'NE', label: '右上エリア', x: padX, y: -padY, alignR: false, alignB: true },
    { key: 'SW', label: '左下エリア', x: -padX, y: padY, alignR: true, alignB: false },
    { key: 'SE', label: '右下エリア', x: padX, y: padY, alignR: false, alignB: false },
  ];

  for (const s of specs) {
    const list = quads[s.key];
    if (list.length === 0) continue;
    const perRow = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(list.length))));
    const colsUsed = Math.min(perRow, list.length);
    const rowsUsed = Math.ceil(list.length / perRow);
    layoutGrid(engine, list, s.x, s.y, perRow, stepX, stepY, s.alignR, s.alignB);

    const labelX = s.alignR
      ? s.x - ((colsUsed - 1) * stepX) / 2
      : s.x + ((colsUsed - 1) * stepX) / 2;
    const topY = s.alignB ? s.y - (rowsUsed - 1) * stepY : s.y;
    engine.zoneLabels.push({
      text: `${s.label} (${list.length})`,
      x: labelX,
      y: topY - engine.pieceH * 0.78,
    });
  }

  return { total: singles.length };
}

export function alignAllUprightPieces(engine, excludedGroupIds = null) {
  let changed = 0;
  for (const p of engine.pieces) {
    if (
      !p.isLocked &&
      (!excludedGroupIds || !excludedGroupIds.has(p.groupId)) &&
      (p.rotation !== 0 || p.isFlipped)
    ) {
      p.rotation = 0;
      p.isFlipped = false;
      changed++;
    }
  }
  return changed;
}
