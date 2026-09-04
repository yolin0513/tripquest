// 任務產生 + 策展地點資料存取
//
// 資料（3 代理一致）：
//   data/places/index.json     階層骨架（國家→地區→城市→行政區皆為按鈕；行政區只是篩選欄位）
//   data/places/<city>.json    該城市的 flat places[]（惰性載入）
//   data/templates.json        byTag 出題（策展地點用）+ typeRules/byType（自由輸入的景點用）
//
// 任務產生順序：地點有人工 quests[] → 直接用；否則依 tags 從 templates.byTag 產 + must 清單；
//               自由輸入的景點 → 依名稱關鍵字判斷型別 → byType → 通用題保底。永不落空。

import { uuid } from '../ids.js';

let _index = null;
let _templates = null;
const _cities = new Map();          // cityId -> places[]
let _allLoadedForSearch = false;

const norm = (s) => String(s || '').toLowerCase()
  .replace(/[\s　·・.,，、。！!？?「」『』（）()【】\-—_/／]+/g, '');

// ---------- 載入 ----------
export async function loadPlaceIndex() {
  if (!_index) _index = await fetch('./data/places/index.json').then((r) => r.json());
  return _index;
}
async function loadTemplates() {
  if (!_templates) _templates = await fetch('./data/templates.json').then((r) => r.json());
  return _templates;
}
export async function loadCity(cityId) {
  if (_cities.has(cityId)) return _cities.get(cityId);
  const idx = await loadPlaceIndex();
  const meta = findCity(idx, cityId);
  if (!meta) { _cities.set(cityId, []); return []; }
  try {
    const data = await fetch('./data/places/' + meta.file).then((r) => r.json());
    const places = (data.places || []).map((p) => ({ ...p, cityId, cityName: meta.name, region: meta.regionName, emoji: primaryEmoji(p) }));
    _cities.set(cityId, places);
    return places;
  } catch {
    _cities.set(cityId, []);
    return [];
  }
}

function findCity(idx, cityId) {
  for (const c of idx.countries || []) {
    for (const r of c.regions || []) {
      for (const ci of r.cities || []) {
        if (ci.id === cityId) return { ...ci, regionName: r.name, countryName: c.name };
      }
    }
  }
  return null;
}

// 建立行程畫面用的階層（回傳整棵 index，畫面自己走訪）
export async function placeHierarchy() { return loadPlaceIndex(); }

// 某城市的地點，依 rank 排序、可選行政區篩選
export async function placesOfCity(cityId, district = null) {
  const places = await loadCity(cityId);
  const list = district ? places.filter((p) => (p.district || '') === district || (p.district || '').startsWith(district.split('（')[0])) : places;
  return [...list].sort((a, b) => (b.rank || 0) - (a.rank || 0) || a.name.localeCompare(b.name));
}

// ---------- 搜尋（輔助用；第一次搜尋時把所有城市載進來）----------
async function loadAllForSearch() {
  if (_allLoadedForSearch) return;
  const idx = await loadPlaceIndex();
  const ids = [];
  for (const c of idx.countries || []) for (const r of c.regions || []) for (const ci of r.cities || []) ids.push(ci.id);
  await Promise.all(ids.map((id) => loadCity(id)));
  _allLoadedForSearch = true;
}
function allLoadedPlaces() {
  const out = [];
  for (const arr of _cities.values()) out.push(...arr);
  return out;
}

export async function searchPlaces(q) {
  await loadAllForSearch();
  const n = norm(q);
  if (n.length < 1) return [];
  const scored = [];
  for (const p of allLoadedPlaces()) {
    const hay = [p.name, p.nameEn, p.district, p.cityName, ...(p.aliases || []), ...(p.must || [])].map(norm);
    let score = 0;
    if (norm(p.name) === n) score = 100;
    else if (norm(p.name).includes(n)) score = 80;
    else if (hay.some((h) => h.includes(n))) score = 55;
    if (score) scored.push({ ...p, _score: score + (p.rank || 0) / 10 });
  }
  return scored.sort((a, b) => b._score - a._score).slice(0, 20);
}

