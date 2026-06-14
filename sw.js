/* しままる Service Worker  ―  オフライン対応 + 毎日リマインド(best-effort) */
const CACHE = 'shimamaru-v1';
const ASSETS = [
  './',
  './index.html',
  './simamaru_memo.html',
  './shimamaru.jpg',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* stale-while-revalidate: まずキャッシュ→裏で更新。オフラインでも開ける */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 外部アプリ等はそのまま
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached || caches.match('./simamaru_memo.html'));
      return cached || net;
    })
  );
});

/* 定刻リマインド（インストール済みPWA / Chrome系のみ。iOSは非対応） */
self.addEventListener('periodicsync', e => {
  if (e.tag === 'shimamaru-daily') {
    e.waitUntil(self.registration.showNotification('しままるから おしらせ', {
      body: 'ジュリリ！きょうの おしごと、いっしょに みてみよ🐦',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'shimamaru-daily'
    }));
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cl => {
      for (const c of cl) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./simamaru_memo.html');
    })
  );
});
