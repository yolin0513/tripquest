// 大眾運輸時間（v1.68）—— Google Routes API `computeRoutes`，使用者自帶金鑰。
//
// 為什麼不用 `computeRouteMatrix`（一次拿整張 N×N）：
//  · TRANSIT 模式的矩陣**上限 100 個元素**（一般模式是 625），10 個景點就滿了。
//  · 更根本的理由：**大眾運輸的答案取決於幾點出發**。矩陣只能帶一個出發時間，
//    但第 5 站的出發時間要等前面 4 站都算完才知道 —— 用同一個時間算整張矩陣，
//    後面幾段全是錯的。所以只能一段一段序列查，把上一段的到達時間接下去。
//  · 代價是「按一下才算」（19 個景點＝18 次呼叫，約 5–6 秒），不像開車估算那樣
//    背景自動跑。介面要講明白這是要按的。
//
// 免金鑰時這支完全不會被呼叫，開車估算（route.js 的 OSRM）維持原狀。
//
// 花費：Routes API 的免費額度是每月數千次起跳，這家人一年 4–6 趟約 500 次，
// 用不到單月額度的一成。但還是記次數並設上限 —— 迴圈寫錯一次就可能燒掉額度。

import * as db from './db.js';

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

// 只要必要的欄位。FieldMask 直接決定計費等級，不要順手多要
//（評分、人氣、路線圖形都不要）。
const FIELDS = [
  'routes.duration',
  'routes.legs.steps.travelMode',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.transitDetails.stopDetails.arrivalStop.name',
  'routes.legs.steps.transitDetails.stopDetails.departureStop.name',
  'routes.legs.steps.transitDetails.stopDetails.departureTime',
  'routes.legs.steps.transitDetails.stopDetails.arrivalTime',
  'routes.legs.steps.transitDetails.transitLine.nameShort',
  'routes.legs.steps.transitDetails.transitLine.name',
  'routes.legs.steps.transitDetails.transitLine.vehicle.type',
].join(',');

// ---- 時區 ----
// startMin 是「當地牆上時鐘」的分鐘數，沒有帶時區；但 Routes API 的 departureTime
// 一定要絕對時間。差一小時，查到的班次就是錯的。
// 用旅程的國家（建立行程時選的，TW/JP/KR）為主、座標框為輔，都對不上才退回本機時區
// —— 退回本機時區時要標 guessed，介面要說「時間可能差幾小時」，不能默默給錯答案。
const BY_COUNTRY = { TW: 8, JP: 9, KR: 9, HK: 8, MO: 8, CN: 8, SG: 8, MY: 8, TH: 7, VN: 7, PH: 8 };
const BOXES = [
  { o: 8, lat: [21.8, 25.4], lng: [119.9, 122.1] },      // 台灣本島
  { o: 8, lat: [23.0, 24.7], lng: [118.0, 119.8] },      // 澎湖/金門/馬祖一帶
  { o: 9, lat: [24.0, 46.0], lng: [122.5, 146.5] },      // 日本
  { o: 9, lat: [33.0, 39.0], lng: [124.5, 131.0] },      // 韓國
  { o: 8, lat: [22.1, 22.6], lng: [113.8, 114.5] },      // 香港/澳門
  { o: 7, lat: [5.5, 20.5], lng: [97.3, 105.7] },        // 泰國一帶
];
const inBox = (b, lat, lng) => lat >= b.lat[0] && lat <= b.lat[1] && lng >= b.lng[0] && lng <= b.lng[1];

export function tzOffsetFor(lat, lng, country) {
  const c = BY_COUNTRY[String(country || '').toUpperCase()];
  if (Number.isFinite(c)) return { offset: c, guessed: false };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    for (const b of BOXES) if (inBox(b, lat, lng)) return { offset: b.o, guessed: false };
  }
  return { offset: -new Date().getTimezoneOffset() / 60, guessed: true };   // 本機時區
}

const pad = (n) => String(n).padStart(2, '0');

// date：'2026-10-01'；min：當地牆上時鐘分鐘數（可 ≥1440＝隔天）→ RFC3339
export function rfc3339(date, min, offsetHours) {
  const [y, mo, d] = String(date || '').split('-').map(Number);
  if (!y || !mo || !d) return null;
  const base = Date.UTC(y, mo - 1, d);
  const day = Math.floor(min / 1440);
  const t = new Date(base + day * 86400000);
  const hh = Math.floor((min % 1440) / 60), mm = min % 60;
  const sign = offsetHours < 0 ? '-' : '+';
  const ao = Math.abs(offsetHours);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
    + `T${pad(hh)}:${pad(mm)}:00${sign}${pad(Math.floor(ao))}:${pad(Math.round((ao % 1) * 60))}`;
}

// ---- 快取 ----
// key 用「起訖座標＋星期幾＋出發的半小時區間」：同一段路在同一個星期幾的同一個
// 時段，班次表是一樣的。TTL 24 小時 —— 班表會改，而且這也讓「同一天反覆開頁」
// 不會重複燒額度。
function cacheKey(a, b, iso, mode) {
  const d = new Date(iso);
  const slot = d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0);
  return `transit:v1:${mode}:${a.lat.toFixed(4)},${a.lng.toFixed(4)};${b.lat.toFixed(4)},${b.lng.toFixed(4)}`
    + `:${d.getDay()}:${slot}`;
}

