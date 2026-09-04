/* TripQuest Service Worker
 * - App shell（HTML/CSS/JS/data JSON）：install 時預快取，之後 stale-while-revalidate
 * - 導覽請求：network-first，離線時回退 index.html
 * - 維基百科等跨網域請求：不快取、直接 network（失敗就失敗，非關鍵路徑）
 */
const VERSION = 'tripquest-v1.23.0';
const SHELL = `${VERSION}-shell`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/router.js',
  './js/store.js',
  './js/db.js',
  './js/ui.js',
  './js/ids.js',
  './js/identity.js',
  './js/prefs.js',
  './js/daterange.js',
  './js/ai.js',
  './js/aikeys.js',
  './js/aicontent.js',
  './js/theme.js',
  './js/quests/compose.js',
  './js/geo.js',
  './js/maps.js',
  './js/nearby.js',
  './js/emergency.js',
  './js/weather.js',
  './js/fx.js',
  './js/expenses.js',
  './js/badges.js',
  './js/recap.js',
  './js/views/sos.js',
  './js/views/weather.js',
  './js/views/expenses.js',
  './js/views/badges.js',
  './js/views/recap.js',
  './js/views/memories.js',
  './js/views/ai-config.js',
  './js/photos.js',
  './js/exif.js',
  './js/share.js',
  './js/sync.js',
  './js/outbox.js',
  './js/claim.js',
  './js/enrich.js',
  './js/memory.js',
  './js/music.js',
  './js/worker-image.js',
  './js/quests/generate.js',
  './js/poster/index.js',
  './js/poster/text.js',
  './js/poster/deco.js',
  './js/poster/presets.js',
  './js/views/poster.js',
  './js/views/plan.js',
  './js/views/home.js',
  './js/views/create.js',
  './js/views/trip.js',
  './js/views/spot.js',
  './js/views/quest.js',
  './js/views/people.js',
  './js/views/album.js',
  './js/views/settings.js',
  './js/views/join.js',
  './data/templates.json',
  './data/themes.json',
  './data/phrases.json',
  './data/emergency.json',
  './data/currencies.json',
  './data/places/index.json',
  './data/places/tw-taipei.json',
  './data/places/tw-newtaipei.json',
  './data/places/tw-taichung.json',
  './data/places/tw-tainan.json',
  './data/places/tw-kaohsiung.json',
  './data/places/tw-hualien.json',
  './data/places/tw-yilan.json',
  './data/places/tw-nantou.json',
  './data/places/tw-chiayi.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // 跨網域（維基百科圖片等）：直接走網路，不進快取
  if (url.origin !== self.location.origin) return;

  // 導覽：network-first → 回退快取的 index.html
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 同源靜態資源：stale-while-revalidate
  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(SHELL).then((c) => c.put(request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
