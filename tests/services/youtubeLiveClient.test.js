import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YouTubeLiveClient, extractVideoId } from '../../src/services/youtubeLiveClient.js';
import { YOUTUBE_CONFIG } from '../../src/config/constants.js';

const KEY = 'TEST_KEY';
const VIDEO_ID = 'LIVEVIDEO01';
const CHAT_ID = 'CHAT_LIVE_1';
const API_HOST = 'https://www.googleapis.com';
const VIDEOS_PATH = '/youtube/v3/videos';
const CHAT_PATH = '/youtube/v3/liveChat/messages';

/**
 * Fake YouTube Data API. Responses are queued per endpoint. Any request that is not
 * an expected GET to the expected endpoint with the test key is recorded in `unexpected`
 * (the afterEach hook fails the test if that list is not empty).
 */
function createFakeYouTube() {
  const fake = {
    videoResponses: [],
    chatResponses: [],
    chatRequests: 0,
    unexpected: [],
  };
  fake.fetch = vi.fn((url, init = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = init.method ?? 'GET';
    const known =
      parsed.origin === API_HOST &&
      (path === VIDEOS_PATH || path === CHAT_PATH) &&
      method === 'GET';
    if (!known || parsed.searchParams.get('key') !== KEY) {
      const msg = `Unexpected request: ${method} ${url}`;
      fake.unexpected.push(msg);
      throw new Error(msg);
    }
    let next;
    if (path === VIDEOS_PATH) {
      next = fake.videoResponses.shift();
      if (!next) {
        const msg = `No queued video response for ${url}`;
        fake.unexpected.push(msg);
        throw new Error(msg);
      }
    } else {
      fake.chatRequests += 1;
      next = fake.chatResponses.shift() ?? { status: 200, body: { items: [] } };
    }
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: () => Promise.resolve(next.body),
    };
  });
  return fake;
}

const liveVideoBody = (overrides = {}) => ({
  items: [
    {
      id: VIDEO_ID,
      snippet: {
        title: 'Live stream title',
        channelTitle: 'Test Channel',
        liveBroadcastContent: 'live',
      },
      liveStreamingDetails: { activeLiveChatId: CHAT_ID },
      ...overrides,
    },
  ],
});

const chatPage = (items = [], extra = {}) => ({
  status: 200,
  body: { nextPageToken: 'NEXT', items, ...extra },
});

const apiError = (status, reason, message = 'API error') => ({
  status,
  body: { error: { code: status, message, errors: [{ reason }] } },
});

describe('extractVideoId', () => {
  it.each([
    ['plain 11-character id', 'LIVEVIDEO01'],
    ['watch URL', 'https://www.youtube.com/watch?v=LIVEVIDEO01'],
    ['youtu.be short URL', 'https://youtu.be/LIVEVIDEO01'],
    ['youtu.be with extra query params', 'https://youtu.be/LIVEVIDEO01?t=42&si=abc'],
    ['/live/ URL', 'https://www.youtube.com/live/LIVEVIDEO01'],
    ['/live/ URL with query', 'https://www.youtube.com/live/LIVEVIDEO01?si=xyz'],
    [
      'watch URL with extra params before v',
      'https://www.youtube.com/watch?feature=share&v=LIVEVIDEO01&t=10',
    ],
    ['URL without scheme', 'youtube.com/watch?v=LIVEVIDEO01'],
    ['surrounding whitespace', '   LIVEVIDEO01  '],
  ])('accepts %s', (_label, input) => {
    expect(extractVideoId(input)).toBe(VIDEO_ID);
  });

  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['whitespace only', '   '],
    ['arbitrary word', 'hello'],
    ['too short id', 'LIVE123'],
    ['non-YouTube host', 'https://example.com/watch?v=LIVEVIDEO01'],
    ['YouTube URL without a video id', 'https://www.youtube.com/'],
    ['watch URL with a malformed v', 'https://www.youtube.com/watch?v=short'],
    ['unparseable input with spaces', 'https://hello world ://'],
  ])('rejects %s', (_label, input) => {
    expect(extractVideoId(input)).toBeNull();
  });
});

