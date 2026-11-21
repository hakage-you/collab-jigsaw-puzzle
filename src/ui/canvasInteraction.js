import { VIEWPORT_CONFIG } from '../config/constants.js';
import { loadImageFromFile } from '../services/imageLoader.js';

export class CanvasInteraction {
  constructor({ app, renderer, loading, ojama, fitViewAndSync, updateZoomReadout, showToast }) {
    this.app = app;
    this.loading = loading;
    /** Camera, dragged/hovered piece and reference sheet: input changes these, never the renderer. */
    this.vs = renderer.viewState;
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
    this.prevButtons = 0;
    this._handledRightPointerDown = false;
    this.dragCounter = 0;

    this._bindEvents();
    this._subscribeApp();
  }

  _getCanvasLocalCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  _rotatePieceOrGroupAt(sx, sy) {
    const target =
      this.vs.draggingGroupId !== null
        ? this.app.getGroupPieces(this.vs.draggingGroupId)[0]
        : this.app.hitTest(this.vs.screenToWorld(sx, sy).x, this.vs.screenToWorld(sx, sy).y);
    if (!target) return false;
    const rotated = this.app.submitRotate(target);
    if (rotated && this.vs.draggingGroupId !== null) {
      this.app.sendDragPreview(this.vs.draggingGroupId, true);
    }
    return rotated;
  }

  _finishDrag(e) {
    this.prevButtons = e.buttons ?? 0;
    if (e.type === 'pointerup' && e.button === 2) {
      this._handledRightPointerDown = false;
      return;
    }
    if (this.isPanning || this.isDraggingRefSheet) {
      this.isPanning = false;
      this.isDraggingRefSheet = false;
      this.canvas.classList.remove('grabbing');
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      return;
    }
    if (this.vs.draggingGroupId !== null) {
      const groupId = this.vs.draggingGroupId;
      this.vs.setDraggingGroup(null);
      this.canvas.classList.remove('grabbing');
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.app.submitDrop(groupId);
    }
  }

  _bindEvents() {
    this._bindPointerDownEvents();
    this._bindPointerMoveEvents();
    this._bindPointerUpEvents();
    this._bindMouseEvents();
    this._bindWheelEvents();
    this._bindKeyboardEvents();
    this._bindZoomControls();
    this._bindFileDropEvents();
    this._bindBeforeUnloadEvent();
  }

  _bindPointerDownEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      const { sx, sy } = this._getCanvasLocalCoords(e);
      this.lastPointerScreen = { x: sx, y: sy };
      this.prevButtons = e.buttons ?? 0;

