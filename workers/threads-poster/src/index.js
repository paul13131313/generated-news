/**
 * threads-poster Worker
 *
 * news-generatorからService Bindingで呼ばれ、
 * Threadsに自動投稿を行う。
 *
 * Endpoint:
 *   POST /api/threads/post  — Threads投稿
 *     body: { edition: "morning" | "evening" }
 *
 * Environment:
 *   THREADS_ACCESS_TOKEN (secret) — Threads API長期アクセストークン
 *   THREADS_USER_ID (secret) — ThreadsユーザーID
 *   NEWSPAPER_CACHE (KV) — 新聞キャッシュ（見出し取得用）
 */

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';
const SITE_URL = 'https://seiseishinbun.com';

const ALLOWED_ORIGINS = [
  'https://seiseishinbun.com',
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

// ─── 日付ユーティリティ ───

function getJstDate() {
  const now = new Date();
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  return new Date(jstMs);
}

function getJstDateString() {
  const jst = getJstDate();
  return jst.getUTCFullYear() + '-' +
    String(jst.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(jst.getUTCDate()).padStart(2, '0');
}

function formatDateForPost(date) {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getUTCDay()];
  return `${month}月${day}日（${weekday}）`;
}

// ─── KVから新聞データ取得 ───

async function getNewspaperData(kvCache, edition) {
  const dateStr = getJstDateString();
  const cacheKey = `${edition}-${dateStr}`;
  const cached = await kvCache.get(cacheKey, { type: 'json' });
  return cached;
}

// ─── Threads投稿テキスト構築 ───

function buildThreadsPost(edition, headline, date) {
  const editionLabel = edition === 'morning' ? '朝刊' : '夕刊';
  const dateStr = formatDateForPost(date);

  const title = headline?.title || '';
  const body = headline?.body || '';

  // 500字制限を考慮してbodyを切り詰め
  // 固定部分: ラベル + 日付 + タイトル + URL + ハッシュタグ + 装飾 ≒ 100字
  const fixedLen = `【生成新聞 ${editionLabel}】${dateStr}\n\n${title}\n\n`.length +
    `\n\n▶ 紙面を読む\n${SITE_URL}\n\n#生成新聞 #AIニュース`.length;
  const maxBodyLen = 500 - fixedLen;

  let trimmedBody = '';
  if (maxBodyLen > 20 && body.length > 0) {
    trimmedBody = body.length > maxBodyLen
      ? body.slice(0, maxBodyLen - 1) + '…'
      : body;
  }

  const parts = [
    `【生成新聞 ${editionLabel}】${dateStr}`,
    '',
    title,
  ];

  if (trimmedBody) {
    parts.push('', trimmedBody);
  }

  parts.push(
    '',
    `▶ 紙面を読む`,
    SITE_URL,
    '',
    '#生成新聞 #AIニュース',
  );

  return parts.join('\n');
}

// ─── Threads API投稿（2ステップ） ───

async function postToThreads(text, userId, accessToken) {
  // Step 1: メディアコンテナ作成
  const createUrl = `${THREADS_API_BASE}/${userId}/threads`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'TEXT',
      text: text,
      access_token: accessToken,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Threads container create failed (${createRes.status}): ${err}`);
  }

  const { id: creationId } = await createRes.json();
  console.log(`Threads: container created, id=${creationId}`);

  // Step 2: 公開（APIドキュメント推奨の短い待機時間）
  await new Promise(resolve => setTimeout(resolve, 2000));

  const publishUrl = `${THREADS_API_BASE}/${userId}/threads_publish`;
  const publishRes = await fetch(publishUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: creationId,
      access_token: accessToken,
    }),
  });

  if (!publishRes.ok) {
    const err = await publishRes.text();
    throw new Error(`Threads publish failed (${publishRes.status}): ${err}`);
  }

  const result = await publishRes.json();
  console.log(`Threads: published, id=${result.id}`);
  return result;
}

// ─── メイン投稿処理 ───

async function handlePost(env, edition) {
  // 認証情報チェック
  if (!env.THREADS_ACCESS_TOKEN || !env.THREADS_USER_ID) {
    return { success: false, error: 'Threads credentials not configured' };
  }

  // 重複チェック
  const dateStr = getJstDateString();
  const postedKey = `threads-posted-${edition}-${dateStr}`;
  const alreadyPosted = await env.NEWSPAPER_CACHE.get(postedKey);
  if (alreadyPosted) {
    return { success: true, skipped: true, message: 'Already posted today' };
  }

  // 新聞データ取得
  const newspaper = await getNewspaperData(env.NEWSPAPER_CACHE, edition);
  if (!newspaper?.newspaper?.headline) {
    return { success: false, error: 'No newspaper data found for this edition' };
  }

  // 投稿テキスト構築
  const jstDate = getJstDate();
  const text = buildThreadsPost(edition, newspaper.newspaper.headline, jstDate);
  console.log(`Threads: posting ${text.length} chars for ${edition}`);

  // Threads投稿
  const result = await postToThreads(text, env.THREADS_USER_ID, env.THREADS_ACCESS_TOKEN);

  // 重複防止フラグ保存（12時間TTL）
  await env.NEWSPAPER_CACHE.put(postedKey, JSON.stringify({
    threadId: result.id,
    postedAt: new Date().toISOString(),
  }), { expirationTtl: 12 * 60 * 60 });

  return { success: true, threadId: result.id, textLength: text.length };
}

// ─── Worker エントリーポイント ───

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }

    // ヘルスチェック
    if (url.pathname === '/health') {
      return jsonResponse({
        status: 'ok',
        worker: 'threads-poster',
        hasToken: !!env.THREADS_ACCESS_TOKEN,
        hasUserId: !!env.THREADS_USER_ID,
      }, 200, request);
    }

    // Threads投稿エンドポイント（news-generatorから呼ばれる）
    if (url.pathname === '/api/threads/post' && request.method === 'POST') {
      try {
        const body = await request.json();
        const edition = body.edition || 'morning';

        console.log(`Threads post triggered: ${edition}`);
        const result = await handlePost(env, edition);
        console.log(`Threads result:`, JSON.stringify(result));

        return jsonResponse(result, 200, request);
      } catch (error) {
        console.error('Threads post error:', error);
        return jsonResponse({ success: false, error: error.message }, 500, request);
      }
    }

    return jsonResponse({ error: 'Not Found' }, 404, request);
  },
};
