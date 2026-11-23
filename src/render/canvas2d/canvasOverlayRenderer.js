import { VIEWPORT_CONFIG } from '../../config/constants.js';
import { deskTexturePattern } from '../deskTextures.js';
import { referenceModeOf, refSheetFrame } from '../viewState.js';

/**
 * Draws board overlays: desk grid, flipped backs, reference sheet, zone labels, lock badges, cursors.
 */

export function drawDeskBackground(ctx, { rect, view, pal }) {
  ctx.save();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  let gridStep = VIEWPORT_CONFIG.DESK_GRID_STEP * view.scale;
  while (gridStep > 0 && gridStep < 22) {
    gridStep *= 2;
  }

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

/*
 * Board frames a player can choose (settings.boardStyle; 'classic' is drawn in drawBoardFrame).
 * Each draws the frame, the paper, then the
 * underlay and cell lines, and any shading over the paper. Shadow sizes are in screen pixels
 * times `dpr`: the canvas transform does not apply to them.
 */

/** The board's corners and the frame width, in world units. */
function boardBox(engine) {
  const w = engine.boardW;
  const h = engine.boardH;
  const rim = Math.max(Math.min(engine.pieceW, engine.pieceH) * 0.18, Math.min(w, h) * 0.018);
  return { x: -w / 2, y: -h / 2, w, h, rim };
}

function fillPolygon(ctx, pts, style) {
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fill();
}

/** A box grown by `d` on every side. */
function grow(b, d) {
  return { x: b.x - d, y: b.y - d, w: b.w + d * 2, h: b.h + d * 2 };
}

/** The four sides of a frame between box `inner` and box `outer`, as polygons (mitred corners). */
function frameSides(inner, outer) {
  const [l, t, r, bt] = [outer.x, outer.y, outer.x + outer.w, outer.y + outer.h];
  const [il, it, ir, ib] = [inner.x, inner.y, inner.x + inner.w, inner.y + inner.h];
  return {
    top: [l, t, r, t, ir, it, il, it],
    left: [l, t, il, it, il, ib, l, bt],
    bottom: [l, bt, r, bt, ir, ib, il, ib],
    right: [r, t, r, bt, ir, ib, ir, it],
  };
}

function dropShadow(ctx, f, draw, { blur = 18, dx = 3, dy = 8, alpha = 0.4 } = {}) {
  ctx.save();
  ctx.shadowColor = f.isDark ? `rgba(0, 0, 0, ${alpha + 0.2})` : `rgba(40, 28, 16, ${alpha})`;
  ctx.shadowBlur = blur * f.dpr;
  ctx.shadowOffsetX = dx * f.dpr;
  ctx.shadowOffsetY = dy * f.dpr;
  draw();
  ctx.restore();
}

/** A soft shadow cast inside the box from its top and left edges (a recess). */
function innerShadow(ctx, box, f, { alpha = 0.3, blur = 6, dx = 2, dy = 3 } = {}) {
  const lw = 40 / f.scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.shadowColor = `rgba(20, 14, 8, ${alpha})`;
  ctx.shadowBlur = blur * f.dpr;
  ctx.shadowOffsetX = dx * f.dpr;
  ctx.shadowOffsetY = dy * f.dpr;
  ctx.lineWidth = lw;
  ctx.strokeStyle = '#000';
  // The stroke lies just outside the clip: only its shadow shows, inside.
  const out = grow(box, lw / 2);
  ctx.strokeRect(out.x, out.y, out.w, out.h);
  ctx.restore();
}

/** A rectangle outline drawn just inside the box, `px` screen pixels wide. */
function strokeInside(ctx, box, f, color, px = 1) {
  const lw = px / f.scale;
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  const r = grow(box, -lw / 2);
  ctx.strokeRect(r.x, r.y, r.w, r.h);
}

const PAPER_GRID = 'rgba(15, 23, 42, 0.1)';

function drawPaper(ctx, b, f) {
  ctx.fillStyle = f.pal.boardPaper;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  drawUnderlayAndGrid(ctx, { ...f, gridColor: PAPER_GRID });
}

/** A wooden picture frame: dark wood with the grain along each bar, mitred corners. */
function drawWoodFrame(ctx, f) {
  const b = boardBox(f.engine);
  const band = b.rim * 1.1;
  const outer = grow(b, band);
  const sides = frameSides(b, outer);
  dropShadow(ctx, f, () => {
    ctx.fillStyle = '#3b1c12';
    ctx.fillRect(outer.x, outer.y, outer.w, outer.h);
  });
  const pattern = deskTexturePattern(ctx, 'wood-a', f.requestRender);
  const k = (band * 7) / 512;
  for (const [name, turn] of [
    ['top', true],
    ['bottom', true],
    ['left', false],
    ['right', false],
  ]) {
    // The texture's grain runs up and down: turn it along the top and bottom bars.
    if (pattern) {
      pattern.setTransform(new DOMMatrix(turn ? [0, k, -k, 0, 0, 0] : [k, 0, 0, k, 0, 0]));
    }
    fillPolygon(ctx, sides[name], pattern || '#4a2618');
  }
  // Light from the top left: lit top and left bars, shaded bottom and right ones.
  fillPolygon(ctx, sides.top, 'rgba(255, 236, 210, 0.16)');
  fillPolygon(ctx, sides.left, 'rgba(255, 236, 210, 0.1)');
  fillPolygon(ctx, sides.bottom, 'rgba(0, 0, 0, 0.28)');
  fillPolygon(ctx, sides.right, 'rgba(0, 0, 0, 0.2)');
  // Mitre joints, and a light outer edge.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 1 / f.scale;
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of [
    [outer.x, outer.y, b.x, b.y],
    [outer.x + outer.w, outer.y, b.x + b.w, b.y],
    [outer.x, outer.y + outer.h, b.x, b.y + b.h],
    [outer.x + outer.w, outer.y + outer.h, b.x + b.w, b.y + b.h],
  ]) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
  strokeInside(ctx, outer, f, 'rgba(255, 230, 200, 0.28)');
  drawPaper(ctx, b, f);
  innerShadow(ctx, b, f, { alpha: 0.38, blur: 7, dx: 2, dy: 3 });
}

