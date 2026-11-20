import { drawCanvasFit, loadImageFromFile } from '../services/imageLoader.js';

export class SetupDrawerUI {
  constructor({ app, renderer, showToast }) {
    this.app = app;
    this.renderer = renderer;
    this.showToast = showToast;

    this.elModal = document.getElementById('puzzleSetupModal');
    this.elBtnCloseModal = document.getElementById('btnCloseSetupModal');
    this.elBtnCancelModal = document.getElementById('btnCancelSetupModal');
    this.elBtnOpenFromMenu = document.getElementById('btnOpenSetupFromMenu');
    this.elBtnOpenFromSolo = document.getElementById('btnOpenSetupFromSolo');
    this.elBtnOpenFromHost = document.getElementById('btnOpenSetupFromHost');
    this.elLobbySoloSummary = document.getElementById('lobbySoloPuzzleSummary');
    this.elLobbyHostSummary = document.getElementById('lobbyHostPuzzleSummary');

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

    this._bindEvents();
    this._subscribeApp();
    this.syncSettings(this.app.getSettings());
  }

  openModal() {
    this.syncSettings(this.app.getSettings());
    this.updatePreviewStrip();
    this.elModal?.classList.remove('hidden');
  }

  closeModal() {
    this.elModal?.classList.add('hidden');
  }

  updateZoomReadout() {
    this.elZoomReadout.textContent = `${Math.round(this.renderer.view.scale * 100)}%`;
  }

  fitViewAndSync() {
    this.renderer.fitView();
    this.updateZoomReadout();
  }

  applyReferenceModeUI() {
    const settings = this.app.getSettings();
    const { canvas: srcCanvas } = this.app.getSourceImage();
    const mode = settings.referenceMode || 'underlay';
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

  updatePreviewStrip() {
    const { canvas: srcCanvas, name } = this.app.getSourceImage();
    const settings = this.app.getSettings();
    drawCanvasFit(this.elPreviewCanvas, srcCanvas);
    if ((settings.referenceMode || 'underlay') === 'floating') {
      drawCanvasFit(this.elFloatingRefCanvas, srcCanvas);
    }
    this.elImageSourceLabel.textContent = name;
    this.elImageDimLabel.textContent = `${srcCanvas.width} × ${srcCanvas.height} px`;
    this.updateLobbySummaries();
  }

  updateLobbySummaries() {
    const { name } = this.app.getSourceImage();
    const s = this.app.getSettings();
    const summary = `現在の設定: ${name} / ${s.cols}×${s.rows} (${s.cols * s.rows}ピース)`;
    if (this.elLobbySoloSummary) this.elLobbySoloSummary.textContent = summary;
    if (this.elLobbyHostSummary) this.elLobbyHostSummary.textContent = summary;
  }

  updatePresetHighlight() {
    const settings = this.app.getSettings();
    document.querySelectorAll('#splitPresets .btn-seg').forEach((btn) => {
      const targetCount = Number(btn.dataset.count);
      const grid = this.app.computeGridForPieceCount(targetCount);
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
        this.app.patchSettings({ referenceMode: btn.dataset.refMode || 'underlay' });
      });
    });

    document.getElementById('imageFileInput').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        loadImageFromFile(
          file,
          (imgCanvas, name) => this.app.setCustomImage(imgCanvas, name),
          (msg) => this.showToast(msg, 'ojama'),
        );
      }
      e.target.value = '';
    });

    document.getElementById('btnUseSampleImage').addEventListener('click', () => {
      this.app.useSampleImage();
    });

    this.elGuideOpacityRange.addEventListener('input', () => {
      this._readAndPatch();
    });

    document.querySelectorAll('#splitPresets .btn-seg').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { cols, rows } = this.app.computeGridForPieceCount(Number(btn.dataset.count));
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
      this.app.startNewPuzzle();
      this.closeModal();
      const s = this.app.getSettings();
      this.showToast(`${s.cols}×${s.rows} で新しいパズルを開始しました`, 'success');
    });
  }

  _subscribeApp() {
    this.app.on('settingsChange', (s) => this.syncSettings(s));
    this.app.on('puzzleReset', () => {
      this.updatePreviewStrip();
      this.applyReferenceModeUI();
    });
  }
}
