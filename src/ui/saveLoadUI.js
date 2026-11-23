import { downloadJsonFile, MAX_SAVE_TEXT_LENGTH, parseSaveText } from '../services/storage.js';
import { loadImageFromFile } from '../services/imageLoader.js';

export class SaveLoadUI {
  constructor({ app, showToast }) {
    this.app = app;
    this.showToast = showToast;

    this.pendingSaveData = null;
    this.pendingSaveImageCanvas = null;

    this.elLoadJsonInput = document.getElementById('loadJsonInput');
    this.elLoadImageInput = document.getElementById('loadImageInput');
    this.elLoadedJsonSummary = document.getElementById('loadedJsonSummary');
    this.elBtnApplyLoad = document.getElementById('btnApplyLoad');
    this.elBtnApplyLoadSample = document.getElementById('btnApplyLoadSample');

    this._bindEvents();
  }

  _bindEvents() {
    document.getElementById('btnDownloadSave').addEventListener('click', () => {
      const payload = this.app.exportSaveData();
      const filename = downloadJsonFile(payload);
      this.showToast(`セーブデータを保存しました（${filename}）`, 'success');
    });

    this.elLoadJsonInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_SAVE_TEXT_LENGTH) {
        this._rejectSaveFile('セーブファイルが大きすぎます');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = parseSaveText(String(reader.result));
        if (!result.ok) {
          this._rejectSaveFile(result.error);
          return;
        }
        this.pendingSaveData = result.data;
        this.updateLoadedSaveSummary();
      };
      reader.readAsText(file);
    });

    this.elLoadImageInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      loadImageFromFile(
        file,
        (imgCanvas, name) => {
          if (this.pendingSaveImageCanvas && this.pendingSaveImageCanvas !== imgCanvas) {
            this.pendingSaveImageCanvas.width = 0;
            this.pendingSaveImageCanvas.height = 0;
          }
          this.pendingSaveImageCanvas = imgCanvas;
          this.pendingSaveImageCanvas._fileName = name;
          this.updateLoadedSaveSummary();
        },
        (msg) => this.showToast(msg, 'ojama'),
      );
    });

    this.elBtnApplyLoad.addEventListener('click', () => this.executeRestore(false));
    this.elBtnApplyLoadSample.addEventListener('click', () => this.executeRestore(true));

    document.getElementById('btnResetSettings').addEventListener('click', () => {
      this.app.resetSettingsToDefault();
    });
  }

  /** Drops the pending save and tells the user why the file was refused. */
  _rejectSaveFile(message) {
    this.pendingSaveData = null;
    this.updateLoadedSaveSummary();
    this.showToast(message, 'ojama');
  }

  refreshLoadButtons() {
    if (!this.pendingSaveData) {
      this.elBtnApplyLoad.disabled = true;
      this.elBtnApplyLoadSample.disabled = true;
      return;
    }
    this.elBtnApplyLoad.disabled = !this.pendingSaveImageCanvas;
    this.elBtnApplyLoadSample.disabled = false;
  }

  updateLoadedSaveSummary() {
    if (!this.pendingSaveData) {
      this.elLoadedJsonSummary.classList.add('hidden');
      this.elLoadedJsonSummary.classList.remove('warn');
      this.refreshLoadButtons();
      return;
    }

    const locked = this.pendingSaveData.pieces.filter((p) => p.isLocked).length;
    const puz = this.pendingSaveData.puzzle;
    this.elLoadedJsonSummary.classList.remove('hidden', 'warn');

    // Save files are untrusted input: build nodes and set text only, never markup.
    const total = this.pendingSaveData.pieces.length;
    const label = document.createElement('b');
    label.textContent = '読み込み待機中:';
    const lines = [
      [
        label,
        ` ${puz.cols}×${puz.rows}（${total}ピース） / 進捗 ${locked}/${total} / seed: ${puz.seed}`,
      ],
      [
        `元画像種別: ${
          puz.isSampleImage
            ? 'サンプル画像'
            : `ローカル画像（${puz.imageWidth}×${puz.imageHeight}）`
        }`,
      ],
    ];

    if (this.pendingSaveImageCanvas) {
      const match = document.createElement('span');
      if (this.app.verifySaveImageMatch(this.pendingSaveImageCanvas, this.pendingSaveData)) {
        match.className = 'match-ok';
        match.textContent = '一致: セーブ時と同一の画像です';
      } else {
        this.elLoadedJsonSummary.classList.add('warn');
        match.className = 'match-warn';
        match.textContent = '注意: セーブ時と異なる画像ですが復元可能です';
      }
      lines.push([match]);
    }

    const nodes = lines.flatMap((parts, i) =>
      i === 0 ? parts : [document.createElement('br'), ...parts],
    );
    this.elLoadedJsonSummary.replaceChildren(...nodes);
    this.refreshLoadButtons();
  }

  executeRestore(useSample) {
    if (!this.pendingSaveData) return;
    if (!useSample && !this.pendingSaveImageCanvas) return;
    const imgCanvas = this.pendingSaveImageCanvas;
    this.app.restoreFromSaveData(this.pendingSaveData, imgCanvas, useSample, imgCanvas?._fileName);
    if (useSample && imgCanvas) {
      imgCanvas.width = 0;
      imgCanvas.height = 0;
    }
    this.pendingSaveImageCanvas = null;
    this.refreshLoadButtons();
  }
}