export function placeById(id) {
  return allLoadedPlaces().find((p) => p.id === id) || null;
}

// 自由文字比對到策展地點（行程文字解析用）
export async function matchPlace(name, cityHint = '') {
  await loadAllForSearch();
  const n = norm(name);
  if (n.length < 2) return null;
  let best = null;
  for (const p of allLoadedPlaces()) {
    const names = [norm(p.name), ...(p.aliases || []).map(norm)];
    let score = 0;
    if (names.includes(n)) score = 100;
    else if (n.length >= 3 && names.some((x) => x.includes(n))) score = 70;
    else if (names.some((x) => x.length >= 3 && n.includes(x))) score = 65;
    if (score && cityHint && norm(p.cityName).includes(norm(cityHint))) score += 15;
    if (score && (!best || score > best._s)) best = { ...p, _s: score };
  }
  return best && best._s >= 60 ? best : null;
}

// ---------- 行程文字解析（進階模式）----------
export function parseItinerary(text, fallbackRegion = '') {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let day = 1;
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    const dm = line.match(/^(?:第\s*([0-9一二三四五六七八九十]+)\s*天|day\s*([0-9]+)|d([0-9]+))[：:.\s-]*/i);
    if (dm) {
      day = cnNum(dm[1] || dm[2] || dm[3]);
      line = line.slice(dm[0].length).trim();
      if (!line) continue;
    }
    for (let piece of line.split(/[、,，;；/｜|]+|\s{2,}/).map((s) => s.trim()).filter(Boolean)) {
      let region = fallbackRegion, name = piece;
      const m = piece.match(/^(\S{2,6})\s+(\S.+)$/);
      if (m && /[一-鿿ぁ-んァ-ヶ]/.test(m[1])) { region = m[1]; name = m[2]; }
      out.push({ name: name.trim(), region: region.trim(), day });
    }
  }
  return out;
}
function cnNum(s) {
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return map[s] || 1;
}

// ---------- 主流程 ----------
// items: [{ placeId?, name?, day }]  —— placeId 來自階層選擇；name 來自自由輸入
export async function generateForTrip({ tripId, items, itineraryText, region = '' }) {
  await Promise.all([loadPlaceIndex(), loadTemplates()]);
  const list = [...(items || [])];
  if (itineraryText) {
    for (const p of parseItinerary(itineraryText, region)) list.push({ name: p.name, region: p.region, day: p.day });
  }

  const spots = [];
  const quests = [];
  let order = 0;

  for (const it of list) {
    if (!it) continue;
    const spotId = uuid();
    const day = it.day || 1;
    let place = null;
    if (it.placeId) { await loadAllForSearch(); place = placeById(it.placeId); }
    if (!place && it.name) place = await matchPlace(it.name, it.region || region);

    if (place) {
      spots.push({
        id: spotId, type: 'spot', tripId, name: place.name, nameLocal: place.name,
        region: place.cityName || place.region || it.region || region,
        district: place.district || '', day, order: order++,
        lat: place.lat ?? null, lng: place.lng ?? null,
        wikiRef: place.wiki || null, commonsImg: place.img?.commons || null,
        emoji: primaryEmoji(place), blurb: place.blurb || '',
        tags: place.tags || [], source: 'curated', placeId: place.id,
      });
      for (const q of questsForPlace(place)) quests.push(mkQuest(tripId, spotId, q));
    } else {
      const name = it.name || '未命名景點';
      const type = inferType(name);
      spots.push({
        id: spotId, type: 'spot', tripId, name, nameLocal: name,
        region: it.region || region, day, order: order++,
        lat: null, lng: null, wikiRef: null, emoji: typeEmoji(type) || '📍',
        blurb: '', tags: [], source: 'auto', inferredType: type,
      });
      for (const q of templateQuests(name, type)) quests.push(mkQuest(tripId, spotId, q));
    }
  }
  return { spots, quests };
}

