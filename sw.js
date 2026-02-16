const CACHE = 'generated-news-v8';
const ASSETS = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './offline.html',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network First: HTMLは常にネットワークから取得、失敗時はキャッシュ→オフラインページ
// 静的アセット（画像等）はキャッシュ優先
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // HTMLリクエスト → Network First、オフライン時はフォールバック
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() =>
          caches.match(e.request).then(r => r || caches.match('./offline.html'))
        )
    );
    return;
  }

  // 外部APIリクエスト → 常にネットワーク（キャッシュしない）
  if (url.hostname !== self.location.hostname || url.pathname.startsWith('/api/')) {
    return;
  }

  // その他静的アセット → Cache First + ネットワーク更新
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }))
  );
});

// ===== Web Push 通知 =====
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data?.json() || {}; } catch { data = {}; }

  const title = data.title || '生成新聞';
  const options = {
    body: data.body || '新しい紙面が届きました。',
    icon: data.icon || './icon-192.png',
    badge: data.badge || './icon-192.png',
    tag: data.tag || 'newspaper',
    data: { url: data.url || './index.html' },
    renotify: true,
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = e.notification.data?.url || './index.html';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/generated-news/') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
