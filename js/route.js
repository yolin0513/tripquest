// 移動時間與順序建議（規劃行程・第 2 批，依三代理投票決議）：
//
// · 移動時間主來源：FOSSGIS 的 OSRM `/table`（routing.openstreetmap.de —— OSM 官網
//   導航背後的公共服務；條款：1 req/s、要標示出處）。**一天一個矩陣請求**就拿到
//   整份 N×N 秒數，之後拖拉重排全部從快取算，網路用量趨近於零。
// · 降級（離線、429、伺服器掛）：直線距離 × 經驗係數 —— 開車依距離分段給速度
//   （市區慢、長途快）、步行 4.5km/h × 繞路係數。回傳都帶 src，UI 一律標「約」，
//   estimate 來源要標得更明白。
// · 誠實的限制：OSRM 只有開車/步行，**沒有大眾運輸**。日本市區靠電車，開車時間
//   只能當粗略參考 —— 這句話要出現在 UI，不能假裝這是唯一真相。
// · 順序建議：最近鄰 + 2-opt（一天 ≤15 個點，毫秒級）。📌 釘住的點位置不動，
//   只重排它們之間的自由段。**建議永遠是預覽，使用者按「套用」才寫入。**

import * as db from './db.js';
import { haversine } from './geo.js';

let OSRM = (typeof window !== 'undefined' && window.__TQ_OSRM_ENDPOINT) || 'https://routing.openstreetmap.de';


export const MODES = {
  drive: { key: 'drive', label: '🚗 開車', profile: 'routed-car/table/v1/driving' },
  walk: { key: 'walk', label: '🚶 步行', profile: 'routed-foot/table/v1/foot' },
};

// ---- 節流：跟 Nominatim 同一套（1 req/s） ----
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

// ---- 係數法（永遠可用的底） ----
export function estimateSec(a, b, mode = 'drive') {
  const m = haversine(a, b);
  if (mode === 'walk') return Math.round((m * 1.3) / (4.5 * 1000 / 3600));
  // 開車：直線 ×1.4 當路程；市區 25、近郊 45、長途 70 km/h
  const road = m * 1.4;
  const kmh = m < 3000 ? 25 : (m < 30000 ? 45 : 70);
  return Math.round(road / (kmh * 1000 / 3600));
}

// 同一組點不管當下排成什麼順序，都應該吃同一份矩陣 —— 所以先照座標字串排序
// 出「正規順序」去要矩陣（快取 key 也用它），拿回來再映射回呼叫端的順序。
// 不做這件事的話，「套用排序建議」本身就會觸發一次新的 /table 請求（實測抓到的）。
function canonical(pts) {
  const keyed = pts.map((p, i) => ({ i, k: `${p.lat.toFixed(4)},${p.lng.toFixed(4)}` }));
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return { order: keyed.map((x) => x.i), key: keyed.map((x) => x.k).join(';') };
}

// N 個點 → N×N 秒數矩陣。回 { sec, src: 'osrm' | 'est' }。
// 快取 30 天（座標取 4 位小數當 key）；OSRM 失敗一律降級係數法，不讓規劃卡住。
const _mem = new Map();
export async function travelMatrix(pts, mode = 'drive') {
  const est = () => ({
    src: 'est',
    sec: pts.map((a) => pts.map((b) => (a === b ? 0 : estimateSec(a, b, mode)))),
  });
  if (pts.length < 2) return est();
  if (pts.some((p) => p.lat == null || p.lng == null)) return est();   // 呼叫端應先濾掉
  const canon = canonical(pts);
  const key = 'osrm:v1:' + mode + ':' + canon.key;
  // canonSec（正規順序的矩陣）→ 映射回呼叫端順序
  const remap = (canonSec) => {
    const pos = [];                                        // 呼叫端 index → 正規 index
    canon.order.forEach((origIdx, ci) => { pos[origIdx] = ci; });
    return { sec: pts.map((_, i) => pts.map((_, j) => canonSec[pos[i]][pos[j]])) };
  };
  if (_mem.has(key)) { const v = _mem.get(key); return { src: v.src, ...remap(v.canonSec) }; }
  const cached = await db.metaGet(key);
  if (cached && Date.now() - cached.ts < 30 * 86400000) {
    const v = { src: 'osrm', canonSec: cached.sec };
    _mem.set(key, v);
    return { src: 'osrm', ...remap(v.canonSec) };
  }
  const canonPts = canon.order.map((i) => pts[i]);
  const got = await throttled(async () => {
    const coords = canonPts.map((p) => `${p.lng},${p.lat}`).join(';');
    const u = `${OSRM}/${MODES[mode]?.profile || MODES.drive.profile}/${coords}?annotations=duration`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(u, { signal: ctrl.signal });
      if (!r.ok) return null;
      const j = await r.json();
      if (j.code !== 'Ok' || !Array.isArray(j.durations)) return null;
      return j.durations.map((row) => row.map((x) => (x == null ? null : Math.round(x))));
    } catch { return null; }
    finally { clearTimeout(timer); }
  });
  if (!got) return est();                                  // 失敗不進快取，下次還能再試 OSRM
  // OSRM 偶爾回 null 格（snap 不到路）：那幾格補係數
  const canonSec = got.map((row, i) => row.map((x, j) => (x == null ? estimateSec(canonPts[i], canonPts[j], mode) : x)));
  await db.metaSet(key, { ts: Date.now(), sec: canonSec });
  _mem.set(key, { src: 'osrm', canonSec });
  return { src: 'osrm', ...remap(canonSec) };
}

