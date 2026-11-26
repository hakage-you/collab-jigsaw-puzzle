import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YOUTUBE_CONFIG } from '../../src/config/constants.js';
import { YouTubeLiveClient, extractVideoId } from '../../src/services/youtubeLiveClient.js';
import { clearDiagnostics, getDiagnosticsState } from '../../src/services/diagnostics.js';

// Details of the YouTube client: URL forms, error messages, defaults for missing fields and the
// polling state (youtubeLiveClient.node.test.js covers the main flow and the request budget).

const ID = 'LIVEVIDEO01';

describe('extractVideoId: more URL forms', () => {
  it.each([
    ['/shorts/', `https://www.youtube.com/shorts/${ID}`],
    ['/embed/', `https://www.youtube.com/embed/${ID}`],
    ['/v/', `https://www.youtube.com/v/${ID}`],
    ['/video/', `https://www.youtube.com/video/${ID}`],
    ['/live/ with more path', `https://www.youtube.com/live/${ID}/extra`],
    ['a subdomain', `https://m.youtube.com/watch?v=${ID}`],
    ['youtu.be with doubled slashes', `https://youtu.be//${ID}`],
  ])('accepts %s', (_, input) => {
    expect(extractVideoId(input)).toBe(ID);
  });

  it.each([
    ['a 12-character id', `${ID}2`],
    ['a path form not at the start', `https://www.youtube.com/foo/live/${ID}`],
    ['a path id that is too long', `https://www.youtube.com/live/${ID}2`],
    ['a host that only ends in youtube.com', `https://notyoutube.com/watch?v=${ID}`],
    ['youtu.be with a bad id', 'https://youtu.be/short'],
  ])('rejects %s', (_, input) => {
    expect(extractVideoId(input)).toBeNull();
  });
});

/** A fetch that answers from a queue: { status, body } or an Error; body 'broken' fails json(). */
function fakeFetch(queue) {
  return vi.fn((url, init) => {
    const next = queue.shift() ?? { status: 200, body: { items: [] } };
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: () =>
        next.body === 'broken' ? Promise.reject(new Error('not json')) : Promise.resolve(next.body),
      url,
      init,
    });
  });
}

const live = (overrides = {}) => ({
  status: 200,
  body: {
    items: [
      {
        snippet: { title: 'T', channelTitle: 'C', liveBroadcastContent: 'live' },
        liveStreamingDetails: { activeLiveChatId: 'CHAT/1' },
        ...overrides,
      },
    ],
  },
});

const error = (status, reason, message = '') => ({
  status,
  body: { error: { message, errors: reason ? [{ reason }] : [] } },
});

function makeClient(queue) {
  const calls = { comments: [], superchats: [], statuses: [], quota: [], errors: [] };
  const fetch = fakeFetch(queue);
  const client = new YouTubeLiveClient({
    fetchImpl: fetch,
    onComments: (c) => calls.comments.push(c),
    onSuperchat: (s) => calls.superchats.push(s),
    onStatusChange: (s) => calls.statuses.push(s),
    onQuotaUpdate: (u) => calls.quota.push(u),
    onError: (e) => calls.errors.push(e),
  });
  return { client, calls, fetch };
}

