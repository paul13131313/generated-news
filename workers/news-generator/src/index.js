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
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
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
 * 紙面を生成
 */
async function generateNewspaper(apiKey, edition) {
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
    return new Response(null, { headers: CORS_HEADERS });
  }

  // Health check
  if (path === '/health') {
    return jsonResponse({
      status: 'ok',
      service: 'news-generator',
      timestamp: new Date().toISOString(),
      hasApiKey: !!env.CLAUDE_API_KEY,
    });
  }

  // 紙面生成
  if (path === '/api/generate') {
    if (!env.CLAUDE_API_KEY) {
      return jsonResponse({ error: 'CLAUDE_API_KEY not configured' }, 500);
    }

    const edition = url.searchParams.get('edition') || detectEdition();
    if (edition !== 'morning' && edition !== 'evening') {
      return jsonResponse({ error: 'Invalid edition. Use "morning" or "evening".' }, 400);
    }

    try {
      const startTime = Date.now();
      const result = await generateNewspaper(env.CLAUDE_API_KEY, edition);
      const elapsed = Date.now() - startTime;

      return jsonResponse({
        ...result,
        meta: {
          ...result.meta,
          elapsedMs: elapsed,
        },
      });
    } catch (error) {
      console.error('Generation error:', error);
      return jsonResponse({
        error: 'Generation failed',
        message: error.message,
      }, 500);
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
  }, 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Internal Server Error', message: error.message }, 500);
    }
  },
};