describe('YouTubeLiveClient', () => {
  let fake;
  let callbacks;
  let client;

  beforeEach(() => {
    fake = createFakeYouTube();
    // Safety net: any code path that bypasses the injected fetch fails loudly.
    vi.stubGlobal('fetch', () => {
      throw new Error('Real network fetch is blocked in tests');
    });
    callbacks = {
      onComments: vi.fn(),
      onSuperchat: vi.fn(),
      onStatusChange: vi.fn(),
      onQuotaUpdate: vi.fn(),
      onError: vi.fn(),
    };
    client = new YouTubeLiveClient(callbacks);
    client.setFetchImpl(fake.fetch);
  });

  afterEach(() => {
    client.stopPolling();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    expect(fake.unexpected).toEqual([]);
  });

  const connectLive = () => {
    fake.videoResponses.push({ status: 200, body: liveVideoBody() });
    return client.verifyBroadcast(KEY, VIDEO_ID);
  };

  describe('verifyBroadcast', () => {
    it('resolves with the live chat id for a live broadcast', async () => {
      const info = await connectLive();

      expect(info).toMatchObject({
        videoId: VIDEO_ID,
        title: 'Live stream title',
        channelTitle: 'Test Channel',
        liveBroadcastContent: 'live',
        activeLiveChatId: CHAT_ID,
        hasActiveChat: true,
        chatDisabledReason: '',
        sessionUnits: 1,
      });
      expect(callbacks.onQuotaUpdate).toHaveBeenLastCalledWith(1);
    });

    it('reports a non-live video without a chat id and refuses to poll', async () => {
      fake.videoResponses.push({
        status: 200,
        body: {
          items: [
            {
              id: VIDEO_ID,
              snippet: {
                title: 'Old upload',
                channelTitle: 'Test Channel',
                liveBroadcastContent: 'none',
              },
              liveStreamingDetails: {},
            },
          ],
        },
      });

      const info = await client.verifyBroadcast(KEY, VIDEO_ID);

      expect(info.hasActiveChat).toBe(false);
      expect(info.activeLiveChatId).toBeNull();
      expect(info.liveBroadcastContent).toBe('none');
      expect(info.chatDisabledReason).toContain('ライブチャットが取得できません');
      expect(() => client.startPolling()).toThrow(
        '先に有効なライブチャットのある配信を確認してください',
      );
    });

    it('rejects when the video is missing from the response', async () => {
      fake.videoResponses.push({ status: 200, body: { items: [] } });

      await expect(client.verifyBroadcast(KEY, VIDEO_ID)).rejects.toThrow(
        '該当する動画が見つかりませんでした',
      );
    });

    it('maps quotaExceeded to the daily quota message', async () => {
      fake.videoResponses.push(apiError(403, 'quotaExceeded', 'quota'));

      await expect(client.verifyBroadcast(KEY, VIDEO_ID)).rejects.toThrow('本日の無料枠');
      expect(callbacks.onQuotaUpdate).toHaveBeenLastCalledWith(1);
    });

    it('maps keyInvalid to the invalid API key message', async () => {
      fake.videoResponses.push(apiError(400, 'keyInvalid', 'bad key'));

      await expect(client.verifyBroadcast(KEY, VIDEO_ID)).rejects.toThrow('APIキーが無効です');
    });

    it('maps a 403 forbidden response to the forbidden message', async () => {
      fake.videoResponses.push(apiError(403, 'forbidden', 'forbidden'));

      await expect(client.verifyBroadcast(KEY, VIDEO_ID)).rejects.toThrow(
        'YouTubeへの接続が拒否されました（403',
      );
    });

    it('maps a 404 response to the not-found message', async () => {
      fake.videoResponses.push({ status: 404, body: {} });

      await expect(client.verifyBroadcast(KEY, VIDEO_ID)).rejects.toThrow(
        '見つからないか、すでに終了しています',
      );
    });

    it('falls back to a generic message with the status for other errors', async () => {
      fake.videoResponses.push(apiError(500, 'backendError', 'boom'));

      await expect(client.verifyBroadcast(KEY, VIDEO_ID)).rejects.toThrow(
        'YouTube APIエラー（500）: boom',
      );
    });

    it('rejects an empty API key without making a request', async () => {
      await expect(client.verifyBroadcast('   ', VIDEO_ID)).rejects.toThrow(
        'APIキーを入力してください',
      );
      expect(fake.fetch).not.toHaveBeenCalled();
    });

    it('rejects an input that is not a YouTube video without making a request', async () => {
      await expect(
        client.verifyBroadcast(KEY, 'https://example.com/watch?v=LIVEVIDEO01'),
      ).rejects.toThrow('有効なYouTube配信URL');
      expect(fake.fetch).not.toHaveBeenCalled();
    });
  });

  describe('chat dispatch', () => {
    it('skips the backlog on the first poll and dispatches comments, super chats and stickers afterwards', async () => {
      vi.useFakeTimers();
      await connectLive();

      fake.chatResponses.push(
        chatPage([
          {
            id: 'old-1',
            snippet: { type: 'textMessageEvent', displayMessage: 'from before connecting' },
            authorDetails: { displayName: 'Early' },
          },
        ]),
        chatPage([
          {
            id: 'm1',
            snippet: { type: 'textMessageEvent', displayMessage: 'hello' },
            authorDetails: { displayName: 'Alice' },
          },
          {
            id: 's1',
            snippet: {
              type: 'superChatEvent',
              displayMessage: 'thanks!',
              superChatDetails: { amountDisplayString: '¥500', userComment: 'thanks!', tier: 2 },
            },
            authorDetails: { displayName: 'Bob' },
          },
          {
            id: 'st1',
            snippet: {
              type: 'superStickerEvent',
              superStickerDetails: {
                amountDisplayString: '¥200',
                tier: 1,
                superStickerMetadata: { altText: 'cat sticker' },
              },
            },
            authorDetails: { displayName: 'Carol' },
          },
          {
            id: 'x1',
            snippet: { type: 'memberMilestoneChatEvent' },
            authorDetails: { displayName: 'Dave' },
          },
        ]),
      );

      client.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(callbacks.onComments).not.toHaveBeenCalled();
      expect(callbacks.onSuperchat).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(YOUTUBE_CONFIG.DEFAULT_POLL_INTERVAL_MS);

      expect(callbacks.onComments).toHaveBeenCalledTimes(1);
      expect(callbacks.onComments).toHaveBeenCalledWith([
        { id: 'm1', author: 'Alice', text: 'hello' },
      ]);

      expect(callbacks.onSuperchat).toHaveBeenCalledTimes(2);
      expect(callbacks.onSuperchat).toHaveBeenNthCalledWith(1, {
        id: 's1',
        author: 'Bob',
        amountDisplay: '¥500',
        message: 'thanks!',
        tier: 2,
        isSticker: false,
      });
      expect(callbacks.onSuperchat).toHaveBeenNthCalledWith(2, {
        id: 'st1',
        author: 'Carol',
        amountDisplay: '¥200',
        message: 'cat sticker',
        tier: 1,
        isSticker: true,
      });

      expect(callbacks.onError).not.toHaveBeenCalled();
    });
  });

  describe('polling interval', () => {
    it('polls at the default interval (10 s) and not sooner', async () => {
      vi.useFakeTimers();
      await connectLive();

      client.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.chatRequests).toBe(1);

      await vi.advanceTimersByTimeAsync(9999);
      expect(fake.chatRequests).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.chatRequests).toBe(2);

      await vi.advanceTimersByTimeAsync(10000);
      expect(fake.chatRequests).toBe(3);
    });

    it('clamps a requested interval below 5000 ms up to 5000 ms', async () => {
      vi.useFakeTimers();
      await connectLive();

      client.startPolling(1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.chatRequests).toBe(1);

      await vi.advanceTimersByTimeAsync(4999);
      expect(fake.chatRequests).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.chatRequests).toBe(2);
    });

    it('honors a longer pollingIntervalMillis returned by the API', async () => {
      vi.useFakeTimers();
      await connectLive();
      fake.chatResponses.push(chatPage([], { pollingIntervalMillis: 15000 }));

      client.startPolling(10000);
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.chatRequests).toBe(1);

      await vi.advanceTimersByTimeAsync(14999);
      expect(fake.chatRequests).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.chatRequests).toBe(2);
    });

    it('counts 5 quota units per liveChatMessages request', async () => {
      vi.useFakeTimers();
      await connectLive();

      client.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10000);

      // 1 unit for the verify call, then 5 per poll.
      expect(callbacks.onQuotaUpdate).toHaveBeenLastCalledWith(1 + 2 * 5);
    });
  });

  describe('errors during polling', () => {
    it.each([
      ['quota exhausted', apiError(403, 'quotaExceeded', 'quota'), '本日の無料枠'],
      ['invalid API key', apiError(400, 'keyInvalid', 'bad key'), 'APIキーが無効です'],
      ['chat disabled', apiError(403, 'liveChatDisabled', 'disabled'), 'ライブチャットが無効'],
    ])('stops polling on %s and reports the reason', async (_label, response, expectedText) => {
      vi.useFakeTimers();
      await connectLive();
      fake.chatResponses.push(chatPage(), response);

      client.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10000);

      expect(fake.chatRequests).toBe(2);
      expect(callbacks.onError).toHaveBeenCalledTimes(1);
      expect(callbacks.onError.mock.calls[0][0]).toContain(expectedText);
      expect(callbacks.onStatusChange).toHaveBeenLastCalledWith({
        isPolling: false,
        message: callbacks.onError.mock.calls[0][0],
      });

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(fake.chatRequests).toBe(2);
    });

    it('stops polling on a network failure and reports it', async () => {
      vi.useFakeTimers();
      await connectLive();
      fake.chatResponses.push(chatPage(), new TypeError('Failed to fetch'));

      client.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10000);

      expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('ネットワークエラー'));
      expect(callbacks.onStatusChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ isPolling: false }),
      );

      await vi.advanceTimersByTimeAsync(60000);
      expect(fake.chatRequests).toBe(2);
    });
  });

  describe('stopPolling', () => {
    it('stops further requests and reports the status change', async () => {
      vi.useFakeTimers();
      await connectLive();

      client.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.chatRequests).toBe(1);

      client.stopPolling();
      expect(callbacks.onStatusChange).toHaveBeenLastCalledWith({
        isPolling: false,
        message: 'コメント連動を停止しました',
      });

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(fake.chatRequests).toBe(1);
    });
  });

  describe('request budget (API usage documentation)', () => {
    it('one hour at the default interval makes about 3600000 / 10000 = 360 liveChatMessages requests (about 1800 quota units)', async () => {
      vi.useFakeTimers();
      await connectLive();

      client.startPolling();
      // Requests at t = 0, 10 s, 20 s, ..., 3600 s: 361 when the window is inclusive.
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      const expected = (60 * 60 * 1000) / YOUTUBE_CONFIG.DEFAULT_POLL_INTERVAL_MS;
      expect(Math.abs(fake.chatRequests - expected)).toBeLessThanOrEqual(1);
      expect(callbacks.onQuotaUpdate).toHaveBeenLastCalledWith(
        1 + fake.chatRequests * YOUTUBE_CONFIG.COST_LIST_MESSAGES,
      );
    });
  });
});
