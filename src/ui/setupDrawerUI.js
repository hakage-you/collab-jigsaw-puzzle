import { referenceModeOf } from '../render/viewState.js';
import { drawCanvasCover, drawCanvasFit, loadImageFromFile } from '../services/imageLoader.js';
import {
  generateSampleImageCanvas,
  getSamplePreset,
  loadSampleImageCanvas,
  normalizeSampleImageId,
} from '../services/sampleImage.js';

export class SetupDrawerUI {
  constructor({ app, renderer, loading, showToast }) {
    this.app = app;
    this.renderer = renderer;
    this.loading = loading;
    this.showToast = showToast;
    /** An image picked in this dialog: the puzzle switches to it only when Start is pressed. */
    this.pendingImage = null;

    this.elModal = document.getElementById('puzzleSetupModal');
    this.elBtnCloseModal = document.getElementById('btnCloseSetupModal');
    this.elBtnCancelModal = document.getElementById('btnCancelSetupModal');
    this.elBtnOpenFromMenu = document.getElementById('btnOpenSetupFromMenu');
    this.elBtnOpenFromSolo = document.getElementById('btnOpenSetupFromSolo');
    this.elBtnOpenFromHost = document.getElementById('btnOpenSetupFromHost');
    this.elLobbySoloSummary = document.getElementById('lobbySoloPuzzleSummary');
    this.elLobbyHostSummary = document.getElementById('lobbyHostPuzzleSummary');
    this.elLobbySoloPreview = document.getElementById('lobbySoloPreviewCanvas');
    this.elLobbyHostPreview = document.getElementById('lobbyHostPreviewCanvas');

    this.elInputCols = document.getElementById('inputCols');
    this.elInputRows = document.getElementById('inputRows');
    this.elInputSeed = document.getElementById('inputSeed');
    this.elOptCutComplexity = document.getElementById('optCutComplexity');
    this.elOptAllowRotation = document.getElementById('optAllowRotation');
    this.elOptAllowFlip = document.getElementById('optAllowFlip');
    this.elUnderlayOpacityRow = document.getElementById('underlayOpacityRow');
    this.elGuideOpacityRange = document.getElementById('guideOpacityRange');

    this.elPreviewCanvas = document.getElementById('previewCanvas');
    this.elImageSourceLabel = document.getElementById('imageSourceLabel');
    this.elImageDimLabel = document.getElementById('imageDimLabel');
    this.elFloatingRefWindow = document.getElementById('floatingRefWindow');
    this.elFloatingRefCanvas = document.getElementById('floatingRefCanvas');
    this.elBtnToggleRefCollapse = document.getElementById('btnToggleRefCollapse');
    this.elZoomReadout = document.getElementById('zoomReadout');

    this._thumbsRendered = false;
    this._thumbCache = new Map();
    this._bindEvents();
    this._subscribeApp();
    this.syncSettings(this.app.getSettings());
    this.updatePreviewStrip();
  }

  openModal() {
    this.pendingImage = null;
    if (!this._thumbsRendered) {
      this._thumbsRendered = true;
      this._renderSamplePresetThumbnails();
    }
    this.syncSettings(this.app.getSettings());
    this.updatePreviewStrip();
    this.elModal?.classList.remove('hidden');
  }

  closeModal() {
    this.elModal?.classList.add('hidden');
    if (this.pendingImage) {
      this.pendingImage = null;
      this.updatePreviewStrip();
      this.updatePresetHighlight();
    }
  }

  /** The image the dialog is set up for: the one just picked, or the current puzzle's. */
  _image() {
    return this.pendingImage ?? this.app.getSourceImage();
  }

  _imageDims(img = this._image()) {
    return {
      width: img?.width || img?.canvas?.width || 960,
      height: img?.height || img?.canvas?.height || 640,
    };
  }

  /** Picks an image for the next puzzle, keeping about the same number of pieces. */
  _pickImage(image) {
    this.pendingImage = image;
    const total = Number(this.elInputCols.value) * Number(this.elInputRows.value);
    const { cols, rows } = this.app.computeGridForPieceCount(total, this._imageDims(image));
    this.elInputCols.value = cols;
    this.elInputRows.value = rows;
    this._readAndPatch();
    this.updatePreviewStrip();
  }

  updateZoomReadout() {
    this.elZoomReadout.textContent = `${Math.round(this.renderer.viewState.camera.scale * 100)}%`;
  }

  fitViewAndSync() {
    this.renderer.fitView();
    this.updateZoomReadout();
  }

