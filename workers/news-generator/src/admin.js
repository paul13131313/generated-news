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

  // 購読者数集計（SUBSCRIBERS KV が利用可能な場合）
  let subscriberStats = { total: 0, trial: 0 };
  if (env.SUBSCRIBERS) {
    try {
      const subs = await getSubscriberList(env);
      const active = subs.filter(s => s.status === 'active').length;
      const trial = subs.filter(s => s.status === 'invite').length;
      subscriberStats = { total: active + trial, trial };
    } catch {
      // バインディングが未設定などの場合は0のまま
    }
  }

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
    subscribers: subscriberStats,
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

// ===== Phase 2: 購読者管理ヘルパー =====

async function getSubscriberList(env) {
  const subscribers = [];
  let cursor;

  do {
    const listResult = cursor
      ? await env.SUBSCRIBERS.list({ cursor })
      : await env.SUBSCRIBERS.list();

    for (const key of listResult.keys) {
      if (key.name === 'INVITE_CODES') continue;
      if (key.name.startsWith('invite:')) continue;

      const data = await env.SUBSCRIBERS.get(key.name, { type: 'json' });
      if (!data) continue;

      let status = data.status;
      if (status === 'invite' && data.expiresAt && new Date(data.expiresAt) < new Date()) {
        status = 'invite_expired';
      }

      subscribers.push({
        email: data.email || key.name,
        status,
        plan: data.plan || null,
        subscribedAt: data.subscribedAt || null,
        inviteCode: data.inviteCode || null,
        email_notify: data.email_notify !== false,
      });
    }

    cursor = listResult.list_complete ? null : listResult.cursor;
  } while (cursor);

  return subscribers;
}

// ===== GET /api/admin/subscribers =====

export async function handleSubscriberList(env) {
  if (!env.SUBSCRIBERS) return { error: 'SUBSCRIBERS KV not configured', _status: 500 };
  const subscribers = await getSubscriberList(env);
  return { subscribers, total: subscribers.length };
}

// ===== GET /api/admin/subscribers/export (CSV) =====

export async function handleSubscriberExport(env) {
  if (!env.SUBSCRIBERS) return { error: 'SUBSCRIBERS KV not configured', _status: 500 };
  const subscribers = await getSubscriberList(env);
  const header = 'email,status,plan,subscribedAt,inviteCode,email_notify';
  const rows = subscribers.map(s =>
    [s.email, s.status, s.plan || '', s.subscribedAt || '', s.inviteCode || '', s.email_notify]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  );
  return { _csv: `${header}\n${rows.join('\n')}` };
}

// ===== GET /api/admin/invites =====

export async function handleInviteList(env) {
  if (!env.SUBSCRIBERS) return { error: 'SUBSCRIBERS KV not configured', _status: 500 };

  const invites = [];
  const listResult = await env.SUBSCRIBERS.list({ prefix: 'invite:' });

  for (const key of listResult.keys) {
    const code = key.name.slice('invite:'.length);
    const data = await env.SUBSCRIBERS.get(key.name, { type: 'json' });
    if (!data) continue;
    invites.push({ code, ...data });
  }

  // invite: キーが1件もない場合は INVITE_CODES 配列からレガシーデータを読む
  if (invites.length === 0) {
    const codesRaw = await env.SUBSCRIBERS.get('INVITE_CODES');
    if (codesRaw) {
      const codes = JSON.parse(codesRaw);
      for (const code of codes) {
        invites.push({ code, maxUses: null, usedCount: null, expiresAt: null, active: true, createdAt: null });
      }
    }
  }

  invites.sort((a, b) => {
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return { invites };
}

// ===== POST /api/admin/invites =====

export async function handleInviteCreate(request, env) {
  if (!env.SUBSCRIBERS) return { error: 'SUBSCRIBERS KV not configured', _status: 500 };

  const body = await request.json().catch(() => ({}));

  const code = body.code
    ? body.code.toUpperCase().replace(/[^A-Z0-9]/g, '')
    : Math.random().toString(36).slice(2, 10).toUpperCase();

  if (!code || code.length < 4) {
    return { error: 'コードは4文字以上で入力してください', _status: 400 };
  }

  const existing = await env.SUBSCRIBERS.get(`invite:${code}`);
  if (existing) return { error: `コード "${code}" は既に存在します`, _status: 409 };

  const invite = {
    maxUses: body.maxUses ? parseInt(body.maxUses) : null,
    usedCount: 0,
    expiresAt: body.expiresAt || null,
    active: true,
    createdAt: new Date().toISOString(),
  };

  await env.SUBSCRIBERS.put(`invite:${code}`, JSON.stringify(invite));

  // INVITE_CODES 配列にも追加（payment-api との後方互換）
  const codesRaw = await env.SUBSCRIBERS.get('INVITE_CODES');
  const codes = codesRaw ? JSON.parse(codesRaw) : [];
  if (!codes.includes(code)) {
    codes.push(code);
    await env.SUBSCRIBERS.put('INVITE_CODES', JSON.stringify(codes));
  }

  return { code, ...invite };
}

// ===== PATCH /api/admin/invites/{code} =====

export async function handleInviteDeactivate(code, env) {
  if (!env.SUBSCRIBERS) return { error: 'SUBSCRIBERS KV not configured', _status: 500 };

  const key = `invite:${code}`;
  const raw = await env.SUBSCRIBERS.get(key);
  if (!raw) return { error: `コード "${code}" が見つかりません`, _status: 404 };

  const invite = JSON.parse(raw);
  invite.active = false;
  await env.SUBSCRIBERS.put(key, JSON.stringify(invite));

  // INVITE_CODES 配列からも除去
  const codesRaw = await env.SUBSCRIBERS.get('INVITE_CODES');
  if (codesRaw) {
    const codes = JSON.parse(codesRaw).filter(c => c !== code);
    await env.SUBSCRIBERS.put('INVITE_CODES', JSON.stringify(codes));
  }

  return { code, active: false };
}

// ===== GET /api/admin/delivery-logs =====

export async function handleDeliveryLogs(env, days = 30) {
  const logs = [];
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);

  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    const raw = await env.NEWSPAPER_CACHE.get(`admin:delivery-log:${dateStr}`);
    if (raw) {
      logs.push({ date: dateStr, ...JSON.parse(raw) });
    }
  }

  return { logs };
}

// ===== 配信ログ書き込み（scheduledハンドラーから呼ぶ） =====

export async function writeDeliveryLog(env, edition, logData) {
  if (!env.NEWSPAPER_CACHE) return;
  const dateStr = getJstDateString();
  const key = `admin:delivery-log:${dateStr}`;
  const existing = JSON.parse(await env.NEWSPAPER_CACHE.get(key) || '{}');
  existing[edition] = { ...logData, loggedAt: new Date().toISOString() };
  await env.NEWSPAPER_CACHE.put(key, JSON.stringify(existing), {
    expirationTtl: 30 * 24 * 3600,
  });
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
