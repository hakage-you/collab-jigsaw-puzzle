import { VIEWPORT_CONFIG } from '../config/constants.js';
import {
  drawAllCursors,
  drawBoardFrame,
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
    this.ghostPiecesActive = false;
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

  setGhostPiecesActive(active) {
    const next = Boolean(active);
    if (this.ghostPiecesActive !== next) {
      this.ghostPiecesActive = next;
      this.needsRender = true;
    }
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
    const pad = Math.max(this.engine.pieceW, this.engine.pieceH) * 1.4 + this.engine.spritePad;
    let minX = -this.engine.boardW / 2 - pad;
    let maxX = this.engine.boardW / 2 + pad;
    let minY = -this.engine.boardH / 2 - pad;
    let maxY = this.engine.boardH / 2 + pad;
    for (const p of this.engine.pieces) {
      if (p.x - pad < minX) minX = p.x - pad;
      if (p.x + pad > maxX) maxX = p.x + pad;
      if (p.y - pad < minY) minY = p.y - pad;
      if (p.y + pad > maxY) maxY = p.y + pad;
    }
    const spanW = Math.max(1, maxX - minX);
    const spanH = Math.max(1, maxY - minY);
    const s = Math.min(rect.width / spanW, rect.height / spanH);
    this.view.scale = Math.max(VIEWPORT_CONFIG.MIN_ZOOM, Math.min(1.2, s));
    this.view.x = (minX + maxX) / 2;
    this.view.y = (minY + maxY) / 2;
    this.needsRender = true;
  }

  resetRefSheetGeometry(sourceCanvas) {
    const aspect = sourceCanvas.height / Math.max(1, sourceCanvas.width);
    this.refSheet.w = Math.max(180, Math.min(480, Math.round(this.engine.boardW * 0.44)));
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
    drawBoardFrame(this.ctx, {
      engine: this.engine,
      scale: this.view.scale,
      settings,
      isDark,
      pal,
    });
  }

  _drawZoneLabels(pal) {
    drawZoneLabels(this.ctx, this.engine.zoneLabels, pal, this.view.scale);
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
    let alpha = 1;
    if (this.highlightFilter !== 'all') {
      if (piece.isLocked) alpha = 0.75;
      else if (this.highlightFilter === 'edges') alpha = piece.isEdge ? 1 : 0.16;
      else if (this.highlightFilter.startsWith('color:')) {
        const bucket = this.highlightFilter.slice(6);
        alpha = piece.colorInfo.bucket === bucket ? 1 : 0.16;
      }
    }
    if (this.ghostPiecesActive && !piece.isLocked) {
      alpha *= 0.1;
    }
    return alpha;
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

    const MAX_LOCKED_CACHE_DIM = 2048;
    const pad = this.engine.spritePad + 8;
    const logicalW = Math.ceil(this.engine.boardW + pad * 2);
    const logicalH = Math.ceil(this.engine.boardH + pad * 2);
    const baseScale = this.engine.pieces[0]?.spriteScale || 1;
    const desiredScale = Math.min(2, Math.max(0.4, baseScale));
    const maxScaleByDim = MAX_LOCKED_CACHE_DIM / Math.max(1, logicalW, logicalH);
    const scale = Math.min(desiredScale, maxScaleByDim);

    const cCanvas = this._lockedCache.canvas;
    const targetW = Math.min(MAX_LOCKED_CACHE_DIM, Math.max(1, Math.ceil(logicalW * scale)));
    const targetH = Math.min(MAX_LOCKED_CACHE_DIM, Math.max(1, Math.ceil(logicalH * scale)));
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

  _resolvePieceSprite(piece, lodConfig) {
    if (lodConfig && this.engine.lodCache) {
      const lodSprite = this.engine.lodCache.getOrRender(piece, {
        isFlipped: piece.isFlipped,
        lodScale: lodConfig.lodScale,
        engine: this.engine,
      });
      if (lodSprite) return lodSprite;
    }
    return piece.isFlipped ? this.engine.ensureBackSprite(piece) : piece.frontSprite;
  }

  _drawPiece(piece, isActiveGroup, isHoverGroup, remoteLockMeta, pal, lodConfig = null) {
    const sprite = this._resolvePieceSprite(piece, lodConfig);
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

    if (this.engine.fakePieces.length > 0 && this.engine.pruneExpiredFakePieces()) {
      this.needsRender = true;
    }

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

      const halfVisW = rect.width / (2 * this.view.scale);
      const halfVisH = rect.height / (2 * this.view.scale);
      const cullPad = Math.max(this.engine.pieceW, this.engine.pieceH) + this.engine.spritePad + 16;
      const minX = this.view.x - halfVisW - cullPad;
      const maxX = this.view.x + halfVisW + cullPad;
      const minY = this.view.y - halfVisH - cullPad;
      const maxY = this.view.y + halfVisH + cullPad;

      const visibleLocked = [];
      for (const p of this.engine.pieces) {
        if (p.isLocked && p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
          visibleLocked.push(p);
        }
      }
      const visibleLoose = [];
      for (const p of this.engine.getSortedLoosePieces()) {
        if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
          visibleLoose.push(p);
        }
      }

      const visibleCount = visibleLocked.length + visibleLoose.length;
      const lodConfig = this.engine.lodCache
        ? this.engine.lodCache.resolveLodConfig(this.view.scale * dpr, this.engine, visibleCount)
        : null;
      if (lodConfig) {
        this.engine.lodCache.beginFrame(
          this.engine.puzzleGeneration,
          lodConfig.bucket,
          lodConfig.slotStep
        );
        for (const p of visibleLocked) {
          this._drawPiece(p, false, false, null, pal, lodConfig);
        }
      } else {
        this._drawLockedBoardCache();
      }

      const hoverGroupId = this.hoveredPiece ? this.hoveredPiece.groupId : null;
      const isMulti = Boolean(this.room?.isMultiplayer());
      for (const p of visibleLoose) {
        const lockOwner = isMulti ? this.room.groupLocks.get(p.groupId) : null;
        const remoteMeta =
          lockOwner && lockOwner !== this.room.myPlayerId
            ? this.room.getPlayerMeta(lockOwner)
            : null;
        const isActive = this.draggingGroupId !== null && p.groupId === this.draggingGroupId;
        const isHover = !isActive && !remoteMeta && hoverGroupId !== null && p.groupId === hoverGroupId;
        this._drawPiece(p, isActive, isHover, remoteMeta, pal, lodConfig);
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

      const lod = this.engine.lodCache;
      this.needsRender = Boolean(lodConfig && lod?.budgetExhausted && !lod?.evictedInFrame);
      if (this.postRenderCallbacks.length > 0) {
        const callbacks = this.postRenderCallbacks.splice(0);
        for (const cb of callbacks) cb();
      }
    }
  }
}
