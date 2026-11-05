/* TripQuest Service Worker
 * - App shell（HTML/CSS/JS/data JSON）：install 時預快取，之後 stale-while-revalidate
 * - 導覽請求：network-first，離線時回退 index.html
 * - 維基百科等跨網域請求：不快取、直接 network（失敗就失敗，非關鍵路徑）
 * - 例外：OpenStreetMap 地圖圖磚進獨立的 TILE_CACHE（只存看過的，見 tile()）
 */
const VERSION = 'tripquest-v1.74.11';
const SHELL = `${VERSION}-shell`;
// 內建配樂：獨立快取、跨版本保留（檔名即版本，內容不會變）—— 15MB 不進 SHELL，
// 不預快取、點了才下載；升版不重抓。
const MUSIC_CACHE = 'tq-music-v1';
// 地圖圖磚（OpenStreetMap）：獨立快取、跨版本保留。只存**使用者看過的**（OSM 條款禁止預先下載區域），
// 照回應的快取標頭判新舊（max-age 內直接用；過期有網路就重抓；沒網路最多沿用到 stale-if-error，讀不到就 7 天）。
// 只存 CORS 回應（img 帶 crossorigin；opaque 回應讀不到標頭、配額也會被灌水）。張數有上限，超過丟最舊的。
const TILE_CACHE = 'tq-tiles-v1';
const TILE_HOST = 'tile.openstreetmap.org';
const TILE_MAX = 1500;
const DAY7 = 7 * 24 * 3600;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/router.js',
  './js/store.js',
  './js/merge.js',
  './js/db.js',
  './js/ui.js',
  './js/ids.js',
  './js/identity.js',
  './js/prefs.js',
  './js/boot-theme.js',
  './js/tripday.js',
  './js/daymap.js',
  './js/legs.js',
  './js/tilemap.js',
  './js/realmap.js',
  './js/overmap.js',
  './js/glyphs.js',
  './js/daterange.js',
  './js/ai.js',
  './js/aikeys.js',
  './js/aicontent.js',
  './js/theme.js',
  './js/places.js',
  './js/plancheck.js',
  './js/transit.js',
  './js/quests/compose.js',
  './js/geo.js',
  './js/geocode.js',
  './js/itinexport.js',
  './js/route.js',
  './js/maps.js',
  './js/nearby.js',
  './js/pos.js',
  './js/emergency.js',
  './js/weather.js',
  './js/fx.js',
  './js/expenses.js',
  './js/buylist.js',
  './js/views/buy.js',
  './js/stays.js',
  './js/views/stays.js',
  './js/flights.js',
  './js/views/flights.js',
  './js/badges.js',
  './js/recap.js',
  './js/views/sos.js',
  './js/views/posconsent.js',
  './js/views/nearby.js',
  './js/views/weather.js',
  './js/views/expenses.js',
  './js/views/badges.js',
  './js/views/recap.js',
  './js/views/memories.js',
  './js/views/ai-config.js',
  './js/photos.js',
  './js/viewer.js',
  './js/photoimg.js',
  './js/spottime.js',
  './js/addphoto.js',
  './js/phototag.js',
  './js/exif.js',
  './js/share.js',
  './js/sync.js',
  './js/outbox.js',
  './js/claim.js',
  './js/enrich.js',
  './js/memory.js',
  './js/music.js',
  './js/tracks.js',
  './js/albumshare.js',
  './js/photoexport.js',
  './js/worker-image.js',
  './js/quests/generate.js',
  './js/itinerary.js',
  './js/install.js',
  './js/poster/index.js',
  './js/poster/text.js',
  './js/poster/deco.js',
  './js/poster/presets.js',
  './js/poster/layout.js',
  './js/views/poster.js',
  './js/views/plan.js',
  './js/views/home.js',
  './js/views/create.js',
  './js/views/installguide.js',
  './js/views/findspot.js',
  './js/views/import.js',
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

// SHELL 清單的路徑集合（fetch handler 用：這些檔案只從本版快取拿，不半路換檔）
const SHELL_SET = new Set(SHELL_ASSETS.map((u) => new URL(u, self.location.href).pathname));

