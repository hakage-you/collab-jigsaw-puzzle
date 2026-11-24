import { VIEWPORT_CONFIG } from '../config/constants.js';
import { scatterBand } from '../core/pieceFactory.js';
import { spawnEffect } from './effects/effectPlayer.js';
import { PieceMotion } from './effects/pieceMotion.js';

/** How far the completion sticker's middle stays from the stage's sides (CSS px): it fits. */
const COMPLETION_SPOT_MARGIN = Object.freeze({ x: 170, y: 60 });

/** How strong the outline flash of snapped pieces starts, per effect strength (off: none). */
const SNAP_FLASH_ALPHA = Object.freeze({ normal: 0.9, reduced: 0.45, off: 0 });

/** The reference mode in effect (settings without one use the default). */
export function referenceModeOf(settings) {
  return settings?.referenceMode || VIEWPORT_CONFIG.DEFAULT_REFERENCE_MODE;
}

/**
 * The reference sheet's paper round its image, in world units: margin, title strip, title font,
 * corner radius and shadow offset. They grow with the sheet, so the title stays readable next
 * to a large board; a sheet up to 320 wide keeps the original sizes.
 */
export function refSheetFrame(sheet) {
  const k = Math.max(1, sheet.w / 320);
  return { k, pad: 10 * k, header: 18 * k, font: 12 * k, radius: 8 * k };
}

