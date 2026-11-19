import { GameSession } from '../app/gameSession.js';
import { CanvasInteraction } from './canvasInteraction.js';
import { CanvasRenderer } from './canvasRenderer.js';
import { DiagnosticsUI } from './diagnosticsUI.js';
import { LobbyUI } from './lobbyUI.js';
import { OjamaController } from './ojamaController.js';
import { ParticipantsUI } from './participantsUI.js';
import { ResultModalUI } from './resultModalUI.js';
import { SaveLoadUI } from './saveLoadUI.js';
import { SetupDrawerUI } from './setupDrawerUI.js';
import { SortFilterUI } from './sortFilterUI.js';
import { TermsModal } from './termsModal.js';
import { TopbarUI } from './topbarUI.js';
import { YouTubeUI } from './youtubeUI.js';

function boot() {
  const app = new GameSession();

  let participantsUI = null;
  let topbarUI = null;

  const renderer = new CanvasRenderer({
    engine: app.engine,
    room: app.room,
    getSettings: () => app.getSettings(),
    getParticipantsState: () =>
      participantsUI ? participantsUI.getState() : { dummyParticipants: [], showDummyCursors: true },
  });

  const showToast = (msg, kind) => topbarUI.showToast(msg, kind);
  const lobbyUI = new LobbyUI({ app, showToast });

  topbarUI = new TopbarUI({
    app,
    renderer,
    onOpenLobby: () => lobbyUI.show(),
  });

  participantsUI = new ParticipantsUI({
    app,
    requestRender: () => renderer.requestRender(),
    showToast,
  });

  const setupDrawerUI = new SetupDrawerUI({
    app,
    renderer,
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
    showToast,
  });

  const youtubeUI = new YouTubeUI({ app, ojama, showToast });

  new SaveLoadUI({ app, showToast });
  const diagnosticsUI = new DiagnosticsUI({ app, showToast });
  new TermsModal();
  new ResultModalUI({ app, renderer });

  new CanvasInteraction({
    app,
    renderer,
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
    youtubeUI,
    youtubeClient: youtubeUI.client,
    diagnostics: {
      getState: () => app.getDiagnosticsState(),
      buildReport: () => app.buildDiagnosticReport(),
      formatText: () => app.formatDiagnosticText(),
      clear: () => diagnosticsUI.clearLogs(),
      record: (cat, msg, meta, lvl) => app.recordDiagnostic(cat, msg, meta, lvl),
    },
    view: renderer.view,
    refSheet: renderer.refSheet,
    getSettings: () => app.getSettings(),
    fitView: () => setupDrawerUI.fitViewAndSync(),
    screenToWorld: (sx, sy) => renderer.screenToWorld(sx, sy),
  };

  function animationLoop(now) {
    renderer.renderFrame(now, (elapsedMs) => topbarUI.updateTimer(elapsedMs));
    requestAnimationFrame(animationLoop);
  }

  app.startNewPuzzle();
  lobbyUI.show();
  requestAnimationFrame(animationLoop);
}

boot();
