import { GameSession } from '../app/gameSession.js';
import { CanvasInteraction } from './canvasInteraction.js';
import { ComfortControls } from './comfortControls.js';
import { DiagnosticsUI } from './diagnosticsUI.js';
import { KeywordGuideUI } from './keywordGuideUI.js';
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
      const desiredMode = app.getSettings().rendererMode;
      const fellBack =
        (desiredMode === 'auto' && kind === 'canvas2d') ||
        (desiredMode === 'webgpu' && kind !== 'webgpu') ||
        (desiredMode === 'webgl2' && kind !== 'webgl2');
      app.recordDiagnostic(
        'render',
        'renderer_selected',
        { kind, mode: desiredMode, reason },
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

/**
 * The lobby's dialogs: the terms and the credits (libraries and assets) from its footer, and
 * "演出と音" from its header (whose controls are also in the menu).
 */
function setUpLobbyDialogs(app) {
  new TermsModal();
  new TermsModal({ modalId: 'creditsModal', openId: 'btnOpenCredits', closeId: 'btnCloseCredits' });
  new TermsModal({ modalId: 'comfortModal', openId: 'btnOpenComfort', closeId: 'btnCloseComfort' });
  new ComfortControls({ app });
}

function boot() {
  const app = new GameSession();

  let topbarUI = null;

  const renderer = createRenderer(app, () => topbarUI);

  app.setRenderStatsProvider(() => renderer.getStats());

  const showToast = (msg, kind, options) => topbarUI.showToast(msg, kind, options);
  const loading = new PuzzleLoading(renderer.viewState);
  const lobbyUI = new LobbyUI({ app, showToast, loading });
  new NoticeUI({ app, actions: { rejoin: () => lobbyUI.rejoinLastRoom() } });

  topbarUI = new TopbarUI({
    app,
    renderer,
    onOpenLobby: () => lobbyUI.show(),
  });

  new RecruitUI({ app });
  const onOpenCreateRoom = () => (lobbyUI.selectTab('host'), lobbyUI.show());
  new ParticipantsUI({ app, showToast, onOpenCreateRoom });

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
    setGhostPiecesActive: (active) => renderer.viewState.setGhostPiecesActive(active),
    showToast,
  });

  const youtubeUI = new YouTubeUI({ app, ojama, showToast });
  setUpOjamaRules({ app, ojama, topbarUI, youtubeUI });
  const keywordGuide = new KeywordGuideUI({ app, showToast });
  youtubeUI.onLiveChange = (live) => keywordGuide.setLive(live);
  keywordGuide.setLive(youtubeUI.liveState());

  new SaveLoadUI({ app, showToast });
  const diagnosticsUI = new DiagnosticsUI({ app, showToast });
  setUpLobbyDialogs(app);
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

  app.startNewPuzzle(null, { animate: false });
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
