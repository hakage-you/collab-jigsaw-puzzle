import { YOUTUBE_CONFIG } from '../config/constants.js';
import { recordDiagnostic } from './diagnostics.js';

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

const CHAT_DISABLED_REASON =
  'ライブチャットが取得できません（配信開始前・アーカイブ・チャット無効・メンバー限定等は非対応です）';

/**
 * Extracts an 11-character YouTube Video ID from various URL formats or raw ID input.
 */
export function extractVideoId(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (VIDEO_ID_RE.test(raw)) return raw;

  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    const isYoutubeHost =
      host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
    if (!isYoutubeHost) return null;

    if (host === 'youtu.be') {
      const seg = url.pathname.replace(/^\/+/, '').split('/')[0];
      return VIDEO_ID_RE.test(seg) ? seg : null;
    }

    const vParam = url.searchParams.get('v');
    if (vParam && VIDEO_ID_RE.test(vParam)) return vParam;

    const pathMatch = url.pathname.match(
      /^\/(?:live|shorts|embed|v|video)\/([a-zA-Z0-9_-]{11})(?:\/|$)/,
    );
    if (pathMatch) return pathMatch[1];
  } catch {
    return null;
  }
  return null;
}

/**
 * Ordered rules for mapping a failed API response to a user-facing message.
 * The first rule whose `match` returns true wins.
 */
const API_ERROR_RULES = [
  {
    match: ({ reason }) => reason === 'quotaExceeded' || reason === 'dailyLimitExceeded',
    message: 'YouTube APIの本日の無料枠（クォータ上限）に達したため自動停止しました',
  },
  {
    match: ({ reason, status, rawMessage }) =>
      reason === 'keyInvalid' || (status === 400 && rawMessage.toLowerCase().includes('api key')),
    message: 'APIキーが無効です。Google Cloud Consoleのキー設定を確認してください',
  },
  {
    match: ({ reason }) => reason === 'liveChatDisabled',
    message: 'この配信ではライブチャットが無効になっているため取得できません',
  },
  {
    match: ({ reason, status }) => reason === 'forbidden' || status === 403,
    message:
      'YouTubeへの接続が拒否されました（403: APIの有効化・キー制限・配信の公開設定を確認してください）',
  },
  {
    match: ({ reason, status }) => reason === 'liveChatEnded' || status === 404,
    message: '配信またはライブチャットが見つからないか、すでに終了しています',
  },
];

function mapApiError(status, body) {
  const reason = body?.error?.errors?.[0]?.reason || '';
  const rawMessage = body?.error?.message || '';
  const context = { status, reason, rawMessage };

  const rule = API_ERROR_RULES.find((r) => r.match(context));
  if (rule) return rule.message;
  return `YouTube APIエラー（${status}）: ${rawMessage || '通信に失敗しました'}`;
}

function buildVideosUrl(videoId, apiKey) {
  return (
    `${YOUTUBE_CONFIG.API_BASE}/videos` +
    `?part=snippet,liveStreamingDetails` +
    `&id=${encodeURIComponent(videoId)}` +
    `&key=${encodeURIComponent(apiKey)}`
  );
}

function parseVideoInfo(item) {
  return {
    title: item.snippet?.title || '無題の配信',
    channelTitle: item.snippet?.channelTitle || '',
    liveBroadcastContent: item.snippet?.liveBroadcastContent || 'none',
    activeLiveChatId: item.liveStreamingDetails?.activeLiveChatId || null,
  };
}

function handleTextMessage(_client, item, snippet, author, comments) {
  const text = snippet.displayMessage || snippet.textMessageDetails?.messageText || '';
  if (text) {
    comments.push({ id: item.id, author, text });
  }
}

function buildSuperChatPayload(item, snippet, author) {
  const d = snippet.superChatDetails || {};
  return {
    id: item.id,
    author,
    amountDisplay: d.amountDisplayString || '¥1,000',
    message: d.userComment || snippet.displayMessage || '',
    tier: Number(d.tier) || 1,
    isSticker: false,
  };
}

function buildSuperStickerPayload(item, snippet, author) {
  const d = snippet.superStickerDetails || {};
  return {
    id: item.id,
    author,
    amountDisplay: d.amountDisplayString || '¥500',
    message: d.superStickerMetadata?.altText || 'スーパーステッカー',
    tier: Number(d.tier) || 1,
    isSticker: true,
  };
}

/**
 * Per-event-type handlers for live chat items. Superchat/sticker handlers emit
 * immediately (preserving the original call order); text comments are batched.
 */
const CHAT_ITEM_HANDLERS = new Map([
  ['textMessageEvent', handleTextMessage],
  [
    'superChatEvent',
    (client, item, snippet, author) =>
      client.onSuperchat(buildSuperChatPayload(item, snippet, author)),
  ],
  [
    'superStickerEvent',
    (client, item, snippet, author) =>
      client.onSuperchat(buildSuperStickerPayload(item, snippet, author)),
  ],
]);

/**
 * Direct browser client for YouTube Data API v3 (BYOK, read-only).
 */
export class YouTubeLiveClient {
  constructor({
    fetchImpl = null,
    onComments = () => {},
    onSuperchat = () => {},
    onStatusChange = () => {},
    onQuotaUpdate = () => {},
    onError = () => {},
  } = {}) {
    this.fetchImpl = fetchImpl || ((...args) => globalThis.fetch(...args));
    this.onComments = onComments;
    this.onSuperchat = onSuperchat;
    this.onStatusChange = onStatusChange;
    this.onQuotaUpdate = onQuotaUpdate;
    this.onError = onError;

    this.apiKey = '';
    this.videoId = null;
    this.activeLiveChatId = null;
    this.broadcastTitle = '';
    this.channelTitle = '';
    this.liveBroadcastContent = 'none';

    this.isPolling = false;
    this.isFirstPoll = true;
    this.nextPageToken = null;
    this.intervalMs = YOUTUBE_CONFIG.DEFAULT_POLL_INTERVAL_MS;
    this.sessionUnits = 0;
    this.pollTimerId = null;
  }

