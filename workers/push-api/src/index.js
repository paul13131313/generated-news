// 生成新聞 — Web Push通知 API
// Cloudflare Worker + Web Crypto API による Web Push 実装

const ALLOWED_ORIGINS = [
  'https://paul13131313.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.find(o => origin.startsWith(o));
  return {
    'Access-Control-Allow-Origin': allowed || ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(request ? corsHeaders(request) : {}),
    },
  });
}

// ============================================================
// Web Push 暗号化 — RFC 8291 (Web Crypto API)
// ============================================================

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// HKDF (RFC 5869) using Web Crypto
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = await crypto.subtle.sign('HMAC',
    await crypto.subtle.importKey('raw', salt.byteLength ? salt : new Uint8Array(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    ikm
  );
  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const infoArr = new Uint8Array(info.byteLength + 1);
  infoArr.set(new Uint8Array(info), 0);
  infoArr[info.byteLength] = 1;
  const okm = await crypto.subtle.sign('HMAC', prkKey, infoArr);
  return new Uint8Array(okm).slice(0, length);
}

function concatBuffers(...buffers) {
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    result.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }
  return result;
}

function createInfo(type, clientPublicKey, serverPublicKey) {
  const encoder = new TextEncoder();
  const typeBuffer = encoder.encode(type);
  const header = encoder.encode('Content-Encoding: ');
  const nul = new Uint8Array(1);
  // WebPush info: "WebPush: info\0" + client_public(65) + server_public(65)
  if (type === 'aesgcm') {
    // For aesgcm encoding
    const infoPrefix = encoder.encode('Content-Encoding: aesgcm\0P-256\0');
    const clientLen = new Uint8Array(2);
    clientLen[0] = 0; clientLen[1] = 65;
    const serverLen = new Uint8Array(2);
    serverLen[0] = 0; serverLen[1] = 65;
    return concatBuffers(infoPrefix, clientLen, clientPublicKey, serverLen, serverPublicKey);
  }
  // aes128gcm (RFC 8291)
  const infoStr = encoder.encode(`Content-Encoding: ${type}\0`);
  return infoStr;
}

async function encryptPayload(subscription, payload, vapidKeys) {
  const clientPublicKey = base64UrlDecode(subscription.keys.p256dh);
  const clientAuth = base64UrlDecode(subscription.keys.auth);

  // Generate ephemeral ECDH key pair
  const serverKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const serverPublicKeyRaw = await crypto.subtle.exportKey('raw', serverKeys.publicKey);

  // Import client public key
  const clientKey = await crypto.subtle.importKey(
    'raw', clientPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // ECDH shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey }, serverKeys.privateKey, 256
  );

  const encoder = new TextEncoder();

  // RFC 8291: aes128gcm
  // IKM = HKDF(auth, shared_secret, "WebPush: info\0" || client_public || server_public, 32)
  const authInfo = concatBuffers(
    encoder.encode('WebPush: info\0'),
    clientPublicKey,
    new Uint8Array(serverPublicKeyRaw)
  );
  const ikm = await hkdf(clientAuth, new Uint8Array(sharedSecret), authInfo, 32);

  // Generate 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Content encryption key
  const cekInfo = encoder.encode('Content-Encoding: aes128gcm\0');
  const cek = await hkdf(salt, ikm, cekInfo, 16);

  // Nonce
  const nonceInfo = encoder.encode('Content-Encoding: nonce\0');
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  // Encrypt payload with AES-128-GCM
  const payloadBytes = encoder.encode(typeof payload === 'string' ? payload : JSON.stringify(payload));

  // Add padding delimiter (2 bytes for record size + \x02 delimiter)
  const paddedPayload = concatBuffers(payloadBytes, new Uint8Array([2]));

  const encKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    encKey,
    paddedPayload
  );

  // Build aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65) + encrypted
  const rs = new ArrayBuffer(4);
  new DataView(rs).setUint32(0, 4096);
  const idlen = new Uint8Array([65]);

  const body = concatBuffers(
    salt,
    new Uint8Array(rs),
    idlen,
    new Uint8Array(serverPublicKeyRaw),
    new Uint8Array(encrypted)
  );

  return {
    body,
    serverPublicKey: base64UrlEncode(serverPublicKeyRaw),
    salt: base64UrlEncode(salt),
  };
}

// ============================================================
// VAPID JWT 署名 (ES256)
// ============================================================

async function createVapidAuth(endpoint, vapidPublicKey, vapidPrivateKey) {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12 hours

  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: expiration,
    sub: 'mailto:info@generated-news.com',
  };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import VAPID private key for signing
  const privateKeyBytes = base64UrlDecode(vapidPrivateKey);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: base64UrlEncode(privateKeyBytes),
    x: base64UrlEncode(base64UrlDecode(vapidPublicKey).slice(1, 33)),
    y: base64UrlEncode(base64UrlDecode(vapidPublicKey).slice(33, 65)),
  };

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsignedToken)
  );

  // Convert DER signature to raw r||s format (already raw from Web Crypto)
  const jwt = `${unsignedToken}.${base64UrlEncode(signature)}`;

  return {
    authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
  };
}

