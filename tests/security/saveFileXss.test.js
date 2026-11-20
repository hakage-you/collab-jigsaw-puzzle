import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SaveLoadUI } from '../../src/ui/saveLoadUI.js';

// S1 (security assessment 2026-11-21): a crafted save file must never inject markup or run script.
const IDS = [
  'loadJsonInput',
  'loadImageInput',
  'loadedJsonSummary',
  'btnApplyLoad',
  'btnApplyLoadSample',
  'btnDownloadSave',
  'btnResetSettings',
];

function mountFixture() {
  const root = document.createElement('div');
  root.id = 'save-fixture';
  for (const id of IDS) {
    const tag = id.startsWith('btn') ? 'button' : id.endsWith('Input') ? 'input' : 'div';
    const el = document.createElement(tag);
    el.id = id;
    root.appendChild(el);
  }
  document.body.appendChild(root);
  return root;
}

const PAYLOAD = '<img src=x onerror="window.__xss=1"><b id="injected">x</b>';

function craftedSave() {
  return {
    puzzle: {
      seed: PAYLOAD,
      cols: PAYLOAD,
      rows: 3,
      isSampleImage: false,
      imageWidth: PAYLOAD,
      imageHeight: PAYLOAD,
    },
    pieces: [{ id: 0, isLocked: false }],
  };
}

describe('save file summary (S1)', () => {
  let root;

  beforeEach(() => {
    window.__xss = undefined;
    root = mountFixture();
  });

  afterEach(() => {
    root.remove();
  });

  it('shows crafted values as plain text and creates no elements from them', async () => {
    const fakeApp = { verifySaveImageMatch: () => true, exportSaveData: () => ({}) };
    const ui = new SaveLoadUI({ app: fakeApp, showToast: () => {} });
    ui.pendingSaveData = craftedSave();
    ui.updateLoadedSaveSummary();
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    const summary = document.getElementById('loadedJsonSummary');
    expect(summary.querySelector('img')).toBeNull();
    expect(summary.querySelector('#injected')).toBeNull();
    expect(window.__xss).toBeUndefined();
  });
});
