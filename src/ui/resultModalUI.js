import { CompletionCelebration } from './completionCelebration.js';
import { formatDuration } from './topbarUI.js';

const PUBLIC_GAME_URL = 'https://hakage-you.github.io/collab-jigsaw-puzzle/';

export function formatShareText(payload) {
  const lines = [
    `🧩 協力ジグソーパズル（${payload.pieceCount}ピース）を完成させました！`,
    `⏱ クリアタイム: ${formatDuration(payload.elapsedMs)}`,
  ];
  if (payload.ojamaTotal > 0) {
    lines.push(`😈 乗り越えたお邪魔: ${payload.ojamaTotal}回`);
  }
  if (payload.isMultiplayer && Array.isArray(payload.roster) && payload.roster.length > 0) {
    const sorted = [...payload.roster].sort((a, b) => b.contrib - a.contrib);
    if (sorted[0]) {
      lines.push(`👑 MVP: ${sorted[0].name}（${sorted[0].contrib}ピース）`);
    }
  }
  lines.push(PUBLIC_GAME_URL);
  return lines.join('\n');
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below when Clipboard API is unavailable or denied.
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export class ResultModalUI {
  constructor({ app, renderer, loading, showToast }) {
    this.app = app;
    this.renderer = renderer;
    this.loading = loading;
    this.showToast = showToast;
    this.lastPayload = null;
    this.elModal = document.getElementById('resultModal');
    this.elRankingList = document.getElementById('resultRankingList');
    this.elBtnShare = document.getElementById('btnResultShare');
    this.elAdmireControls = document.getElementById('admireControls');
    this.elBtnToggleAdmire = document.getElementById('btnToggleAdmire');
    this.elBrandIsland = document.querySelector('.brand-island');
    this.isCompleted = false;
    this.isAdmiring = false;
    /** The "かんせい！" sticker shown over the finished picture before this card. */
    this.celebration = new CompletionCelebration();

    this._bindEvents();
    this._subscribeApp();
  }

  setAdmireMode(on) {
    this.isAdmiring = Boolean(on && this.isCompleted);
    document.body.classList.toggle('admire-mode', this.isAdmiring);
    if (this.isAdmiring) {
      const drawer = document.getElementById('sideDrawer');
      if (drawer && !drawer.classList.contains('collapsed')) {
        document.getElementById('btnCloseDrawer')?.click();
      }
    }
    if (this.elBtnToggleAdmire) {
      this.elBtnToggleAdmire.textContent = this.isAdmiring ? 'UIを表示' : 'UIを隠す';
    }
  }

  /** Completion: confetti and the big sticker first, then this card (CompletionCelebration). */
  showResult(payload) {
    this.isCompleted = true;
    this.elAdmireControls?.classList.remove('hidden');
    this.lastPayload = payload;
    this._fill(payload);
    this.renderer.launchConfetti();
    this.renderer.requestRender();
    this.celebration.play(
      () => this._open(),
      this.renderer.completionSpot(),
      this.renderer.viewState.effectIntensity,
    );
  }

  _fill(payload) {
    document.getElementById('resultTime').textContent = formatDuration(payload.elapsedMs);
    document.getElementById('resultSize').textContent =
      `${payload.cols} × ${payload.rows} (${payload.pieceCount})`;
    document.getElementById('resultOjamaTotal').textContent = String(payload.ojamaTotal);

    const bd = payload.ojamaBreakdown;
    document.getElementById('resultOjamaBreakdown').textContent =
      `内訳 — 落下: ${bd.drop} / 視覚: ${bd.visual} / スパチャ: ${bd.superchat} / いたずら: ${bd.prank} / 偽: ${bd.fake || 0} / 重い: ${bd.heavy || 0} / 逃げる: ${bd.runaway || 0}`;

    this.elRankingList.replaceChildren();
    if (payload.isMultiplayer && payload.roster.length > 0) {
      const sorted = [...payload.roster].sort((a, b) => b.contrib - a.contrib);
      for (const member of sorted) {
        const li = document.createElement('li');
        li.className = 'result-ranking-item';

        const left = document.createElement('span');
        left.className = 'result-ranking-left';
        const dot = document.createElement('span');
        dot.className = 'result-ranking-dot';
        dot.style.background = member.color;
        const nameSpan = document.createElement('span');
        nameSpan.textContent = member.name;
        left.append(dot, nameSpan);

        const score = document.createElement('strong');
        score.textContent = `${member.contrib} ピース`;
        li.append(left, score);
        this.elRankingList.appendChild(li);
      }
      this.elRankingList.classList.remove('hidden');
    } else {
      this.elRankingList.classList.add('hidden');
    }
  }

  _open() {
    this.elModal.classList.remove('hidden');
  }

  hide() {
    this.celebration.cancel();
    this.elModal.classList.add('hidden');
  }

  _bindEvents() {
    this.elBtnShare?.addEventListener('click', async () => {
      if (!this.lastPayload) return;
      const ok = await writeClipboardText(formatShareText(this.lastPayload));
      if (ok) {
        this.showToast?.('戦績をコピーしました', 'success');
      } else {
        this.showToast?.('戦績のコピーに失敗しました', 'ojama');
      }
    });
    document.getElementById('btnResultReplay').addEventListener('click', () => {
      this.loading.run(() => this.app.startNewPuzzle());
    });
    document.getElementById('btnResultClose').addEventListener('click', () => {
      this.hide();
      this.setAdmireMode(true);
      this.renderer.fitView();
    });
    this.elBtnToggleAdmire?.addEventListener('click', () => this.setAdmireMode(!this.isAdmiring));
    this.elBrandIsland?.addEventListener('click', (e) => {
      if (!this.isAdmiring) return;
      e.stopPropagation();
      this.setAdmireMode(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isAdmiring) {
        this.setAdmireMode(false);
      }
    });
  }

  _subscribeApp() {
    this.app.on('puzzleComplete', (payload) => this.showResult(payload));
    this.app.on('puzzleReset', () => {
      this.hide();
      this.isCompleted = false;
      this.setAdmireMode(false);
      this.elAdmireControls?.classList.add('hidden');
    });
  }
}