function mkQuest(tripId, spotId, q) {
  return {
    id: uuid(), type: 'quest', tripId, spotId,
    title: q.title, hint: q.hint, kind: q.kind || 'thing',
    source: q.source || 'template', order: q.order ?? 0, refImage: null,
  };
}

// 策展地點 → 任務
function questsForPlace(place) {
  const out = [];
  if (Array.isArray(place.quests) && place.quests.length) {
    place.quests.forEach((q, i) => out.push({ title: q.title, hint: q.hint, kind: q.type || q.kind || 'thing', source: 'curated', order: i }));
  }
  const t = _templates;
  const tags = place.questSeed?.tags || place.tags || [];
  if (out.length < 3 && t) {
    let i = out.length;
    for (const tag of tags) {
      for (const q of (t.byTag[tag] || [])) {
        if (out.length >= 4) break;
        const title = q.title.replaceAll('{spot}', place.name);
        if (out.some((o) => o.title === title)) continue;
        out.push({ title, hint: q.hint.replaceAll('{spot}', place.name), kind: q.kind, source: 'template', order: i++ });
      }
    }
  }
  // 必吃清單 → 每項一個任務（最多 3 個）
  if (Array.isArray(place.must) && t?.mustQuest) {
    place.must.slice(0, 3).forEach((item, i) => {
      out.push({
        title: t.mustQuest.title.replaceAll('{item}', item).replaceAll('{spot}', place.name),
        hint: t.mustQuest.hint.replaceAll('{item}', item).replaceAll('{spot}', place.name),
        kind: 'food', source: 'must', order: out.length + i,
      });
    });
  }
  if (!out.length) out.push({ title: '到此一遊代表照', hint: `拍一張最能代表「我來過 ${place.name}」的照片。`, kind: 'view', source: 'generic', order: 0 });
  return out.slice(0, 6);
}

const TAG_EMOJI = { sight: '🏛️', food: '🍜', nightmarket: '🏮', snack: '🍢', checkin: '📸', culture: '🎎', nature: '🌄', shopping: '🛍️', view: '🌇' };
function primaryEmoji(place) {
  if (place.emoji) return place.emoji;
  return TAG_EMOJI[place.primary] || TAG_EMOJI[(place.tags || [])[0]] || '📍';
}

// ---------- 自由輸入景點：關鍵字型別判斷 ----------
export function inferType(name) {
  if (!_templates) return null;
  const n = String(name || '').toLowerCase();
  for (const rule of _templates.typeRules || []) {
    if (rule.match.some((kw) => n.includes(kw.toLowerCase()))) return rule.type;
  }
  return null;
}
function typeEmoji(type) {
  return ({ temple: '⛩️', shrine: '⛩️', castle: '🏯', market: '🏮', park: '🌳', mountain: '⛰️', water: '🌊', museum: '🖼️', street: '🏮', station: '🚉', tower: '🗼', themepark: '🎡' })[type];
}
export function templateQuests(name, type) {
  if (!_templates) return [];
  const fill = (t) => ({ ...t, hint: t.hint.replaceAll('{spot}', name), title: t.title.replaceAll('{spot}', name) });
  const byType = (type && _templates.byType?.[type]) ? _templates.byType[type].map(fill) : [];
  const generic = (_templates.generic || []).map(fill);
  const out = [...byType];
  for (const g of generic) {
    if (out.length >= 4) break;
    if (!out.some((o) => o.title === g.title)) out.push(g);
  }
  return out.slice(0, 5).map((q, i) => ({ ...q, source: 'template', order: i }));
}

// ---------- 可選：Wikipedia 補圖（enrich.js 也會用）----------
export async function enrichSpotFromWiki(spot) {
  const title = spot.wikiRef?.title || spot.name;
  const lang = spot.wikiRef?.lang || 'zh';
  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const d = await res.json();
    return {
      thumb: d.thumbnail?.source || null, extract: d.extract || '',
      lat: d.coordinates?.lat ?? null, lng: d.coordinates?.lon ?? null,
      wikiUrl: d.content_urls?.desktop?.page || null,
    };
  } catch { return null; }
}
