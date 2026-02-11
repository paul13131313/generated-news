import { buildPrompt } from './prompt.js';
import { callClaude, parseGeneratedJson } from './claude.js';
import { FEED_SOURCES } from './feeds.js';
import { fetchAndParseFeed } from './parser.js';

/**
 * 生成新聞 - 紙面生成 Worker
 *
 * Endpoints:
 *   GET /api/generate              → 紙面JSON生成（デフォルト: 時間帯に応じて朝刊/夕刊）
 *   GET /api/generate?edition=morning → 朝刊指定
 *   GET /api/generate?edition=evening → 夕刊指定
 *   GET /health                    → ヘルスチェック
 *
 * Environment:
 *   CLAUDE_API_KEY (secret) — Anthropic API key
 *   UNSPLASH_ACCESS_KEY (secret) — Unsplash API key
 */

const ALLOWED_ORIGINS = [
  'https://paul13131313.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

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

  // 5. Unsplash写真取得（imageKeywordがあれば）
  const imageKeyword = newspaper.headline?.imageKeyword;
  if (imageKeyword && unsplashKey) {
    const photo = await fetchUnsplashImage(unsplashKey, imageKeyword);
    if (photo) {
      newspaper.headline.imageUrl = photo.imageUrl;
      newspaper.headline.imageCredit = photo.imageCredit;
      newspaper.headline.imageCreditLink = photo.imageCreditLink;
      newspaper.headline.unsplashLink = photo.unsplashLink;
    }
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
    }, 200, request);
  }

  // 紙面生成
  if (path === '/api/generate') {
    if (!env.CLAUDE_API_KEY) {
      return jsonResponse({ error: 'CLAUDE_API_KEY not configured' }, 500, request);
    }

    const edition = url.searchParams.get('edition') || detectEdition();
    if (edition !== 'morning' && edition !== 'evening') {
      return jsonResponse({ error: 'Invalid edition. Use "morning" or "evening".' }, 400, request);
    }

    try {
      const startTime = Date.now();
      const result = await generateNewspaper(env.CLAUDE_API_KEY, edition, env.UNSPLASH_ACCESS_KEY);
      const elapsed = Date.now() - startTime;

      return jsonResponse({
        ...result,
        meta: {
          ...result.meta,
          elapsedMs: elapsed,
        },
      }, 200, request);
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
      'GET /health',
    ],
  }, 404, request);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Internal Server Error', message: error.message }, 500, request);
    }
  },
};
