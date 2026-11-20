/**
 * Optional read-only YouTube API key permission & restriction verifier.
 * Strictly GET-only, max 4 HTTP requests, zero persistent key storage, automatic log redaction.
 * Manual execution only (excluded from lint and standard E2E).
 */

import { YOUTUBE_CONFIG } from '../src/config/constants.js';
import { YouTubeLiveClient, extractVideoId } from '../src/services/youtubeLiveClient.js';

const MAX_REQUESTS = 4;
const DEFAULT_PUBLIC_VIDEO_ID = 'jNQXAC9IVRw';

function redactSecrets(text, apiKey) {
  let out = String(text ?? '');
  out = out.replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]');
  if (apiKey) {
    out = out.split(apiKey).join('[REDACTED]');
    const encoded = encodeURIComponent(apiKey);
    if (encoded && encoded !== apiKey) {
      out = out.split(encoded).join('[REDACTED]');
    }
  }
  return out;
}

function createDryRunFetch() {
  return (url) => {
    if (url.includes('/youtube/v3/videos')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            items: [
              {
                snippet: {
                  title: 'Me at the zoo',
                  channelTitle: 'jawed',
                  liveBroadcastContent: 'none',
                },
                liveStreamingDetails: {},
              },
            ],
          }),
      });
    }
    if (url.includes('/youtube/v3/channels') || url.includes('/youtube/v3/subscriptions')) {
      return Promise.resolve({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            error: {
              code: 401,
              message: 'API keys are not supported by this API. Expected OAuth2 access token.',
              errors: [{ reason: 'authError' }],
            },
          }),
      });
    }
    if (url.includes('/books/v1/volumes')) {
      return Promise.resolve({
        ok: false,
        status: 403,
        json: () =>
          Promise.resolve({
            error: {
              code: 403,
              message: 'Requests from this API client are blocked.',
              errors: [{ reason: 'API_KEY_SERVICE_BLOCKED' }],
            },
          }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  };
}

function printUsage() {
  console.error('環境変数 YT_DEV_API_KEY が未設定のため、通信を行わず終了します。');
  console.error('使い方 (PowerShell):');
  console.error('  $env:YT_DEV_API_KEY="AIza..."; npm.cmd run test:yt-key-readonly');
  console.error('実通信なしで自己検証する場合:');
  console.error('  node tests/optional-youtube-key-check.mjs --dry-run');
}

// Wraps the base fetch so that only GET requests are sent and the request budget is enforced.
function createGuardedFetch(baseFetch, usage) {
  return (url, init = {}) => {
    const method = String(init?.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      return Promise.reject(
        new Error(`GET 以外の HTTP メソッド (${method}) は規約違反のためブロックされました`),
      );
    }
    if (usage.requestCount >= MAX_REQUESTS) {
      return Promise.reject(
        new Error(`1実行あたりの上限リクエスト数 (${MAX_REQUESTS}) を超過しました`),
      );
    }
    usage.requestCount += 1;
    usage.methodsUsed.push(method);
    return baseFetch(url, { ...init, method: 'GET' });
  };
}

// Check 1: public video read via YouTubeLiveClient (1 unit).
async function checkPublicVideo(guardedFetch, apiKey, videoId) {
  try {
    const client = new YouTubeLiveClient({ fetchImpl: guardedFetch });
    const info = await client.verifyBroadcast(apiKey, videoId);
    if (info.title) {
      return { line: `1. 公開動画読み取り (GET): PASS — "${info.title}"`, failed: false };
    }
    return {
      line: '1. 公開動画読み取り (GET): FAIL — タイトルを取得できませんでした',
      failed: true,
    };
  } catch (err) {
    return { line: `1. 公開動画読み取り (GET): FAIL — ${err?.message || 'エラー'}`, failed: true };
  }
}

// Checks 2 and 3: private account endpoints must be rejected with 401 Unauthorized.
async function checkUnauthorizedEndpoint(guardedFetch, apiKey, { index, label, path }) {
  const url = `${YOUTUBE_CONFIG.API_BASE}/${path}?part=id&mine=true&key=${encodeURIComponent(apiKey)}`;
  const res = await guardedFetch(url, { method: 'GET' });
  if (res.status === 401) {
    return { line: `${index}. ${label}: PASS (401 Unauthorized)`, failed: false };
  }
  return {
    line: `${index}. ${label}: FAIL (期待=401, 実際=${res.status})`,
    failed: true,
  };
}

// Check 4: other Google API restriction (Books API GET, 0 YouTube quota).
async function checkBooksRestriction(guardedFetch, booksUrl) {
  const booksRes = await guardedFetch(booksUrl, { method: 'GET' });
  if (booksRes.status === 403) {
    return {
      line: '4. 他 Google API 制限確認 (GET books/v1): PASS (API制限が正しくYouTubeのみに効いています)',
      failed: false,
    };
  }
  if (booksRes.status === 200) {
    return {
      line: '4. 他 Google API 制限確認 (GET books/v1): WARN / FAIL (APIの制限が未設定の可能性があります：Google CloudでYouTube Data API v3のみに制限してください)',
      failed: true,
    };
  }
  return {
    line: `4. 他 Google API 制限確認 (GET books/v1): FAIL (期待=403, 実際=${booksRes.status})`,
    failed: true,
  };
}

function printSummary(log, usage, redactionSmoke) {
  log('--- サマリー ---');
  log(`実行した HTTP メソッド: ${usage.methodsUsed.join(', ')} (すべて GET)`);
  log(`リクエスト総数: ${usage.requestCount} / ${MAX_REQUESTS}`);
  log('推定 YouTube クォータ消費: 約 1〜3 ユニット (1日無料枠 10,000 ユニットの 0.03% 以下)');
  log(`キーマスク検証: ${redactionSmoke}`);
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.env.YT_DRY_RUN === '1';
  const rawEnvKey = (process.env.YT_DEV_API_KEY || '').trim();

  if (!isDryRun && !rawEnvKey) {
    printUsage();
    process.exit(1);
  }

  const apiKey = isDryRun ? 'DRY_RUN_DUMMY_KEY_SAMPLE' : rawEnvKey;
  const rawVideoInput = process.env.YT_TEST_VIDEO_ID || DEFAULT_PUBLIC_VIDEO_ID;
  const videoId = extractVideoId(rawVideoInput) || DEFAULT_PUBLIC_VIDEO_ID;

  const baseFetch = isDryRun ? createDryRunFetch() : globalThis.fetch.bind(globalThis);
  const usage = { methodsUsed: [], requestCount: 0 };
  const guardedFetch = createGuardedFetch(baseFetch, usage);
  const booksUrl = `https://www.googleapis.com/books/v1/volumes?q=jigsaw&maxResults=1&key=${encodeURIComponent(apiKey)}`;

  const log = (line) => console.log(redactSecrets(line, apiKey));

  log(`[YT Key Readonly Check] モード: ${isDryRun ? 'DRY-RUN (モック通信)' : 'LIVE (実通信)'}`);
  log(`テスト対象動画 ID: ${videoId}`);

  // Checks run sequentially, in order, to keep the request budget and output stable.
  const checks = [];
  checks.push(await checkPublicVideo(guardedFetch, apiKey, videoId));
  checks.push(
    await checkUnauthorizedEndpoint(guardedFetch, apiKey, {
      index: 2,
      label: '非公開チャンネル読み取り拒否 (GET channels?mine=true)',
      path: 'channels',
    }),
  );
  checks.push(
    await checkUnauthorizedEndpoint(guardedFetch, apiKey, {
      index: 3,
      label: '登録チャンネル読み取り拒否 (GET subscriptions?mine=true)',
      path: 'subscriptions',
    }),
  );
  checks.push(await checkBooksRestriction(guardedFetch, booksUrl));
  const hasFailure = checks.some((check) => check.failed);

  // Verify redaction works on URLs containing key=...
  const redactionSmoke = redactSecrets(booksUrl, apiKey);
  if (redactionSmoke.includes(apiKey) || !redactionSmoke.includes('[REDACTED]')) {
    throw new Error('Redaction check failed');
  }

  log('');
  for (const check of checks) {
    log(check.line);
  }
  printSummary(log, usage, redactionSmoke);

  if (hasFailure) {
    process.exit(1);
  }
}

main().catch((err) => {
  const rawKey = (process.env.YT_DEV_API_KEY || '').trim();
  console.error(redactSecrets(err?.message || String(err), rawKey));
  process.exit(1);
});