const secOf = (s) => (typeof s === 'string' ? parseInt(s, 10) || 0 : 0);
const hhmm = (iso, offsetHours) => {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(+t)) return '';
  const local = new Date(t.getTime() + offsetHours * 3600000);
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
};

// 回 { ok, sec, transfers, walkSec, lines:[{name,from,to,depart,arrive}] }
// 或 { ok:false, reason }
function parseRoute(j, offsetHours) {
  const r = (j && j.routes && j.routes[0]) || null;
  if (!r) return { ok: false, reason: 'none' };
  const steps = (r.legs || []).flatMap((l) => l.steps || []);
  const lines = [];
  let walkSec = 0;
  for (const st of steps) {
    if (st.travelMode === 'WALK') { walkSec += secOf(st.staticDuration); continue; }
    const td = st.transitDetails;
    if (!td) continue;
    const tl = td.transitLine || {};
    const sd = td.stopDetails || {};
    lines.push({
      name: tl.nameShort || tl.name || '',
      vehicle: (tl.vehicle && tl.vehicle.type) || '',
      from: (sd.departureStop && sd.departureStop.name) || '',
      to: (sd.arrivalStop && sd.arrivalStop.name) || '',
      depart: hhmm(sd.departureTime, offsetHours),
      arrive: hhmm(sd.arrivalTime, offsetHours),
    });
  }
  const sec = secOf(r.duration);
  if (!sec) return { ok: false, reason: 'none' };
  return { ok: true, sec, walkSec, transfers: Math.max(0, lines.length - 1), lines };
}

// 一段：a → b，departAt = RFC3339。key 是使用者自帶的 Google 金鑰。
export async function transitLeg(a, b, departAt, key, { signal } = {}) {
  const ep = (typeof window !== 'undefined' && window.__TQ_ROUTES_ENDPOINT) || ENDPOINT;
  const offsetHours = departAt ? (parseInt(departAt.slice(-6, -3), 10) || 0) : 0;
  const ck = cacheKey(a, b, departAt, 'transit');
  const cached = await db.metaGet(ck).catch(() => null);
  if (cached && Date.now() - cached.ts < 86400000) return { ...cached.v, cached: true };

  let res;
  try {
    res = await fetch(ep, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
        destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
        travelMode: 'TRANSIT',
        departureTime: departAt,
        computeAlternativeRoutes: false,
        languageCode: 'zh-TW',
        units: 'METRIC',
      }),
    });
  } catch { return { ok: false, reason: 'network' }; }
  if (res.status === 400) return { ok: false, reason: 'badtime' };     // 多半是出發時間在過去
  if (res.status === 403) return { ok: false, reason: 'key' };
  if (res.status === 429) return { ok: false, reason: 'quota' };
  if (!res.ok) return { ok: false, reason: 'http' + res.status };
  let j;
  try { j = await res.json(); } catch { return { ok: false, reason: 'parse' }; }
  const out = parseRoute(j, offsetHours);
  if (out.ok) await db.metaSet(ck, { ts: Date.now(), v: out }).catch(() => {});
  return out;
}

export const VEHICLE_EMOJI = {
  BUS: '🚌', RAIL: '🚆', METRO_RAIL: '🚇', SUBWAY: '🚇', HEAVY_RAIL: '🚆',
  COMMUTER_TRAIN: '🚆', HIGH_SPEED_TRAIN: '🚄', LONG_DISTANCE_TRAIN: '🚆',
  TRAM: '🚊', MONORAIL: '🚝', FERRY: '⛴️', CABLE_CAR: '🚡', GONDOLA_LIFT: '🚡',
};

// 貼金鑰時的實測。花掉一次呼叫，但這是唯一能確定「Routes API 真的開了、
// 而且參照網址限制沒有把我們擋掉」的方法 —— 光看字串長得像 AIza 沒有意義。
// 用台北車站 → 台北 101（捷運一定有班次）當測試段，時間取下一個週一早上 9 點。
export async function testMapsKey(key) {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const at = rfc3339(date, 9 * 60, 8);
  const r = await transitLeg({ lat: 25.0478, lng: 121.5170 }, { lat: 25.0338, lng: 121.5645 }, at, key);
  if (r.ok) return { ok: true, message: '可以用了（測試查到一班車）' };
  if (r.reason === 'key') return { ok: false, message: '金鑰被拒 —— 請確認已啟用 Routes API，且參照網址限制允許這個網站' };
  if (r.reason === 'quota') return { ok: false, message: 'Google 說太頻繁了，等一下再試' };
  if (r.reason === 'network') return { ok: false, message: '連不上 Google（可能沒有網路）' };
  if (r.reason === 'badtime') return { ok: false, message: '金鑰或請求被拒（400）—— 請確認已啟用 Routes API' };
  return { ok: true, message: '金鑰可以用（這段測試路線剛好查不到班次，不影響）' };
}