  applyReferenceModeUI() {
    const settings = this.app.getSettings();
    const { canvas: srcCanvas } = this.app.getSourceImage();
    const mode = referenceModeOf(settings);
    document.querySelectorAll('#referenceModeGroup .btn-seg').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.refMode === mode);
    });
    this.elGuideOpacityRange.value = String(settings.guideOpacity ?? 14);
    this.elUnderlayOpacityRow.classList.toggle('hidden', mode !== 'underlay');
    this.elFloatingRefWindow.classList.toggle('hidden', mode !== 'floating');
    if (mode === 'floating') {
      drawCanvasFit(this.elFloatingRefCanvas, srcCanvas);
    }
    this.renderer.requestRender();
  }

  _drawPreviewTo(canvas, img) {
    if (!canvas || !img) return;
    if (img.previewCanvas) {
      drawCanvasCover(canvas, img.previewCanvas);
      return;
    }
    if (img.needsLoad && img.thumbUrl) {
      let thumb = this._thumbCache.get(img.thumbUrl);
      if (!thumb) {
        thumb = new Image();
        thumb.onload = () => {
          if (this._image()?.thumbUrl === img.thumbUrl) this.updatePreviewStrip();
        };
        thumb.src = img.thumbUrl;
        this._thumbCache.set(img.thumbUrl, thumb);
      }
      if (thumb.complete && thumb.naturalWidth > 0) drawCanvasCover(canvas, thumb);
      return;
    }
    if (img.canvas) drawCanvasCover(canvas, img.canvas);
  }

  updatePreviewStrip() {
    const img = this._image();
    const { width, height } = this._imageDims(img);
    const settings = this.app.getSettings();
    this._drawPreviewTo(this.elPreviewCanvas, img);
    if (!this.pendingImage && referenceModeOf(settings) === 'floating') {
      drawCanvasFit(this.elFloatingRefCanvas, img?.canvas);
    }
    this.elImageSourceLabel.textContent = img?.name || '';
    this.elImageDimLabel.textContent = `${width} × ${height} px`;
    this.updateSamplePresetHighlight();
    this.updateLobbySummaries();
  }

  updateSamplePresetHighlight() {
    const img = this._image();
    document.querySelectorAll('[data-sample-preset]').forEach((btn) => {
      const active = Boolean(img?.isSample && img.sampleId === btn.dataset.samplePreset);
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  updateLobbySummaries() {
    const img = this._image();
    const s = this.app.getSettings();
    const summary = `現在の設定: ${img?.name || ''} / ${s.cols}×${s.rows}（${s.cols * s.rows}ピース）`;
    if (this.elLobbySoloSummary) this.elLobbySoloSummary.textContent = summary;
    if (this.elLobbyHostSummary) this.elLobbyHostSummary.textContent = summary;
    this._drawPreviewTo(this.elLobbySoloPreview, img);
    this._drawPreviewTo(this.elLobbyHostPreview, img);
  }

  updatePresetHighlight() {
    const settings = this.app.getSettings();
    const dims = this._imageDims();
    document.querySelectorAll('#splitPresets .btn-seg').forEach((btn) => {
      const targetCount = Number(btn.dataset.count);
      const grid = this.app.computeGridForPieceCount(targetCount, dims);
      btn.classList.toggle('active', grid.cols === settings.cols && grid.rows === settings.rows);
    });
  }

  syncSettings(settings) {
    this.elInputCols.value = settings.cols;
    this.elInputRows.value = settings.rows;
    this.elInputSeed.value = settings.seed;
    this.elOptCutComplexity.value = this.app.normalizeCutComplexity(settings.cutComplexity);
    this.elOptAllowRotation.checked = settings.allowRotation;
    this.elOptAllowFlip.checked = settings.allowFlip;
    this.applyReferenceModeUI();
    this.updatePresetHighlight();
    this.updateLobbySummaries();
  }

  _readAndPatch() {
    this.app.patchSettings({
      cols: Number(this.elInputCols.value),
      rows: Number(this.elInputRows.value),
      seed: Number(this.elInputSeed.value) || 1,
      cutComplexity: this.elOptCutComplexity.value,
      allowRotation: this.elOptAllowRotation.checked,
      allowFlip: this.elOptAllowFlip.checked,
      guideOpacity: Number(this.elGuideOpacityRange.value) || 0,
    });
  }

  _bindEvents() {
    this.elBtnOpenFromMenu?.addEventListener('click', () => this.openModal());
    this.elBtnOpenFromSolo?.addEventListener('click', () => this.openModal());
    this.elBtnOpenFromHost?.addEventListener('click', () => this.openModal());
    this.elBtnCloseModal?.addEventListener('click', () => this.closeModal());
    this.elBtnCancelModal?.addEventListener('click', () => this.closeModal());
    this.elModal?.addEventListener('click', (e) => {
      if (e.target === this.elModal) this.closeModal();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.elModal && !this.elModal.classList.contains('hidden')) {
        e.preventDefault();
        this.closeModal();
      }
    });

    document.querySelectorAll('#referenceModeGroup .btn-seg').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.app.patchSettings({
          referenceMode: referenceModeOf({ referenceMode: btn.dataset.refMode }),
        });
      });
    });

    this._bindImagePicks();

    this.elGuideOpacityRange.addEventListener('input', () => {
      this._readAndPatch();
    });

    document.querySelectorAll('#splitPresets .btn-seg').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { cols, rows } = this.app.computeGridForPieceCount(
          Number(btn.dataset.count),
          this._imageDims(),
        );
        this.elInputCols.value = cols;
        this.elInputRows.value = rows;
        this._readAndPatch();
      });
    });

    document.getElementById('btnRandomSeed').addEventListener('click', () => {
      this.elInputSeed.value = String(Math.floor(100000 + Math.random() * 899999));
      this._readAndPatch();
    });

    [
      this.elInputCols,
      this.elInputRows,
      this.elInputSeed,
      this.elOptCutComplexity,
      this.elOptAllowRotation,
      this.elOptAllowFlip,
    ].forEach((el) => {
      el.addEventListener('change', () => this._readAndPatch());
    });

    this.elBtnToggleRefCollapse.addEventListener('click', () => {
      const collapsed = this.elFloatingRefWindow.classList.toggle('collapsed');
      this.elBtnToggleRefCollapse.textContent = collapsed ? '＋' : '－';
    });

    document.getElementById('btnNewPuzzle').addEventListener('click', () => {
      this._readAndPatch();
      const picked = this.pendingImage;
      this.pendingImage = null;
      this.closeModal();
      this.loading.run(async () => {
        const current = this.app.getSourceImage();
        let nextImage = picked;
        if (nextImage?.needsLoad) {
          nextImage.canvas = await loadSampleImageCanvas(nextImage.sampleId);
        } else if (!nextImage && current?.needsLoad) {
          const canvas = await loadSampleImageCanvas(current.sampleId);
          nextImage = { canvas, name: current.name, isSample: true, sampleId: current.sampleId };
        }
        this.app.startNewPuzzle(nextImage);
        const s = this.app.getSettings();
        this.showToast(`${s.cols}×${s.rows} で新しいパズルを開始しました`, 'success');
      });
    });
  }

  _renderSamplePresetThumbnails() {
    for (const btn of document.querySelectorAll('[data-sample-preset]')) {
      const thumb = btn.querySelector('canvas');
      if (!thumb) continue;
      const sampleId = normalizeSampleImageId(btn.dataset.samplePreset);
      const preset = getSamplePreset(sampleId);
      if (preset.kind === 'artwork' && preset.thumbUrl) {
        const img = new Image();
        img.onload = () => drawCanvasCover(thumb, img);
        img.src = preset.thumbUrl;
        continue;
      }
      const sample = generateSampleImageCanvas(180, 120, sampleId);
      drawCanvasCover(thumb, sample);
      sample.width = 0;
      sample.height = 0;
    }
  }

  /** Picking a file or a sample only reserves it; Start loads/generates the full image. */
  _bindImagePicks() {
    document.getElementById('imageFileInput').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        loadImageFromFile(
          file,
          (canvas, name) => this._pickImage({ canvas, name, isSample: false }),
          (msg) => this.showToast(msg, 'ojama'),
        );
      }
      e.target.value = '';
    });

    for (const btn of document.querySelectorAll('[data-sample-preset]')) {
      btn.addEventListener('click', () => {
        const sampleId = normalizeSampleImageId(btn.dataset.samplePreset);
        const preset = getSamplePreset(sampleId);
        const thumb = btn.querySelector('canvas');
        this._pickImage({
          previewCanvas: thumb || null,
          width: preset.width,
          height: preset.height,
          name: preset.name,
          isSample: true,
          sampleId,
          needsLoad: true,
        });
      });
    }
  }

  _subscribeApp() {
    this.app.on('settingsChange', (s) => this.syncSettings(s));
    this.app.on('puzzleReset', () => {
      this.updatePreviewStrip();
      this.applyReferenceModeUI();
    });
  }
}
