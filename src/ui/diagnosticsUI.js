/**
 * UI bindings for the unexpected-error capture banner and menu/guest diagnostics tools.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function buildDiagFilename() {
  const d = new Date();
  const datePart = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  const timePart = `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return `collab-jigsaw-diag-${datePart}_${timePart}.json`;
}

export class DiagnosticsUI {
  constructor({ app, showToast }) {
    this.app = app;
    this.showToast = showToast;

    this.elBanner = document.getElementById('errorCaptureBanner');
    this.elBtnCopyBanner = document.getElementById('btnCopyErrorLog');
    this.elBtnDismissBanner = document.getElementById('btnDismissErrorBanner');

    this.summaryEls = [document.getElementById('diagSummaryText')].filter(Boolean);

    this._bindEvents();
    this._subscribe();
    this.updateSummary(this.app.getDiagnosticsState());
  }

  updateSummary(state) {
    const text = `エラー ${state.errorCount}件 / 記録 ${state.totalCount}件`;
    for (const el of this.summaryEls) {
      el.textContent = text;
    }
  }

  async copyReport() {
    const text = this.app.formatDiagnosticText();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        ta.remove();
      }
    }
    this.showToast('診断ログをコピーしました（秘密情報は自動マスク済み）', 'success');
    return text;
  }

  downloadJson() {
    const report = this.app.buildDiagnosticReport();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildDiagFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    this.showToast('診断ログ JSON を保存しました', 'success');
    return report;
  }

  clearLogs() {
    this.app.clearDiagnostics();
    this.elBanner?.classList.add('hidden');
    this.showToast('診断ログをクリアしました', 'info');
  }

  _bindEvents() {
    this.elBtnCopyBanner?.addEventListener('click', () => this.copyReport());
    this.elBtnDismissBanner?.addEventListener('click', () => {
      this.elBanner?.classList.add('hidden');
    });

    document.getElementById('btnCopyDiagLog')?.addEventListener('click', () => this.copyReport());
    document
      .getElementById('btnDownloadDiagJson')
      ?.addEventListener('click', () => this.downloadJson());
    document.getElementById('btnClearDiagLog')?.addEventListener('click', () => this.clearLogs());
  }

  _subscribe() {
    this.app.subscribeDiagnostics(({ state, isUnexpectedError }) => {
      this.updateSummary(state);
      if (isUnexpectedError) {
        this.elBanner?.classList.remove('hidden');
      }
    });
  }
}