// ============================================================
// Push送信
// ============================================================

async function sendPushNotification(subscription, payload, env) {
  try {
    const encrypted = await encryptPayload(subscription, payload, {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    });

    const vapid = await createVapidAuth(
      subscription.endpoint,
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY
    );

    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Content-Length': String(encrypted.body.byteLength),
        'Authorization': vapid.authorization,
        'TTL': '86400',
        'Urgency': 'normal',
      },
      body: encrypted.body,
    });

    if (response.status === 410 || response.status === 404) {
      // Subscription expired or invalid — remove it
      return { success: false, expired: true, status: response.status };
    }

    return { success: response.status >= 200 && response.status < 300, status: response.status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// ハッシュユーティリティ
// ============================================================

async function hashEndpoint(endpoint) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// ============================================================
// ルーター
// ============================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // Health check
    if (path === '/health') {
      return json({
        status: 'ok',
        service: 'push-api',
        timestamp: new Date().toISOString(),
        hasVapidPublicKey: !!env.VAPID_PUBLIC_KEY,
        hasVapidPrivateKey: !!env.VAPID_PRIVATE_KEY,
        hasPushSubsKV: !!env.PUSH_SUBSCRIPTIONS,
      }, 200, request);
    }

    // GET /api/vapid-public-key — VAPID公開鍵を返す
    if (path === '/api/vapid-public-key' && request.method === 'GET') {
      return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, request);
    }

    // POST /api/push/subscribe — Push購読を保存
    if (path === '/api/push/subscribe' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { subscription, email } = body;

        if (!subscription || !subscription.endpoint || !subscription.keys) {
          return json({ error: 'Invalid subscription object' }, 400, request);
        }

        const key = `sub:${await hashEndpoint(subscription.endpoint)}`;
        await env.PUSH_SUBSCRIPTIONS.put(key, JSON.stringify({
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          email: email || 'anonymous',
          subscribedAt: new Date().toISOString(),
        }));

        return json({ success: true }, 200, request);
      } catch (e) {
        return json({ error: e.message }, 500, request);
      }
    }

    // DELETE /api/push/subscribe — Push購読を解除
    if (path === '/api/push/subscribe' && request.method === 'DELETE') {
      try {
        const body = await request.json();
        const { endpoint } = body;

        if (!endpoint) {
          return json({ error: 'endpoint required' }, 400, request);
        }

        const key = `sub:${await hashEndpoint(endpoint)}`;
        await env.PUSH_SUBSCRIPTIONS.delete(key);

        return json({ success: true }, 200, request);
      } catch (e) {
        return json({ error: e.message }, 500, request);
      }
    }

    // POST /api/push/trigger — 全購読者に通知送信
    if (path === '/api/push/trigger' && request.method === 'POST') {
      try {
        let payload;
        try {
          payload = await request.json();
        } catch {
          payload = {};
        }

        const edition = payload.edition || 'morning';
        const editionLabel = edition === 'morning' ? '朝刊' : '夕刊';
        const notificationPayload = JSON.stringify({
          title: `生成新聞 — ${editionLabel}`,
          body: `本日の${editionLabel}が届きました。`,
          icon: 'https://paul13131313.github.io/generated-news/icon-192.png',
          badge: 'https://paul13131313.github.io/generated-news/icon-192.png',
          tag: `newspaper-${edition}`,
          url: 'https://paul13131313.github.io/generated-news/index.html',
        });

        // 全購読を取得して送信
        let sent = 0;
        let failed = 0;
        let expired = 0;
        let cursor = null;

        do {
          const listResult = await env.PUSH_SUBSCRIPTIONS.list({
            prefix: 'sub:',
            cursor,
            limit: 100,
          });

          const sendPromises = listResult.keys.map(async ({ name }) => {
            const subData = await env.PUSH_SUBSCRIPTIONS.get(name, 'json');
            if (!subData) return;

            const result = await sendPushNotification(subData, notificationPayload, env);
            if (result.success) {
              sent++;
            } else if (result.expired) {
              expired++;
              await env.PUSH_SUBSCRIPTIONS.delete(name);
            } else {
              failed++;
            }
          });

          await Promise.all(sendPromises);
          cursor = listResult.list_complete ? null : listResult.cursor;
        } while (cursor);

        return json({ success: true, sent, failed, expired }, 200, request);
      } catch (e) {
        return json({ error: e.message }, 500, request);
      }
    }

    return json({ error: 'Not Found' }, 404, request);
  },
};
