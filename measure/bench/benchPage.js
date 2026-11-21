/**
 * Controls of the render bench page: options, run button, results table and JSON for copying.
 */
import { MODES, SCENES, measureRefresh, runMode } from './renderBench.js';

const el = (id) => document.getElementById(id);

function gpuName() {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'WebGL2 なし';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '（ブラウザが非公開）';
}

function selectedModes() {
  return Object.keys(MODES).filter((mode) => el(`mode-${mode}`).checked);
}

function addRow(tbody, r) {
  const tr = document.createElement('tr');
  const sceneLabel = SCENES.find((s) => s.id === r.scene)?.label ?? r.scene;
  const cells = [
    MODES[r.mode],
    `${r.pieces}`,
    `${r.dpr}`,
    sceneLabel,
    `${r.frameMsMedian}`,
    `${r.frameMsP95}`,
    `${r.droppedPct}%`,
    `${r.workMsMedian}`,
    `${r.workMsP95}`,
  ];
  for (const text of cells) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.appendChild(td);
  }
  tbody.appendChild(tr);
}

async function run() {
  const button = el('btnRun');
  button.disabled = true;
  const tbody = el('results');
  tbody.replaceChildren();
  const status = el('status');
  const report = {
    date: new Date().toISOString(),
    userAgent: navigator.userAgent,
    cpuThreads: navigator.hardwareConcurrency ?? null,
    gpu: gpuName(),
    note: el('note').value.trim(),
    refreshMs: null,
    results: [],
  };
  try {
    status.textContent = '画面の更新間隔を測っています…';
    report.refreshMs = Math.round((await measureRefresh()) * 10) / 10;
    const pieceCount = Number(el('pieceCount').value);
    const dpr = Number(el('dpr').value) || window.devicePixelRatio || 1;
    for (const mode of selectedModes()) {
      const { results } = await runMode({
        mode,
        pieceCount,
        dpr,
        stage: el('benchStage'),
        refreshMs: report.refreshMs,
        onProgress: (text) => {
          status.textContent = `計測中: ${text}`;
        },
      });
      for (const r of results) addRow(tbody, r);
      report.results.push(...results);
    }
    status.textContent = `完了（画面の更新間隔 ${report.refreshMs} ms）`;
  } catch (err) {
    status.textContent = `失敗: ${err?.message || err}`;
  } finally {
    el('json').value = JSON.stringify(report, null, 2);
    button.disabled = false;
  }
}

el('gpu').textContent = gpuName();
el('cpu').textContent = `${navigator.hardwareConcurrency ?? '?'} スレッド`;
el('btnRun').addEventListener('click', run);
el('btnCopy').addEventListener('click', () => {
  navigator.clipboard?.writeText(el('json').value);
});
