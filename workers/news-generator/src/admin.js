// src/admin.js — 管理画面用APIルートハンドラー

function getJstDateString() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function detectEdition() {
  const h = new Date(Date.now() + 9 * 60 * 60 * 1000).getHours();
  return (h >= 6 && h < 17) ? 'morning' : 'evening';
}

// ===== JWT (WebCrypto HMAC-SHA256) =====

async function createToken(secret) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    admin: true,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400, // 24h
  }));
  const data = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}

async function verifyToken(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key,
      Uint8Array.from(atob(s), c => c.charCodeAt(0)),
      new TextEncoder().encode(`${h}.${p}`)
    );
    if (!valid) return null;
    const decoded = JSON.parse(atob(p));
    return (decoded.exp && Date.now() / 1000 > decoded.exp) ? null : decoded;
  } catch {
    return null;
  }
}

export async function requireAdmin(request, env) {
  if (!env.JWT_SECRET) return false;
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  return !!(await verifyToken(auth.slice(7), env.JWT_SECRET));
}

// ===== POST /api/admin/auth =====

export async function handleAdminAuth(request, env) {
  if (!env.ADMIN_PASSWORD || !env.JWT_SECRET) {
    return { error: 'Admin not configured', _status: 500 };
  }
  const body = await request.json().catch(() => ({}));
  if (body.password !== env.ADMIN_PASSWORD) {
    return { error: 'Unauthorized', _status: 401 };
  }
  const token = await createToken(env.JWT_SECRET);
  return { token, expiresIn: 86400 };
}

// ===== GET /api/admin/stats =====

export async function handleAdminStats(env) {
  const today = getJstDateString();
  const [morningRaw, eveningRaw] = await Promise.all([
    env.NEWSPAPER_CACHE.get(`morning-${today}`),
    env.NEWSPAPER_CACHE.get(`evening-${today}`),
  ]);

  const parseMeta = (raw) => {
    if (!raw) return { status: 'pending' };
    try {
      const m = JSON.parse(raw).meta;
      return { status: 'delivered', generatedAt: m?.generatedAt };
    } catch {
      return { status: 'delivered' };
    }
  };

  const samplesRaw = await env.NEWSPAPER_CACHE.get('admin:samples:index');
  const sampleCount = samplesRaw ? JSON.parse(samplesRaw).length : 0;

  return {
    delivery: {
      morning: parseMeta(morningRaw),
      evening: parseMeta(eveningRaw),
    },
    subscribers: { total: 0, trial: 0 }, // TODO: 購読者システム実装後に更新
    samples: sampleCount,
    currentEdition: detectEdition(),
    today,
  };
}

// ===== POST /api/admin/sample/issue =====

export async function handleSampleIssue(request, env) {
  const body = await request.json().catch(() => ({}));
  const edition = body.edition || detectEdition();
  const today = getJstDateString();

  const cached = await env.NEWSPAPER_CACHE.get(`${edition}-${today}`);
  if (!cached) {
    return {
      error: `${edition === 'morning' ? '朝刊' : '夕刊'}がまだ生成されていません。先に生成してください。`,
      _status: 404,
    };
  }

  const data = JSON.parse(cached);
  const suffix = Math.random().toString(36).slice(2, 6);
  const id = `${today.replace(/-/g, '')}-${suffix}`;

  const sample = {
    id,
    date: today,
    edition,
    newspaper: data.newspaper,
    issuedAt: new Date().toISOString(),
    views: 0,
  };

  await env.NEWSPAPER_CACHE.put(
    `admin:sample:${id}`,
    JSON.stringify(sample),
    { expirationTtl: 90 * 24 * 3600 } // 90日間保持
  );

  // インデックス更新（最大100件）
  const rawIndex = await env.NEWSPAPER_CACHE.get('admin:samples:index');
  const index = rawIndex ? JSON.parse(rawIndex) : [];
  index.unshift({ id, date: today, edition, issuedAt: sample.issuedAt, views: 0 });
  await env.NEWSPAPER_CACHE.put('admin:samples:index', JSON.stringify(index.slice(0, 100)));

  return {
    id,
    url: `https://paul13131313.github.io/generated-news/?sample=${id}`,
    edition,
    date: today,
  };
}

// ===== GET /api/admin/sample/list =====

export async function handleSampleList(env) {
  const rawIndex = await env.NEWSPAPER_CACHE.get('admin:samples:index');
  const samples = rawIndex ? JSON.parse(rawIndex) : [];
  return { samples };
}

// ===== GET /api/sample/{id} (公開エンドポイント・認証不要) =====

export async function handleSampleGet(id, env) {
  const raw = await env.NEWSPAPER_CACHE.get(`admin:sample:${id}`);
  if (!raw) return { error: '見本紙が見つかりません', _status: 404 };

  const sample = JSON.parse(raw);

  // 閲覧数を非同期でインクリメント（レスポンスを遅延させない）
  const updated = { ...sample, views: (sample.views || 0) + 1 };
  env.NEWSPAPER_CACHE.put(
    `admin:sample:${id}`,
    JSON.stringify(updated),
    { expirationTtl: 90 * 24 * 3600 }
  );

  return {
    newspaper: sample.newspaper,
    meta: {
      edition: sample.edition,
      date: sample.date,
      issuedAt: sample.issuedAt,
      isSample: true,
    },
  };
}
