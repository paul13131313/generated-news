const CACHE = 'generated-news-v2';
const ASSETS = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
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

// Network First: HTMLは常にネットワークから取得、失敗時のみキャッシュ
// 静的アセット（画像等）はキャッシュ優先
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // HTMLリクエスト → Network First
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // APIリクエスト → 常にネットワーク（キャッシュしない）
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // その他静的アセット → Cache First
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
