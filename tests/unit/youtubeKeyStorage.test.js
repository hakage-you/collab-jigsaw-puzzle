import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../src/config/constants.js';
import { YouTubeUI } from '../../src/ui/youtubeUI.js';

function mountYouTubeDom() {
  document.body.innerHTML = `
    <input type="text" id="ytApiKeyInput" class="api-key-masked" />
    <button type="button" id="btnYtToggleKeyVisibility" aria-pressed="false">表示</button>
    <button type="button" id="btnYtClearKey">消去</button>
    <input type="checkbox" id="ytRememberKeyToggle" />
    <div id="ytRememberKeyConsent" class="hidden">
      <button type="button" id="btnConfirmYtRememberKey">有効にする</button>
      <button type="button" id="btnCancelYtRememberKey">やめる</button>
    </div>
    <p id="ytKeyStorageHint"></p>
    <input type="text" id="ytVideoUrlInput" />
    <select id="ytPollInterval"><option value="10000">10s</option></select>
    <button type="button" id="btnYtVerify"></button>
    <button type="button" id="btnYtTogglePoll" disabled></button>
    <div id="ytBroadcastPreview" class="hidden"></div>
    <div id="ytPreviewTitle"></div>
    <div id="ytPreviewMeta"></div>
    <div id="ytStatusText" class="hidden"></div>
    <div id="ytQuotaReadout"></div>
    <div class="yt-live-indicator hidden"></div>
    <div id="ytGuideModal" class="hidden"></div>
    <button type="button" id="btnOpenYtGuide"></button>
    <button type="button" id="btnCloseYtGuide"></button>
  `;
}

function createYouTubeUI() {
  const showToast = vi.fn();
  const app = {
    engine: { isCompleted: () => false },
    on: vi.fn(),
  };
  const ojama = {
    processIncomingComment: vi.fn(),
    processYouTubeSuperchat: vi.fn(),
  };
  const ui = new YouTubeUI({ app, ojama, showToast });
  return { ui, showToast };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mountYouTubeDom();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '';
});

describe('YouTubeUI API key browser storage option', () => {
  it('defaults to memory-only and does not persist keys without explicit consent', () => {
    createYouTubeUI();
    const input = document.getElementById('ytApiKeyInput');
    const toggle = document.getElementById('ytRememberKeyToggle');
    const consent = document.getElementById('ytRememberKeyConsent');

    input.value = 'AIzaSyTestKeyDefaultOff';
    input.dispatchEvent(new Event('input'));

    expect(toggle.checked).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.YOUTUBE_API_KEY)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.YOUTUBE_STORAGE_MODE)).toBeNull();

    // Toggling on opens consent box instead of immediately enabling persistence
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    expect(toggle.checked).toBe(false);
    expect(consent.classList.contains('hidden')).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.YOUTUBE_API_KEY)).toBeNull();

    // Cancelling keeps persistence off
    document.getElementById('btnCancelYtRememberKey').click();
    expect(consent.classList.contains('hidden')).toBe(true);
    expect(toggle.checked).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.YOUTUBE_API_KEY)).toBeNull();
  });

  it('persists and restores the key after explicit consent, and clears on disable or clear button', () => {
    createYouTubeUI();
    const input = document.getElementById('ytApiKeyInput');
    const toggle = document.getElementById('ytRememberKeyToggle');

    input.value = 'AIzaSyConsentedKey';
    input.dispatchEvent(new Event('input'));

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    document.getElementById('btnConfirmYtRememberKey').click();

    expect(toggle.checked).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.YOUTUBE_STORAGE_MODE)).toBe('local');
    expect(localStorage.getItem(STORAGE_KEYS.YOUTUBE_API_KEY)).toBe('AIzaSyConsentedKey');

    // Simulate reload: fresh DOM + YouTubeUI restores key and toggle state
    mountYouTubeDom();
    createYouTubeUI();
    expect(document.getElementById('ytApiKeyInput').value).toBe('AIzaSyConsentedKey');
    expect(document.getElementById('ytRememberKeyToggle').checked).toBe(true);

    // Turning off removes stored key immediately
    const reloadedToggle = document.getElementById('ytRememberKeyToggle');
    reloadedToggle.checked = false;
    reloadedToggle.dispatchEvent(new Event('change'));
    expect(localStorage.getItem(STORAGE_KEYS.YOUTUBE_API_KEY)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.YOUTUBE_STORAGE_MODE)).toBeNull();

    // Re-enable then clear button wipes both input and storage
    reloadedToggle.checked = true;
    reloadedToggle.dispatchEvent(new Event('change'));
    document.getElementById('btnConfirmYtRememberKey').click();
    expect(localStorage.getItem(STORAGE_KEYS.YOUTUBE_API_KEY)).toBe('AIzaSyConsentedKey');

    document.getElementById('btnYtClearKey').click();
    expect(document.getElementById('ytApiKeyInput').value).toBe('');
    expect(document.getElementById('ytRememberKeyToggle').checked).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.YOUTUBE_API_KEY)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.YOUTUBE_STORAGE_MODE)).toBeNull();
  });

  it('toggles API key mask visibility and prefers YouTube tab only when key or polling is active', () => {
    const { ui } = createYouTubeUI();
    const input = document.getElementById('ytApiKeyInput');
    const toggleBtn = document.getElementById('btnYtToggleKeyVisibility');

    expect(input.type).toBe('text');
    expect(input.classList.contains('api-key-masked')).toBe(true);
    expect(toggleBtn.textContent).toBe('表示');
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');
    expect(ui.shouldPreferYoutubeTab()).toBe(false);

    toggleBtn.click();
    expect(input.classList.contains('api-key-masked')).toBe(false);
    expect(toggleBtn.textContent).toBe('隠す');
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');

    input.value = 'AIzaSyVisibleKey';
    expect(ui.shouldPreferYoutubeTab()).toBe(true);

    document.getElementById('btnYtClearKey').click();
    expect(input.classList.contains('api-key-masked')).toBe(true);
    expect(toggleBtn.textContent).toBe('表示');
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');
    expect(ui.shouldPreferYoutubeTab()).toBe(false);
  });
});

describe('YouTubeUI live state', () => {
  it('tells whoever follows it where comments come in from, with the live dots', () => {
    const { ui } = createYouTubeUI();
    const dot = document.querySelector('.yt-live-indicator');
    const onLiveChange = vi.fn();
    ui.onLiveChange = onLiveChange;
    let autoComments = false;
    ui.ojama.isAutoCommentsRunning = () => autoComments;

    autoComments = true;
    ui.syncLiveIndicators();
    expect(onLiveChange).toHaveBeenLastCalledWith({ youtube: false, autoComments: true });
    expect(dot.classList.contains('hidden')).toBe(false);

    autoComments = false;
    ui.client.isPolling = true;
    ui.syncLiveIndicators();
    expect(onLiveChange).toHaveBeenLastCalledWith({ youtube: true, autoComments: false });
    expect(ui.liveState()).toEqual({ youtube: true, autoComments: false });

    ui.client.isPolling = false;
    ui.syncLiveIndicators();
    expect(onLiveChange).toHaveBeenLastCalledWith({ youtube: false, autoComments: false });
    expect(dot.classList.contains('hidden')).toBe(true);
  });
});
