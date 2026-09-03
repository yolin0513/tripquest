// 任務產生 —— 三層 fallback（三位架構代理一致方案）
//   1. 策展資料庫命中 → 直接帶入人工撰寫的高品質任務
//   2. 未命中 → 依景點名稱關鍵字判斷型別，套規則式模板
//   3. 一律再加通用題組當保底 → 產生結果永遠不會是空的
// Wikipedia 補圖是「可選的線上加值」，預設關閉，永遠不在關鍵路徑上。

import { uuid } from '../ids.js';

let _curated = null;
let _templates = null;

async function loadData() {
  if (!_curated) _curated = await fetch('./data/curated.json').then((r) => r.json());
  if (!_templates) _templates = await fetch('./data/templates.json').then((r) => r.json());
}

// 給「建立行程」畫面用：熱門地區與該地區的景點（讓長輩用點的、不用打字）
export async function curatedIndex() {
  await loadData();
  const byRegion = new Map();
  for (const s of _curated.spots) {
    if (!byRegion.has(s.region)) byRegion.set(s.region, []);
    byRegion.get(s.region).push({ id: s.id, name: s.name, region: s.region, emoji: s.emoji || spotEmoji(s), questCount: s.quests.length });
  }
  return [...byRegion.entries()].map(([region, spots]) => ({ region, country: spots[0] && _curated.spots.find((x) => x.id === spots[0].id)?.country, spots }));
}

export async function searchCurated(q) {
  await loadData();
  const n = norm(q);
  if (n.length < 1) return [];
  const hits = [];
  for (const s of _curated.spots) {
    if (s.aliases.some((a) => norm(a).includes(n)) || norm(s.name).includes(n) || norm(s.region).includes(n)) {
      hits.push({ id: s.id, name: s.name, region: s.region, emoji: s.emoji || spotEmoji(s), questCount: s.quests.length });
    }
  }
  return hits.slice(0, 12);
}

function spotEmoji(s) {
  const t = inferTypeSync(s.name);
  return ({ temple: '⛩️', shrine: '⛩️', castle: '🏯', market: '🍢', park: '🌳', mountain: '⛰️', water: '🌊', museum: '🖼️', street: '🏮', station: '🚉', tower: '🗼', themepark: '🎡' })[t] || '📍';
}
function inferTypeSync(name) {
  if (!_templates) return null;
  const nn = String(name || '').toLowerCase();
  for (const rule of _templates.typeRules) if (rule.match.some((kw) => nn.includes(kw.toLowerCase()))) return rule.type;
  return null;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[\s　·・.,，、。！!？?「」『』（）()【】\-—_/／]+/g, '');

// ---- 行程文字 → 景點清單 ----
// 支援：換行分隔；一行內用 、,，;；/｜ 分隔多個景點；「第N天 / Day N」當日期標頭；
//       「京都 清水寺」這種「地區＋景點」也會拆開。
export function parseItinerary(text, fallbackRegion = '') {
  const lines = String(text || '').split(/\r?\n/);
  const spots = [];
  let day = 0;
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    const dayMatch = line.match(/^(?:第\s*([0-9一二三四五六七八九十]+)\s*天|day\s*([0-9]+)|d([0-9]+))[：:.\s-]*/i);
    if (dayMatch) {
      const n = dayMatch[1] || dayMatch[2] || dayMatch[3];
      day = cnNum(n);
      line = line.slice(dayMatch[0].length).trim();
      if (!line) continue;
    }
    const pieces = line.split(/[、,，;；/｜|]+|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    for (const piece of pieces) {
      let region = fallbackRegion;
      let name = piece;
      // 「京都 清水寺」→ region=京都 name=清水寺（只在前段短、後段也有內容時）
      const m = piece.match(/^(\S{2,6})\s+(\S.+)$/);
      if (m && /[一-鿿ぁ-んァ-ヶ]/.test(m[1])) { region = m[1]; name = m[2]; }
      spots.push({ name: name.trim(), region: region.trim(), day: day || 1 });
    }
  }
  return spots;
}

