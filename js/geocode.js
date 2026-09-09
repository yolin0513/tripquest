// 幫景點補上座標 —— 路線圖只畫得出「有座標」的地點，文字匯入的行程裡
// 餐廳、民宿、小吃店幾乎都配不到景點資料庫，使用者那趟 19 個地點只有 4 個畫得出來。
//
// 兩條路，依序試：
//  (a) 照片的 GPS：只有在該行程開了「記錄位置」才有（而且匯入時就降到約 110 公尺
//      精度，見 exif.js）。同一景點有多張就取「中位數」座標 —— 平均會被一張
//      在車上拍的離群值拖走，中位數不會。對已經拍完、沒開定位的旅程，這條路無效。
//  (b) 地名查詢（主要解法）：OpenStreetMap 的 Nominatim，免金鑰。App 的天氣與
//      SOS 本來就用它做反向查詢（geo.js），隱私姿態一致：送出去的只有景點名稱。
//      使用規範照做：每秒最多 1 次、結果一定快取（成功永久、失敗七天內不重問）、
//      瀏覽器的 Referer 就是識別來源。查詢帶上地區（「林場肉羹 宜蘭」）提高命中，
//      查不到就維持沒有座標 —— 不亂猜。
//      （也評估過 Photon 與 Overpass：Photon 的公開機是示範性質不宜依賴；
//        Overpass 是資料庫查詢語言、按名稱模糊找店家並不適合。）
//
// 找到的座標寫進 spot 記錄（LWW 可同步）—— 一個人查過，全群組都有，不會重複查。
// 防呆：行程已有座標的話算出中心點，新結果離中心 120 公里以上就當查錯、丟掉
// （「家」這種名字全台灣都有）。

import * as db from './db.js';
import * as store from './store.js';
import { haversine } from './geo.js';

// 測試用：可用 setGeoEndpoint() 或在頁面載入前設 window.__TQ_GEO_ENDPOINT
// （puppeteer 的 evaluateOnNewDocument —— 換頁重載模組後覆寫才不會消失）
let BASE = (typeof window !== 'undefined' && window.__TQ_GEO_ENDPOINT) || 'https://nominatim.openstreetmap.org/search';
export function setGeoEndpoint(u) { BASE = u; }

const NEG_TTL = 7 * 86400000;
const MAX_DIST_M = 120 * 1000;

// ---- 每秒最多一次（Nominatim 使用規範）----
let chain = Promise.resolve();
let lastAt = 0;
function throttled(fn) {
  const p = chain.then(async () => {
    const wait = lastAt + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try { return await fn(); } finally { lastAt = Date.now(); }
  });
  chain = p.catch(() => {});
  return p;
}

// 名稱清理：拿掉括號註記與 emoji，關鍵字灌水的長名只留第一段。
// 清不出東西（例如「家」只有一個字）→ 回 null，這種名字不該拿去查。
export function cleanName(raw) {
  let s = String(raw || '');
  for (let i = 0; i < 3; i++) s = s.replace(/[（(][^（）()]*[）)]/g, '');
  s = s.replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[-—–·・.]+|[-—–·.]+$/g, '').trim();
  if (s.length > 24) s = s.split(/[ 　\-—]/)[0].slice(0, 24);
  return s.length >= 2 ? s : null;
}

