/**
 * 生成新聞 - 認証API Worker
 *
 * Endpoints:
 *   POST /api/signup    → メール+パスワードでユーザー登録
 *   POST /api/login     → ログイン（セッショントークン発行）
 *   POST /api/logout    → ログアウト（セッション削除）
 *   GET  /api/me        → セッションから現在のユーザー情報取得
 *   GET  /health        → ヘルスチェック
 *
 * Environment:
 *   USERS (KV) — ユーザーデータ（key: email, value: { email, passwordHash, ... }）
 *   SESSIONS (KV) — セッション（key: token, value: { email, createdAt }, TTL: 30日）
 */

const ALLOWED_ORIGINS = [
  'https://paul13131313.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const SESSION_TTL = 60 * 60 * 24 * 30; // 30日

function getCorsHeaders(request) {
  const origin = request?.headers?.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}

function jsonResponse(data, status = 200, request = null, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...getCorsHeaders(request),
      ...headers,
    },
  });
}

/**
 * パスワードハッシュ（PBKDF2 + Web Crypto API）
 */
async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * セッショントークン生成（crypto.randomUUID）
 */
function generateToken() {
  return crypto.randomUUID() + '-' + crypto.randomUUID();
}

/**
 * メールバリデーション
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * セッショントークンからユーザー取得
 */
async function getUserFromToken(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return null;

  const sessionData = await env.SESSIONS.get(token);
  if (!sessionData) return null;

  const session = JSON.parse(sessionData);
  const userData = await env.USERS.get(session.email);
  if (!userData) return null;

  const user = JSON.parse(userData);
  return { email: user.email, createdAt: user.createdAt, token };
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
      service: 'auth-api',
      timestamp: new Date().toISOString(),
      hasUsersKV: !!env.USERS,
      hasSessionsKV: !!env.SESSIONS,
    }, 200, request);
  }

  // POST /api/signup — ユーザー登録
  if (path === '/api/signup' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400, request);
    }

    const { email, password } = body;

    if (!email || !password) {
      return jsonResponse({ error: 'メールアドレスとパスワードは必須です' }, 400, request);
    }
    if (!isValidEmail(email)) {
      return jsonResponse({ error: 'メールアドレスの形式が正しくありません' }, 400, request);
    }
    if (password.length < 8) {
      return jsonResponse({ error: 'パスワードは8文字以上にしてください' }, 400, request);
    }

    // 重複チェック
    const existing = await env.USERS.get(email.toLowerCase());
    if (existing) {
      return jsonResponse({ error: 'このメールアドレスは既に登録されています' }, 409, request);
    }

    // パスワードハッシュ
    const salt = crypto.randomUUID();
    const passwordHash = await hashPassword(password, salt);

    // ユーザー保存
    const userData = {
      email: email.toLowerCase(),
      passwordHash,
      salt,
      createdAt: new Date().toISOString(),
    };
    await env.USERS.put(email.toLowerCase(), JSON.stringify(userData));

    // セッション作成
    const token = generateToken();
    await env.SESSIONS.put(token, JSON.stringify({
      email: email.toLowerCase(),
      createdAt: new Date().toISOString(),
    }), { expirationTtl: SESSION_TTL });

    return jsonResponse({
      success: true,
      message: 'アカウントを作成しました',
      user: { email: email.toLowerCase() },
      token,
    }, 201, request);
  }

  // POST /api/login — ログイン
  if (path === '/api/login' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400, request);
    }

    const { email, password } = body;

    if (!email || !password) {
      return jsonResponse({ error: 'メールアドレスとパスワードは必須です' }, 400, request);
    }

    // ユーザー検索
    const userData = await env.USERS.get(email.toLowerCase());
    if (!userData) {
      return jsonResponse({ error: 'メールアドレスまたはパスワードが正しくありません' }, 401, request);
    }

    const user = JSON.parse(userData);
    const passwordHash = await hashPassword(password, user.salt);

    if (passwordHash !== user.passwordHash) {
      return jsonResponse({ error: 'メールアドレスまたはパスワードが正しくありません' }, 401, request);
    }

    // セッション作成
    const token = generateToken();
    await env.SESSIONS.put(token, JSON.stringify({
      email: email.toLowerCase(),
      createdAt: new Date().toISOString(),
    }), { expirationTtl: SESSION_TTL });

    return jsonResponse({
      success: true,
      message: 'ログインしました',
      user: { email: email.toLowerCase() },
      token,
    }, 200, request);
  }

  // POST /api/logout — ログアウト
  if (path === '/api/logout' && request.method === 'POST') {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (token) {
      await env.SESSIONS.delete(token);
    }
    return jsonResponse({ success: true, message: 'ログアウトしました' }, 200, request);
  }

  // GET /api/me — 現在のユーザー情報
  if (path === '/api/me' && request.method === 'GET') {
    const user = await getUserFromToken(request, env);
    if (!user) {
      return jsonResponse({ authenticated: false }, 200, request);
    }
    return jsonResponse({
      authenticated: true,
      user: { email: user.email, createdAt: user.createdAt },
    }, 200, request);
  }

  // 404
  return jsonResponse({
    error: 'Not Found',
    endpoints: [
      'POST /api/signup',
      'POST /api/login',
      'POST /api/logout',
      'GET /api/me',
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
