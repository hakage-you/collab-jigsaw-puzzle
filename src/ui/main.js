import { GameSession } from '../app/gameSession.js';
import { CanvasInteraction } from './canvasInteraction.js';
import { DiagnosticsUI } from './diagnosticsUI.js';
import { LobbyUI } from './lobbyUI.js';
import { OjamaController } from './ojamaController.js';
import { NoticeUI } from './noticeUI.js';
import { ParticipantsUI } from './participantsUI.js';
import { PuzzleLoading } from './puzzleLoading.js';
import { createPuzzleRenderer } from './puzzleRenderer.js';
import { RecruitUI } from './recruitUI.js';
import { ResultModalUI } from './resultModalUI.js';
import { SaveLoadUI } from './saveLoadUI.js';
import { SetupDrawerUI } from './setupDrawerUI.js';
import { SortFilterUI } from './sortFilterUI.js';
import { TestPalette } from './testPalette.js';
import { OjamaRulesPanel } from './ojamaRulesPanel.js';
import { OjamaPeek } from './ojamaPeek.js';
import { TermsModal } from './termsModal.js';
import { TopbarUI } from './topbarUI.js';
import { YouTubeUI } from './youtubeUI.js';

/** The table renderer; records which one is used (and fallbacks) in the diagnostics log. */
function createRenderer(app, getTopbar) {
  return createPuzzleRenderer({
    engine: app.engine,
    room: app.room,
    getSettings: () => app.getSettings(),
    watchSettings: (fn) => app.on('settingsChange', fn),
    onChange: ({ kind, reason }) => {
      const fellBack = kind === 'canvas2d' && app.getSettings().rendererMode !== 'canvas2d';
      app.recordDiagnostic(
        'render',
        'renderer_selected',
        { kind, reason },
        fellBack ? 'warn' : 'info',
      );
      getTopbar()?.updateRendererStatus();
    },
  });
}

/** The ojama rules tab, its "今すぐ出す" and the test palette ("動作確認"). */
function setUpOjamaRules({ app, ojama, topbarUI, youtubeUI }) {
  const closeStreamModal = () => topbarUI.closeStreamModal();
  const openRules = () => topbarUI.openStreamModal('rules');
  const palette = new TestPalette({ app, closeStreamModal, openRules });
  const peek = new OjamaPeek({ ojama, closeStreamModal, openRules });
  new OjamaRulesPanel({
    app,
    tryNow: (type) => peek.show(type),
    openTest: () => palette.open(),
  });
  ojama.onAutoCommentsChange = () => youtubeUI.syncLiveIndicators();
  // Whichever way the stream modal comes back during a test, the test ends the same way.
  topbarUI.onStreamModalOpen = ({ requestedTab } = {}) => {
    const testing = palette.isOpen() || peek.isShown();
    palette.close();
    peek.hide();
    if (testing) return 'rules';
    if (requestedTab) return requestedTab;
    return youtubeUI.shouldPreferYoutubeTab() ? 'yt' : 'rules';
  };
}

/** The lobby footer's dialogs: the terms, and the credits (libraries and assets). */
function setUpFooterDialogs() {
  new TermsModal();
  new TermsModal({ modalId: 'creditsModal', openId: 'btnOpenCredits', closeId: 'btnCloseCredits' });
}

function boot() {
  const app = new GameSession();

  let topbarUI = null;

  const renderer = createRenderer(app, () => topbarUI);

  app.setRenderStatsProvider(() => renderer.getStats());

  const showToast = (msg, kind) => topbarUI.showToast(msg, kind);
  const lobbyUI = new LobbyUI({ app, showToast });
  new NoticeUI({ app, actions: { rejoin: () => lobbyUI.rejoinLastRoom() } });

  topbarUI = new TopbarUI({
    app,
    renderer,
    onOpenLobby: () => lobbyUI.show(),
  });

  new RecruitUI({ app });
  new ParticipantsUI({
    app,
    showToast,
  });

  const loading = new PuzzleLoading(renderer.viewState);

  const setupDrawerUI = new SetupDrawerUI({
    app,
    renderer,
    loading,
    showToast,
  });

  new SortFilterUI({
    app,
    renderer,
    fitViewAndSync: () => setupDrawerUI.fitViewAndSync(),
    showToast,
  });

  const ojama = new OjamaController({
    app,
    updateHUD: () => topbarUI.updateHUD(),
    requestRender: () => renderer.requestRender(),
    setGhostPiecesActive: (active) => renderer.viewState.setGhostPiecesActive(active),
    showToast,
  });

  const youtubeUI = new YouTubeUI({ app, ojama, showToast });
  setUpOjamaRules({ app, ojama, topbarUI, youtubeUI });

  new SaveLoadUI({ app, showToast });
  const diagnosticsUI = new DiagnosticsUI({ app, showToast });
  setUpFooterDialogs();
  new ResultModalUI({ app, renderer, loading, showToast });

  new CanvasInteraction({
    app,
    renderer,
    loading,
    ojama,
    fitViewAndSync: () => setupDrawerUI.fitViewAndSync(),
    updateZoomReadout: () => setupDrawerUI.updateZoomReadout(),
    showToast,
  });

  window.__PUZZLE_APP__ = {
    engine: app.engine,
    renderer,
    room: app.room,
    lobbyUI,
    topbarUI,
    youtubeUI,
    youtubeClient: youtubeUI.client,
    diagnostics: {
      getState: () => app.getDiagnosticsState(),
      buildReport: () => app.buildDiagnosticReport(),
      formatText: () => app.formatDiagnosticText(),
      clear: () => diagnosticsUI.clearLogs(),
      record: (cat, msg, meta, lvl) => app.recordDiagnostic(cat, msg, meta, lvl),
    },
    view: renderer.viewState.camera,
    refSheet: renderer.viewState.refSheet,
    getSettings: () => app.getSettings(),
    setCustomImage: (canvas, name) => app.setCustomImage(canvas, name),
    useSampleImage: (sampleId) => app.useSampleImage(sampleId),
    fitView: () => setupDrawerUI.fitViewAndSync(),
    screenToWorld: (sx, sy) => renderer.viewState.screenToWorld(sx, sy),
  };

  app.startNewPuzzle();
  lobbyUI.show();
  startRenderLoop(renderer, topbarUI);
}

function startRenderLoop(renderer, topbarUI) {
  function animationLoop(now) {
    renderer.renderFrame(now, (elapsedMs) => topbarUI.updateTimer(elapsedMs));
    requestAnimationFrame(animationLoop);
  }
  requestAnimationFrame(animationLoop);
}

boot();
