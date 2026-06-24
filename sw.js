/* しままる Service Worker  ―  オフライン対応 + 毎日リマインド(best-effort) */
const CACHE = 'shimamaru-v3';
const ASSETS = [
  './',
  './index.html',
  './simamaru_memo.html',
  './kanji/index.html',
  './shimamaru.jpg',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './favicon-32.png',
  './assets/imagegen/bosses/bat.png',
  './assets/imagegen/bosses/devil.png',
  './assets/imagegen/bosses/dragon.png',
  './assets/imagegen/bosses/dragonking.png',
  './assets/imagegen/bosses/ghost.png',
  './assets/imagegen/bosses/golem.png',
  './assets/imagegen/bosses/maou.png',
  './assets/imagegen/bosses/skeleton.png',
  './assets/imagegen/bosses/slimebird.png',
  './assets/imagegen/bosses/witch.png',
  './assets/imagegen/buildings/bath.png',
  './assets/imagegen/buildings/books.png',
  './assets/imagegen/buildings/castle.png',
  './assets/imagegen/buildings/clock.png',
  './assets/imagegen/buildings/food.png',
  './assets/imagegen/buildings/house.png',
  './assets/imagegen/buildings/hut.png',
  './assets/imagegen/buildings/tent.png',
  './assets/imagegen/characters/ao.png',
  './assets/imagegen/characters/cha.png',
  './assets/imagegen/characters/dodo.png',
  './assets/imagegen/characters/fuku.png',
  './assets/imagegen/characters/haku.png',
  './assets/imagegen/characters/kamo.png',
  './assets/imagegen/characters/koge.png',
  './assets/imagegen/characters/kuja.png',
  './assets/imagegen/characters/maru.png',
  './assets/imagegen/characters/oosi.png',
  './assets/imagegen/characters/pen.png',
  './assets/imagegen/characters/piyo.png',
  './assets/imagegen/characters/ruri.png',
  './assets/imagegen/characters/sora.png',
  './assets/imagegen/characters/stage_adult.png',
  './assets/imagegen/characters/stage_child.png',
  './assets/imagegen/characters/stage_egg.png',
  './assets/imagegen/characters/stage_hatchling.png',
  './assets/imagegen/characters/stage_shimamaru.png',
  './assets/imagegen/characters/stage_teacher.png',
  './assets/imagegen/characters/washi.png',
  './assets/imagegen/items/acorn.png',
  './assets/imagegen/items/balloon.png',
  './assets/imagegen/items/bow.png',
  './assets/imagegen/items/cap.png',
  './assets/imagegen/items/clover.png',
  './assets/imagegen/items/crown.png',
  './assets/imagegen/items/flower.png',
  './assets/imagegen/items/gem.png',
  './assets/imagegen/items/hat.png',
  './assets/imagegen/items/lamp.png',
  './assets/imagegen/items/leaf.png',
  './assets/imagegen/items/mush.png',
  './assets/imagegen/items/plant.png',
  './assets/imagegen/items/rainbow.png',
  './assets/imagegen/items/ribbon.png',
  './assets/imagegen/items/snowflake.png',
  './assets/imagegen/items/star.png',
  './assets/imagegen/items/treasure_chest.png',
  './assets/imagegen/items/tulip.png',
  './assets/imagegen/items/wand.png'
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
  // リアルタイム同期のAPI/SSEはキャッシュせずそのまま通す
  if (url.pathname.indexOf('/api/') !== -1 || url.pathname.endsWith('/events')) return;
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
