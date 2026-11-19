import { formatDuration } from './topbarUI.js';

export class ResultModalUI {
  constructor({ app, renderer }) {
    this.app = app;
    this.renderer = renderer;
    this.elModal = document.getElementById('resultModal');
    this.elRankingList = document.getElementById('resultRankingList');

    this._bindEvents();
    this._subscribeApp();
  }

  showResult(payload) {
    this.renderer.launchConfetti();
    document.getElementById('resultTime').textContent = formatDuration(payload.elapsedMs);
    document.getElementById('resultSize').textContent =
      `${payload.cols} × ${payload.rows} (${payload.pieceCount})`;
    const resultPlacedEl = document.getElementById('resultPlaced');
    resultPlacedEl.textContent = String(payload.myContrib ?? payload.placedCount);
    const placedLabelEl = resultPlacedEl.parentElement?.querySelector('.label');
    if (placedLabelEl) {
      placedLabelEl.textContent = payload.isMultiplayer
        ? 'あなたの貢献度（はめた数）'
        : '貢献度（はめた数）';
    }
    document.getElementById('resultOjamaTotal').textContent = String(payload.ojamaTotal);

    const bd = payload.ojamaBreakdown;
    document.getElementById('resultOjamaBreakdown').textContent =
      `内訳 — 落下: ${bd.drop} / 視覚: ${bd.visual} / スパチャ: ${bd.superchat} / いたずら: ${bd.prank}`;

    this.elRankingList.innerHTML = '';
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

    this.elModal.classList.remove('hidden');
    this.renderer.requestRender();
  }

  hide() {
    this.elModal.classList.add('hidden');
  }

  _bindEvents() {
    document.getElementById('btnResultReplay').addEventListener('click', () => {
      this.app.startNewPuzzle();
    });
    document.getElementById('btnResultClose').addEventListener('click', () => this.hide());
  }

  _subscribeApp() {
    this.app.on('puzzleComplete', (payload) => this.showResult(payload));
    this.app.on('puzzleReset', () => this.hide());
  }
}
