import { COLOR_BUCKETS } from '../config/constants.js';
import {
  buildDiagnosticReport,
  clearDiagnostics,
  formatDiagnosticText,
  getDiagnosticsState,
  initDiagnostics,
  recordDiagnostic,
  subscribeDiagnostics,
} from '../services/diagnostics.js';
import { PuzzleEngine } from '../core/puzzleEngine.js';
import {
  clampGridDimensions,
  computeGridForPieceCount,
  normalizeCutComplexity,
} from '../core/jigsawPath.js';
import { validateSaveData } from '../core/saveValidation.js';
import {
  clearAutoBackup,
  loadSavedSettings,
  resetSavedSettings,
  saveSettings,
} from '../services/storage.js';
import { sound } from '../services/sound.js';
import { computeImageSignature, imageAnalyzer } from '../services/imagePixels.js';
import { generateSampleImageCanvas } from '../services/sampleImage.js';
import { RoomController } from '../net/roomController.js';
import { createRoomCallbacks } from './roomCallbacks.js';

export class GameSession {
  constructor() {
    initDiagnostics();
    this.listeners = new Map();
    this.engine = new PuzzleEngine({ imageAnalyzer });
    this.settings = loadSavedSettings();
    sound.enabled = this.settings.soundEnabled;

    this.sourceImage = {
      canvas: generateSampleImageCanvas(),
      name: 'サンプルテスト画像',
      isSample: true,
    };
    this.knockQueue = [];
    this.highlightFilter = 'all';

    this.room = new RoomController({
      engine: this.engine,
      getSettings: () => this.settings,
      getSourceState: () => ({
        sourceCanvas: this.sourceImage.canvas,
        isSampleImage: this.sourceImage.isSample,
      }),
      callbacks: createRoomCallbacks(this),
    });
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const fn of handlers) {
      fn(payload);
    }
  }

  // ---------- Settings & Rules ----------

  getSettings() {
    return this.settings;
  }

  normalizeCutComplexity(val) {
    return normalizeCutComplexity(val);
  }

  computeGridForPieceCount(targetCount) {
    const { canvas } = this.sourceImage;
    return computeGridForPieceCount(targetCount, canvas?.width, canvas?.height);
  }

  patchSettings(partial) {
    const nextOjama = partial.ojama
      ? { ...this.settings.ojama, ...partial.ojama }
      : this.settings.ojama;
    const clampedGrid = clampGridDimensions(
      partial.cols ?? this.settings.cols,
      partial.rows ?? this.settings.rows,
    );
    this.settings = {
      ...this.settings,
      ...partial,
      cols: clampedGrid.cols,
      rows: clampedGrid.rows,
      cutComplexity: normalizeCutComplexity(partial.cutComplexity ?? this.settings.cutComplexity),
      ojama: nextOjama,
    };
    sound.enabled = this.settings.soundEnabled;
    saveSettings(this.settings);
    this.emit('settingsChange', this.settings);
    this.emit('hudUpdate');
    this.emit('renderNeeded');
  }

  toggleTheme() {
    const next = this.settings.theme === 'dark' ? 'light' : 'dark';
    this.patchSettings({ theme: next });
    return next;
  }

  resetSettingsToDefault() {
    this.settings = resetSavedSettings();
    sound.enabled = this.settings.soundEnabled;
    this.emit('settingsChange', this.settings);
    this.emit('hudUpdate');
    this.emit('toast', { message: '設定を初期値にリセットしました', kind: 'info' });
  }

  getAllowRotation() {
    if (this.room.isGuest() && this.room.roomRules) return this.room.roomRules.allowRotation;
    return this.settings.allowRotation;
  }

  getAllowFlip() {
    if (this.room.isGuest() && this.room.roomRules) return this.room.roomRules.allowFlip;
    return this.settings.allowFlip;
  }

  // ---------- Puzzle & Image Lifecycle ----------

  createSampleCanvas() {
    return generateSampleImageCanvas();
  }

  getSourceImage() {
    return this.sourceImage;
  }

  _replaceSourceImage(canvas, name, isSample) {
    const prev = this.sourceImage?.canvas;
    if (prev && prev !== canvas && prev !== this.engine.sourceCanvas) {
      prev.width = 0;
      prev.height = 0;
    }
    this.sourceImage = { canvas, name, isSample };
  }

  _syncGridToSourceAspect(canvas) {
    if (!canvas) return;
    const currentTotal = this.settings.cols * this.settings.rows;
    const { cols, rows } = computeGridForPieceCount(currentTotal, canvas.width, canvas.height);
    if (cols !== this.settings.cols || rows !== this.settings.rows) {
      this.patchSettings({ cols, rows });
    }
  }

  setCustomImage(imgCanvas, name) {
    this._replaceSourceImage(imgCanvas, name, false);
    this._syncGridToSourceAspect(imgCanvas);
    this.startNewPuzzle();
    this.emit('toast', { message: `「${name}」でパズルを開始しました`, kind: 'success' });
  }

  useSampleImage() {
    const sample = generateSampleImageCanvas();
    this._replaceSourceImage(sample, 'サンプルテスト画像', true);
    this._syncGridToSourceAspect(sample);
    this.startNewPuzzle();
    this.emit('toast', { message: 'サンプルテスト画像を生成しました', kind: 'success' });
  }

  startNewPuzzle() {
    this.highlightFilter = 'all';
    this.room.resetContributions();
    this.engine.initPuzzle({
      sourceCanvas: this.sourceImage.canvas,
      isSampleImage: this.sourceImage.isSample,
      cols: this.settings.cols,
      rows: this.settings.rows,
      seed: this.settings.seed,
      cutComplexity: this.settings.cutComplexity,
      allowRotation: this.settings.allowRotation,
      allowFlip: this.settings.allowFlip,
    });
    this.emit('puzzleReset', { ...this.sourceImage, resetEffects: true, fitView: true });
    this._emitRoleChange();
    this.emit('hudUpdate');
    recordDiagnostic('puzzle', 'puzzle_init', {
      cols: this.engine.cols,
      rows: this.engine.rows,
      cutComplexity: this.engine.cutComplexity,
      isSampleImage: this.sourceImage.isSample,
    });
    if (this.room.role === 'host') {
      this.room.broadcastFullState();
    }
  }

  getMyContribution() {
    if (!this.room.isMultiplayer()) {
      return this.engine.stats.placedCount;
    }
    const mine = this.room.roster.find((m) => m.id === this.room.myPlayerId);
    return mine ? mine.contrib : 0;
  }

  exportSaveData() {
    return this.engine.exportSaveData(this.settings, this.room.buildContributionsList());
  }

  verifySaveImageMatch(imgCanvas, saveData) {
    const puz = saveData?.puzzle;
    if (!puz || !imgCanvas) return false;
    const uploadedHash = computeImageSignature(imgCanvas);
    const sameHash = Boolean(puz.imageHash && uploadedHash === puz.imageHash);
    const sameDims = imgCanvas.width === puz.imageWidth && imgCanvas.height === puz.imageHeight;
    return sameHash || (!puz.imageHash && sameDims);
  }

  restoreFromSaveData(rawSaveData, customCanvas, useSample, imgName) {
    const checked = validateSaveData(rawSaveData);
    if (!checked.ok) {
      this.emit('toast', { message: checked.error, kind: 'ojama' });
      return;
    }
    const saveData = checked.data;
    const srcCanvas = useSample ? generateSampleImageCanvas() : customCanvas;
    if (!srcCanvas) return;
    const resolvedName = useSample ? 'サンプルテスト画像 (復元)' : imgName || 'ローカル画像 (復元)';

    if (saveData.settings) {
      this.patchSettings({
        ...saveData.settings,
        cutComplexity: normalizeCutComplexity(
          saveData.puzzle?.cutComplexity || saveData.settings.cutComplexity,
        ),
        ojama: {
          ...this.settings.ojama,
          ...(saveData.settings.ojama || {}),
        },
      });
    }

    this.engine.restoreFromSave(saveData, srcCanvas, useSample);
    this.room.applySavedContributions(saveData.contributions, this.engine.stats.placedCount);
    this._replaceSourceImage(srcCanvas, resolvedName, useSample);
    this.highlightFilter = 'all';
    this.emit('puzzleReset', { ...this.sourceImage, resetEffects: true, fitView: true });
    this.emit('hudUpdate');
    if (this.room.role === 'host') {
      this.room.broadcastFullState();
    }
    this.emit('toast', { message: 'セーブデータからパズルを復元しました', kind: 'success' });
  }

  // ---------- Sorting & Highlighting ----------

  getPresentColorBuckets() {
    const present = new Set(this.engine.pieces.map((p) => p.colorInfo.bucket));
    return COLOR_BUCKETS.filter((b) => present.has(b.id));
  }

  setHighlightFilter(mode) {
    this.highlightFilter = mode;
    this.emit('filterChange', mode);
    this.emit('renderNeeded');
  }

  sortEdges() {
    const res = this.engine.sortEdges(this.room.getLockedGroupIds());
    this.room.broadcastSortResult();
    return {
      ...res,
      toastMessage: `外枠 ${res.edges}個 / 内側 ${res.inner}個を整列しました`,
    };
  }

  sortByColor() {
    const res = this.engine.sortByColor(this.room.getLockedGroupIds());
    this.room.broadcastSortResult();
    return {
      ...res,
      toastMessage: `${res.total}個の単体ピースを ${res.bucketCount}色グループに山分けしました`,
    };
  }

  sortByQuadrant() {
    const res = this.engine.sortByQuadrant(this.room.getLockedGroupIds());
    this.room.broadcastSortResult();
    return {
      ...res,
      toastMessage: `${res.total}個の単体ピースを4分割エリアへ整列しました`,
    };
  }

  alignAllUpright() {
    const changed = this.engine.alignAllUpright(this.room.getLockedGroupIds());
    this.room.broadcastSortResult();
    this.emit('renderNeeded');
    return {
      changed,
      toastMessage: `${changed}個のピースを表・0度向きに整えました`,
    };
  }

  // ---------- Board Interaction Delegation ----------

  hitTest(wx, wy) {
    return this.engine.hitTest(wx, wy);
  }

  getGroupPieces(groupId) {
    return this.engine.getGroupPieces(groupId);
  }

  bringGroupToFront(groupId) {
    this.engine.bringGroupToFront(groupId);
  }

  moveGroup(groupId, dx, dy) {
    this.engine.moveGroup(groupId, dx, dy);
  }

  requestLock(groupId) {
    const res = this.room.requestLock(groupId);
    if (!res.allowed) {
      this.emit('toast', {
        message: `${res.ownerName || '他の参加者'} が操作中です`,
        kind: 'ojama',
      });
    }
    return res;
  }

  sendCursorMove(wx, wy) {
    this.room.sendCursorMove(wx, wy);
  }

  sendDragPreview(groupId, force = false) {
    this.room.sendDragPreview(groupId, force);
  }

  submitDrop(groupId) {
    const res = this.room.submitDrop(groupId);
    if (res.type === 'snap') {
      sound.playSnap();
      this.emit('snapEffect', { pieces: this.engine.getGroupPieces(groupId) });
      this.emit('hudUpdate');
      if (res.completed) {
        this.completePuzzle();
        this.room.broadcastCompletion();
      }
    } else if (res.type === 'merge') {
      sound.playMerge();
      this.emit('toast', {
        message: `ピース結合（塊サイズ: ${res.groupSize}）`,
        kind: 'success',
      });
    }
    this.emit('renderNeeded');
    return res;
  }

  submitRotate(piece) {
    if (piece && this.room.submitRotate(piece, this.getAllowRotation())) {
      sound.playTick();
      this.emit('renderNeeded');
      return true;
    }
    return false;
  }

  submitFlip(piece) {
    if (piece && this.room.submitFlip(piece, this.getAllowFlip())) {
      sound.playTick();
      this.emit('renderNeeded');
      return true;
    }
    return false;
  }

  completePuzzle() {
    if (this.engine.completedFired) return;
    this.engine.completedFired = true;

    if (this.room.role === 'host') {
      clearAutoBackup();
    }
    this.emit('stopYoutubePolling', { reason: 'パズル完成のためコメント連動を自動停止しました' });
    sound.playWin();

    this.emit('puzzleComplete', {
      elapsedMs: this.engine.stats.elapsedMs,
      cols: this.engine.cols,
      rows: this.engine.rows,
      pieceCount: this.engine.pieces.length,
      placedCount: this.engine.stats.placedCount,
      myContrib: this.getMyContribution(),
      ojamaTotal: this.engine.stats.ojamaTotal,
      ojamaBreakdown: { ...this.engine.stats.ojamaBreakdown },
      isMultiplayer: this.room.isMultiplayer(),
      roster: [...this.room.roster],
    });
    this.emit('renderNeeded');
  }

  // ---------- Multiplayer & Lobby ----------

  shouldWarnBeforeUnload() {
    return this.room.shouldWarnBeforeUnload();
  }

  startSolo() {
    this.emit('stopYoutubePolling', { reason: null });
    this.room.close();
    this.knockQueue.length = 0;
    this.emit('knockChange', []);
    this._emitRoleChange();
    this.emit('hudUpdate');
    this.emit('renderNeeded');
  }

  async startHostRoom({ displayName, passcode, requireApproval, capacity }) {
    this.emit('stopYoutubePolling', { reason: null });
    this.patchSettings({ playerName: displayName });
    await this.room.startHostRoom({ passcode, requireApproval, capacity });
    this.knockQueue.length = 0;
    this.emit('knockChange', []);
    this._emitRoleChange();
    this.emit('hudUpdate');
    this.emit('toast', { message: 'マルチプレイ部屋を作成しました', kind: 'success' });
  }

  async resumeHostFromBackup(
    rawBackup,
    imgCanvas,
    isSample,
    { displayName, passcode, requireApproval, capacity },
  ) {
    const checked = validateSaveData(rawBackup);
    if (!checked.ok) {
      this.emit('toast', { message: checked.error, kind: 'ojama' });
      return;
    }
    const backup = checked.data;
    this.emit('stopYoutubePolling', { reason: null });
    const resolvedCanvas = isSample ? generateSampleImageCanvas() : imgCanvas;
    const imgName = isSample
      ? 'サンプルテスト画像'
      : imgCanvas?._fileName || backup.puzzle?.imageName || '復元画像';
    this.engine.restoreFromSave(backup, resolvedCanvas, isSample);
    this.room.applySavedContributions(backup.contributions, this.engine.stats.placedCount);
    if (backup.settings) {
      this.patchSettings({ ...backup.settings, playerName: displayName });
    } else {
      this.patchSettings({ playerName: displayName });
    }
    this._replaceSourceImage(resolvedCanvas, imgName, isSample);
    this.highlightFilter = 'all';
    this.emit('puzzleReset', { ...this.sourceImage, resetEffects: true, fitView: true });
    await this.room.startHostRoom({ passcode, requireApproval, capacity });
    this.knockQueue.length = 0;
    this.emit('knockChange', []);
    this._emitRoleChange();
    this.emit('hudUpdate');
    this.emit('toast', { message: '自動バックアップから部屋を再開しました', kind: 'success' });
  }

  async joinGuestRoom({ roomId, displayName, passcode }) {
    this.emit('stopYoutubePolling', { reason: null });
    // Remembered (without the passcode) so a dropped guest can rejoin with one click.
    this.lastGuestJoin = { roomId: roomId.trim(), displayName };
    await this.room.joinGuestRoom({ roomId, displayName, passcode });
  }

  /** The room this tab last joined as a guest, or null. */
  getLastGuestJoin() {
    return this.lastGuestJoin || null;
  }

  /** True when this tab still holds a seat token for the room it last joined. */
  canRejoinLastRoom() {
    return Boolean(this.lastGuestJoin && this.room.hasRejoinToken(this.lastGuestJoin.roomId));
  }

  approveNextKnock() {
    const req = this.knockQueue.shift();
    this.emit('knockChange', [...this.knockQueue]);
    if (req) this.room.approveKnock(req.connId);
  }

  /** Host: keep the room listed after the "nobody is here" prompt. */
  keepRecruiting() {
    this.room.keepRecruiting();
  }

  /** Host: reopen recruiting (or reconnect to the signaling server). */
  resumeRecruiting() {
    this.room.resumeRecruiting();
  }

  rejectNextKnock() {
    const req = this.knockQueue.shift();
    this.emit('knockChange', [...this.knockQueue]);
    if (req) this.room.rejectKnock(req.connId);
  }

  _emitRoleChange() {
    this.emit('roleChange', {
      role: this.room.role,
      isGuest: this.room.isGuest(),
      roomRules: this.room.roomRules,
    });
  }

  _diagnosticSnapshot() {
    return {
      role: this.room.role,
      puzzleSize: `${this.engine.cols}x${this.engine.rows}`,
      pieceCount: this.engine.pieces.length,
      lockedCount: this.engine.getLockedCount(),
      atlasCount: this.engine.atlasCount,
    };
  }

  getDiagnosticsState() {
    return getDiagnosticsState();
  }
  buildDiagnosticReport() {
    return buildDiagnosticReport(this._diagnosticSnapshot());
  }
  formatDiagnosticText() {
    return formatDiagnosticText(this._diagnosticSnapshot());
  }
  clearDiagnostics() {
    clearDiagnostics();
  }
  subscribeDiagnostics(listener) {
    return subscribeDiagnostics(listener);
  }
  recordDiagnostic(cat, msg, meta, lvl) {
    return recordDiagnostic(cat, msg, meta, lvl);
  }
}
