/**
 * 生成新聞 - Stripe決済API Worker
 *
 * Endpoints:
 *   POST /api/checkout  → Stripe Checkout Session作成（月額300円サブスク）
 *   POST /api/webhook   → Stripe Webhook（支払い完了検知・購読者KV保存）
 *   GET  /api/subscriber/:email → 購読ステータス確認
 *   GET  /health        → ヘルスチェック
 *
 * Environment:
 *   STRIPE_SECRET_KEY (secret) — Stripe Secret Key
 *   STRIPE_WEBHOOK_SECRET (secret) — Stripe Webhook Signing Secret
 *   SUBSCRIBERS (KV) — 購読者データストア
 */

const ALLOWED_ORIGINS = [
  'https://paul13131313.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const SUCCESS_URL = 'https://paul13131313.github.io/generated-news/index.html?subscribed=true';
const CANCEL_URL = 'https://paul13131313.github.io/generated-news/lp.html';

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
 * Stripe APIを直接fetchで呼び出し
 */
async function createCheckoutSession(stripeSecretKey) {
  const params = new URLSearchParams();
  params.append('mode', 'subscription');
  params.append('line_items[0][price_data][currency]', 'jpy');
  params.append('line_items[0][price_data][product_data][name]', '生成新聞');
  params.append('line_items[0][price_data][product_data][description]', 'AIがあなただけの朝刊・夕刊を毎日届けます');
  params.append('line_items[0][price_data][unit_amount]', '300');
  params.append('line_items[0][price_data][recurring][interval]', 'month');
  params.append('line_items[0][quantity]', '1');
  params.append('success_url', SUCCESS_URL);
  params.append('cancel_url', CANCEL_URL);

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || `Stripe API error: ${response.status}`);
  }

  return data;
}

/**
 * Stripe Webhook署名検証
 * Web Crypto APIを使用（Cloudflare Workers互換）
 */
async function verifyStripeSignature(payload, sigHeader, webhookSecret) {
  const parts = sigHeader.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
  const signature = parts.find(p => p.startsWith('v1='))?.split('=')[1];

  if (!timestamp || !signature) {
    throw new Error('Invalid Stripe signature header');
  }

  // タイムスタンプ検証（5分以上古い場合は拒否）
  const now = Math.floor(Date.now() / 1000);
  if (now - parseInt(timestamp) > 300) {
    throw new Error('Webhook timestamp too old');
  }

  // HMAC-SHA256署名検証
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expectedSig = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (expectedSig !== signature) {
    throw new Error('Invalid webhook signature');
  }

  return JSON.parse(payload);
}

/**
 * Stripe Checkout Session詳細取得（顧客メール取得用）
 */
async function retrieveCheckoutSession(sessionId, stripeSecretKey) {
  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=customer`,
    {
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
      },
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Stripe API error: ${response.status}`);
  }
  return data;
}

/**
 * Webhook イベント処理
 */
async function handleWebhookEvent(event, env) {
  const type = event.type;
  console.log(`Webhook event: ${type}`);

  switch (type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      // Checkout Sessionから詳細取得
      const fullSession = await retrieveCheckoutSession(session.id, env.STRIPE_SECRET_KEY);
      const email = fullSession.customer_details?.email || fullSession.customer?.email || '';
      const customerId = fullSession.customer?.id || fullSession.customer || '';
      const subscriptionId = fullSession.subscription || '';

      if (email) {
        await env.SUBSCRIBERS.put(email, JSON.stringify({
          email,
          customerId,
          subscriptionId,
          status: 'active',
          plan: '生成新聞 月額300円',
          subscribedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
        console.log(`New subscriber: ${email}`);
      } else {
        console.warn('checkout.session.completed: no email found', session.id);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      // customerId から既存の購読者を検索
      const subscribers = await env.SUBSCRIBERS.list();
      for (const key of subscribers.keys) {
        const data = JSON.parse(await env.SUBSCRIBERS.get(key.name));
        if (data.customerId === customerId) {
          data.status = subscription.status; // active, past_due, canceled, etc.
          data.updatedAt = new Date().toISOString();
          await env.SUBSCRIBERS.put(key.name, JSON.stringify(data));
          console.log(`Subscription updated: ${key.name} → ${subscription.status}`);
          break;
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const subscribers = await env.SUBSCRIBERS.list();
      for (const key of subscribers.keys) {
        const data = JSON.parse(await env.SUBSCRIBERS.get(key.name));
        if (data.customerId === customerId) {
          data.status = 'canceled';
          data.updatedAt = new Date().toISOString();
          await env.SUBSCRIBERS.put(key.name, JSON.stringify(data));
          console.log(`Subscription canceled: ${key.name}`);
          break;
        }
      }
      break;
    }

    default:
      console.log(`Unhandled event type: ${type}`);
  }
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
      service: 'payment-api',
      timestamp: new Date().toISOString(),
      hasStripeKey: !!env.STRIPE_SECRET_KEY,
      hasWebhookSecret: !!env.STRIPE_WEBHOOK_SECRET,
      hasSubscribersKV: !!env.SUBSCRIBERS,
    }, 200, request);
  }

  // POST /api/checkout → Stripe Checkout Session作成
  if (path === '/api/checkout' && request.method === 'POST') {
    if (!env.STRIPE_SECRET_KEY) {
      return jsonResponse({ error: 'STRIPE_SECRET_KEY not configured' }, 500, request);
    }

    try {
      const session = await createCheckoutSession(env.STRIPE_SECRET_KEY);
      return jsonResponse({ url: session.url }, 200, request);
    } catch (error) {
      console.error('Checkout error:', error);
      return jsonResponse({
        error: 'Checkout session creation failed',
        message: error.message,
      }, 500, request);
    }
  }

  // POST /api/webhook → Stripe Webhook
  if (path === '/api/webhook' && request.method === 'POST') {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      console.error('STRIPE_WEBHOOK_SECRET not configured');
      return new Response('Webhook secret not configured', { status: 500 });
    }

    const sigHeader = request.headers.get('stripe-signature');
    if (!sigHeader) {
      return new Response('Missing stripe-signature header', { status: 400 });
    }

    const payload = await request.text();

    try {
      const event = await verifyStripeSignature(payload, sigHeader, env.STRIPE_WEBHOOK_SECRET);
      await handleWebhookEvent(event, env);
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Webhook error:', error);
      return new Response(`Webhook error: ${error.message}`, { status: 400 });
    }
  }

  // GET /api/subscriber/:email → 購読ステータス確認
  if (path.startsWith('/api/subscriber/') && request.method === 'GET') {
    const email = decodeURIComponent(path.replace('/api/subscriber/', ''));
    if (!email || !email.includes('@')) {
      return jsonResponse({ error: 'Invalid email' }, 400, request);
    }

    const data = await env.SUBSCRIBERS.get(email);
    if (!data) {
      return jsonResponse({ subscribed: false }, 200, request);
    }

    const subscriber = JSON.parse(data);
    return jsonResponse({
      subscribed: subscriber.status === 'active',
      status: subscriber.status,
      subscribedAt: subscriber.subscribedAt,
    }, 200, request);
  }

  // 404
  return jsonResponse({
    error: 'Not Found',
    endpoints: [
      'POST /api/checkout',
      'POST /api/webhook',
      'GET /api/subscriber/:email',
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
