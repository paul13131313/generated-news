import { FEED_SOURCES, CATEGORY_MAP } from './feeds.js';
import { fetchAndParseFeed } from './parser.js';

/**
 * 生成新聞 - ニュースソース収集 Worker
 *
 * Endpoints:
 *   GET /api/news           → 全ニュース一覧（新しい順）
 *   GET /api/news?category= → カテゴリ別（英語 or 日本語）
 *   GET /api/news?limit=    → 件数制限（デフォルト50）
 *   GET /api/sources        → 登録ソース一覧
 *   GET /api/categories     → カテゴリ一覧
 *   GET /health             → ヘルスチェック
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
      'Cache-Control': 'public, max-age=300',
      ...CORS_HEADERS,
    },
  });
}

/**
 * 全フィードを並列取得して統合
 */
async function collectAllNews(targetCategory = null) {
  let sources = FEED_SOURCES;

  // カテゴリ指定時はそのカテゴリのフィードのみ取得
  if (targetCategory) {
    const normalizedCategory = CATEGORY_MAP[targetCategory] || targetCategory;
    sources = sources.filter((s) => s.category === normalizedCategory);
  }

  // 全フィードを並列フェッチ
  const results = await Promise.allSettled(
    sources.map((source) => fetchAndParseFeed(source))
  );

  // 結果を統合
  const articles = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      articles.push(...result.value);
    }
  }

  // publishedAtで新しい順にソート
  articles.sort((a, b) => {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });

  // 重複除去（同じURLの記事）
  const seen = new Set();
  return articles.filter((article) => {
    if (seen.has(article.url)) return false;
    seen.add(article.url);
    return true;
  });
}

/**
 * ルーティング
 */
async function handleRequest(request) {
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
      service: 'news-collector',
      timestamp: new Date().toISOString(),
      feedCount: FEED_SOURCES.length,
    });
  }

  // ソース一覧
  if (path === '/api/sources') {
    return jsonResponse({
      sources: FEED_SOURCES.map(({ name, url, category }) => ({ name, url, category })),
      total: FEED_SOURCES.length,
    });
  }

  // カテゴリ一覧
  if (path === '/api/categories') {
    const categories = [...new Set(FEED_SOURCES.map((s) => s.category))];
    return jsonResponse({ categories });
  }

  // ニュース取得
  if (path === '/api/news') {
    const category = url.searchParams.get('category');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

    const startTime = Date.now();
    const articles = await collectAllNews(category);
    const elapsed = Date.now() - startTime;

    return jsonResponse({
      articles: articles.slice(0, limit),
      meta: {
        total: articles.length,
        returned: Math.min(articles.length, limit),
        category: category || 'all',
        fetchedAt: new Date().toISOString(),
        elapsedMs: elapsed,
      },
    });
  }

  // 404
  return jsonResponse(
    {
      error: 'Not Found',
      endpoints: [
        'GET /api/news',
        'GET /api/news?category={category}&limit={n}',
        'GET /api/sources',
        'GET /api/categories',
        'GET /health',
      ],
    },
    404
  );
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Internal Server Error', message: error.message }, 500);
    }
  },
};
