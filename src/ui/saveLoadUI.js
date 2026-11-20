import { downloadJsonFile } from '../services/storage.js';
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
      this.showToast(`セーブデータを保存しました (${filename})`, 'success');
    });

    this.elLoadJsonInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          if (!parsed.puzzle || !Array.isArray(parsed.pieces)) {
            throw new Error('Invalid save schema');
          }
          this.pendingSaveData = parsed;
          this.updateLoadedSaveSummary();
        } catch {
          this.pendingSaveData = null;
          this.updateLoadedSaveSummary();
          this.showToast('JSONファイルの形式が正しくありません', 'ojama');
        }
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

    let html =
      `<b>読込待機中:</b> ${puz.cols}×${puz.rows} (${this.pendingSaveData.pieces.length}ピース) / ` +
      `進捗 ${locked}/${this.pendingSaveData.pieces.length} / seed: ${puz.seed}<br>` +
      `元画像種別: ${
        puz.isSampleImage ? 'サンプル画像' : `ローカル画像 (${puz.imageWidth}×${puz.imageHeight})`
      }`;

    if (this.pendingSaveImageCanvas) {
      if (this.app.verifySaveImageMatch(this.pendingSaveImageCanvas, this.pendingSaveData)) {
        html += `<br><span class="match-ok">一致: セーブ時と同一の画像です</span>`;
      } else {
        this.elLoadedJsonSummary.classList.add('warn');
        html += `<br><span class="match-warn">注意: セーブ時と異なる画像ですが復元可能です</span>`;
      }
    }

    this.elLoadedJsonSummary.innerHTML = html;
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
