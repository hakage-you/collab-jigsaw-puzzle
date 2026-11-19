import { VIEWPORT_CONFIG } from '../config/constants.js';
import { loadImageFromFile } from '../services/imageLoader.js';

export class CanvasInteraction {
  constructor({ app, renderer, ojama, fitViewAndSync, updateZoomReadout, showToast }) {
    this.app = app;
    this.renderer = renderer;
    this.ojama = ojama;
    this.fitViewAndSync = fitViewAndSync;
    this.updateZoomReadout = updateZoomReadout;
    this.showToast = showToast;

    this.canvasStage = document.getElementById('canvasStage');
    this.canvas = document.getElementById('puzzleCanvas');
    this.fileDropOverlay = document.getElementById('fileDropOverlay');

    this.isDraggingRefSheet = false;
    this.isPanning = false;
    this.spacePressed = false;
    this.lastPointerScreen = { x: 0, y: 0 };
    this.dragCounter = 0;

    this._bindEvents();
    this._subscribeApp();
  }

  _getCanvasLocalCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  _finishDrag(e) {
    if (this.isPanning || this.isDraggingRefSheet) {
      this.isPanning = false;
      this.isDraggingRefSheet = false;
      this.canvas.classList.remove('grabbing');
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      return;
    }
    if (this.renderer.draggingGroupId !== null) {
      const groupId = this.renderer.draggingGroupId;
      this.renderer.draggingGroupId = null;
      this.canvas.classList.remove('grabbing');
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.app.submitDrop(groupId);
    }
  }

  _bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      const { sx, sy } = this._getCanvasLocalCoords(e);
      this.lastPointerScreen = { x: sx, y: sy };

      if (e.button === 2) {
        const target =
          this.renderer.draggingGroupId !== null
            ? this.app.getGroupPieces(this.renderer.draggingGroupId)[0]
            : this.app.hitTest(this.renderer.screenToWorld(sx, sy).x, this.renderer.screenToWorld(sx, sy).y);
        if (target) {
          this.app.submitRotate(target);
        }
        return;
      }
      if (e.button === 1 || (e.button === 0 && this.spacePressed)) {
        this.isPanning = true;
        this.canvas.classList.add('grabbing');
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;

      const world = this.renderer.screenToWorld(sx, sy);
      const hit = this.app.hitTest(world.x, world.y);

      if (hit) {
        const lockRes = this.app.requestLock(hit.groupId);
        if (!lockRes.allowed) return;
        this.renderer.draggingGroupId = hit.groupId;
        this.renderer.hoveredPiece = hit;
        this.app.bringGroupToFront(hit.groupId);
        this.canvas.classList.add('grabbing');
        this.canvas.setPointerCapture(e.pointerId);
        this.renderer.requestRender();
      } else if (this.renderer.isPointInRefSheet(world.x, world.y)) {
        this.isDraggingRefSheet = true;
        this.canvas.classList.add('grabbing');
        this.canvas.setPointerCapture(e.pointerId);
      } else {
        this.isPanning = true;
        this.canvas.classList.add('grabbing');
        this.canvas.setPointerCapture(e.pointerId);
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const { sx, sy } = this._getCanvasLocalCoords(e);
      this.ojama.updateSpotlightPosition(sx, sy);

      const dxScreen = sx - this.lastPointerScreen.x;
      const dyScreen = sy - this.lastPointerScreen.y;
      this.lastPointerScreen = { x: sx, y: sy };

      if (this.isPanning) {
        this.renderer.view.x -= dxScreen / this.renderer.view.scale;
        this.renderer.view.y -= dyScreen / this.renderer.view.scale;
        this.renderer.requestRender();
        return;
      }

      const world = this.renderer.screenToWorld(sx, sy);
      this.app.sendCursorMove(world.x, world.y);

      if (this.isDraggingRefSheet) {
        this.renderer.refSheet.x += dxScreen / this.renderer.view.scale;
        this.renderer.refSheet.y += dyScreen / this.renderer.view.scale;
        this.renderer.requestRender();
        return;
      }

      if (this.renderer.draggingGroupId !== null) {
        this.app.moveGroup(
          this.renderer.draggingGroupId,
          dxScreen / this.renderer.view.scale,
          dyScreen / this.renderer.view.scale
        );
        this.app.sendDragPreview(this.renderer.draggingGroupId);
        this.renderer.requestRender();
        return;
      }

      const hit = this.app.hitTest(world.x, world.y);
      const overSheet = !hit && this.renderer.isPointInRefSheet(world.x, world.y);
      if (hit !== this.renderer.hoveredPiece) {
        this.renderer.hoveredPiece = hit;
        this.renderer.requestRender();
      }
      this.canvas.style.cursor = hit || overSheet ? 'pointer' : 'grab';
    });

