import { VIEWPORT_CONFIG } from '../config/constants.js';
import {
  drawAllCursors,
  drawDeskBackground,
  drawReferenceSheet,
  drawRemoteLockBadges,
  drawZoneLabels,
  resolvePlayerColor,
} from './canvasOverlayRenderer.js';

export class CanvasRenderer {
  constructor({ canvasStage = null, canvas = null, engine, room, getSettings, getParticipantsState }) {
    this.canvasStage = canvasStage || document.getElementById('canvasStage');
    this.canvas = canvas || document.getElementById('puzzleCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.engine = engine;
    this.room = room;
    this.getSettings = getSettings;
    this.getParticipantsState = getParticipantsState;

    this.view = {
      x: 0,
      y: 0,
      scale: VIEWPORT_CONFIG.DEFAULT_SCALE,
    };

    this.refSheet = {
      x: -520,
      y: -40,
      w: 280,
      h: 186,
    };

    this.hoveredPiece = null;
    this.draggingGroupId = null;
    this.highlightFilter = 'all';
    this.snapFlashes = [];
    this.confetti = [];
    this.needsRender = true;
    this.postRenderCallbacks = [];
    this.lastFrameTime = performance.now();
    this._paletteCache = { key: null, palette: null };
    this._lockedCache = {
      key: null,
      canvas: document.createElement('canvas'),
      hasLocked: false,
      logicalW: 0,
      logicalH: 0,
      offsetX: 0,
      offsetY: 0,
    };
  }

  afterNextRender(callback) {
    if (typeof callback === 'function') {
      this.postRenderCallbacks.push(callback);
      this.needsRender = true;
    }
  }

  requestRender() {
    this.needsRender = true;
  }

  screenToWorld(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    return {
      x: (sx - cx) / this.view.scale + this.view.x,
      y: (sy - cy) / this.view.scale + this.view.y,
    };
  }

  fitView() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const totalSpanW = this.engine.boardW + this.engine.pieceW * 7.5;
    const totalSpanH = this.engine.boardH + this.engine.pieceH * 6.5;
    const s = Math.min(rect.width / totalSpanW, rect.height / totalSpanH);
    this.view.scale = Math.max(0.28, Math.min(1.4, s));
    this.view.x = 0;
    this.view.y = 0;
    this.needsRender = true;
  }

  resetRefSheetGeometry(sourceCanvas) {
    const aspect = sourceCanvas.height / Math.max(1, sourceCanvas.width);
    this.refSheet.w = Math.round(this.engine.boardW * 0.44);
    this.refSheet.h = Math.round(this.refSheet.w * aspect);
    this.refSheet.x =
      -this.engine.boardW / 2 -
      this.refSheet.w / 2 -
      Math.max(60, this.engine.pieceW * 1.1);
    this.refSheet.y = 0;
  }

  isPointInRefSheet(wx, wy) {
    const settings = this.getSettings();
    if ((settings.referenceMode || 'underlay') !== 'sheet') return false;
    return (
      wx >= this.refSheet.x - this.refSheet.w / 2 - 10 &&
      wx <= this.refSheet.x + this.refSheet.w / 2 + 10 &&
      wy >= this.refSheet.y - this.refSheet.h / 2 - 28 &&
      wy <= this.refSheet.y + this.refSheet.h / 2 + 10
    );
  }

  addSnapFlashes(pieces) {
    for (const sp of pieces) {
      this.snapFlashes.push({
        x: sp.x,
        y: sp.y,
        w: this.engine.pieceW,
        h: this.engine.pieceH,
        alpha: 0.9,
      });
    }
    this.needsRender = true;
  }

  _getThemePalette() {
    const themeKey = document.documentElement.getAttribute('data-theme') || 'light';
    if (this._paletteCache.key === themeKey && this._paletteCache.palette) {
      return this._paletteCache.palette;
    }
    const cs = getComputedStyle(document.documentElement);
    const read = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    const palette = {
      accent: read('--accent', '#1565c0'),
      secondary: read('--secondary', '#6d28d9'),
      success: read('--success', '#166534'),
      warning: read('--warning', '#92400e'),
      danger: read('--danger', '#c62828'),
      surface: read('--surface', '#ffffff'),
      text: read('--text', '#0f172a'),
      borderStrong: read('--border-strong', '#64748b'),
      boardBg: read('--canvas-board-bg', 'rgb(255 255 255 / 92%)'),
      deskGrid: read('--canvas-grid', 'rgb(15 23 42 / 6%)'),
      cellGrid: read('--canvas-cell-grid', 'rgb(15 23 42 / 12%)'),
      sheetBg: read('--canvas-sheet-bg', '#f8fafc'),
      sheetText: read('--canvas-sheet-text', '#1e293b'),
    };
    this._paletteCache = { key: themeKey, palette };
    return palette;
  }

