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
  // 網路失敗不要寫 30 天負面快取：使用者剛好在維基慢的那一秒查「新千歲」，
  // 之後整整一個月都只看得到大阪的公車站（v1.64 健檢）
  } catch { return null; }
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

// 「貼上座標或地圖連結」。支援（v1.61 擴充）：
//   · 純數字：24.677, 121.767 ／ 24.677 121.767 ／ 全形逗號
//   · Google 完整網址：@lat,lng、!3d..!4d..、?q=lat,lng、ll=、center=
//   · Apple 地圖：maps.apple.com/?ll=25.03,121.56 或 &sll=、&daddr=
//   · geo: URI（Android 分享）：geo:24.677,121.767
//   · 多行文字（App 的「分享」常是「地名\n網址」）—— regex 本來就會全文搜尋
// 短網址（maps.app.goo.gl）本身不含座標，要走 resolveMapLink（需要連線）。
export function parseCoordInput(text) {
  const s = String(text || '');
  const pats = [
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /[?&](?:ll|sll|center|daddr|saddr)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/,
    /[?&]q=(?:loc:)?(-?\d{1,2}\.\d+)\s*(?:,|%2C)\s*(-?\d{1,3}\.\d+)/,
    /\bgeo:(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/i,
    /(-?\d{1,2}\.\d{2,})\s*[,，]\s*(-?\d{1,3}\.\d{2,})/,
    /(-?\d{1,2}\.\d{4,})\s+(-?\d{1,3}\.\d{4,})/,          // 只有空格分隔（要夠多小數位才敢猜）
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (!m) continue;
    const lat = +m[1], lng = +m[2];
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

// 貼進來的文字裡有沒有 Google 地圖短網址？
const SHORT_RE = /https?:\/\/(?:maps\.app\.goo\.gl\/[A-Za-z0-9]+|(?:www\.)?goo\.gl\/maps\/[A-Za-z0-9]+)[^\s]*/;
export function findShortMapLink(text) {
  const m = String(text || '').match(SHORT_RE);
  return m ? m[0] : null;
}

// 短網址 → { lat, lng } 或 { query }（需要連線；瀏覽器不能直接跟隨轉址，走自家 Worker）
export async function resolveMapLink(shortUrl, { timeoutMs = 12000 } = {}) {
  const base = (typeof window !== 'undefined' && window.__TQ_RESOLVE_ENDPOINT)
    || 'https://tripquest.yolin0513.workers.dev/resolve';
  const res = await fetch(`${base}?u=${encodeURIComponent(shortUrl)}`, {
    signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!res.ok) { const e = new Error('resolve ' + res.status); e.status = res.status; throw e; }
  return res.json();
}

// Google 給的地名常是「郵遞區號＋整串地址＋店名」黏在一起，例如
//「270宜蘭縣蘇澳鎮新城里蘇新路81號諾貝爾奶凍 國道五號蘇澳服務區 - 蘇澳店」。
// 整串丟去查一定摃龜，所以拆成候選——**順序照「像不像地標名」排，不是照長度**。
// 實測踩過的兩個坑：
//   · 先試「地址＋店名」那串會模糊命中三公里外的飯店（比查不到還糟）
//   · 「蘇澳服務區」在 OSM 的名字沒有「國道五號」前綴 → 要生出去掉前綴的變體
//   · 太短又太通用的段（「蘇澳店」）會命中中國的地名 → 一律排到最後
const PLACE_SUFFIX = /(服務區|休息站|轉運站|交流道|夜市|老街|車站|機場|漁港|園區|商圈|公園|步道|瀑布|溫泉|農場|牧場|博物館|美術館|紀念館|文化館|體育館|大學|醫院|市場|大橋|燈塔|海灘|沙灘|水庫|神社|寺|廟|宮|城|館|山|湖|潭|谷|港)$/;
// 地址判定：門牌（阿拉伯數字＋號）或「…縣/市…」開頭的行政區串。
// 注意不能只看單一個「區」字——「服務區」「園區」都會被誤判成地址（實測踩過）。
const ADDRESSY = /\d+\s*號|[縣市][^\s]{2,}[鄉鎮市區村里]/;

// 從貼上的原文抽出行政區（宜蘭縣、蘇澳鎮…）。用來替搜尋結果評分：
// 同一家連鎖店在別的鄉鎮也有分店（實測「諾貝爾奶凍」先查到 22 公里外的礁溪店），
// 靠原文裡的鄉鎮名才分得出哪一筆才是使用者釘的那個點。
export function adminTokens(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/[^\s\d]{1,3}[縣市鄉鎮區]/g)) {
    const t = m[0];
    if (t.length >= 2 && !out.includes(t)) out.push(t);
  }
  return out;
}

export function placeCandidates(q) {
  const raw = String(q || '').trim();
  if (!raw) return [];
  const landmark = [], addressy = [], weak = [];
  const add = (arr, x) => {
    const v = String(x || '').replace(/\s+/g, ' ').trim();
    if (v.length >= 2 && !arr.includes(v)) arr.push(v);
  };

  const noZip = raw.replace(/^\d{3,6}\s*/, '');
  // 門牌之後黏著的通常就是店名／地標名
  const m = noZip.match(/^(.*?[路街道段巷弄]\s*\d+\s*號)(.+)$/);
  const tail = m ? m[2] : '';
  const segs = [...(tail ? tail.split(/\s+-\s+|\s+/) : []), ...noZip.split(/\s+-\s+|\s+/)]
    .map((x) => x.trim()).filter((x) => x.length >= 2);

  for (const seg of segs) {
    const isPlace = PLACE_SUFFIX.test(seg);                   // 地名字尾優先於地址判定
    if (!isPlace && ADDRESSY.test(seg)) { add(addressy, seg); continue; }
    // 太短又沒有地名字尾的（「蘇澳店」）容易命中八竿子打不著的地方，排最後。
    // 但中文/日文的三字地名很常見（清水寺、龍山寺、九份老街），有地名字尾就不算短。
    if (!isPlace && seg.length <= 3) { add(weak, seg); continue; }
    add(landmark, seg);
    const noBranch = stripBranch(seg);
    if (noBranch) add(landmark, noBranch);
    // 「國道五號蘇澳服務區」→「蘇澳服務區」、「…16號礁溪溫泉公園」→「礁溪溫泉公園」：
    // OSM 上的名字常常沒有那些前綴。長的變體先試（比較specific），
    // 而開頭是「號」或數字的一定是切壞的碎片，直接丟掉。
    const sm = seg.match(PLACE_SUFFIX);
    if (sm) {
      const suffix = sm[1];
      const head = seg.slice(0, seg.length - suffix.length);
      for (const n of [4, 3, 2]) {
        if (head.length <= n) continue;
        const cand = head.slice(-n) + suffix;
        if (/^[號段巷弄0-9０-９一二三四五六七八九十]/.test(cand)) continue;
        add(landmark, cand);
      }
    }
  }
  // 地標名 → 門牌後的整串 → 地址 → 原文 → 太通用的短詞
  const out = [...landmark];
  const push = (x) => { const v = String(x || '').replace(/\s+/g, ' ').trim(); if (v.length >= 2 && !out.includes(v)) out.push(v); };
  if (tail) push(tail);
  for (const x of addressy) push(x);
  push(noZip);
  for (const x of weak) push(x);
  return out.slice(0, 8);
}

