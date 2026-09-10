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
import { spotTimes } from './spottime.js';
import { stayForSpot } from './theme.js';

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
// · 停留沒填的依景點類別推（stayForSpot），並標 assumed —— 畫面要說用了幾分鐘。
//
// v1.67 修掉三個實測重現的錯誤（三代理各自獨立指出，我逐一餵資料驗過）：
//  ① **跨區之後會瞬間移動**。原本 `cur = leave != null ? leave : cur`，跨區段的
//     leave 是 null，於是 cur 停在跨區前那一站的離開時間，下一站從那裡繼續往下加。
//     實測：台北 09:00 停 60 分 → 飛沖繩（停 60 分）→ 沖繩隔壁站，第三站算出
//     「10:05 到」—— 飛行時間與沖繩那一站的停留**都憑空消失**。
//  ② **跨午夜會報出荒謬的遲到**。使用者填的「幾點到」是牆上時鐘（minOfInput 上限
//     1439），推算到達卻可能已經跨日。實測 23:00 夜市 → 01:00 宵夜，late=1413，
//     畫面會寫「⚠ 比預定晚 23 小時 33 分」。現在先把固定時刻平移到離推算值最近
//     的那一天再比。
//  ③ **只有舊字串時間的記錄對時刻鏈完全隱形**。spottime.js 開頭寫著「所有要顯示
//     時間的地方都走這裡」，但這支當初直接讀 s.startMin。實測 startTime:'09:00'
//     的舊記錄 fixed=false、arrive=null，**整條鏈跟著全空**。現在走 spotTimes()。
//
// 另外新增 lateSoft：遲到數字只要上游用過任何估算（估算車程／假設停留／跨區中斷）
// 或差距太小，就不該當成警告 —— 見下方 LATE_MIN 的說明。
export const LATE_MIN = 20;

// 固定時刻是 0–1439 的牆上時鐘；推算到達可能 > 1440。平移到離推算值最近的那一天。
function alignDay(fixedMin, arrive) {
  if (arrive == null) return fixedMin;
  return fixedMin + Math.round((arrive - fixedMin) / 1440) * 1440;
}

export function chainTimes(spots, matrix, mode = 'drive') {
  const out = [];
  const src = matrix ? matrix.src : 'est';
  let cur = null;                       // 目前時刻（分鐘）
  let soft = false;                     // 上游是否用過估算（會污染下游所有推算）
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    const t = spotTimes(s);             // 舊記錄只有 startTime 字串時也讀得出來（③）
    const fixed = Number.isFinite(t.startMin);
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
    if (i === 0) arrive = fixed ? t.startMin : null;
    else if (cur != null && travel != null) arrive = cur + Math.round(travel / 60);
    if (fixed) {
      const want = alignDay(t.startMin, arrive);          // ②
      if (arrive != null && arrive > want) late = arrive - want;
      arrive = want;
    }
    // 遲到可不可信，看的是「上游」有沒有用過估算 —— 這一站自己的假設停留只會影響下游
    const lateSoft = late > 0 && (soft || src !== 'osrm' || late < LATE_MIN);
    const hasStay = Number.isFinite(t.stayMin) && t.stayMin > 0;
    const stay = hasStay ? t.stayMin : (arrive != null ? stayForSpot(s) : null);
    const leave = arrive != null && stay != null ? arrive + stay : null;
    out.push({ id: s.id, arrive, leave, fixed, late, lateSoft, travel, longHaul: far,
      stayAssumed: arrive != null && !hasStay, stayUsed: stay });
    if (!hasStay && arrive != null) soft = true;          // 這一站的停留是猜的 → 污染下游
    if (far) soft = true;
    // 跨區之後不能沿用前一站的離開時間，那等於瞬間移動（①）。
    // 但如果這一站自己有填「幾點到」，鏈就從那裡重新接上，是可信的。
    //
    // v1.73.2：`far ? null : cur` 還不夠 —— **任何**算不出離開時刻的站都會斷鏈，
    // 不只跨區。最常見的是「還沒找到座標」的景點：travel 是 null → arrive 是 null，
    // 但 cur 還留著更前面那一站的離開時間，於是再下一站的抵達時刻是從**兩站以前**
    // 算的，中間那些站等於零停留、零車程。而它們的 arrive 是 null，`soft` 那一行
    // 也不會觸發，所以那個遲到會被當成**硬**遲到報出來 —— 一個建立在虛構鏈上的警告。
    // leave 是 null 就等於「我不知道幾點離開這裡」，下游本來就不該從別處接。
    cur = leave;
  }
  return out;
}

// ---- 使用者自己填的時間互相矛盾 ----
// 這是唯一**完全不需要估算**的檢查：不看車程、不看假設停留、不受跨區中斷影響，
// 純粹是使用者親手輸入的兩個數字打架。三個代理各自獨立提出這一條並都排第一。
//
// 實務命中率不低：拖拉重排與「排順序」只改 day/order，**完全不碰 startMin**，
// 所以「把訂了 13:00 的餐廳拖到 15:00 的景點後面」是家常便飯，而目前 App 一聲不吭
// （chainTimes 只是把 arrive 重設成 startMin，然後若無其事地往下算）。
// 匯入行程表把時間解析到錯的一列，也會產生這種資料。
//
// 唯一的誤報來源是跨午夜：23:00 夜市 → 01:00 宵夜，前後相減是負的，但那是正當安排。
// 所以「晚上很晚 → 凌晨很早」這一組直接跳過不判。這是刻意選擇**漏報**而不是誤報
// （19:00 → 02:00 若真的是打錯，我們會沉默）——因為誤報一次就會讓長輩以後都不看。
const NIGHT = 18 * 60, DAWN = 6 * 60;
const crossesMidnight = (a, b) => a >= NIGHT && b <= DAWN;

export function timeConflicts(spots) {
  const out = [];
  let prev = null;                       // 前一個「有填幾點到」的景點
  for (let i = 0; i < (spots || []).length; i++) {
    const t = spotTimes(spots[i]);
    if (!Number.isFinite(t.startMin)) continue;
    if (prev && !crossesMidnight(prev.t.startMin, t.startMin)) {
      const hasStay = Number.isFinite(prev.t.stayMin) && prev.t.stayMin > 0;
      if (t.startMin < prev.t.startMin) {
        out.push({ kind: 'order', id: spots[i].id, prevId: spots[prev.i].id,
          at: t.startMin, prevAt: prev.t.startMin, prevName: spots[prev.i].name || '' });
      } else if (hasStay && prev.t.startMin + prev.t.stayMin > t.startMin) {
        out.push({ kind: 'overlap', id: spots[i].id, prevId: spots[prev.i].id,
          at: t.startMin, prevAt: prev.t.startMin, prevEnd: prev.t.startMin + prev.t.stayMin,
          prevName: spots[prev.i].name || '' });
      }
    }
    prev = { i, t };
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
