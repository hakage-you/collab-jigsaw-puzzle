import { TableRendererBase } from '../tableRendererBase.js';
import { LockedBoardCache } from './lockedBoardCache.js';
import {
  collectVisiblePieces,
  drawBoardStage,
  drawDeskStage,
  drawLockBadgeStage,
  drawOutlinesStage,
  drawPieceStage,
  enterWorld,
  leaveWorld,
  liftedGroups,
  prepareCanvas,
} from './renderStages.js';

/**
 * Canvas 2D renderer: draws the whole table (desk, board, pieces, lock badges) into the bottom
 * canvas, redrawn only when something on it changed. Cursors and effects are on the effects
 * layer (see TableRendererBase). Works everywhere; the fallback when WebGL2 is not usable.
 */
export class CanvasRenderer extends TableRendererBase {
  constructor(options) {
    super(options);
    this.kind = 'canvas2d';
    this.ctx = this.canvas.getContext('2d');
    this._lockedCache = new LockedBoardCache();
  }

  /** Snapshot of everything the table draw stages need for one frame. */
  _buildFrame() {
    const settings = this.getSettings();
    const vs = this.viewState;
    return {
      ctx: this.ctx,
      engine: this.engine,
      room: this.room,
      view: vs.camera,
      refSheet: vs.refSheet,
      settings,
      isDark: settings.theme === 'dark',
      pal: this._getThemePalette(),
      rect: this.canvasStage.getBoundingClientRect(),
      dpr: window.devicePixelRatio || 1,
      highlightFilter: vs.highlightFilter,
      ghostPiecesActive: vs.ghostPiecesActive,
      motionOffsets: vs.motion.offsets,
      draggingGroupId: vs.draggingGroupId,
      hoveredPiece: vs.hoveredPiece,
      lockedCache: this._lockedCache,
      sprites: this.sprites,
      lifted: liftedGroups({ viewState: vs, engine: this.engine, room: this.room }),
      requestRender: () => vs.requestRender(),
    };
  }

  _drawTable() {
    this.sprites.sync(this.engine);
    const frame = this._buildFrame();
    prepareCanvas(frame);
    drawDeskStage(frame);
    enterWorld(frame);
    drawBoardStage(frame);
    const visible = collectVisiblePieces(frame);
    const lodConfig = drawPieceStage(frame, visible);
    drawLockBadgeStage(frame);
    leaveWorld(frame);
    this._finishTable(lodConfig);
    // Outlines go on the effects layer (they cut the pieces' shapes out of their layer).
    return { ...frame, visibleLoose: visible.visibleLoose };
  }

  _drawOverlay(ctx, frame) {
    drawOutlinesStage({ ...frame, ctx }, frame.visibleLoose);
  }
}
