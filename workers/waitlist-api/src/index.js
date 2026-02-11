/**
 * 生成新聞 - ウェイトリスト登録API Worker
 *
 * Endpoints:
 *   POST /api/waitlist        → メールアドレスを受け取ってKVに保存
 *   GET  /api/waitlist/count  → 登録者数を返す
 *   GET  /health              → ヘルスチェック
 *
 * Environment:
 *   WAITLIST (KV) — ウェイトリスト用KV namespace
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
 * メールアドレスの簡易バリデーション
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  // 基本的な形式チェック
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email) && email.length <= 254;
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
      service: 'waitlist-api',
      timestamp: new Date().toISOString(),
      hasKV: !!env.WAITLIST,
    }, 200, request);
  }

  // POST /api/waitlist — メール登録
  if (path === '/api/waitlist' && request.method === 'POST') {
    if (!env.WAITLIST) {
      return jsonResponse({ error: 'WAITLIST KV not configured' }, 500, request);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, request);
    }

    const email = body.email?.trim()?.toLowerCase();

    // バリデーション
    if (!isValidEmail(email)) {
      return jsonResponse({
        error: 'Invalid email',
        message: '有効なメールアドレスを入力してください。',
      }, 400, request);
    }

    // 重複チェック
    const existing = await env.WAITLIST.get(email);
    if (existing) {
      return jsonResponse({
        error: 'Already registered',
        message: 'すでにご登録いただいています。',
      }, 409, request);
    }

    // KVに保存
    const record = {
      email,
      registeredAt: new Date().toISOString(),
      source: 'lp',
    };
    await env.WAITLIST.put(email, JSON.stringify(record));

    console.log(`Waitlist: registered ${email}`);

    return jsonResponse({
      success: true,
      message: 'ご登録ありがとうございます。正式リリース時にご案内いたします。',
    }, 201, request);
  }

  // GET /api/waitlist/count — 登録者数
  if (path === '/api/waitlist/count' && request.method === 'GET') {
    if (!env.WAITLIST) {
      return jsonResponse({ error: 'WAITLIST KV not configured' }, 500, request);
    }

    // KV list で全キーを数える
    let count = 0;
    let cursor = undefined;
    do {
      const list = await env.WAITLIST.list({ cursor, limit: 1000 });
      count += list.keys.length;
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);

    return jsonResponse({
      count,
      timestamp: new Date().toISOString(),
    }, 200, request);
  }

  // 404
  return jsonResponse({
    error: 'Not Found',
    endpoints: [
      'POST /api/waitlist',
      'GET /api/waitlist/count',
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
