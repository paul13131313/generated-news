/**
 * email-notifier Worker
 *
 * news-generatorからService Bindingで呼ばれ、
 * 購読者にメール配信を行う。
 *
 * Endpoint:
 *   POST /api/email/send  — メール一括配信
 *     body: { edition: "morning" | "evening" }
 *
 * Environment:
 *   RESEND_API_KEY (secret) — Resend APIキー
 *   SUBSCRIBERS (KV) — 購読者データ
 *   NEWSPAPER_CACHE (KV) — 新聞キャッシュ（見出し取得用）
 */

const RESEND_API = 'https://api.resend.com/emails';
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

// ─── 日付フォーマット ───

function getJstDate() {
  const now = new Date();
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  return new Date(jstMs);
}

function formatJapaneseDate(date) {
  const year = date.getUTCFullYear();
  const reiwaYear = year - 2018;
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getUTCDay()];
  return `令和${kansuji(reiwaYear)}年${kansuji(month)}月${kansuji(day)}日（${weekday}曜日）`;
}

function kansuji(num) {
  const chars = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (num < 10) return chars[num];
  if (num < 20) return '十' + (num === 10 ? '' : chars[num - 10]);
  if (num < 100) {
    const tens = Math.floor(num / 10);
    const ones = num % 10;
    return chars[tens] + '十' + (ones === 0 ? '' : chars[ones]);
  }
  return String(num);
}

// ─── KVから購読者一覧取得 ───

async function getActiveSubscribers(kvSubscribers) {
  const subscribers = [];
  let cursor = null;

  // KVのlist APIで全キーを取得
  do {
    const listResult = await kvSubscribers.list({ cursor, limit: 1000 });

    for (const key of listResult.keys) {
      // システムキーはスキップ
      if (key.name === 'INVITE_CODES') continue;

      const data = await kvSubscribers.get(key.name, { type: 'json' });
      if (!data) continue;

      // active または invite（期限内）のみ
      if (data.status === 'active' || data.status === 'invite') {
        // invite の場合、期限切れチェック
        if (data.status === 'invite' && data.expiresAt) {
          if (new Date(data.expiresAt) < new Date()) continue;
        }

        // email_notify が明示的に false の場合はスキップ
        if (data.email_notify === false) continue;

        subscribers.push({
          email: data.email || key.name,
          status: data.status,
        });
      }
    }

    cursor = listResult.list_complete ? null : listResult.cursor;
  } while (cursor);

  return subscribers;
}

// ─── KVから新聞データ取得 ───

