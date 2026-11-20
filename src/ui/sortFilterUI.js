export class SortFilterUI {
  constructor({ app, renderer, fitViewAndSync, showToast }) {
    this.app = app;
    this.renderer = renderer;
    this.fitViewAndSync = fitViewAndSync;
    this.showToast = showToast;

    this.elColorChips = document.getElementById('colorFilterChips');
    this.elGuestRoomRulesSummary = document.getElementById('guestRoomRulesSummary');

    this._bindEvents();
    this._subscribeApp();
  }

  _populateColorChips(container, buckets) {
    if (!container) return;
    container.innerHTML = '';
    for (const b of buckets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-chip-btn';
      btn.dataset.filter = `color:${b.id}`;
      if (this.renderer.highlightFilter === btn.dataset.filter) {
        btn.classList.add('active');
      }

      const dot = document.createElement('span');
      dot.className = 'color-dot';
      dot.style.background = b.swatch;
      btn.appendChild(dot);
      btn.appendChild(document.createTextNode(b.label));
      btn.addEventListener('click', () => this.app.setHighlightFilter(`color:${b.id}`));
      container.appendChild(btn);
    }
  }

  rebuildColorFilterChips() {
    const buckets = this.app.getPresentColorBuckets();
    this._populateColorChips(this.elColorChips, buckets);
  }

  applyFilterMode(mode) {
    this.renderer.highlightFilter = mode;
    document.querySelectorAll('#highlightModeGroup .btn-seg').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.filter === mode);
    });
    document.querySelectorAll('#colorFilterChips .color-chip-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.filter === mode);
    });
    this.renderer.requestRender();
  }

  updateGuestRules({ isGuest, roomRules }) {
    if (!isGuest || !roomRules || !this.elGuestRoomRulesSummary) return;
    const total = roomRules.cols * roomRules.rows;
    this.elGuestRoomRulesSummary.textContent = `${roomRules.cols}×${roomRules.rows} (${total}ピース) / 回転: ${
      roomRules.allowRotation ? 'ON' : 'OFF'
    } / 裏返し: ${roomRules.allowFlip ? 'ON' : 'OFF'}`;
  }

  _bindEvents() {
    document.getElementById('btnSortEdges').addEventListener('click', () => {
      const res = this.app.sortEdges();
      this.fitViewAndSync();
      this.renderer.afterNextRender(() => this.showToast(res.toastMessage));
    });
    document.getElementById('btnSortColors').addEventListener('click', () => {
      const res = this.app.sortByColor();
      this.fitViewAndSync();
      this.renderer.afterNextRender(() => this.showToast(res.toastMessage));
    });
    document.getElementById('btnSortQuadrants').addEventListener('click', () => {
      const res = this.app.sortByQuadrant();
      this.fitViewAndSync();
      this.renderer.afterNextRender(() => this.showToast(res.toastMessage));
    });
    document.getElementById('btnAlignAllUpright').addEventListener('click', () => {
      const res = this.app.alignAllUpright();
      this.renderer.afterNextRender(() => this.showToast(res.toastMessage));
    });

    document.querySelectorAll('#highlightModeGroup .btn-seg').forEach((btn) => {
      btn.addEventListener('click', () => this.app.setHighlightFilter(btn.dataset.filter));
    });
  }

  _subscribeApp() {
    this.app.on('puzzleReset', () => {
      this.rebuildColorFilterChips();
      this.applyFilterMode(this.app.highlightFilter);
    });
    this.app.on('filterChange', (mode) => this.applyFilterMode(mode));
    this.app.on('roleChange', (info) => this.updateGuestRules(info));
  }
}