// ---- 跨區移動 ----
// 北海道到京都給「開車 19 小時」只會誤導 —— 實際是搭飛機或新幹線。
// 直線超過 LONGHAUL_KM、或路網時間超過 LONGHAUL_SEC 的段落視為「跨區」：
// 不顯示開車時間、不往下推算時刻、排順序的總移動也不把它算進去。
export const LONGHAUL_KM = 150;
export const LONGHAUL_SEC = 4 * 3600;

// 粗略的「島」分類（純經緯度框，不引入相依）：只拿來把提示寫準一點
// （跨海 → 開車到不了）。分不出來就回 null，用一般文案，不影響判斷本身。
function islandOf(p) {
  const { lat, lng } = p;
  if (lat == null || lng == null) return null;
  if (lng >= 122.5) {                                      // 日本一帶
    if (lng >= 126.5 && lng <= 129.5 && lat <= 28) return 'jp-okinawa';
    if (lat >= 41.4) return 'jp-hokkaido';                 // 津輕海峽以北
    if (lat >= 30) return 'jp-main';                       // 本州/四國/九州（橋隧相連）
    return null;
  }
  if (lng >= 119.9 && lng <= 122.1 && lat >= 21.8 && lat <= 25.4) return 'tw-main';
  if (lng >= 119.3 && lng <= 119.75 && lat >= 23.1 && lat <= 23.8) return 'tw-penghu';
  if (lng >= 118.1 && lng <= 118.6 && lat >= 24.3 && lat <= 24.65) return 'tw-kinmen';
  if (lng >= 119.85 && lng <= 120.1 && lat >= 25.9 && lat <= 26.4) return 'tw-matsu';
  return null;
}

// 回 null（一般段落）或 { km, crossSea }
export function longHaul(a, b, travelSec = null) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const km = haversine(a, b) / 1000;
  if (km < LONGHAUL_KM && !(travelSec != null && travelSec > LONGHAUL_SEC)) return null;
  const ia = islandOf(a), ib = islandOf(b);
  return { km: Math.round(km), crossSea: !!(ia && ib && ia !== ib) };
}

// ---- 時刻鏈 ----
// 一天的景點依 order 排好丟進來，回傳每個景點的推算到達/離開與兩點之間的移動秒數。
// 規則：
// · 有填「幾點到」的視為固定 —— 推算若晚於它，標 late（⚠ 可能趕不上）；到達採用固定值。
// · 沒填的顯示「約 HH:MM」（斜體語意由 UI 決定）。
// · 停留沒填的用 60 分推下去，並標 assumed。
export function chainTimes(spots, matrix, mode = 'drive') {
  const out = [];
  let cur = null;                       // 目前時刻（分鐘）
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    const fixed = Number.isFinite(s.startMin);
    let travel = null, far = null;
    if (i > 0) {
      const a = spots[i - 1], b = s;
      if (a.lat != null && b.lat != null) {
        travel = matrix ? matrix.sec[i - 1][i] : estimateSec(a, b, mode);
        far = longHaul(a, b, travel);
        if (far) travel = null;      // 跨區：開車數字沒有參考價值，不顯示、也不拿來推下一站
      }
    }
    let arrive = null, late = 0;
    if (i === 0) arrive = fixed ? s.startMin : null;
    else if (cur != null && travel != null) arrive = cur + Math.round(travel / 60);
    if (fixed) {
      if (arrive != null && arrive > s.startMin) late = arrive - s.startMin;
      arrive = s.startMin;
    }
    const stay = Number.isFinite(s.stayMin) ? s.stayMin : (arrive != null ? 60 : null);
    const leave = arrive != null && stay != null ? arrive + stay : null;
    out.push({ id: s.id, arrive, leave, fixed, late, travel, longHaul: far,
      stayAssumed: arrive != null && !Number.isFinite(s.stayMin) });
    cur = leave != null ? leave : cur;
  }
  return out;
}

