import { VIEWPORT_CONFIG } from '../config/constants.js';

/**
 * What the player is looking at and doing on the table, separate from how it is drawn:
 * the camera, the reference sheet, the dragged and hovered pieces, highlight modes and effect
 * data. Input handlers change it; renderers only read it (and advance the effects).
 * Every renderer (Canvas 2D today, WebGL later) shares the same ViewState.
 */
export class ViewState {
  /**
   * @param {object} deps
   * @param {() => {width: number, height: number}} deps.getViewportSize stage size in CSS px
   * @param {object} deps.engine PuzzleEngine (read only)
   * @param {() => object} deps.getSettings current settings
   */
  constructor({ getViewportSize, engine, getSettings }) {
    this.getViewportSize = getViewportSize;
    this.engine = engine;
    this.getSettings = getSettings;

    /** Camera: world point at the centre of the stage, and CSS px per world unit. */
    this.camera = { x: 0, y: 0, scale: VIEWPORT_CONFIG.DEFAULT_SCALE };
    this.refSheet = { x: -520, y: -40, w: 280, h: 186 };

    this.draggingGroupId = null;
    this.hoveredPieceId = null;
    this.highlightFilter = 'all';
    this.ghostPiecesActive = false;

    /** Effect data (world-space snap flashes, screen-space confetti); drawn on the effects layer. */
    this.snapFlashes = [];
    this.confetti = [];

    this.needsRender = true;
    this.postRenderCallbacks = [];
  }

  /** Redraw the table on the next frame. */
  requestRender() {
    this.needsRender = true;
  }

  /** Runs `callback` after the next frame has been drawn. */
  afterNextRender(callback) {
    if (typeof callback === 'function') {
      this.postRenderCallbacks.push(callback);
      this.needsRender = true;
    }
  }

  get hoveredPiece() {
    return this.hoveredPieceId === null ? null : this.engine.getPieceById(this.hoveredPieceId);
  }

  /** Sets the hovered piece; returns true when it changed. */
  setHoveredPiece(piece) {
    const id = piece ? piece.id : null;
    if (id === this.hoveredPieceId) return false;
    this.hoveredPieceId = id;
    this.needsRender = true;
    return true;
  }

  setDraggingGroup(groupId) {
    this.draggingGroupId = groupId;
    this.needsRender = true;
  }

  setHighlightFilter(mode) {
    this.highlightFilter = mode;
    this.needsRender = true;
  }

  setGhostPiecesActive(active) {
    const next = Boolean(active);
    if (this.ghostPiecesActive !== next) {
      this.ghostPiecesActive = next;
      this.needsRender = true;
    }
  }

  /** Forgets everything that points at pieces of the previous puzzle. */
  resetForNewPuzzle({ clearEffects = false } = {}) {
    this.hoveredPieceId = null;
    this.draggingGroupId = null;
    if (clearEffects) {
      this.snapFlashes = [];
      this.confetti = [];
    }
    this.needsRender = true;
  }

  screenToWorld(sx, sy) {
    const { width, height } = this.getViewportSize();
    const c = this.camera;
    return { x: (sx - width / 2) / c.scale + c.x, y: (sy - height / 2) / c.scale + c.y };
  }

  worldToScreen(wx, wy) {
    const { width, height } = this.getViewportSize();
    const c = this.camera;
    return { x: (wx - c.x) * c.scale + width / 2, y: (wy - c.y) * c.scale + height / 2 };
  }

  /** Moves the camera by a drag of (dx, dy) screen px. */
  panBy(dxScreen, dyScreen) {
    this.camera.x -= dxScreen / this.camera.scale;
    this.camera.y -= dyScreen / this.camera.scale;
    this.needsRender = true;
  }

  setScale(scale) {
    this.camera.scale = Math.max(
      VIEWPORT_CONFIG.MIN_ZOOM,
      Math.min(VIEWPORT_CONFIG.MAX_ZOOM, scale),
    );
    this.needsRender = true;
  }

  /** Zooms by `factor`, keeping the world point under screen point (sx, sy) in place. */
  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.setScale(this.camera.scale * factor);
    const after = this.screenToWorld(sx, sy);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
  }

  /** Fits the board and every piece into the stage (at most 120%). */
  fitView() {
    const { width, height } = this.getViewportSize();
    if (width <= 0 || height <= 0) return;
    const e = this.engine;
    const pad = Math.max(e.pieceW, e.pieceH) * 1.4 + e.spritePad;
    let minX = -e.boardW / 2 - pad;
    let maxX = e.boardW / 2 + pad;
    let minY = -e.boardH / 2 - pad;
    let maxY = e.boardH / 2 + pad;
    for (const p of e.pieces) {
      if (p.x - pad < minX) minX = p.x - pad;
      if (p.x + pad > maxX) maxX = p.x + pad;
      if (p.y - pad < minY) minY = p.y - pad;
      if (p.y + pad > maxY) maxY = p.y + pad;
    }
    const s = Math.min(width / Math.max(1, maxX - minX), height / Math.max(1, maxY - minY));
    this.camera.scale = Math.max(VIEWPORT_CONFIG.MIN_ZOOM, Math.min(1.2, s));
    this.camera.x = (minX + maxX) / 2;
    this.camera.y = (minY + maxY) / 2;
    this.needsRender = true;
  }

  /** Places the reference sheet left of the board, sized to the image's aspect ratio. */
  resetRefSheetGeometry(sourceCanvas) {
    const e = this.engine;
    const aspect = sourceCanvas.height / Math.max(1, sourceCanvas.width);
    this.refSheet.w = Math.max(180, Math.min(480, Math.round(e.boardW * 0.44)));
    this.refSheet.h = Math.round(this.refSheet.w * aspect);
    this.refSheet.x = -e.boardW / 2 - this.refSheet.w / 2 - Math.max(60, e.pieceW * 1.1);
    this.refSheet.y = 0;
  }

  moveRefSheetBy(dxScreen, dyScreen) {
    this.refSheet.x += dxScreen / this.camera.scale;
    this.refSheet.y += dyScreen / this.camera.scale;
    this.needsRender = true;
  }

  isPointInRefSheet(wx, wy) {
    if ((this.getSettings().referenceMode || 'underlay') !== 'sheet') return false;
    const r = this.refSheet;
    return (
      wx >= r.x - r.w / 2 - 10 &&
      wx <= r.x + r.w / 2 + 10 &&
      wy >= r.y - r.h / 2 - 28 &&
      wy <= r.y + r.h / 2 + 10
    );
  }

  /** A short outline flash where pieces snapped into place. */
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
  }

  /** Confetti across the stage; `colors` come from the theme. Speeds are per second. */
  launchConfetti(colors) {
    const { width } = this.getViewportSize();
    for (let i = 0; i < 90; i++) {
      this.confetti.push({
        x: Math.random() * width,
        y: -10 - Math.random() * 80,
        vx: (Math.random() - 0.5) * 300,
        vy: 120 + Math.random() * 240,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 12,
        size: 7 + Math.random() * 6,
        color: colors[i % colors.length],
      });
    }
  }

  get hasEffects() {
    return this.snapFlashes.length > 0 || this.confetti.length > 0;
  }
}
