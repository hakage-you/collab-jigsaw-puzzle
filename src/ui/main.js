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
import { TermsModal } from './termsModal.js';
import { TopbarUI } from './topbarUI.js';
import { YouTubeUI } from './youtubeUI.js';

/** The table renderer; records which one is used (and fallbacks) in the diagnostics log. */
function createRenderer(app, getTopbar) {
  return createPuzzleRenderer({
    engine: app.engine,
    room: app.room,
    getSettings: () => app.getSettings(),
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
  new TestPalette({ closeStreamModal: () => topbarUI.closeStreamModal() });

  new SaveLoadUI({ app, showToast });
  const diagnosticsUI = new DiagnosticsUI({ app, showToast });
  new TermsModal();
  new ResultModalUI({ app, renderer, loading });

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
    useSampleImage: () => app.useSampleImage(),
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