/** A cardboard puzzle tray: a rounded, softly shaded rim and the paper sunk into it. */
function drawTray(ctx, f) {
  const { scale, isDark } = f;
  const b = boardBox(f.engine);
  const outer = grow(b, b.rim * 0.85);
  const radius = b.rim * 0.75;
  const grad = ctx.createLinearGradient(0, outer.y, 0, outer.y + outer.h);
  grad.addColorStop(0, isDark ? '#bdb7ab' : '#f6f1e7');
  grad.addColorStop(1, isDark ? '#a29b8e' : '#e2d9c8');
  dropShadow(
    ctx,
    f,
    () => {
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(outer.x, outer.y, outer.w, outer.h, radius);
      ctx.fill();
    },
    { blur: 22, dx: 2, dy: 10, alpha: 0.32 },
  );
  // A thin light edge round the top of the rim.
  const lip = grow(outer, -0.6 / scale);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 1.2 / scale;
  ctx.beginPath();
  ctx.roundRect(lip.x, lip.y, lip.w, lip.h, radius);
  ctx.stroke();
  drawPaper(ctx, b, f);
  innerShadow(ctx, b, f, { alpha: 0.3, blur: 8, dx: 1.5, dy: 3 });
  // The lower and right edges of the recess catch the light.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  ctx.moveTo(b.x + b.w, b.y);
  ctx.lineTo(b.x + b.w, b.y + b.h);
  ctx.lineTo(b.x, b.y + b.h);
  ctx.stroke();
}

/** A thin dark frame with a wide white mat, like a framed print. */
function drawGalleryFrame(ctx, f) {
  const { isDark } = f;
  const b = boardBox(f.engine);
  const matBox = grow(b, b.rim * 1.3);
  const outer = grow(matBox, b.rim * 0.5);
  const frameGrad = ctx.createLinearGradient(
    outer.x,
    outer.y,
    outer.x + outer.w,
    outer.y + outer.h,
  );
  frameGrad.addColorStop(0, '#4a4139');
  frameGrad.addColorStop(1, '#1f1b18');
  dropShadow(ctx, f, () => {
    ctx.fillStyle = frameGrad;
    ctx.fillRect(outer.x, outer.y, outer.w, outer.h);
  });
  strokeInside(ctx, outer, f, 'rgba(255, 255, 255, 0.22)');
  ctx.fillStyle = isDark ? '#dad6ce' : '#fbfaf6';
  ctx.fillRect(matBox.x, matBox.y, matBox.w, matBox.h);
  innerShadow(ctx, matBox, f, { alpha: 0.3, blur: 5, dx: 1.5, dy: 2 });
  drawPaper(ctx, b, f);
  // The mat's bevelled cut: a light band, and a fine shadow where it meets the paper.
  const cut = Math.max(1 / f.scale, b.rim * 0.12);
  const bevel = grow(b, cut / 2);
  ctx.lineWidth = cut;
  ctx.strokeStyle = isDark ? '#ece9e2' : '#ffffff';
  ctx.strokeRect(bevel.x, bevel.y, bevel.w, bevel.h);
  ctx.lineWidth = 1 / f.scale;
  ctx.strokeStyle = 'rgba(30, 24, 18, 0.3)';
  ctx.strokeRect(b.x, b.y, b.w, b.h);
}

const BOARD_STYLES = {
  wood: drawWoodFrame,
  tray: drawTray,
  gallery: drawGalleryFrame,
};

