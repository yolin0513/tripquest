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
export async function nearbyFacilities(lat, lng, { radius = 3000, fresh = false } = {}) {
  const cached = readCache(lat, lng);
  if (cached && !fresh && Date.now() - cached.at < 3 * 86400000) {
    return { at: cached.at, stale: false, results: rank(cached.data, lat, lng) };
  }

  const body = 'data=' + encodeURIComponent(buildQuery(lat, lng, radius));
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
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
