// 附近的警局 / 醫院 / 藥局 —— OpenStreetMap Overpass API（免金鑰）。
// 結果會快取（依大略座標），離線或查詢失敗時回快取。

import { haversine } from './geo.js';

const CACHE = 'tripquest.nearby';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const KIND = {
  police: { label: '警察局', emoji: '🚓', q: 'amenity=police' },
  hospital: { label: '醫院 / 急診', emoji: '🏥', q: 'amenity~"^(hospital|clinic)$"' },
  pharmacy: { label: '藥局', emoji: '💊', q: 'amenity=pharmacy' },
};

// v2：醫院查詢半徑放大 + 分級排序，舊快取自動失效
function cacheKey(lat, lng) { return `v2:${lat.toFixed(2)},${lng.toFixed(2)}`; }

function readCache(lat, lng) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE) || '{}');
    return all[cacheKey(lat, lng)] || null;
  } catch { return null; }
}
function writeCache(lat, lng, data) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE) || '{}');
    all[cacheKey(lat, lng)] = { at: Date.now(), data };
    // 只留最近 5 個位置
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, 5);
    const trimmed = {};
    for (const k of keys) trimmed[k] = all[k];
    localStorage.setItem(CACHE, JSON.stringify(trimmed));
  } catch { /* noop */ }
}

function buildQuery(lat, lng, radius) {
  // 醫院 / 急診用大一點的半徑（真正緊急時，遠一點的大醫院比隔壁小診所有用）
  const hospRadius = Math.max(radius * 3, 8000);
  const parts = [
    `nwr[amenity=police](around:${radius},${lat},${lng});`,
    `nwr[amenity=pharmacy](around:${radius},${lat},${lng});`,
    `nwr[amenity~"^(hospital|clinic)$"](around:${hospRadius},${lat},${lng});`,
  ].join('');
  return `[out:json][timeout:25];(${parts});out center tags 80;`;
}

function classify(tags) {
  const a = tags.amenity;
  if (a === 'police') return 'police';
  if (a === 'hospital' || a === 'clinic') return 'hospital';
  if (a === 'pharmacy') return 'pharmacy';
  return null;
}
// 醫療院所的分級：有急診的大醫院 > 醫院 > 診所
function hospTier(t) {
  if (t.amenity === 'hospital') return t.emergency === 'yes' ? 0 : 1;
  if (t.emergency === 'yes') return 1;                 // 有掛急診的診所
  if (t.healthcare === 'hospital') return 1;
  return 3;                                             // 一般診所
}

function addr(tags) {
  if (tags['addr:full']) return tags['addr:full'];
  const area = [tags['addr:province'], tags['addr:city'], tags['addr:district'], tags['addr:suburb'], tags['addr:neighbourhood']].filter(Boolean).join('');
  const street = [tags['addr:street'], tags['addr:block_number'], tags['addr:housenumber']].filter(Boolean).join('-').replace(/^-|-$/g, '');
  return [area, street].filter(Boolean).join(' ').trim();
}

// 回傳 { at, stale, results: [{id,kind,name,lat,lng,dist,addr,phone}] }
const _to = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

export async function nearbyFacilities(lat, lng, { radius = 3000, fresh = false } = {}) {
  const cached = readCache(lat, lng);
  if (cached && !fresh && Date.now() - cached.at < 3 * 86400000) {
    return { at: cached.at, stale: false, results: rank(cached.data, lat, lng) };
  }

  const body = 'data=' + encodeURIComponent(buildQuery(lat, lng, radius));
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: _to(12000) });
      if (!res.ok) continue;
      const d = await res.json();
      const items = [];
      for (const el of d.elements || []) {
        const t = el.tags || {};
        const kind = classify(t);
        if (!kind || !t.name) continue;
        const p = el.center || el;
        if (p.lat == null) continue;
        items.push({
          id: el.type[0] + el.id, kind, name: t.name,
          lat: p.lat, lng: p.lon,
          addr: addr(t), phone: t.phone || t['contact:phone'] || t['emergency:phone'] || '',
          tier: kind === 'hospital' ? hospTier(t) : 0,
          er: kind === 'hospital' && (t.emergency === 'yes' || (t.amenity === 'hospital' && t.emergency !== 'no')),
        });
      }
      writeCache(lat, lng, items);
      return { at: Date.now(), stale: false, results: rank(items, lat, lng) };
    } catch { /* 換下一個鏡像 */ }
  }

  if (cached) return { at: cached.at, stale: true, results: rank(cached.data, lat, lng) };
  return { at: 0, stale: true, results: [], failed: true };
}

function rank(items, lat, lng) {
  return (items || [])
    .map((it) => ({ ...it, dist: Math.round(haversine({ lat, lng }, { lat: it.lat, lng: it.lng })) }))
    .sort((a, b) => {
      // 醫院：先照分級（有急診的大醫院優先），同級再比距離
      if (a.kind === 'hospital' && b.kind === 'hospital' && (a.tier || 0) !== (b.tier || 0)) {
        return (a.tier || 0) - (b.tier || 0);
      }
      return a.dist - b.dist;
    });
}