async function getNewspaperData(kvCache, edition) {
  const jst = getJstDate();
  const dateStr = jst.getUTCFullYear() + '-' +
    String(jst.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(jst.getUTCDate()).padStart(2, '0');

  const cacheKey = `${edition}-${dateStr}`;
  const cached = await kvCache.get(cacheKey, { type: 'json' });
  return cached;
}

// ─── メールHTML生成 ───

function buildEmailHtml(edition, date, headline) {
  const editionLabel = edition === 'morning' ? '朝刊' : '夕刊';
  const dateStr = formatJapaneseDate(date);

  const headlineTitle = headline?.title || '';
  const headlineBody = headline?.body || '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>生成新聞 ${editionLabel}</title>
</head>
<body style="margin:0; padding:0; background-color:#f5f0eb; font-family:'Hiragino Mincho ProN','Yu Mincho','MS PMincho',serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f0eb;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%;">

          <!-- マストヘッド -->
          <tr>
            <td style="border-bottom:2px solid #1a1a1a; padding-bottom:16px; text-align:center;">
              <div style="font-size:28px; font-weight:700; letter-spacing:0.4em; color:#1a1a1a; margin-right:-0.4em;">生 成 新 聞</div>
              <div style="font-size:11px; color:#666; margin-top:6px; letter-spacing:0.1em;">${dateStr}　${editionLabel}</div>
            </td>
          </tr>

          <!-- 一面見出し -->
          <tr>
            <td style="padding:28px 0 24px;">
              <div style="font-size:20px; font-weight:700; color:#1a1a1a; line-height:1.6; letter-spacing:0.05em;">${headlineTitle}</div>
              <div style="font-size:13px; color:#444; line-height:1.8; margin-top:12px; letter-spacing:0.02em;">${headlineBody.slice(0, 120)}${headlineBody.length > 120 ? '…' : ''}</div>
            </td>
          </tr>

          <!-- 紙面を読むボタン -->
          <tr>
            <td align="center" style="padding:8px 0 32px;">
              <a href="${SITE_URL}" target="_blank"
                style="display:inline-block; padding:12px 40px; background-color:#1a1a1a; color:#f5f0eb; font-size:13px; letter-spacing:0.15em; text-decoration:none; border:1px solid #1a1a1a;">
                紙面を読む
              </a>
            </td>
          </tr>

          <!-- フッター -->
          <tr>
            <td style="border-top:1px solid #ccc; padding-top:20px; text-align:center;">
              <div style="font-size:11px; color:#999; line-height:1.8;">
                <span style="letter-spacing:0.2em;">生成新聞</span><br>
                あなたの関心から、生まれる新聞。<br>
                <a href="${SITE_URL}#cancel" style="color:#999; text-decoration:underline;">購読を解約する</a>
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildEmailText(edition, date, headline) {
  const editionLabel = edition === 'morning' ? '朝刊' : '夕刊';
  const dateStr = formatJapaneseDate(date);
  const headlineTitle = headline?.title || '';
  const headlineBody = headline?.body || '';

  return `生成新聞 ${editionLabel}
${dateStr}

━━━━━━━━━━━━━━━━━━━━━━

${headlineTitle}

${headlineBody.slice(0, 200)}

━━━━━━━━━━━━━━━━━━━━━━

▶ 紙面を読む
${SITE_URL}

---
生成新聞 — あなたの関心から、生まれる新聞。
購読を解約する: ${SITE_URL}#cancel`;
}

// ─── Resend APIでメール送信 ───

async function sendEmail(apiKey, to, subject, html, text) {
  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: '生成新聞 <noreply@seiseishinbun.com>',
      to: [to],
      subject: subject,
      html: html,
      text: text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error (${response.status}): ${error}`);
  }

  return await response.json();
}

// ─── メイン配信処理 ───

async function sendEditionEmails(env, edition) {
  if (!env.RESEND_API_KEY) {
    return { error: 'RESEND_API_KEY not configured', sent: 0, failed: 0 };
  }

  // 購読者一覧取得
  const subscribers = await getActiveSubscribers(env.SUBSCRIBERS);
  if (subscribers.length === 0) {
    return { sent: 0, failed: 0, skipped: 0, message: 'No active subscribers' };
  }

  // 新聞データ取得（一面見出し用）
  const newspaper = await getNewspaperData(env.NEWSPAPER_CACHE, edition);
  const headline = newspaper?.newspaper?.headline || null;

  // 日付・件名
  const jst = getJstDate();
  const editionLabel = edition === 'morning' ? '朝刊' : '夕刊';
  const dateStr = formatJapaneseDate(jst);
  const subject = `生成新聞 ${editionLabel} — ${dateStr}`;

  // メールHTML/テキスト生成
  const html = buildEmailHtml(edition, jst, headline);
  const text = buildEmailText(edition, jst, headline);

  // 一括送信
  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const sub of subscribers) {
    try {
      const result = await sendEmail(env.RESEND_API_KEY, sub.email, subject, html, text);
      sent++;
      console.log(`Email sent: ${sub.email}, id: ${result?.id}`);
    } catch (error) {
      failed++;
      errors.push({ email: sub.email, error: error.message });
      console.error(`Email failed: ${sub.email}`, error.message);
    }
  }

  return { sent, failed, total: subscribers.length, errors: errors.slice(0, 5) };
}

// ─── お知らせメールHTML生成 ───

function buildAnnounceHtml(subject, body) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[生成新聞] ${subject}</title>
</head>
<body style="margin:0; padding:0; background-color:#f5f0eb; font-family:'Hiragino Mincho ProN','Yu Mincho','MS PMincho',serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f0eb;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%;">
          <tr>
            <td style="border-bottom:2px solid #1a1a1a; padding-bottom:16px; text-align:center;">
              <div style="font-size:28px; font-weight:700; letter-spacing:0.4em; color:#1a1a1a; margin-right:-0.4em;">生 成 新 聞</div>
              <div style="font-size:11px; color:#666; margin-top:6px; letter-spacing:0.1em;">お知らせ</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 0 24px;">
              <div style="font-size:18px; font-weight:700; color:#1a1a1a; line-height:1.6;">${subject}</div>
              <div style="font-size:13px; color:#444; line-height:1.8; margin-top:16px; white-space:pre-line;">${body}</div>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #ccc; padding-top:20px; text-align:center;">
              <div style="font-size:11px; color:#999; line-height:1.8;">
                <span style="letter-spacing:0.2em;">生成新聞</span><br>
                あなたの関心から、生まれる新聞。<br>
                <a href="${SITE_URL}#cancel" style="color:#999; text-decoration:underline;">購読を解約する</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildAnnounceText(subject, body) {
  return `[生成新聞] お知らせ

${subject}

${body}

---
生成新聞 — あなたの関心から、生まれる新聞。
購読を解約する: ${SITE_URL}#cancel`;
}

// ─── お知らせメール一括送信 ───

async function sendAnnounceEmails(env, toList, subject, body) {
  if (!env.RESEND_API_KEY) {
    return { error: 'RESEND_API_KEY not configured', sentCount: 0 };
  }

  const html = buildAnnounceHtml(subject, body);
  const text = buildAnnounceText(subject, body);

  let sentCount = 0;
  let failed = 0;

  for (const email of toList) {
    try {
      await sendEmail(env.RESEND_API_KEY, email, `[生成新聞] ${subject}`, html, text);
      sentCount++;
    } catch (error) {
      failed++;
      console.error(`Announce email failed: ${email}`, error.message);
    }
  }

  return { sentCount, failed, total: toList.length };
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
        worker: 'email-notifier',
        hasResendKey: !!env.RESEND_API_KEY,
      }, 200, request);
    }

    // メール配信エンドポイント（news-generatorから呼ばれる）
    if (url.pathname === '/api/email/send' && request.method === 'POST') {
      try {
        const body = await request.json();
        const edition = body.edition || 'morning';

        console.log(`Email send triggered: ${edition}`);
        const result = await sendEditionEmails(env, edition);
        console.log(`Email result: sent=${result.sent}, failed=${result.failed}`);

        return jsonResponse(result, 200, request);
      } catch (error) {
        console.error('Email send error:', error);
        return jsonResponse({ error: error.message }, 500, request);
      }
    }

    // お知らせメール配信エンドポイント（admin.jsから呼ばれる）
    if (url.pathname === '/send' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { to, subject, body: text } = body;

        if (!to || !subject || !text) {
          return jsonResponse({ error: 'to, subject, body are required' }, 400, request);
        }

        const toList = Array.isArray(to) ? to : [to];
        console.log(`Announce email triggered: "${subject}" to ${toList.length} recipients`);
        const result = await sendAnnounceEmails(env, toList, subject, text);
        console.log(`Announce result: sent=${result.sentCount}, failed=${result.failed}`);

        return jsonResponse(result, 200, request);
      } catch (error) {
        console.error('Announce email error:', error);
        return jsonResponse({ error: error.message }, 500, request);
      }
    }

    return jsonResponse({ error: 'Not Found' }, 404, request);
  },
};