  launchConfetti() {
    const rect = this.canvasStage.getBoundingClientRect();
    const pal = this._getThemePalette();
    const colors = [pal.accent, pal.secondary, pal.success, pal.warning, pal.danger];
    for (let i = 0; i < 90; i++) {
      this.confetti.push({
        x: Math.random() * rect.width,
        y: -10 - Math.random() * 80,
        vx: (Math.random() - 0.5) * 5,
        vy: 2 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.2,
        size: 7 + Math.random() * 6,
        color: colors[i % colors.length],
      });
    }
    this.needsRender = true;
  }

  clearEffects() {
    this.confetti = [];
    this.snapFlashes = [];
    this.needsRender = true;
  }

  resizeCanvas() {
    const rect = this.canvasStage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.max(1, Math.floor(rect.width * dpr));
    const targetH = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      this.needsRender = true;
    }
  }

  _drawDeskBackground(rect, pal) {
    drawDeskBackground(this.ctx, { rect, view: this.view, pal });
  }

  _drawBoardFrame(settings, isDark, pal) {
    const ctx = this.ctx;
    const bx = -this.engine.boardW / 2;
    const by = -this.engine.boardH / 2;
    const shadowOffset = 6 / this.view.scale;

    ctx.save();
    ctx.fillStyle = isDark ? 'rgba(0, 0, 0, 0.38)' : 'rgba(15, 23, 42, 0.08)';
    ctx.fillRect(bx + shadowOffset, by + shadowOffset, this.engine.boardW, this.engine.boardH);

    ctx.fillStyle = pal.boardBg;
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 2.2 / this.view.scale;
    ctx.beginPath();
    ctx.rect(bx, by, this.engine.boardW, this.engine.boardH);
    ctx.fill();
    ctx.stroke();

    if (
      (settings.referenceMode || 'underlay') === 'underlay' &&
      settings.guideOpacity > 0 &&
      this.engine.sourceCanvas &&
      this.engine.sourceCanvas.width > 0 &&
      this.engine.sourceCanvas.height > 0
    ) {
      ctx.globalAlpha = settings.guideOpacity / 100;
      ctx.drawImage(this.engine.sourceCanvas, bx, by, this.engine.boardW, this.engine.boardH);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = pal.cellGrid;
    ctx.lineWidth = 1 / this.view.scale;
    ctx.beginPath();
    for (let c = 1; c < this.engine.cols; c++) {
      const gx = bx + c * this.engine.pieceW;
      ctx.moveTo(gx, by);
      ctx.lineTo(gx, by + this.engine.boardH);
    }
    for (let r = 1; r < this.engine.rows; r++) {
      const gy = by + r * this.engine.pieceH;
      ctx.moveTo(bx, gy);
      ctx.lineTo(bx + this.engine.boardW, gy);
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawZoneLabels(pal) {
    drawZoneLabels(this.ctx, this.engine.zoneLabels, pal);
  }

  _drawReferenceSheet(settings, pal) {
    drawReferenceSheet(this.ctx, {
      settings,
      sourceCanvas: this.engine.sourceCanvas,
      refSheet: this.refSheet,
      pal,
    });
  }

  _getPieceAlpha(piece) {
    if (this.highlightFilter === 'all') return 1;
    if (piece.isLocked) return 0.75;
    if (this.highlightFilter === 'edges') {
      return piece.isEdge ? 1 : 0.16;
    }
    if (this.highlightFilter.startsWith('color:')) {
      const bucket = this.highlightFilter.slice(6);
      return piece.colorInfo.bucket === bucket ? 1 : 0.16;
    }
    return 1;
  }

  _ensureLockedBoardCache() {
    const key = `${this.engine.puzzleGeneration}:${this.engine.lockedVersion}`;
    if (this._lockedCache.key === key) return;
    this._lockedCache.key = key;

    const lockedPieces = [];
    for (const p of this.engine.pieces) {
      if (p.isLocked) lockedPieces.push(p);
    }
    if (lockedPieces.length === 0) {
      this._lockedCache.hasLocked = false;
      this._lockedCache.canvas.width = 0;
      this._lockedCache.canvas.height = 0;
      return;
    }

    const pad = this.engine.spritePad + 8;
    const logicalW = Math.ceil(this.engine.boardW + pad * 2);
    const logicalH = Math.ceil(this.engine.boardH + pad * 2);
    const maxScale = this.engine.pieces.length >= 800 ? 2 : 3;
    const rawScale = (this.engine.sourceCanvas?.width || this.engine.boardW) / Math.max(1, this.engine.boardW);
    const scale = Math.min(maxScale, Math.max(2, Math.ceil(rawScale)));

    const cCanvas = this._lockedCache.canvas;
    const targetW = Math.ceil(logicalW * scale);
    const targetH = Math.ceil(logicalH * scale);
    if (cCanvas.width !== targetW || cCanvas.height !== targetH) {
      cCanvas.width = targetW;
      cCanvas.height = targetH;
    }
    const lCtx = cCanvas.getContext('2d', { willReadFrequently: true });
    lCtx.setTransform(1, 0, 0, 1, 0, 0);
    lCtx.clearRect(0, 0, targetW, targetH);
    lCtx.imageSmoothingEnabled = true;
    lCtx.imageSmoothingQuality = 'high';
    lCtx.setTransform(scale, 0, 0, scale, (logicalW / 2) * scale, (logicalH / 2) * scale);

    for (const p of lockedPieces) {
      const sprite = p.frontSprite;
      if (!sprite) continue;
      const drawW = p.spriteLogicalW || sprite.sw;
      const drawH = p.spriteLogicalH || sprite.sh;
      lCtx.drawImage(
        sprite.canvas,
        sprite.sx,
        sprite.sy,
        sprite.sw,
        sprite.sh,
        p.targetX - p.spriteHalfW,
        p.targetY - p.spriteHalfH,
        drawW,
        drawH
      );
    }

    this._lockedCache.hasLocked = true;
    this._lockedCache.logicalW = logicalW;
    this._lockedCache.logicalH = logicalH;
    this._lockedCache.offsetX = -logicalW / 2;
    this._lockedCache.offsetY = -logicalH / 2;
  }

  _drawLockedBoardCache() {
    this._ensureLockedBoardCache();
    const lc = this._lockedCache;
    if (!lc.hasLocked) return;
    const ctx = this.ctx;
    const faded = this.highlightFilter !== 'all';
    if (faded) {
      ctx.save();
      ctx.globalAlpha = 0.75;
    }
    ctx.drawImage(lc.canvas, lc.offsetX, lc.offsetY, lc.logicalW, lc.logicalH);
    if (faded) {
      ctx.restore();
    }
  }

  _drawPiece(piece, isActiveGroup, isHoverGroup, remoteLockMeta, pal) {
    const sprite = piece.isFlipped ? this.engine.ensureBackSprite(piece) : piece.frontSprite;
    if (!sprite) return;
    const ctx = this.ctx;

    ctx.save();
    ctx.translate(piece.x, piece.y);
    ctx.rotate((piece.rotation * Math.PI) / 2);
    if (piece.isFlipped) {
      ctx.scale(-1, 1);
    }

    ctx.globalAlpha = this._getPieceAlpha(piece);

    const drawW = piece.spriteLogicalW || sprite.sw;
    const drawH = piece.spriteLogicalH || sprite.sh;
    if (sprite.canvas) {
      ctx.drawImage(
        sprite.canvas,
        sprite.sx,
        sprite.sy,
        sprite.sw,
        sprite.sh,
        -piece.spriteHalfW,
        -piece.spriteHalfH,
        drawW,
        drawH
      );
    } else {
      ctx.drawImage(sprite, -piece.spriteHalfW, -piece.spriteHalfH, drawW, drawH);
    }

    if (remoteLockMeta || isActiveGroup || isHoverGroup) {
      const strokeCol = remoteLockMeta
        ? resolvePlayerColor(remoteLockMeta.color, pal)
        : isActiveGroup
        ? pal.accent
        : pal.secondary;
      ctx.lineWidth = (remoteLockMeta || isActiveGroup ? 4.4 : 3.6) / this.view.scale;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.stroke(piece.path);
      ctx.lineWidth = (remoteLockMeta ? 2.8 : 2.4) / this.view.scale;
      ctx.strokeStyle = strokeCol;
      ctx.stroke(piece.path);
    }

    ctx.restore();
  }

  _drawRemoteLockBadges(pal) {
    drawRemoteLockBadges(this.ctx, {
      room: this.room,
      engine: this.engine,
      scale: this.view.scale,
      pal,
    });
  }

  _drawAllCursors(now, pal) {
    drawAllCursors(this.ctx, {
      now,
      room: this.room,
      engine: this.engine,
      scale: this.view.scale,
      getParticipantsState: this.getParticipantsState,
      pal,
    });
  }

  renderFrame(now, onTimerTick) {
    const dt = Math.min(100, now - this.lastFrameTime);
    this.lastFrameTime = now;

    if (this.engine.pieces.length > 0 && !this.engine.isCompleted()) {
      this.engine.stats.elapsedMs += dt;
      onTimerTick(this.engine.stats.elapsedMs);
    }

    this.resizeCanvas();

    const interpolated = this.room ? this.room.stepInterpolation() : false;
    const { showDummyCursors, dummyParticipants } = this.getParticipantsState();
    const hasAnimatedCursors =
      !this.room?.isMultiplayer() && showDummyCursors && dummyParticipants.length > 0;

    if (
      this.needsRender ||
      interpolated ||
      this.snapFlashes.length > 0 ||
      this.confetti.length > 0 ||
      hasAnimatedCursors
    ) {
      const settings = this.getSettings();
      const isDark = settings.theme === 'dark';
      const pal = this._getThemePalette();
      const rect = this.canvasStage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const ctx = this.ctx;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, rect.width, rect.height);

      this._drawDeskBackground(rect, pal);

      ctx.save();
      ctx.translate(rect.width / 2, rect.height / 2);
      ctx.scale(this.view.scale, this.view.scale);
      ctx.translate(-this.view.x, -this.view.y);

      this._drawBoardFrame(settings, isDark, pal);
      this._drawReferenceSheet(settings, pal);
      this._drawZoneLabels(pal);

      this._drawLockedBoardCache();

      const halfVisW = rect.width / (2 * this.view.scale);
      const halfVisH = rect.height / (2 * this.view.scale);
      const cullPad = Math.max(this.engine.pieceW, this.engine.pieceH) + this.engine.spritePad + 16;
      const minX = this.view.x - halfVisW - cullPad;
      const maxX = this.view.x + halfVisW + cullPad;
      const minY = this.view.y - halfVisH - cullPad;
      const maxY = this.view.y + halfVisH + cullPad;

      const loose = this.engine.getSortedLoosePieces();
      const hoverGroupId = this.hoveredPiece ? this.hoveredPiece.groupId : null;
      const isMulti = Boolean(this.room?.isMultiplayer());
      for (const p of loose) {
        if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
        const lockOwner = isMulti ? this.room.groupLocks.get(p.groupId) : null;
        const remoteMeta =
          lockOwner && lockOwner !== this.room.myPlayerId
            ? this.room.getPlayerMeta(lockOwner)
            : null;
        const isActive = this.draggingGroupId !== null && p.groupId === this.draggingGroupId;
        const isHover = !isActive && !remoteMeta && hoverGroupId !== null && p.groupId === hoverGroupId;
        this._drawPiece(p, isActive, isHover, remoteMeta, pal);
      }

      this._drawRemoteLockBadges(pal);

      for (let i = this.snapFlashes.length - 1; i >= 0; i--) {
        const fl = this.snapFlashes[i];
        ctx.save();
        ctx.globalAlpha = fl.alpha;
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 4 / this.view.scale;
        ctx.strokeRect(fl.x - fl.w / 2, fl.y - fl.h / 2, fl.w, fl.h);
        ctx.restore();
        fl.alpha -= 0.045;
        if (fl.alpha <= 0) this.snapFlashes.splice(i, 1);
      }

      this._drawAllCursors(now, pal);
      ctx.restore();

      if (this.confetti.length > 0) {
        for (let i = this.confetti.length - 1; i >= 0; i--) {
          const c = this.confetti[i];
          c.x += c.vx;
          c.y += c.vy;
          c.vy += 0.14;
          c.rot += c.vr;
          ctx.save();
          ctx.translate(c.x, c.y);
          ctx.rotate(c.rot);
          ctx.fillStyle = c.color;
          ctx.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.6);
          ctx.restore();
          if (c.y > rect.height + 30) this.confetti.splice(i, 1);
        }
      }

      this.needsRender = false;
      if (this.postRenderCallbacks.length > 0) {
        const callbacks = this.postRenderCallbacks.splice(0);
        for (const cb of callbacks) cb();
      }
    }
  }
}
