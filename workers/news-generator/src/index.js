import { buildPrompt } from './prompt.js';
import { callClaude, parseGeneratedJson } from './claude.js';
import { FEED_SOURCES } from './feeds.js';
import { fetchAndParseFeed } from './parser.js';

/**
 * 生成新聞 - 紙面生成 Worker
 *
 * Endpoints:
 *   GET /api/generate              → 紙面JSON（キャッシュ優先、なければ生成）
 *   GET /api/generate?edition=morning → 朝刊指定
 *   GET /api/generate?edition=evening → 夕刊指定
 *   GET /api/generate?force=true   → キャッシュ無視して再生成
 *   GET /health                    → ヘルスチェック
 *
 * Cron Triggers:
 *   0 21 * * * (UTC) = 06:00 JST → 朝刊生成・キャッシュ
 *   0  8 * * * (UTC) = 17:00 JST → 夕刊生成・キャッシュ
 *
 * Environment:
 *   CLAUDE_API_KEY (secret) — Anthropic API key
 *   UNSPLASH_ACCESS_KEY (secret) — Unsplash API key
 *   NEWSPAPER_CACHE (KV) — キャッシュ用KV namespace
 */

const ALLOWED_ORIGINS = [
  'https://paul13131313.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const CACHE_TTL = 12 * 60 * 60; // 12時間（秒）

function getCorsHeaders(request) {
  const origin = request?.headers?.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonResponse(data, status = 200, request = null) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...getCorsHeaders(request),
    },
  });
}

/**
 * 時間帯から版を判定（JST基準）
 * 6:00〜16:59 → 朝刊, 17:00〜5:59 → 夕刊
 */
function detectEdition() {
  const jstHour = new Date(Date.now() + 9 * 60 * 60 * 1000).getHours();
  return (jstHour >= 6 && jstHour < 17) ? 'morning' : 'evening';
}

/**
 * JSTの日付文字列を取得 (例: "2026-02-12")
 */
function getJstDateString() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/**
 * キャッシュキーを生成 (例: "morning-2026-02-12")
 */
function getCacheKey(edition) {
  return `${edition}-${getJstDateString()}`;
}

/**
 * RSSフィードから直接ニュースを取得（Worker間通信の制約回避）
 */
async function fetchNews(limit = 50) {
  const results = await Promise.allSettled(
    FEED_SOURCES.map((source) => fetchAndParseFeed(source))
  );

  const articles = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      articles.push(...result.value);
    }
  }

  // 新しい順にソート
  articles.sort((a, b) => {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });

  // 重複除去
  const seen = new Set();
  const unique = articles.filter((article) => {
    if (seen.has(article.url)) return false;
    seen.add(article.url);
    return true;
  });

  console.log(`Fetched ${unique.length} unique articles from ${FEED_SOURCES.length} feeds`);
  return unique.slice(0, limit);
}

/**
 * Unsplash APIで写真を検索
 * @returns {{ imageUrl: string, imageCredit: string } | null}
 */
async function fetchUnsplashImage(accessKey, keyword) {
  if (!accessKey || !keyword) return null;
  try {
    const query = encodeURIComponent(keyword);
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${query}&orientation=landscape&per_page=1`,
      { headers: { Authorization: `Client-ID ${accessKey}` } }
    );
    if (!res.ok) {
      console.error(`Unsplash API error: ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data.results || data.results.length === 0) return null;
    const photo = data.results[0];
    return {
      imageUrl: photo.urls.regular,
      imageCredit: photo.user.name,
      imageCreditLink: photo.user.links.html,
      unsplashLink: photo.links.html,
    };
  } catch (err) {
    console.error('Unsplash fetch error:', err);
    return null;
  }
}

/**
 * 紙面を生成
 */
