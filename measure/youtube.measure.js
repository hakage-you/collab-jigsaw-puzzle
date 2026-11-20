/**
 * YouTube Data API quota consumption (streamer free tier: 10,000 units/day).
 * Fake fetch injected with setFetchImpl, fake timers, no network.
 * Units are the client's own accounting (sessionUnits): 1 per videos.list, 5 per liveChat/messages.
 * Output: measure/.latest/youtube.json
 */
import { it, vi } from 'vitest';
import { YouTubeLiveClient } from '../src/services/youtubeLiveClient.js';
import { YOUTUBE_CONFIG } from '../src/config/constants.js';
import { round, writeResult } from './measureUtils.js';

const NOTE =
  'Simulated with a fake fetch and fake timers; no network and no key. Units are the client own ' +
  'counter (sessionUnits): 1 per videos.list (verify, once) and 5 per liveChat/messages request ' +
  '(poll). Real Google billing is per request by these same unit costs, but the client does not ' +
  'account for other API calls (search, other tabs or apps sharing the key). The daily quota ' +
  'resets at midnight Pacific time. The 1-hour window starts at the first poll (t = 0) and ' +
  'includes the poll at t = 60 min. "Hours per day" = (10,000 - verify units) / polling units per ' +
  'hour, i.e. one verify per day plus continuous polling.';

const KEY = 'MEASURE_FAKE_KEY';
const VIDEO_ID = 'MEASURELIVE';
const CHAT_ID = 'MEASURE_CHAT';
const HOUR_MS = 60 * 60 * 1000;
const DAILY_LIMIT = YOUTUBE_CONFIG.QUOTA_DAILY_LIMIT;

function jsonResponse(body) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** Fake API: one live video for videos.list; empty chat pages for liveChat/messages. */
function createFakeApi({ pollingIntervalMillis = null } = {}) {
  const calls = { videos: 0, chat: 0 };
  const fetchImpl = vi.fn((url) => {
    const { pathname } = new URL(url);
    if (pathname.endsWith('/videos')) {
      calls.videos += 1;
      return Promise.resolve(
        jsonResponse({
          items: [
            {
              id: VIDEO_ID,
              snippet: {
                title: 'Measurement stream',
                channelTitle: 'Measurement',
                liveBroadcastContent: 'live',
              },
              liveStreamingDetails: { activeLiveChatId: CHAT_ID },
            },
          ],
        }),
      );
    }
    calls.chat += 1;
    const extra = pollingIntervalMillis ? { pollingIntervalMillis } : {};
    return Promise.resolve(
      jsonResponse({ nextPageToken: `page-${calls.chat}`, items: [], ...extra }),
    );
  });
  return { fetchImpl, calls };
}

/**
 * Verifies once, polls for one simulated hour, and reads the client's own unit counter.
 * @param {number|undefined} intervalMs    passed to startPolling (undefined = client default)
 * @param {number|null} apiIntervalMs      pollingIntervalMillis returned by the fake API
 */
async function simulateHour({ intervalMs, apiIntervalMs = null }) {
  const api = createFakeApi({ pollingIntervalMillis: apiIntervalMs });
  vi.stubGlobal('fetch', () => {
    throw new Error('Real network fetch is blocked in measurements');
  });
  vi.useFakeTimers();
  try {
    const client = new YouTubeLiveClient({
      onComments: () => {},
      onSuperchat: () => {},
      onStatusChange: () => {},
      onQuotaUpdate: () => {},
      onError: () => {},
    });
    client.setFetchImpl(api.fetchImpl);

    await client.verifyBroadcast(KEY, VIDEO_ID);
    const verifyUnits = client.sessionUnits;

    client.startPolling(intervalMs);
    await vi.advanceTimersByTimeAsync(HOUR_MS);

    const totalUnits = client.sessionUnits;
    const pollingUnits = totalUnits - verifyUnits;
    const requests = api.calls.videos + api.calls.chat;
    const effectiveIntervalMs = Math.max(client.intervalMs, apiIntervalMs ?? 0);
    client.stopPolling();

    return {
      requestedIntervalMs: intervalMs ?? YOUTUBE_CONFIG.DEFAULT_POLL_INTERVAL_MS,
      apiPollingIntervalMillis: apiIntervalMs,
      effectiveIntervalMs,
      verifyUnits,
      pollRequestsPerHour: api.calls.chat,
      requestsPerHour: requests,
      unitsPerHour: totalUnits,
      pollingUnitsPerHour: pollingUnits,
      hoursPerDayWithin10kUnits: round((DAILY_LIMIT - verifyUnits) / pollingUnits, 2),
    };
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
}

const CASES = [
  { key: 'default', label: 'client default interval', intervalMs: undefined, apiIntervalMs: null },
  { key: 'i15s', label: '15 s interval', intervalMs: 15000, apiIntervalMs: null },
  { key: 'i30s', label: '30 s interval', intervalMs: 30000, apiIntervalMs: null },
  {
    key: 'defaultApi30s',
    label: 'default interval, API asks 30 s (pollingIntervalMillis)',
    intervalMs: undefined,
    apiIntervalMs: 30000,
  },
];

it('YouTube quota per hour of polling, by interval', async () => {
  const scenarios = {};
  for (const c of CASES) {
    scenarios[c.key] = { label: c.label, ...(await simulateHour(c)) };
  }

  const line = (s) =>
    `${s.label}: ${s.unitsPerHour} units/h, ${s.requestsPerHour} requests/h, ` +
    `~${s.hoursPerDayWithin10kUnits} h of polling per day within 10,000 units`;
  const summary = Object.values(scenarios).map(line);

  await writeResult({
    system: 'youtube',
    note: NOTE,
    summary,
    details: {
      dailyLimitUnits: DAILY_LIMIT,
      unitCosts: {
        videosList: YOUTUBE_CONFIG.COST_VERIFY_VIDEOS,
        liveChatMessagesList: YOUTUBE_CONFIG.COST_LIST_MESSAGES,
      },
      scenarios,
    },
  });
}, 120000);