export function drawBoardFrame(
  ctx,
  { engine, scale, settings, isDark, pal, board, dpr = 1, requestRender = null },
) {
  const bx = -engine.boardW / 2;
  const by = -engine.boardH / 2;
  const shadowOffset = 6 / scale;

  ctx.save();
  const style = BOARD_STYLES[board];
  if (style) {
    style(ctx, { engine, scale, settings, isDark, pal, dpr, requestRender });
    ctx.restore();
    return;
  }
  ctx.fillStyle = isDark ? 'rgba(0, 0, 0, 0.38)' : 'rgba(15, 23, 42, 0.08)';
  ctx.fillRect(bx + shadowOffset, by + shadowOffset, engine.boardW, engine.boardH);

  ctx.fillStyle = pal.boardBg;
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = 2.2 / scale;
  ctx.beginPath();
  ctx.rect(bx, by, engine.boardW, engine.boardH);
  ctx.fill();
  ctx.stroke();
  drawUnderlayAndGrid(ctx, { engine, scale, settings, gridColor: pal.cellGrid });
  ctx.restore();
}

/** The faint reference image (underlay mode) and the cell lines on the board. */
function drawUnderlayAndGrid(ctx, { engine, scale, settings, gridColor }) {
  const bx = -engine.boardW / 2;
  const by = -engine.boardH / 2;
  if (
    referenceModeOf(settings) === 'underlay' &&
    settings.guideOpacity > 0 &&
    engine.sourceCanvas?.width > 0 &&
    engine.sourceCanvas?.height > 0
  ) {
    ctx.globalAlpha = settings.guideOpacity / 100;
    ctx.drawImage(engine.sourceCanvas, bx, by, engine.boardW, engine.boardH);
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  for (let c = 1; c < engine.cols; c++) {
    const gx = bx + c * engine.pieceW;
    ctx.moveTo(gx, by);
    ctx.lineTo(gx, by + engine.boardH);
  }
  for (let r = 1; r < engine.rows; r++) {
    const gy = by + r * engine.pieceH;
    ctx.moveTo(bx, gy);
    ctx.lineTo(bx + engine.boardW, gy);
  }
  ctx.stroke();
}

export function drawReferenceSheet(ctx, { settings, sourceCanvas, refSheet, pal }) {
  if (
    referenceModeOf(settings) !== 'sheet' ||
    !sourceCanvas ||
    sourceCanvas.width <= 0 ||
    sourceCanvas.height <= 0
  ) {
    return;
  }
  const x = refSheet.x - refSheet.w / 2;
  const y = refSheet.y - refSheet.h / 2;
  const { k, pad, header, font, radius } = refSheetFrame(refSheet);
  const paperW = refSheet.w + pad * 2;
  const paperH = refSheet.h + pad * 2 + header;

  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.16)';
  ctx.beginPath();
  ctx.roundRect(x - pad + 5 * k, y - pad - header + 6 * k, paperW, paperH, radius);
  ctx.fill();

  ctx.fillStyle = pal.sheetBg;
  ctx.strokeStyle = pal.borderStrong;
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath();
  ctx.roundRect(x - pad, y - pad - header, paperW, paperH, radius);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = pal.sheetText;
  ctx.font = `bold ${font}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('お手本シート（ドラッグ移動可）', x, y - 13 * k);

  ctx.drawImage(sourceCanvas, x, y, refSheet.w, refSheet.h);
  ctx.strokeStyle = pal.borderStrong;
  ctx.lineWidth = k;
  ctx.strokeRect(x, y, refSheet.w, refSheet.h);
  ctx.restore();
}

export function drawZoneLabels(ctx, zoneLabels, pal, scale = 1) {
  if (!zoneLabels || zoneLabels.length === 0) return;
  const fontSize = Math.min(84, Math.max(13, Math.round(13 / Math.max(0.06, scale))));
  const padX = Math.round(fontSize * 1.4);
  const pillH = Math.round(fontSize * 1.85);
  const radius = Math.round(pillH / 2);
  const borderW = Math.max(1.5, Math.min(8, 1.5 / Math.max(0.06, scale)));

  ctx.save();
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const lbl of zoneLabels) {
    const w = ctx.measureText(lbl.text).width + padX;
    ctx.fillStyle = pal.surface;
    ctx.beginPath();
    ctx.roundRect(lbl.x - w / 2, lbl.y - pillH / 2, w, pillH, radius);
    ctx.fill();
    ctx.strokeStyle = lbl.color || pal.borderStrong;
    ctx.lineWidth = borderW;
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

function drawCursor(ctx, { x, y, name, color, scale }) {
  ctx.save();
  ctx.translate(x, y);
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

export function drawAllCursors(ctx, { room, scale, pal }) {
  if (!room?.isMultiplayer()) return;
  for (const cur of room.remoteCursors.values()) {
    drawCursor(ctx, {
      x: cur.x,
      y: cur.y,
      name: cur.name,
      color: resolvePlayerColor(cur.color, pal),
      scale,
    });
  }
}