self.addEventListener('install', (e) => {
  e.waitUntil(
    // cache:'reload' 一定要加。GitHub Pages 對每個檔案都送 Cache-Control: max-age=600，
    // 普通的 addAll 會走瀏覽器的 HTTP 快取 —— 新版 SW 有可能把「舊的 JS」預存進新快取，
    // 使用者重開之後跑的還是舊程式，於是得再重開一次。這是「要重開兩次」的元凶。
    caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
    // 這裡刻意不自動 skipWaiting：由畫面決定什麼時候換，才不會在使用者操作到一半時
    // 讓新資源混進正在跑的舊程式裡。畫面準備好了會傳 SKIP_WAITING 過來。
  );
});

// 畫面說「可以換了」才接手
self.addEventListener('message', (e) => {
  const d = e.data;
  if (d === 'SKIP_WAITING' || (d && d.type === 'SKIP_WAITING')) self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION) && k !== MUSIC_CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.host === TILE_HOST) { e.respondWith(tile(request)); return; }

  // 跨網域（維基百科圖片等）：直接走網路，不進快取
  if (url.origin !== self.location.origin) return;

  // 導覽：network-first → 回退快取的 index.html
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 內建配樂：cache-first 到獨立快取（不佔 SHELL、不隨版本重抓、離線可用）
  if (url.pathname.includes('/media/music/')) {
    e.respondWith(
      caches.open(MUSIC_CACHE).then(async (c) => {
        const hit = await c.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res && res.ok) c.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // SHELL 檔案：只從「這個版本的快取」拿（cache-first、不背景覆寫）。
  // v1.59.1 前是 stale-while-revalidate——會把網路上的新版檔案寫回正在跑的版本快取，
  // 造成「舊 app.js 還在跑、動態載入卻拿到新 trip.js」：畫面有新按鈕、路由表沒那條路，
  // 一點就被 notFound 踢回首頁（找附近實機踩到的就是這個）。install 時的
  // addAll(cache:'reload') ＋ SKIP_WAITING 流程本來就是為了整組換版，這裡不再半路混檔。
  if (SHELL_SET.has(url.pathname)) {
    e.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
    return;
  }

  // 不在 SHELL 清單的同源檔案（極少數）：照舊 stale-while-revalidate
  // （圖磚的處理在檔尾 tile()）
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

// ---------- 地圖圖磚 ----------
const secOf = (cc, key, dflt) => { const m = new RegExp(key + '=(\\d+)').exec(cc || ''); return m ? Number(m[1]) : dflt; };
async function tile(request) {
  const c = await caches.open(TILE_CACHE);
  const hit = await c.match(request);
  const age = hit ? (Date.now() - Number(hit.headers.get('x-tq-at') || 0)) / 1000 : Infinity;
  const cc = hit ? hit.headers.get('cache-control') : '';
  if (hit && age < secOf(cc, 'max-age', DAY7)) return hit;               // 還新：不打網路
  try {
    const res = await fetch(request);
    if (res && res.ok && (res.type === 'cors' || res.type === 'basic')) {
      const h = new Headers(res.headers);
      h.set('x-tq-at', String(Date.now()));
      const body = await res.clone().blob();
      await c.delete(request);                                          // 重新放：排到最新（丟最舊時用插入順序）
      await c.put(request, new Response(body, { status: res.status, statusText: res.statusText, headers: h }));
      const keys = await c.keys();
      for (const k of keys.slice(0, Math.max(0, keys.length - TILE_MAX))) await c.delete(k);
      return res;
    }
    if (hit && age < secOf(cc, 'max-age', DAY7) + secOf(cc, 'stale-if-error', DAY7)) return hit;
    return res;
  } catch (err) {
    // 沒網路：舊的那張在標頭允許的範圍內（stale-if-error，讀不到 7 天）就拿出來；再舊就當沒有
    if (hit && age < secOf(cc, 'max-age', DAY7) + secOf(cc, 'stale-if-error', DAY7)) return hit;
    return Response.error();
  }
}