beforeEach(() => {
  clearDiagnostics();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('verifyBroadcast: error messages', () => {
  it.each([
    ['the daily limit', error(403, 'dailyLimitExceeded'), /無料枠/],
    ['a 400 that names the API key', error(400, '', 'Bad API Key given'), /APIキーが無効/],
    ['a disabled live chat', error(403, 'liveChatDisabled'), /ライブチャットが無効/],
    ['a forbidden reason with another status', error(400, 'forbidden'), /拒否されました/],
    ['an ended live chat with another status', error(400, 'liveChatEnded'), /終了しています/],
    ['a plain 400', error(400, '', 'oops'), /^YouTube APIエラー（400）: oops$/],
    [
      'an unreadable answer',
      { status: 500, body: 'broken' },
      /^YouTube APIエラー（500）: 通信に失敗しました$/,
    ],
    [
      'an answer without details',
      { status: 502, body: { error: {} } },
      /^YouTube APIエラー（502）: 通信に失敗しました$/,
    ],
  ])('explains %s', async (_, response, message) => {
    const { client } = makeClient([response]);
    await expect(client.verifyBroadcast('KEY', ID)).rejects.toThrow(message);
  });
});

describe('verifyBroadcast: request and defaults', () => {
  it('asks videos.list once with the trimmed key and counts its units', async () => {
    const { client, calls, fetch } = makeClient([live()]);
    const result = await client.verifyBroadcast('  K Y  ', `https://youtu.be/${ID}`);
    const [url, init] = fetch.mock.calls[0];
    expect(init).toEqual({ method: 'GET' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('id')).toBe(ID);
    expect(parsed.searchParams.get('key')).toBe('K Y');
    expect(result).toMatchObject({ videoId: ID, hasActiveChat: true, chatDisabledReason: '' });
    expect(calls.quota).toEqual([YOUTUBE_CONFIG.COST_VERIFY_VIDEOS]);
    expect(result.sessionUnits).toBe(YOUTUBE_CONFIG.COST_VERIFY_VIDEOS);
  });

  it('fills in a title and the rest when the video has no details', async () => {
    const { client } = makeClient([{ status: 200, body: { items: [{}] } }]);
    expect(await client.verifyBroadcast('KEY', ID)).toMatchObject({
      title: '無題の配信',
      channelTitle: '',
      liveBroadcastContent: 'none',
      activeLiveChatId: null,
      hasActiveChat: false,
    });
  });

  it('reports a missing video for an answer without items', async () => {
    const { client } = makeClient([{ status: 200, body: {} }]);
    await expect(client.verifyBroadcast('KEY', ID)).rejects.toThrow(/見つかりませんでした/);
  });

  it('stops polling before checking another broadcast', async () => {
    const { client, calls } = makeClient([live(), { status: 200, body: { items: [] } }, live()]);
    await client.verifyBroadcast('KEY', ID);
    vi.useFakeTimers();
    client.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    await client.verifyBroadcast('KEY', ID);
    expect(client.isPolling).toBe(false);
    expect(calls.statuses.at(-1)).toEqual({
      isPolling: false,
      message: 'コメント連動を停止しました',
    });
  });
});

describe('polling', () => {
  async function polling(queue, interval) {
    const made = makeClient([live(), ...queue]);
    await made.client.verifyBroadcast('KEY', ID);
    vi.useFakeTimers();
    made.client.startPolling(interval);
    await vi.advanceTimersByTimeAsync(0);
    return made;
  }

  const chatUrls = (fetch) => fetch.mock.calls.slice(1).map(([url]) => new URL(url));

  it('refuses to start before a broadcast with a chat was checked', () => {
    const { client } = makeClient([]);
    expect(() => client.startPolling()).toThrow(/先に有効なライブチャット/);
  });

  it('says it started, then how many old comments it skipped', async () => {
    const { calls } = await polling([{ status: 200, body: { items: [{}, {}] } }]);
    expect(calls.statuses).toEqual([
      {
        isPolling: true,
        message: 'コメント連動を開始しました（初回取得で過去コメントをスキップします）',
      },
      { isPolling: true, message: '連動中（接続前の過去コメント 2件をスキップしました）' },
    ]);
    expect(calls.comments).toEqual([]);
  });

  it('asks for the chat by id and passes the page token on to the next request', async () => {
    const { fetch } = await polling([
      { status: 200, body: { items: [], nextPageToken: 'A&B' } },
      { status: 200, body: { items: [] } },
      { status: 200, body: { items: [] } },
    ]);
    await vi.advanceTimersByTimeAsync(YOUTUBE_CONFIG.DEFAULT_POLL_INTERVAL_MS * 2);
    const [first, second, third] = chatUrls(fetch);
    expect(first.searchParams.get('liveChatId')).toBe('CHAT/1');
    expect(first.searchParams.has('pageToken')).toBe(false);
    expect(second.searchParams.get('pageToken')).toBe('A&B');
    // The token is kept when an answer has none.
    expect(third.searchParams.get('pageToken')).toBe('A&B');
  });

  it('falls back to the default interval for a broken one', async () => {
    const { fetch } = await polling([], 'x');
    await vi.advanceTimersByTimeAsync(YOUTUBE_CONFIG.DEFAULT_POLL_INTERVAL_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('logs an API error with its status and stops with the message', async () => {
    const { client, calls } = await polling([error(403, 'quotaExceeded')]);
    expect(client.isPolling).toBe(false);
    expect(calls.errors).toEqual([expect.stringMatching(/無料枠/)]);
    expect(getDiagnosticsState().entries.at(-1)).toMatchObject({
      category: 'youtube',
      message: 'poll_api_error',
      meta: { status: 403 },
      level: 'warn',
    });
  });

  it('ignores an answer that arrives after it was stopped', async () => {
    const made = makeClient([live()]);
    await made.client.verifyBroadcast('KEY', ID);
    let answer;
    made.client.setFetchImpl(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    made.client.startPolling();
    made.client.stopPolling('止めた');
    answer({ ok: false, status: 500, json: () => Promise.resolve(null) });
    await Promise.resolve();
    await Promise.resolve();
    expect(made.calls.errors).toEqual([]);
    expect(made.calls.quota).toEqual([YOUTUBE_CONFIG.COST_VERIFY_VIDEOS]);
    expect(made.calls.statuses.at(-1)).toEqual({ isPolling: false, message: '止めた' });
  });

  it('ignores a network failure after it was stopped', async () => {
    const made = makeClient([live()]);
    await made.client.verifyBroadcast('KEY', ID);
    let fail;
    made.client.setFetchImpl(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    made.client.startPolling();
    made.client.stopPolling();
    fail(new Error('offline'));
    await Promise.resolve();
    await Promise.resolve();
    expect(made.calls.errors).toEqual([]);
  });

  it('says nothing when stopped while not polling, and cancels the next poll', async () => {
    const { client, calls } = makeClient([]);
    client.stopPolling();
    expect(calls.statuses).toEqual([]);

    const made = await polling([]);
    made.client.stopPolling();
    await vi.advanceTimersByTimeAsync(YOUTUBE_CONFIG.DEFAULT_POLL_INTERVAL_MS * 3);
    expect(made.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('chat items', () => {
  async function dispatched(items) {
    const made = makeClient([
      live(),
      { status: 200, body: { items: [] } },
      { status: 200, body: { items } },
    ]);
    await made.client.verifyBroadcast('KEY', ID);
    vi.useFakeTimers();
    made.client.startPolling();
    await vi.advanceTimersByTimeAsync(YOUTUBE_CONFIG.DEFAULT_POLL_INTERVAL_MS);
    return made.calls;
  }

  it('reads text from the message details and fills in a viewer name', async () => {
    const calls = await dispatched([
      { id: 'a', snippet: { type: 'textMessageEvent', textMessageDetails: { messageText: 'hi' } } },
      { id: 'b', snippet: { type: 'textMessageEvent' }, authorDetails: { displayName: 'B' } },
      { id: 'c', snippet: { type: 'otherEvent', displayMessage: 'x' } },
      null,
    ]);
    expect(calls.comments).toEqual([[{ id: 'a', author: '視聴者', text: 'hi' }]]);
  });

  it('sends no comment batch when there are no comments', async () => {
    const calls = await dispatched([{ id: 'c', snippet: { type: 'otherEvent' } }]);
    expect(calls.comments).toEqual([]);
  });

  it('fills in the defaults of super chats and stickers', async () => {
    const calls = await dispatched([
      { id: 's', snippet: { type: 'superChatEvent', displayMessage: 'from snippet' } },
      { id: 't', snippet: { type: 'superStickerEvent', superStickerDetails: { tier: '3' } } },
    ]);
    expect(calls.superchats).toEqual([
      {
        id: 's',
        author: '視聴者',
        amountDisplay: '¥1,000',
        message: 'from snippet',
        tier: 1,
        isSticker: false,
      },
      {
        id: 't',
        author: '視聴者',
        amountDisplay: '¥500',
        message: 'スーパーステッカー',
        tier: 3,
        isSticker: true,
      },
    ]);
  });

  it('treats an answer without a list as no items', async () => {
    const calls = await dispatched('not a list');
    expect(calls.comments).toEqual([]);
    expect(calls.superchats).toEqual([]);
  });
});