/** The sheet's paper as a box (image, margin and title strip). */
function refSheetBox(sheet) {
  const { pad, header } = refSheetFrame(sheet);
  return {
    minX: sheet.x - sheet.w / 2 - pad,
    maxX: sheet.x + sheet.w / 2 + pad,
    minY: sheet.y - sheet.h / 2 - pad - header,
    maxY: sheet.y + sheet.h / 2 + pad,
  };
}

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

    /** Effect data drawn on the effects layer: world-space snap flashes, and stamp effects
     * (effects/effectRecipes.js) at world points or across the screen; sizes are screen px. */
    this.snapFlashes = [];
    this.particles = [];
    /** Stamp effects on the top layer, above the stage's overlays (the superchat card): screen px. */
    this.overlayParticles = [];
    /** Effect strength: 'normal', 'reduced' or 'off' (effects/effectPlayer.js INTENSITY). */
    this.effectIntensity = 'normal';
    /** Runaway hops and the heavy-piece tether, drawn over the pieces' real positions. */
    this.motion = new PieceMotion();
    /** Heavy pieces: the level ('strong' | 'heavier' | 'heaviest') while it lasts, else null. */
    this.heavyLevel = null;
    /** Where each fake piece was last seen (fakeId -> {x, y}), to puff when one vanishes. */
    this.fakeSpots = new Map();

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

  /**
   * Whether held pieces are drawn lifted off the desk: not when effects are reduced, and not
   * while the "heavy" interference lasts (heavy pieces are dragged along the desk).
   */
  get liftHeldPieces() {
    return this.effectIntensity === 'normal' && !this.heavyLevel;
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
    this.fakeSpots = new Map();
    this.draggingGroupId = null;
    if (clearEffects) {
      this.snapFlashes = [];
      this.particles = [];
      this.overlayParticles = [];
      this.motion.clear();
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

  /** Fits the board, every piece and the reference sheet (when shown) into the stage (at most 120%). */
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
    if (referenceModeOf(this.getSettings()) === 'sheet') {
      const box = refSheetBox(this.refSheet);
      const margin = Math.max(e.pieceW, e.pieceH) * 0.5;
      minX = Math.min(minX, box.minX - margin);
      maxX = Math.max(maxX, box.maxX + margin);
      minY = Math.min(minY, box.minY - margin);
      maxY = Math.max(maxY, box.maxY + margin);
    }
    const s = Math.min(width / Math.max(1, maxX - minX), height / Math.max(1, maxY - minY));
    this.camera.scale = Math.max(VIEWPORT_CONFIG.MIN_ZOOM, Math.min(1.2, s));
    this.camera.x = (minX + maxX) / 2;
    this.camera.y = (minY + maxY) / 2;
    this.needsRender = true;
  }

  /**
   * Places the reference sheet left of the band where a new puzzle's pieces are scattered, so
   * none starts on top of it, sized with the board and to the image's aspect ratio.
   */
  resetRefSheetGeometry(sourceCanvas) {
    const e = this.engine;
    const sheet = this.refSheet;
    const aspect = sourceCanvas.height / Math.max(1, sourceCanvas.width);
    sheet.w = Math.max(180, Math.round(e.boardW * 0.44));
    sheet.h = Math.round(sheet.w * aspect);
    const { marginX, bandW } = scatterBand(e);
    // A piece reaches this far from its centre, turned any way, tabs included.
    const pieceReach = Math.max(e.pieceW, e.pieceH) / 2 + e.spritePad;
    const gap = Math.max(e.pieceW, e.pieceH) * 0.5;
    const sheetRight = -(marginX + bandW) - pieceReach - gap;
    sheet.x = sheetRight - refSheetFrame(sheet).pad - sheet.w / 2;
    sheet.y = 0;
  }

  moveRefSheetBy(dxScreen, dyScreen) {
    this.refSheet.x += dxScreen / this.camera.scale;
    this.refSheet.y += dyScreen / this.camera.scale;
    this.needsRender = true;
  }

  isPointInRefSheet(wx, wy) {
    if (referenceModeOf(this.getSettings()) !== 'sheet') return false;
    const box = refSheetBox(this.refSheet);
    return wx >= box.minX && wx <= box.maxX && wy >= box.minY && wy <= box.maxY;
  }

  /** Plays a stamp effect (a key of effects/effectRecipes.js EFFECTS) at a world point. */
  playEffect(name, x, y, opts = {}) {
    spawnEffect(this.particles, name, x, y, { ...opts, intensity: this.effectIntensity });
  }

  /**
   * Puffs smoke where a fake piece vanished (it expired, or the puzzle was completed), on every
   * player's screen alike. Call once per frame with the current fake pieces.
   */
  trackFakePieces(fakes) {
    if (fakes.length === 0 && this.fakeSpots.size === 0) return;
    const seen = new Map(fakes.map((f) => [f.fakeId ?? f.id, { x: f.x, y: f.y }]));
    for (const [id, spot] of this.fakeSpots) {
      if (!seen.has(id)) this.playEffect('smokePuff', spot.x, spot.y);
    }
    this.fakeSpots = seen;
  }

  /** Smoke where interference knocked pieces off the board, and a puff where each one landed. */
  playDropEffect(pieces) {
    for (const p of pieces) {
      this.playEffect('smokePuff', p.targetX, p.targetY);
      this.playEffect('smallPuff', p.x, p.y);
    }
  }

  /**
   * A curled arrow over the middle of each group interference turned round (pointing the way it
   * turned), or turning over like a card where a piece was flipped.
   * @param {object[]} pieces the changed pieces, as they are now
   * @param {Map} before id -> { rotation, isFlipped } before the change (turnStates)
   */
  playPrankEffect(pieces, before) {
    const groups = new Map();
    for (const p of pieces) groups.set(p.groupId, [...(groups.get(p.groupId) || []), p]);
    for (const group of groups.values()) {
      const p = group.find((q) => before.has(q.id));
      if (!p) continue;
      const was = before.get(p.id);
      const cx = group.reduce((sum, q) => sum + q.x, 0) / group.length;
      const cy = group.reduce((sum, q) => sum + q.y, 0) / group.length;
      const turns = (((p.rotation - was.rotation) % 4) + 4) % 4;
      if (p.isFlipped !== was.isFlipped) this.playEffect('prankFlip', cx, cy);
      else if (turns !== 0) {
        this.playEffect('prankTurn', cx, cy, { direction: turns === 3 ? -1 : 1 });
      }
    }
  }

  /**
   * A short outline flash where pieces snapped into place, and a star hopping from their middle.
   * The flash starts fainter when effects are reduced and is not drawn when they are off.
   */
  addSnapFlashes(pieces) {
    if (pieces.length > 0) {
      const cx = pieces.reduce((sum, p) => sum + p.x, 0) / pieces.length;
      const cy = pieces.reduce((sum, p) => sum + p.y, 0) / pieces.length;
      this.playEffect('snapStar', cx, cy);
    }
    const alpha = SNAP_FLASH_ALPHA[this.effectIntensity];
    if (!alpha) return;
    for (const sp of pieces) {
      this.snapFlashes.push({
        x: sp.x,
        y: sp.y,
        w: this.engine.pieceW,
        h: this.engine.pieceH,
        alpha,
      });
    }
  }

  /** Plays a stamp effect on the top layer at a screen point (CSS px from the stage's top left). */
  playOverlayEffect(name, x, y) {
    spawnEffect(this.overlayParticles, name, x, y, {
      intensity: this.effectIntensity,
      screen: true,
    });
  }

  /** Stars popping where the superchat card was hit (screen px). */
  playSuperchatHit(x, y) {
    this.playOverlayEffect('superchatHit', x, y);
  }

  /** Smoke and stars bursting from the middle of the superchat card when it is driven off. */
  playSuperchatDefeat(x, y) {
    this.playOverlayEffect('superchatBurstPuff', x, y);
    this.playOverlayEffect('superchatBurstStars', x, y);
  }

  /**
   * Completion (the result screen plays it): confetti across the whole stage, and stars bursting
   * from its middle, from under the big "かんせい！" sticker.
   */
  launchConfetti() {
    const { width, height } = this.getViewportSize();
    spawnEffect(this.particles, 'confetti', 0, 0, {
      intensity: this.effectIntensity,
      area: { width, height },
    });
    const spot = this.completionSpot();
    this.playOverlayEffect('superchatBurstStars', spot.x, spot.y);
  }

  /**
   * Where the completion sticker sticks (CSS px on the stage): the middle of the board's top
   * edge, so it hides little of the finished picture; kept on screen when that edge is not.
   */
  completionSpot() {
    const { width, height } = this.getViewportSize();
    const p = this.worldToScreen(0, -this.engine.boardH / 2);
    const mx = Math.min(COMPLETION_SPOT_MARGIN.x, width / 2);
    const my = Math.min(COMPLETION_SPOT_MARGIN.y, height / 2);
    return {
      x: Math.min(width - mx, Math.max(mx, p.x)),
      y: Math.min(height - my, Math.max(my, p.y)),
    };
  }

  /**
   * A runaway group hopped (its pieces already stand where they landed; `from` holds where they
   * were). With effects at normal everyone sees the hop; reduced shows it only to the player who
   * grabbed it; off (and anyone else when reduced) sees the pieces simply move.
   */
  playHop({ groupId, from, byPlayerId }, myPlayerId) {
    const mine = byPlayerId === myPlayerId;
    const show = this.effectIntensity === 'normal' || (this.effectIntensity === 'reduced' && mine);
    if (show) this.motion.playHop(this.engine.getGroupPieces(groupId), from, performance.now());
    this.needsRender = true;
  }

  get hasEffects() {
    return (
      this.snapFlashes.length > 0 ||
      this.particles.length > 0 ||
      this.motion.active ||
      this.motion.tether !== null
    );
  }
}