  setFetchImpl(fn) {
    this.fetchImpl = fn || ((...args) => globalThis.fetch(...args));
  }

  _addUnits(units) {
    this.sessionUnits += units;
    this.onQuotaUpdate(this.sessionUnits);
  }

  async _fetchJson(url) {
    const res = await this.fetchImpl(url, { method: 'GET' });
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  }

  _storeBroadcast(cleanKey, videoId, info) {
    this.apiKey = cleanKey;
    this.videoId = videoId;
    this.broadcastTitle = info.title;
    this.channelTitle = info.channelTitle;
    this.liveBroadcastContent = info.liveBroadcastContent;
    this.activeLiveChatId = info.activeLiveChatId;
  }

  /**
   * Verifies a broadcast using videos.list (consumes 1 quota unit).
   */
  async verifyBroadcast(apiKey, rawUrlOrId) {
    this.stopPolling();
    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey) {
      throw new Error('YouTube Data API v3 のAPIキーを入力してください');
    }

    const videoId = extractVideoId(rawUrlOrId);
    if (!videoId) {
      throw new Error('有効なYouTube配信URLまたは11文字の動画IDを入力してください');
    }

    const { ok, status, data } = await this._fetchJson(buildVideosUrl(videoId, cleanKey));
    this._addUnits(YOUTUBE_CONFIG.COST_VERIFY_VIDEOS);

    if (!ok) {
      throw new Error(mapApiError(status, data));
    }

    const item = data?.items?.[0];
    if (!item) {
      throw new Error('該当する動画が見つかりませんでした（URL・公開設定を確認してください）');
    }

    const info = parseVideoInfo(item);
    this._storeBroadcast(cleanKey, videoId, info);

    return {
      videoId,
      ...info,
      hasActiveChat: Boolean(info.activeLiveChatId),
      chatDisabledReason: info.activeLiveChatId ? '' : CHAT_DISABLED_REASON,
      sessionUnits: this.sessionUnits,
    };
  }

  startPolling(intervalMs = YOUTUBE_CONFIG.DEFAULT_POLL_INTERVAL_MS) {
    if (!this.apiKey || !this.activeLiveChatId) {
      throw new Error('先に有効なライブチャットのある配信を確認してください');
    }
    this.stopPolling();
    this.intervalMs = Math.max(5000, Number(intervalMs) || YOUTUBE_CONFIG.DEFAULT_POLL_INTERVAL_MS);
    this.isPolling = true;
    this.isFirstPoll = true;
    this.nextPageToken = null;

    this.onStatusChange({
      isPolling: true,
      message: 'コメント連動を開始しました（初回取得で過去コメントをスキップします）',
    });
    this._pollOnce();
  }

  stopPolling(reason = null) {
    if (this.pollTimerId) {
      clearTimeout(this.pollTimerId);
      this.pollTimerId = null;
    }
    const wasPolling = this.isPolling;
    this.isPolling = false;
    this.nextPageToken = null;
    if (wasPolling) {
      this.onStatusChange({
        isPolling: false,
        message: reason || 'コメント連動を停止しました',
      });
    }
  }

  async _pollOnce() {
    if (!this.isPolling || !this.activeLiveChatId) return;

    const pageParam = this.nextPageToken
      ? `&pageToken=${encodeURIComponent(this.nextPageToken)}`
      : '';
    const url = `${YOUTUBE_CONFIG.API_BASE}/liveChat/messages?liveChatId=${encodeURIComponent(this.activeLiveChatId)}&part=snippet,authorDetails&key=${encodeURIComponent(this.apiKey)}${pageParam}`;

    let res;
    try {
      res = await this._fetchJson(url);
    } catch {
      if (!this.isPolling) return;
      const msg = 'YouTube APIへの接続でネットワークエラーが発生したため停止しました';
      this.stopPolling(msg);
      this.onError(msg);
      return;
    }

    if (!this.isPolling) return;
    this._addUnits(YOUTUBE_CONFIG.COST_LIST_MESSAGES);

    if (!res.ok) {
      const msg = mapApiError(res.status, res.data);
      recordDiagnostic('youtube', 'poll_api_error', { status: res.status }, 'warn');
      this.stopPolling(msg);
      this.onError(msg);
      return;
    }

    const payload = res.data || {};
    if (payload.nextPageToken) {
      this.nextPageToken = payload.nextPageToken;
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    if (this.isFirstPoll) {
      this.isFirstPoll = false;
      this.onStatusChange({
        isPolling: true,
        message: `連動中（接続前の過去コメント ${items.length}件をスキップしました）`,
      });
    } else if (items.length > 0) {
      this._dispatchChatItems(items);
    }

    if (this.isPolling) {
      const apiInterval = Number(payload.pollingIntervalMillis) || 0;
      const waitMs = Math.max(this.intervalMs, apiInterval);
      this.pollTimerId = setTimeout(() => {
        this._pollOnce();
      }, waitMs);
    }
  }

  _dispatchChatItems(items) {
    const comments = [];
    for (const item of items) {
      const snippet = item?.snippet || {};
      const author = item?.authorDetails?.displayName || '視聴者';
      const handle = CHAT_ITEM_HANDLERS.get(snippet.type);
      if (handle) handle(this, item, snippet, author, comments);
    }

    if (comments.length > 0) {
      this.onComments(comments);
    }
  }
}
