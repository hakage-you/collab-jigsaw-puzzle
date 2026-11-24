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

function formatAdapterInfo(adapter) {
  const raw = adapter.info || {};
  const isFallback = Boolean(raw.isFallbackAdapter ?? adapter.isFallbackAdapter);
  const parts = [raw.description, raw.vendor, raw.architecture].filter(Boolean);
  const label = parts.length > 0 ? parts.join(' / ') : '取得済み（詳細非公開）';
  return {
    text: isFallback ? `${label} [fallback]` : label,
    info: {
      vendor: raw.vendor || null,
      architecture: raw.architecture || null,
      description: raw.description || null,
      device: raw.device || null,
      isFallbackAdapter: isFallback,
      hasTimestampQuery: Boolean(adapter.features?.has('timestamp-query')),
    },
  };
}

async function webgpuAdapterInfo(powerPreference) {
  if (!navigator.gpu) return { text: 'WebGPU 非対応', info: null };
  try {
    const opts = powerPreference ? { powerPreference } : undefined;
    const adapter = await navigator.gpu.requestAdapter(opts);
    if (!adapter) return { text: 'アダプタなし', info: null };
    return formatAdapterInfo(adapter);
  } catch (err) {
    return { text: `取得失敗: ${err?.message || err}`, info: null };
  }
}

async function refreshWebGpuLabel() {
  const target = el('webgpuGpu');
  if (!target) return null;
  const powerPreference = el('powerPreference')?.value || '';
  const result = await webgpuAdapterInfo(powerPreference);
  target.textContent = result.text;
  return result;
}

function selectedModes() {
  return Object.keys(MODES).filter((mode) => el(`mode-${mode}`)?.checked);
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
    r.gpuMsMedian != null ? `${r.gpuMsMedian}` : '-',
    r.gpuMsP95 != null ? `${r.gpuMsP95}` : '-',
  ];
  for (const text of cells) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.appendChild(td);
  }
  tbody.appendChild(tr);
}

function buildReport(powerPreference, gpuProbe) {
  return {
    date: new Date().toISOString(),
    userAgent: navigator.userAgent,
    cpuThreads: navigator.hardwareConcurrency ?? null,
    gpu: gpuName(),
    powerPreference: powerPreference || 'default',
    webgpuAdapter: gpuProbe?.info ?? null,
    webgpuAdapterText: gpuProbe?.text ?? null,
    note: el('note').value.trim(),
    refreshMs: null,
    results: [],
  };
}

async function run() {
  const button = el('btnRun');
  button.disabled = true;
  const tbody = el('results');
  tbody.replaceChildren();
  const status = el('status');
  const powerPreference = el('powerPreference')?.value || '';
  const gpuProbe = await refreshWebGpuLabel();
  const report = buildReport(powerPreference, gpuProbe);
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
        powerPreference,
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
refreshWebGpuLabel();
el('powerPreference')?.addEventListener('change', refreshWebGpuLabel);
el('btnRun').addEventListener('click', run);
el('btnCopy').addEventListener('click', () => {
  navigator.clipboard?.writeText(el('json').value);
});