// 單一查詢（有快取）。回 {lat,lng,label} 或 null。
export async function geocodeQuery(q) {
  const key = 'geo:v1:' + q;
  const cached = await db.metaGet(key);
  if (cached && (cached.ok || Date.now() - cached.ts < NEG_TTL)) {
    return cached.ok ? { lat: cached.lat, lng: cached.lng, label: cached.label } : null;
  }
  const res = await throttled(async () => {
    const u = `${BASE}?format=jsonv2&limit=1&accept-language=zh-TW&q=${encodeURIComponent(q)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(u, { signal: ctrl.signal });
      if (!r.ok) return undefined;                       // 伺服器出狀況 → 不寫入負面快取
      const arr = await r.json();
      const hit = Array.isArray(arr) && arr[0];
      if (!hit || !hit.lat) return null;
      return { lat: +(+hit.lat).toFixed(5), lng: +(+hit.lon).toFixed(5), label: hit.display_name || '' };
    } catch { return undefined; }
    finally { clearTimeout(timer); }
  });
  if (res === undefined) return null;                    // 網路失敗：下次還能再試
  await db.metaSet(key, res ? { ok: true, ts: Date.now(), ...res } : { ok: false, ts: Date.now() });
  return res;
}

// 關鍵字搜尋 → 候選清單（規劃行程用）。
// 與 geocodeQuery 同一條節流與快取（Nominatim 規範：只能按鈕觸發，不可打字即搜）。
// 回傳最多 limit 筆 {name, fullName, lat, lng, cls, type}，查不到回空陣列。
const TYPE_ZH = {
  restaurant: '餐廳', cafe: '咖啡店', fast_food: '小吃', bar: '酒吧', food_court: '美食街',
  attraction: '景點', viewpoint: '觀景點', museum: '博物館', gallery: '美術館', zoo: '動物園',
  theme_park: '樂園', hotel: '住宿', guest_house: '民宿', hostel: '住宿',
  park: '公園', garden: '花園', beach: '海灘', peak: '山', waterfall: '瀑布',
  temple: '寺廟', shrine: '神社', place_of_worship: '寺廟', castle: '城堡',
  marketplace: '市場', mall: '商場', supermarket: '超市', department_store: '百貨',
  station: '車站', bus_stop: '公車站', aerodrome: '機場',
  city: '城市', town: '城鎮', village: '村里', suburb: '地區', neighbourhood: '地區',
  hamlet: '聚落', island: '島', bay: '海灣', spring: '溫泉',
};
export function geoTypeLabel(cls, type) {
  return TYPE_ZH[type] || TYPE_ZH[cls] || '';
}

// 搜尋（規劃頁「搜尋景點加入」用）。v1.56.2 針對實測的準確度問題：
//   · 「新千歲」只跑出三個大阪的公車站「新千歳」 —— Nominatim 對這類短查詢照名稱相似度排，
//     沒有地區偏好。現在：(1) 有行程座標就帶 viewbox（偏好、不限制）；(2) 交通站點類
//     （bus_stop/stop_position/platform…）在使用者沒說要找車站時降權；(3) 同名且 3km 內去重；
//     (4) 結果太弱（空、或全是被降權的站點）→ 問 zh.wikipedia 這個詞的正式條目名與座標
//     （「新千歲」→「新千歲機場」），用條目名再查一次 Nominatim，並把維基座標本身也列為候選。
//   · 每首候選都帶「離行程約 X 公里」（findspot 已顯示）、國家／行政區、類別，讓人自己選對。
const STOPPY = new Set(['bus_stop', 'stop_position', 'platform', 'stop', 'tram_stop', 'halt', 'bus_station']);
const WIKI_BASE = (typeof window !== 'undefined' && window.__TQ_WIKI_ENDPOINT) || 'https://zh.wikipedia.org';
const TEST_GEO = typeof window !== 'undefined' && !!window.__TQ_GEO_ENDPOINT && !window.__TQ_WIKI_ENDPOINT;

function wantsStop(q) { return /站|公車|巴士|bus|stop|電車|駅/i.test(q); }

function rankHits(hits, q, near) {
  const seen = [];
  const out = [];
  for (const hit of hits) {
    if (seen.some((x) => x.name === hit.name && haversine(x, hit) < 3000)) continue;   // 同名 3km 內視為同一個
    seen.push(hit);
    let score = 0;
    if (STOPPY.has(hit.type) && !wantsStop(q)) score -= 2;
    if (['aeroway', 'railway', 'tourism', 'amenity', 'leisure', 'historic', 'natural', 'shop'].includes(hit.cls)) score += 1;
    if (hit.type === 'aerodrome' || hit.type === 'station') score += 1;
    if (near) { const d = haversine(near, hit); score += d < 30000 ? 2 : d < 200000 ? 1 : 0; }
    out.push({ ...hit, _score: score });
  }
  out.sort((x, y) => y._score - x._score);
  return out;
}

async function nominatimRaw(query, { limit, near }) {
  return throttled(async () => {
    let u = `${BASE}?format=jsonv2&limit=${limit}&accept-language=zh-TW&addressdetails=1&dedupe=1&q=${encodeURIComponent(query)}`;
    if (near) u += `&viewbox=${(near.lng - 1.5).toFixed(3)},${(near.lat + 1.5).toFixed(3)},${(near.lng + 1.5).toFixed(3)},${(near.lat - 1.5).toFixed(3)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(u, { signal: ctrl.signal });
      if (!r.ok) return undefined;
      const arr = await r.json();
      if (!Array.isArray(arr)) return [];
      return arr.map((hit) => {
        const a = hit.address || {};
        const area = [a.country === '臺灣' || a.country === '台灣' ? '' : a.country,
          a.state || a.county || a.city, a.town || a.district || a.suburb]
          .filter(Boolean).join(' ');
        return {
          name: String(hit.display_name || '').split(',')[0].trim() || String(hit.name || query),
          fullName: area,
          lat: +(+hit.lat).toFixed(5), lng: +(+hit.lon).toFixed(5),
          cls: hit.class || '', type: hit.type || '',
        };
      });
    } catch { return undefined; }
    finally { clearTimeout(timer); }
  });
}