    this.canvas.addEventListener('pointerup', (e) => this._finishDrag(e));
    this.canvas.addEventListener('pointercancel', (e) => this._finishDrag(e));

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    this.canvas.addEventListener('dblclick', (e) => {
      const { sx, sy } = this._getCanvasLocalCoords(e);
      const world = this.renderer.screenToWorld(sx, sy);
      this.app.submitFlip(this.app.hitTest(world.x, world.y));
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const { sx, sy } = this._getCanvasLocalCoords(e);
        const before = this.renderer.screenToWorld(sx, sy);
        const factor =
          e.deltaY < 0 ? VIEWPORT_CONFIG.ZOOM_STEP_WHEEL : 1 / VIEWPORT_CONFIG.ZOOM_STEP_WHEEL;
        this.renderer.view.scale = Math.max(
          VIEWPORT_CONFIG.MIN_ZOOM,
          Math.min(VIEWPORT_CONFIG.MAX_ZOOM, this.renderer.view.scale * factor)
        );
        const after = this.renderer.screenToWorld(sx, sy);
        this.renderer.view.x += before.x - after.x;
        this.renderer.view.y += before.y - after.y;
        this.updateZoomReadout();
        this.renderer.requestRender();
      },
      { passive: false }
    );

    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;
      if (e.code === 'Space') {
        this.spacePressed = true;
      } else if (e.key === 'r' || e.key === 'R') {
        const target =
          this.renderer.draggingGroupId !== null
            ? this.app.getGroupPieces(this.renderer.draggingGroupId)[0]
            : this.renderer.hoveredPiece;
        this.app.submitRotate(target);
      } else if (e.key === 'f' || e.key === 'F') {
        const target =
          this.renderer.draggingGroupId !== null
            ? this.app.getGroupPieces(this.renderer.draggingGroupId)[0]
            : this.renderer.hoveredPiece;
        this.app.submitFlip(target);
      } else if (e.key === '0') {
        this.fitViewAndSync();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spacePressed = false;
    });

    document.getElementById('btnZoomIn').addEventListener('click', () => {
      this.renderer.view.scale = Math.min(
        VIEWPORT_CONFIG.MAX_ZOOM,
        this.renderer.view.scale * VIEWPORT_CONFIG.ZOOM_STEP_BUTTON
      );
      this.updateZoomReadout();
      this.renderer.requestRender();
    });
    document.getElementById('btnZoomOut').addEventListener('click', () => {
      this.renderer.view.scale = Math.max(
        VIEWPORT_CONFIG.MIN_ZOOM,
        this.renderer.view.scale / VIEWPORT_CONFIG.ZOOM_STEP_BUTTON
      );
      this.updateZoomReadout();
      this.renderer.requestRender();
    });
    document.getElementById('btnResetView').addEventListener('click', () => this.fitViewAndSync());

    const zoomReadout = document.getElementById('zoomReadout');
    const resetTo100Pct = () => {
      this.renderer.view.scale = 1.0;
      this.updateZoomReadout();
      this.renderer.requestRender();
    };
    zoomReadout?.addEventListener('click', resetTo100Pct);
    zoomReadout?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        resetTo100Pct();
      }
    });

    this.canvasStage.addEventListener('dragenter', (e) => {
      if (this.app.room.isGuest()) return;
      if (e.dataTransfer?.types?.includes('Files')) {
        this.dragCounter++;
        this.fileDropOverlay.classList.remove('hidden');
      }
    });
    this.canvasStage.addEventListener('dragleave', () => {
      if (this.app.room.isGuest()) return;
      this.dragCounter = Math.max(0, this.dragCounter - 1);
      if (this.dragCounter === 0) this.fileDropOverlay.classList.add('hidden');
    });
    this.canvasStage.addEventListener('dragover', (e) => {
      if (!this.app.room.isGuest() && e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
      }
    });
    this.canvasStage.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dragCounter = 0;
      this.fileDropOverlay.classList.add('hidden');
      if (this.app.room.isGuest()) return;
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        loadImageFromFile(
          file,
          (imgCanvas, name) => this.app.setCustomImage(imgCanvas, name),
          (msg) => this.showToast(msg, 'ojama')
        );
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (this.app.shouldWarnBeforeUnload()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  _subscribeApp() {
    this.app.on('lockDenied', ({ groupId }) => {
      if (this.renderer.draggingGroupId === groupId) {
        this.renderer.draggingGroupId = null;
        this.canvas.classList.remove('grabbing');
      }
    });
    this.app.on('snapEffect', ({ pieces }) => this.renderer.addSnapFlashes(pieces));
    this.app.on('puzzleReset', ({ canvas: srcCanvas, resetEffects, fitView }) => {
      this.renderer.hoveredPiece = null;
      this.renderer.draggingGroupId = null;
      if (resetEffects) this.renderer.clearEffects();
      this.renderer.resetRefSheetGeometry(srcCanvas);
      if (fitView) this.fitViewAndSync();
    });
  }
}