export { KIND };

// ---------- 生活設施「找附近」（v1.59）----------
// 自駕與帶長輩出遊最常要的：停車場、廁所、便利商店、加油站、藥局。
// 跟上面的緊急設施同一套 Overpass（免金鑰、雙鏡像、12 秒逾時），但分開快取：
// 語境不同（緊急 vs 生活）、欄位不同、半徑不同、也不要求有名字（停車場多半沒有）。
// 誠實原則：capacity 是地圖登記的「總車位」靜態資料，不是即時剩餘——介面要講明。

export const LIFE = {
  parking:     { label: '停車場',   emoji: '🅿️', radius: 1500, sel: '[amenity=parking]' },
  toilets:     { label: '廁所',     emoji: '🚻', radius: 1200, sel: '[amenity=toilets]' },
  convenience: { label: '便利商店', emoji: '🏪', radius: 1500, sel: '[shop=convenience]' },
  fuel:        { label: '加油站',   emoji: '⛽', radius: 4000, sel: '[amenity=fuel]' },
};
// （藥局不在這裡：SOS 頁已經有「附近藥局」，不重複）

const PTYPE = { surface: '平面', underground: '地下', 'multi-storey': '立體', rooftop: '頂樓', street_side: '路邊', lane: '路邊' };

const LIFE_CACHE = 'tripquest.nearlife';
function lifeKey(kind, lat, lng) { return `v1:${kind}:${lat.toFixed(2)},${lng.toFixed(2)}`; }
function lifeRead(kind, lat, lng) {
  try { return (JSON.parse(localStorage.getItem(LIFE_CACHE) || '{}'))[lifeKey(kind, lat, lng)] || null; } catch { return null; }
}
function lifeWrite(kind, lat, lng, data) {
  try {
    const all = JSON.parse(localStorage.getItem(LIFE_CACHE) || '{}');
    all[lifeKey(kind, lat, lng)] = { at: Date.now(), data };
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, 12);
    const trimmed = {};
    for (const k of keys) trimmed[k] = all[k];
    localStorage.setItem(LIFE_CACHE, JSON.stringify(trimmed));
  } catch { /* noop */ }
}

function lifeParse(el, kind) {
  const t = el.tags || {};
  const p = el.center || el;
  if (p.lat == null) return null;
  const it = { id: el.type[0] + el.id, kind, lat: p.lat, lng: p.lon, name: t.name || t.brand || '', hours: t.opening_hours || '' };
  if (kind === 'parking') {
    if (t.access === 'private' || t.access === 'no') return null;   // 住戶/員工專用，導航過去也不能停
    it.cap = parseInt(t.capacity, 10) || 0;
    it.capDis = parseInt(t['capacity:disabled'], 10) || 0;
    it.fee = t.fee === 'yes' ? '收費' : t.fee === 'no' ? '免費' : '';
    it.ptype = PTYPE[t.parking] || '';
    it.customers = t.access === 'customers';           // 消費者限定（店家附設）
  } else if (kind === 'toilets') {
    it.wheelchair = t.wheelchair === 'yes';
    it.changing = t.changing_table === 'yes';
    it.fee = t.fee === 'yes' ? '收費' : t.fee === 'no' ? '免費' : '';
  } else {
    it.h24 = t.opening_hours === '24/7';
  }
  return it;
}

// 回傳 { at, stale, results:[{id,kind,name,lat,lng,dist,dir,…欄位}], failed? }
export async function nearbyLife(lat, lng, kind, { fresh = false } = {}) {
  const meta = LIFE[kind];
  if (!meta) return { at: 0, stale: true, results: [], failed: true };
  const cached = lifeRead(kind, lat, lng);
  if (cached && !fresh && Date.now() - cached.at < 86400000) {
    return { at: cached.at, stale: false, results: lifeRank(cached.data, lat, lng) };
  }
  const q = `[out:json][timeout:25];nwr${meta.sel}(around:${meta.radius},${lat},${lng});out center tags 120;`;
  const body = 'data=' + encodeURIComponent(q);
  const eps = (typeof window !== 'undefined' && window.__TQ_OVERPASS_ENDPOINT) ? [window.__TQ_OVERPASS_ENDPOINT] : ENDPOINTS;
  for (const ep of eps) {
    try {
      const res = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: _to(12000) });
      if (!res.ok) continue;
      const d = await res.json();
      const items = [];
      for (const el of d.elements || []) { const it = lifeParse(el, kind); if (it) items.push(it); }
      lifeWrite(kind, lat, lng, items);
      return { at: Date.now(), stale: false, results: lifeRank(items, lat, lng) };
    } catch { /* 換下一個鏡像 */ }
  }
  if (cached) return { at: cached.at, stale: true, results: lifeRank(cached.data, lat, lng) };
  return { at: 0, stale: true, results: [], failed: true };
}

function lifeRank(items, lat, lng) {
  return (items || [])
    .map((it) => ({ ...it, dist: Math.round(haversine({ lat, lng }, { lat: it.lat, lng: it.lng })) }))
    .sort((a, b) => a.dist - b.dist);
}