async function generateNewspaper(apiKey, edition, unsplashKey) {
  // 1. ニュース取得
  const articles = await fetchNews(50);
  if (articles.length === 0) {
    throw new Error('No news articles available');
  }

  // 2. プロンプト構築
  const { systemPrompt, userPrompt } = buildPrompt(articles, edition);

  // 3. Claude API呼び出し
  const rawText = await callClaude(apiKey, systemPrompt, userPrompt);

  // 4. JSONパース
  const newspaper = parseGeneratedJson(rawText);

  // 5. Unsplash写真取得（headline + articles）
  if (unsplashKey) {
    const photoPromises = [];

    // headline写真
    const headlineKeyword = newspaper.headline?.imageKeyword;
    if (headlineKeyword) {
      photoPromises.push(
        fetchUnsplashImage(unsplashKey, headlineKeyword).then(photo => {
          if (photo) {
            newspaper.headline.imageUrl = photo.imageUrl;
            newspaper.headline.imageCredit = photo.imageCredit;
            newspaper.headline.imageCreditLink = photo.imageCreditLink;
            newspaper.headline.unsplashLink = photo.unsplashLink;
          }
        })
      );
    }

    // articles写真（imageKeywordがある記事のみ）
    if (newspaper.articles) {
      newspaper.articles.forEach((article, i) => {
        if (article.imageKeyword) {
          photoPromises.push(
            fetchUnsplashImage(unsplashKey, article.imageKeyword).then(photo => {
              if (photo) {
                newspaper.articles[i].imageUrl = photo.imageUrl;
                newspaper.articles[i].imageCredit = photo.imageCredit;
                newspaper.articles[i].imageCreditLink = photo.imageCreditLink;
                newspaper.articles[i].unsplashLink = photo.unsplashLink;
              }
            })
          );
        }
      });
    }

    // 並列で写真取得
    await Promise.all(photoPromises);
  }

  return {
    newspaper,
    meta: {
      edition,
      sourceArticleCount: articles.length,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * 紙面を生成してKVにキャッシュ
 */
async function generateAndCache(env, edition) {
  const startTime = Date.now();
  const result = await generateNewspaper(env.CLAUDE_API_KEY, edition, env.UNSPLASH_ACCESS_KEY);
  const elapsed = Date.now() - startTime;

  const cached = {
    ...result,
    meta: {
      ...result.meta,
      elapsedMs: elapsed,
      cached: true,
      cachedAt: new Date().toISOString(),
    },
  };

  // KVに保存（TTL: 12時間）
  const cacheKey = getCacheKey(edition);
  if (env.NEWSPAPER_CACHE) {
    await env.NEWSPAPER_CACHE.put(cacheKey, JSON.stringify(cached), {
      expirationTtl: CACHE_TTL,
    });
    console.log(`Cached ${cacheKey} (${elapsed}ms, TTL ${CACHE_TTL}s)`);
  }

  return cached;
}

/**
 * ルーティング
 */
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(request) });
  }

  // Health check
  if (path === '/health') {
    return jsonResponse({
      status: 'ok',
      service: 'news-generator',
      timestamp: new Date().toISOString(),
      hasApiKey: !!env.CLAUDE_API_KEY,
      hasUnsplashKey: !!env.UNSPLASH_ACCESS_KEY,
      hasCache: !!env.NEWSPAPER_CACHE,
    }, 200, request);
  }

  // 紙面生成（キャッシュ優先）
  if (path === '/api/generate') {
    if (!env.CLAUDE_API_KEY) {
      return jsonResponse({ error: 'CLAUDE_API_KEY not configured' }, 500, request);
    }

    const edition = url.searchParams.get('edition') || detectEdition();
    if (edition !== 'morning' && edition !== 'evening') {
      return jsonResponse({ error: 'Invalid edition. Use "morning" or "evening".' }, 400, request);
    }

    const force = url.searchParams.get('force') === 'true';

    // キャッシュ確認（force=true でなければ）
    if (!force && env.NEWSPAPER_CACHE) {
      const cacheKey = getCacheKey(edition);
      const cachedData = await env.NEWSPAPER_CACHE.get(cacheKey);
      if (cachedData) {
        console.log(`Cache hit: ${cacheKey}`);
        const parsed = JSON.parse(cachedData);
        return jsonResponse(parsed, 200, request);
      }
      console.log(`Cache miss: ${cacheKey}`);
    }

    // キャッシュなし or force → 生成してキャッシュ
    try {
      const result = await generateAndCache(env, edition);
      return jsonResponse(result, 200, request);
    } catch (error) {
      console.error('Generation error:', error);
      return jsonResponse({
        error: 'Generation failed',
        message: error.message,
      }, 500, request);
    }
  }

  // 404
  return jsonResponse({
    error: 'Not Found',
    endpoints: [
      'GET /api/generate',
      'GET /api/generate?edition=morning',
      'GET /api/generate?edition=evening',
      'GET /api/generate?force=true',
      'GET /health',
    ],
  }, 404, request);
}

export default {
  // HTTP handler
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Internal Server Error', message: error.message }, 500, request);
    }
  },

  // Cron Trigger handler
  async scheduled(event, env, ctx) {
    if (!env.CLAUDE_API_KEY) {
      console.error('Cron: CLAUDE_API_KEY not configured');
      return;
    }

    // UTC 21:00 = JST 06:00 → 朝刊, UTC 08:00 = JST 17:00 → 夕刊
    const hour = new Date(event.scheduledTime).getUTCHours();
    const edition = (hour === 21) ? 'morning' : 'evening';

    console.log(`Cron triggered: generating ${edition} edition (UTC ${hour}:00)`);

    try {
      const result = await generateAndCache(env, edition);
      console.log(`Cron: ${edition} generated and cached (${result.meta.elapsedMs}ms)`);

      // Push通知を送信
      if (env.PUSH_API) {
        try {
          const pushRes = await env.PUSH_API.fetch('https://push-api/api/push/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ edition }),
          });
          const pushResult = await pushRes.json();
          console.log(`Push: sent=${pushResult.sent}, failed=${pushResult.failed}, expired=${pushResult.expired}`);
        } catch (pushError) {
          console.error('Push notification failed:', pushError);
        }
      }
    } catch (error) {
      console.error(`Cron: ${edition} generation failed:`, error);
    }
  },
};