// zh.wikipedia：查詢詞 → 正式條目名 + 座標（免金鑰、CORS 開放）。查不到就回 null。
export async function wikiLookup(q, region = '') {
  if (TEST_GEO) return null;                        // 測試的假 Nominatim 環境不打真維基
  const key = 'geo:wiki:' + q;
  const cached = await db.metaGet(key);
  if (cached && Date.now() - cached.ts < 30 * 86400000) return cached.v;
  let v = null;
  try {
    const to = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
    const su = `${WIKI_BASE}/w/api.php?action=opensearch&format=json&origin=*&namespace=0&limit=3&variant=zh-tw&search=${encodeURIComponent(q)}`;
    const r = await fetch(su, { signal: to(8000) });
    const arr = r.ok ? await r.json() : null;
    const titles = Array.isArray(arr) && Array.isArray(arr[1]) ? arr[1] : [];
    // 有地區提示時，優先選含該地區字樣的條目；否則取第一個
    const title = (region && titles.find((t) => t.includes(region))) || titles[0] || null;
    if (title) {
      const r2 = await fetch(`${WIKI_BASE}/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { accept: 'application/json' }, signal: to(8000) });
      const d = r2.ok ? await r2.json() : null;
      const c = d && d.coordinates;
      v = { title: (d && d.title) || title, lat: c ? +(+c.lat).toFixed(5) : null, lng: c ? +(+c.lon).toFixed(5) : null,
        desc: (d && d.description) || '' };
    }
  } catch { v = null; }
  await db.metaSet(key, { ts: Date.now(), v });
  return v;
}

export async function geocodeSearch(q, { limit = 5, region = '', near = null } = {}) {
  const query = [cleanName(q) || String(q).trim(), region].filter(Boolean).join(' ');
  if (!query.trim()) return [];
  const nearKey = near ? `${near.lat.toFixed(0)},${near.lng.toFixed(0)}` : '';   // 行程中心粗到 1 度，中心稍微漂移不重查
  const key = 'geo:s3:' + limit + ':' + query + ':' + nearKey;
  const cached = await db.metaGet(key);
  if (cached && Date.now() - cached.ts < 30 * 86400000) return cached.list || [];
  const raw = await nominatimRaw(query, { limit, near });
  if (raw === undefined) return null;               // 網路失敗（跟「查無結果」分開，UI 要講不同的話）
  let list = rankHits(raw, q, near);
  // 結果太弱（空、或全是被降權的站點）→ 問維基百科這個詞到底是什麼
  const weak = !list.length || list.every((x) => x._score < 0);
  if (weak) {
    const w = await wikiLookup(String(q).trim(), region);
    if (w && w.title) {
      const extra = [];
      if (w.title !== String(q).trim()) {
        const raw2 = await nominatimRaw([w.title, region].filter(Boolean).join(' '), { limit, near });
        if (Array.isArray(raw2)) extra.push(...rankHits(raw2, w.title, near));
      }
      if (w.lat != null) extra.push({ name: w.title, fullName: w.desc || '維基百科', lat: w.lat, lng: w.lng, cls: 'wiki', type: 'wiki', wiki: true, _score: 0.5 });
      // 維基帶來的候選放前面（它們才是使用者要的東西），原本的弱結果留在後面
      const merged = [...extra, ...list];
      const seen = [];
      list = merged.filter((x) => { if (seen.some((y) => y.name === x.name && haversine(y, x) < 3000)) return false; seen.push(x); return true; });
    }
  }
  list = list.map(({ _score, ...x }) => x).slice(0, limit + 2);
  await db.metaSet(key, { ts: Date.now(), list });
  return list;
}

// 一個景點：先照片 GPS（本機、免費、即時），再地名查詢（帶地區 → 不帶）
export function photoCoordsForSpot(spotId) {
  const pts = [];
  for (const q of store.questsOf(spotId)) {
    for (const sub of store.submissionsOf(q.id)) {
      if (sub.gps && Number.isFinite(sub.gps.lat) && Number.isFinite(sub.gps.lng)) pts.push(sub.gps);
    }
  }
  if (!pts.length) return null;
  const med = (arr) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  return { lat: med(pts.map((p) => p.lat)), lng: med(pts.map((p) => p.lng)), n: pts.length };
}

function centroidOf(spots) {
  const has = spots.filter((s) => s.lat != null && s.lng != null);
  if (!has.length) return null;
  return { lat: has.reduce((n, s) => n + s.lat, 0) / has.length, lng: has.reduce((n, s) => n + s.lng, 0) / has.length };
}

// 連鎖店的分店字尾會讓查詢摃龜：「北門綠豆沙牛乳大王-羅東店」查不到，
// 「北門綠豆沙牛乳大王」就查得到。實測宜蘭那趟，光這一類就漏了四家。
export function stripBranch(name) {
  let s = String(name)
    .replace(/[-‐–—]\s*[^\s-]{1,5}(分店|總店|店)$/u, '')
    .replace(/\s+[^\s-]{1,5}(分店|總店|店)$/u, '')
    .trim();
  // 沒有分隔符的「火山爆發雞礁溪總店」這種 —— 只在「總店/分店」這麼明確時才剝
  if (s === String(name)) s = s.replace(/[^\s-]{1,4}(總店|分店)$/u, '').trim();
  return s.length >= 2 && s !== name ? s : null;
}

export async function locateSpot(spot, { region = '', centroid = null } = {}) {
  const pg = photoCoordsForSpot(spot.id);
  if (pg) return { lat: pg.lat, lng: pg.lng, src: 'photo' };
  const name = cleanName(spot.name);
  if (!name) return null;
  const noBranch = stripBranch(name);
  const ladder = [...new Set([
    region ? `${name} ${region}` : null,
    name,
    noBranch && region ? `${noBranch} ${region}` : null,
    noBranch,
  ].filter(Boolean))];
  for (const q of ladder) {
    const r = await geocodeQuery(q);
    if (!r) continue;
    if (centroid && haversine(centroid, r) > MAX_DIST_M) continue;   // 離整趟太遠 → 查到同名的別家，丟掉
    return { lat: r.lat, lng: r.lng, src: 'osm' };
  }
  return null;
}

// 整趟補齊。onProgress({done,total,name,found})
export async function fillTripCoords(tripId, { onProgress = () => {} } = {}) {
  const trip = store.get(tripId);
  const spots = store.spotsOf(tripId);
  const missing = spots.filter((s) => s.lat == null || s.lng == null);
  let found = 0, byPhoto = 0, done = 0;
  for (const m of missing) {
    onProgress({ done, total: missing.length, name: m.name, found });
    const centroid = centroidOf(store.spotsOf(tripId));               // 每找到一個，中心點就更準
    const r = await locateSpot(m, { region: trip.region || '', centroid });
    if (r) {
      await store.patch(m.id, { lat: r.lat, lng: r.lng, geoSrc: r.src });
      found++;
      if (r.src === 'photo') byPhoto++;
    }
    done++;
    onProgress({ done, total: missing.length, name: m.name, found });
  }
  return { tried: missing.length, found, byPhoto, still: missing.length - found };
}

// 「貼上座標或地圖連結」：接受 24.67,121.77、Google 地圖網址（@lat,lng、!3d..!4d..、q=lat,lng）
export function parseCoordInput(text) {
  const s = String(text || '');
  const pats = [
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /[?&]q=(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/,
    /(-?\d{1,2}\.\d{2,})\s*[,，]\s*(-?\d{1,3}\.\d{2,})/,
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (!m) continue;
    const lat = +m[1], lng = +m[2];
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}
