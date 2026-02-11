/**
 * 生成新聞 - Stripe決済API Worker
 *
 * Endpoints:
 *   POST /api/checkout  → Stripe Checkout Session作成（月額300円サブスク）
 *   GET  /health        → ヘルスチェック
 *
 * Environment:
 *   STRIPE_SECRET_KEY (secret) — Stripe Secret Key
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

  // 404
  return jsonResponse({
    error: 'Not Found',
    endpoints: [
      'POST /api/checkout',
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