function cnNum(s) {
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s in map) return map[s];
  if (s === '十一') return 11;
  if (s === '十二') return 12;
  return 1;
}

// ---- 主流程 ----
export async function generateForTrip({ tripId, itineraryText, region }) {
  await loadData();
  const parsed = parseItinerary(itineraryText, region);
  const spots = [];
  const quests = [];
  let spotOrder = 0;

  for (const p of parsed) {
    if (!p.name) continue;
    const spotId = uuid();
    const hit = matchCurated(p.name, p.region);
    let spot;
    if (hit) {
      spot = {
        id: spotId, type: 'spot', tripId, name: hit.name,
        nameLocal: hit.name, region: hit.region || p.region, day: p.day, order: spotOrder++,
        lat: hit.lat ?? null, lng: hit.lng ?? null,
        wikiRef: hit.wiki || null, source: 'curated',
      };
      let qi = 0;
      for (const q of hit.quests) {
        quests.push(mkQuest(tripId, spotId, {
          title: q.title, hint: q.hint, kind: q.type || q.kind, source: 'curated', order: qi++,
        }));
      }
    } else {
      const kindType = inferType(p.name);
      spot = {
        id: spotId, type: 'spot', tripId, name: p.name, nameLocal: p.name,
        region: p.region, day: p.day, order: spotOrder++,
        lat: null, lng: null, wikiRef: null, source: 'auto', inferredType: kindType,
      };
      for (const q of templateQuests(p.name, kindType)) quests.push(mkQuest(tripId, spotId, q));
    }
    spots.push(spot);
  }
  return { spots, quests };
}

function mkQuest(tripId, spotId, q) {
  return {
    id: uuid(), type: 'quest', tripId, spotId,
    title: q.title, hint: q.hint, kind: q.kind || 'thing',
    source: q.source || 'template', order: q.order ?? 0,
    refImage: null,
  };
}

export function matchCurated(name, region) {
  if (!_curated) return null;
  const n = norm(name);
  if (n.length < 2) return null;
  let best = null;
  for (const s of _curated.spots) {
    for (const a of s.aliases) {
      const an = norm(a);
      if (!an) continue;
      let score = 0;
      if (an === n) score = 100;
      else if (n.length >= 3 && an.includes(n)) score = 70;
      else if (an.length >= 3 && n.includes(an)) score = 65;
      if (score && region && norm(s.region).includes(norm(region))) score += 10;
      if (score && (!best || score > best.score)) best = { ...s, score };
    }
  }
  return best && best.score >= 60 ? best : null;
}

export function inferType(name) {
  if (!_templates) return null;
  const n = String(name || '').toLowerCase();
  for (const rule of _templates.typeRules) {
    if (rule.match.some((kw) => n.includes(kw.toLowerCase()))) return rule.type;
  }
  return null;
}

export function templateQuests(name, type) {
  if (!_templates) return [];
  const fill = (t) => ({ ...t, hint: t.hint.replaceAll('{spot}', name), title: t.title.replaceAll('{spot}', name) });
  const byType = (type && _templates.byType[type]) ? _templates.byType[type].map(fill) : [];
  const generic = _templates.generic.map(fill);
  // 型別題組優先，補到至少 3 題、最多 5 題
  const out = [...byType];
  for (const g of generic) {
    if (out.length >= 4) break;
    if (!out.some((o) => o.title === g.title)) out.push(g);
  }
  return out.slice(0, 5).map((q, i) => ({ ...q, source: 'template', order: i }));
}

// ---- 可選：Wikipedia 補圖（預設關閉，需使用者在行程設定開啟）----
export async function enrichSpotFromWiki(spot) {
  const title = spot.wikiRef?.title || spot.name;
  const lang = spot.wikiRef?.lang || 'zh';
  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      thumb: data.thumbnail?.source || null,
      extract: data.extract || '',
      lat: data.coordinates?.lat ?? null,
      lng: data.coordinates?.lon ?? null,
      wikiUrl: data.content_urls?.desktop?.page || null,
    };
  } catch {
    return null;
  }
}
