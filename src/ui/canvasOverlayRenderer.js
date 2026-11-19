import { VIEWPORT_CONFIG } from '../config/constants.js';

/**
 * Draws board overlays: desk grid, flipped backs, reference sheet, zone labels, lock badges, cursors.
 */

export function drawDeskBackground(ctx, { rect, view, pal }) {
  ctx.save();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const gridStep = VIEWPORT_CONFIG.DESK_GRID_STEP * view.scale;

  if (gridStep >= 16) {
    const offsetX = (((cx - view.x * view.scale) % gridStep) + gridStep) % gridStep;
    const offsetY = (((cy - view.y * view.scale) % gridStep) + gridStep) % gridStep;
    ctx.strokeStyle = pal.deskGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = offsetX; x < rect.width; x += gridStep) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.height);
    }
    for (let y = offsetY; y < rect.height; y += gridStep) {
      ctx.moveTo(0, y);
      ctx.lineTo(rect.width, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function resolvePlayerColor(rawColor, pal) {
  if (!rawColor || rawColor === 'var(--accent)') return pal.accent;
  return rawColor;
}

export function drawReferenceSheet(ctx, { settings, sourceCanvas, refSheet, pal }) {
  if (
    (settings.referenceMode || 'underlay') !== 'sheet' ||
    !sourceCanvas ||
    sourceCanvas.width <= 0 ||
    sourceCanvas.height <= 0
  ) {
    return;
  }
  const x = refSheet.x - refSheet.w / 2;
  const y = refSheet.y - refSheet.h / 2;
  const pad = 10;

  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.16)';
  ctx.beginPath();
  ctx.roundRect(
    x - pad + 5,
    y - pad - 18 + 6,
    refSheet.w + pad * 2,
    refSheet.h + pad * 2 + 18,
    8
  );
  ctx.fill();

  ctx.fillStyle = pal.sheetBg;
  ctx.strokeStyle = pal.borderStrong;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - pad, y - pad - 18, refSheet.w + pad * 2, refSheet.h + pad * 2 + 18, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = pal.sheetText;
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('お手本シート（ドラッグ移動可）', x, y - 13);

  ctx.drawImage(sourceCanvas, x, y, refSheet.w, refSheet.h);
  ctx.strokeStyle = pal.borderStrong;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, refSheet.w, refSheet.h);
  ctx.restore();
}

export function drawZoneLabels(ctx, zoneLabels, pal) {
  if (!zoneLabels || zoneLabels.length === 0) return;
  ctx.save();
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const lbl of zoneLabels) {
    const w = ctx.measureText(lbl.text).width + 20;
    ctx.fillStyle = pal.surface;
    ctx.beginPath();
    ctx.roundRect(lbl.x - w / 2, lbl.y - 12, w, 24, 12);
    ctx.fill();
    ctx.strokeStyle = lbl.color || pal.borderStrong;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = pal.text;
    ctx.fillText(lbl.text, lbl.x, lbl.y + 1);
  }
  ctx.restore();
}

export function drawRemoteLockBadges(ctx, { room, engine, scale, pal }) {
  if (!room?.isMultiplayer()) return;
  ctx.save();
  for (const [groupId, ownerId] of room.groupLocks.entries()) {
    if (ownerId === room.myPlayerId) continue;
    const group = engine.getGroupPieces(groupId);
    if (group.length === 0) continue;
    const meta = room.getPlayerMeta(ownerId);
    const col = resolvePlayerColor(meta.color, pal);
    const topPiece = group.reduce((best, cur) => (cur.y < best.y ? cur : best), group[0]);

    ctx.font = `bold ${11 / scale}px sans-serif`;
    const tw = ctx.measureText(meta.name).width + 12 / scale;
    const pillH = 18 / scale;
    const px = topPiece.x - tw / 2;
    const py = topPiece.y - engine.pieceH * 0.65 - pillH;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect(px, py, tw, pillH, 9 / scale);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.name, topPiece.x, py + pillH / 2);
  }
  ctx.restore();
}

function drawCursor(ctx, cx, cy, name, color, scale) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.5 / scale;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 16 / scale);
  ctx.lineTo(5 / scale, 12 / scale);
  ctx.lineTo(11 / scale, 15 / scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.font = `bold ${11 / scale}px sans-serif`;
  const tw = ctx.measureText(name).width + 10 / scale;
  const pillH = 16 / scale;
  const px = 10 / scale;
  const py = 12 / scale;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(px, py, tw, pillH, 6 / scale);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, px + 5 / scale, py + pillH / 2);
  ctx.restore();
}

export function drawAllCursors(ctx, { now, room, engine, scale, getParticipantsState, pal }) {
  if (room?.isMultiplayer()) {
    for (const cur of room.remoteCursors.values()) {
      drawCursor(ctx, cur.x, cur.y, cur.name, resolvePlayerColor(cur.color, pal), scale);
    }
    return;
  }

  const { showDummyCursors, dummyParticipants } = getParticipantsState();
  if (!showDummyCursors || dummyParticipants.length === 0) return;

  const t = now * 0.0012;
  dummyParticipants.forEach((m, idx) => {
    const phase = t + idx * 1.9;
    const cx = Math.cos(phase * 0.8) * (engine.boardW * 0.42);
    const cy = Math.sin(phase * 1.1) * (engine.boardH * 0.42);
    drawCursor(ctx, cx, cy, m.name, m.color, scale);
  });
}
