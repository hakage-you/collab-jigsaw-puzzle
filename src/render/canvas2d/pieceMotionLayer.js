import { PieceMotion } from '../effects/pieceMotion.js';

/**
 * Draws PieceMotion on the effects layer, in world space: a shadow under each hopping piece,
 * kick-off lines behind each hop, and the tether from a heavy piece to the cursor dragging it.
 * Line widths are in screen px, so they look the same at every zoom.
 */
export function drawPieceMotion(ctx, vs, pal) {
  const motion = vs.motion;
  if (!motion) return;
  const px = 1 / vs.camera.scale;
  const ink = pal.fx?.quiet || '#888780';

  for (const [id, o] of motion.offsets) {
    if (o.lift <= 0) continue;
    const p = vs.engine.getPieceById(id);
    if (!p) continue;
    const gx = p.x + o.dx;
    const gy = p.y + o.dy + o.lift + vs.engine.pieceH * 0.45;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = ink;
    ctx.beginPath();
    const w = vs.engine.pieceW * 0.45 * (1 - (o.lift / vs.engine.pieceH) * 0.5);
    ctx.ellipse(gx, gy, w, vs.engine.pieceH * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const k of motion.kicks) {
    const { alpha, out } = PieceMotion.kickPhase(k);
    const back = k.dir + Math.PI;
    const r0 = vs.engine.pieceW * (0.35 + out * 0.25);
    const r1 = r0 + vs.engine.pieceW * 0.25;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.5 * px;
    ctx.lineCap = 'round';
    for (const spread of [-0.5, 0, 0.5]) {
      const a = back + spread;
      ctx.beginPath();
      ctx.moveTo(k.x + Math.cos(a) * r0, k.y + Math.sin(a) * r0);
      ctx.lineTo(k.x + Math.cos(a) * r1, k.y + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }

  const t = motion.tether;
  if (t) {
    ctx.save();
    ctx.strokeStyle = pal.fx?.mischief || pal.accent;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.moveTo(t.from.x, t.from.y);
    ctx.lineTo(t.to.x, t.to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(t.to.x, t.to.y, 4 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