      if (e.button === 2) {
        this._handledRightPointerDown = true;
        this._rotatePieceOrGroupAt(sx, sy);
        return;
      }
      if (e.button === 1 || (e.button === 0 && this.spacePressed)) {
        this.isPanning = true;
        this.canvas.classList.add('grabbing');
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;

      const world = this.vs.screenToWorld(sx, sy);
      const hit = this.app.hitTest(world.x, world.y);

      if (hit) {
        const lockRes = this.app.requestLock(hit.groupId);
        if (!lockRes.allowed) return;
        this.vs.setDraggingGroup(hit.groupId);
        this.vs.setHoveredPiece(hit);
        this.app.bringGroupToFront(hit.groupId);
        this.canvas.classList.add('grabbing');
        this.canvas.setPointerCapture(e.pointerId);
        this.vs.requestRender();
      } else if (this.vs.isPointInRefSheet(world.x, world.y)) {
        this.isDraggingRefSheet = true;
        this.canvas.classList.add('grabbing');
        this.canvas.setPointerCapture(e.pointerId);
      } else {
        this.isPanning = true;
        this.canvas.classList.add('grabbing');
        this.canvas.setPointerCapture(e.pointerId);
      }
    });
  }

  _bindPointerMoveEvents() {
    this.canvas.addEventListener('pointermove', (e) => {
      const { sx, sy } = this._getCanvasLocalCoords(e);
      this.ojama.updateSpotlightPosition(sx, sy);

      const curButtons = e.buttons ?? 0;
      const rightJustPressed = (curButtons & 2) !== 0 && (this.prevButtons & 2) === 0;
      this.prevButtons = curButtons;
      if (rightJustPressed && this.vs.draggingGroupId !== null) {
        this._handledRightPointerDown = true;
        this._rotatePieceOrGroupAt(sx, sy);
      }

      const dxScreen = sx - this.lastPointerScreen.x;
      const dyScreen = sy - this.lastPointerScreen.y;
      this.lastPointerScreen = { x: sx, y: sy };

      if (this.isPanning) {
        this.vs.panBy(dxScreen, dyScreen);
        return;
      }

      const world = this.vs.screenToWorld(sx, sy);
      this.app.sendCursorMove(world.x, world.y);

      if (this.isDraggingRefSheet) {
        this.vs.moveRefSheetBy(dxScreen, dyScreen);
        return;
      }

      if (this.vs.draggingGroupId !== null) {
        this.app.moveGroup(
          this.vs.draggingGroupId,
          dxScreen / this.vs.camera.scale,
          dyScreen / this.vs.camera.scale,
        );
        this.app.sendDragPreview(this.vs.draggingGroupId);
        this.vs.requestRender();
        return;
      }

      const hit = this.app.hitTest(world.x, world.y);
      const overSheet = !hit && this.vs.isPointInRefSheet(world.x, world.y);
      this.vs.setHoveredPiece(hit);
      this.canvas.style.cursor = hit || overSheet ? 'pointer' : 'grab';
    });
  }

  _bindPointerUpEvents() {
    this.canvas.addEventListener('pointerup', (e) => this._finishDrag(e));
    this.canvas.addEventListener('pointercancel', (e) => this._finishDrag(e));
  }

  _bindMouseEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      if (this._handledRightPointerDown) {
        this._handledRightPointerDown = false;
        return;
      }
      const { sx, sy } = this._getCanvasLocalCoords(e);
      this.prevButtons |= 2;
      this._rotatePieceOrGroupAt(sx, sy);
    });

    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button === 2) {
        this.prevButtons &= ~2;
        this._handledRightPointerDown = false;
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    this.canvas.addEventListener('dblclick', (e) => {
      const { sx, sy } = this._getCanvasLocalCoords(e);
      const world = this.vs.screenToWorld(sx, sy);
      this.app.submitFlip(this.app.hitTest(world.x, world.y));
    });
  }

  _bindWheelEvents() {
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const { sx, sy } = this._getCanvasLocalCoords(e);
        const factor =
          e.deltaY < 0 ? VIEWPORT_CONFIG.ZOOM_STEP_WHEEL : 1 / VIEWPORT_CONFIG.ZOOM_STEP_WHEEL;
        this.vs.zoomAt(sx, sy, factor);
        this.updateZoomReadout();
      },
      { passive: false },
    );
  }

  _bindKeyboardEvents() {
    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;
      if (e.code === 'Space') {
        this.spacePressed = true;
      } else if (e.key === 'r' || e.key === 'R') {
        const target =
          this.vs.draggingGroupId !== null
            ? this.app.getGroupPieces(this.vs.draggingGroupId)[0]
            : this.vs.hoveredPiece;
        this.app.submitRotate(target);
      } else if (e.key === 'f' || e.key === 'F') {
        const target =
          this.vs.draggingGroupId !== null
            ? this.app.getGroupPieces(this.vs.draggingGroupId)[0]
            : this.vs.hoveredPiece;
        this.app.submitFlip(target);
      } else if (e.key === '0') {
        this.fitViewAndSync();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spacePressed = false;
    });
  }

  _bindZoomControls() {
    document.getElementById('btnZoomIn').addEventListener('click', () => {
      this.vs.setScale(this.vs.camera.scale * VIEWPORT_CONFIG.ZOOM_STEP_BUTTON);
      this.updateZoomReadout();
    });
    document.getElementById('btnZoomOut').addEventListener('click', () => {
      this.vs.setScale(this.vs.camera.scale / VIEWPORT_CONFIG.ZOOM_STEP_BUTTON);
      this.updateZoomReadout();
    });
    document.getElementById('btnResetView').addEventListener('click', () => this.fitViewAndSync());

    const zoomReadout = document.getElementById('zoomReadout');
    const resetTo100Pct = () => {
      this.vs.setScale(1.0);
      this.updateZoomReadout();
    };
    zoomReadout?.addEventListener('click', resetTo100Pct);
    zoomReadout?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        resetTo100Pct();
      }
    });
  }

  _bindFileDropEvents() {
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
          (imgCanvas, name) => this.loading.run(() => this.app.setCustomImage(imgCanvas, name)),
          (msg) => this.showToast(msg, 'ojama'),
        );
      }
    });
  }

  _bindBeforeUnloadEvent() {
    window.addEventListener('beforeunload', (e) => {
      if (this.app.shouldWarnBeforeUnload()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  _subscribeApp() {
    this.app.on('renderNeeded', () => this.vs.requestRender());
    this.app.on('lockDenied', ({ groupId }) => {
      if (this.vs.draggingGroupId === groupId) {
        this.vs.setDraggingGroup(null);
        this.canvas.classList.remove('grabbing');
      }
    });
    this.app.on('snapEffect', ({ pieces }) => this.vs.addSnapFlashes(pieces));
    this.app.on('ojamaDropEffect', ({ pieces }) => this.vs.playDropEffect(pieces));
    this.app.on('superchatHitEffect', ({ x, y }) => this.vs.playSuperchatHit(x, y));
    this.app.on('superchatDefeatEffect', ({ x, y }) => this.vs.playSuperchatDefeat(x, y));
    this.app.on('ojamaPrankEffect', ({ pieces, before }) =>
      this.vs.playPrankEffect(pieces, before),
    );
    this.app.on('puzzleReset', ({ canvas: srcCanvas, resetEffects, fitView }) => {
      this.vs.resetForNewPuzzle({ clearEffects: resetEffects });
      this.vs.resetRefSheetGeometry(srcCanvas);
      if (fitView) this.fitViewAndSync();
    });
  }
}