// 推算時刻可能跨日（例：23:30 到、停 90 分 → 離開是隔天 01:00）。
// 「27:12」不是時間 —— 超過 24:00 一律換算成隔天並明確標示。
export function fmtMin(min) {
  if (min == null) return '';
  const d = Math.floor(min / 1440);
  const hm = `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  return d <= 0 ? hm : (d === 1 ? `隔天 ${hm}` : `${d} 天後 ${hm}`);
}
// 「到–離開」區間：兩端在同一天（含同為隔天）時，天的標示只寫一次
export function fmtRange(a, b) {
  if (a == null) return '';
  if (b == null) return fmtMin(a);
  const da = Math.floor(a / 1440), db = Math.floor(b / 1440);
  if (da === db && da > 0) return `${fmtMin(a)}–${fmtMin(b).replace(/^.+ /, '')}`;
  return `${fmtMin(a)}–${fmtMin(b)}`;
}
export function fmtDur(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${Math.max(1, m)} 分`;
  return `${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ''}`;
}

// ---- 順序建議：📌 是錨（位置不動），錨之間的自由段做最近鄰 + 2-opt ----
function totalTravelSec(orderIdx, sec) {
  let t = 0;
  for (let i = 1; i < orderIdx.length; i++) t += sec[orderIdx[i - 1]][orderIdx[i]] || 0;
  return t;
}

export function suggestOrder(spots, matrix) {
  const n = spots.length;
  const idx = spots.map((_, i) => i);
  if (n < 3) return { order: idx, before: 0, after: 0, changed: false };
  const sec = matrix.sec;
  const anchored = new Set(idx.filter((i) => spots[i].pinned));
  const before = totalTravelSec(idx, sec);

  // 自由段 = 兩個錨（或頭尾）之間的區間，段內先最近鄰再 2-opt
  const order = [...idx];
  const segs = [];
  let segStart = 0;
  for (let i = 0; i <= n; i++) {
    if (i === n || anchored.has(order[i])) {
      if (i - segStart > 1) segs.push([segStart, i - 1]);   // 至少兩個自由點才值得排
      segStart = i + 1;
    }
  }
  for (const [a, b] of segs) {
    const free = order.slice(a, b + 1);
    const prev = a > 0 ? order[a - 1] : null;               // 段前的錨當起點參考
    // 最近鄰
    const rest = new Set(free);
    const seq = [];
    let cur = prev;
    while (rest.size) {
      let best = null, bd = Infinity;
      for (const x of rest) {
        const d = cur == null ? 0 : (sec[cur][x] || 0);
        if (d < bd) { bd = d; best = x; }
      }
      seq.push(best); rest.delete(best); cur = best;
    }
    // 2-opt（含段後錨當終點參考）
    const next = b < n - 1 ? order[b + 1] : null;
    const cost = (arr) => {
      let t = 0, c = prev;
      for (const x of arr) { if (c != null) t += sec[c][x] || 0; c = x; }
      if (next != null) t += sec[c][next] || 0;
      return t;
    };
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < seq.length - 1; i++) {
        for (let j = i + 1; j < seq.length; j++) {
          const cand = [...seq.slice(0, i), ...seq.slice(i, j + 1).reverse(), ...seq.slice(j + 1)];
          if (cost(cand) + 1 < cost(seq)) { seq.splice(0, seq.length, ...cand); improved = true; }
        }
      }
    }
    order.splice(a, b - a + 1, ...seq);
  }
  const after = totalTravelSec(order, sec);
  return {
    order, before, after,
    changed: after + 30 < before && order.some((x, i) => x !== idx[i]),   // 至少省 30 秒才值得動
  };
}
