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
import { loadThemes, themeForSpot } from '../theme.js';
import { loadPhrases, makeCtx, composeBlurb, composeQuests } from './compose.js';

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

// 分店後綴。比對時要拿掉（「奕順軒 礁溪店」跟「奕順軒」是同一家），
// 但**只在比對時**拿掉 —— 景點名字保留分店，導航才會帶到對的那一家。
const BRANCH = /[\s\-]*[一-龥]{0,4}(?:總店|本店|旗艦店|創始店|分店|門市|店)$/;

// 策展名是不是輸入的「子序列」，而且只差幾個字。
// 「羅東夜市」⊂「羅東觀光夜市」（中間插了「觀光」兩個字）—— 這種在台灣地名
// 很常見（觀光／國家／市立…），純子字串比對抓不到。
// 插入字數抓緊：給錯的策展資料會連帶給錯的示意圖與任務，比沒對到更糟。
function looseHit(curated, input) {
  if (curated.length < 3 || input.length <= curated.length) return false;
  const gap = input.length - curated.length;
  if (gap > 2) return false;
  if (curated.length < 4 && gap > 1) return false;
  let i = 0;
  for (const ch of input) if (ch === curated[i]) i++;
  return i === curated.length;
}

// 自由文字比對到策展地點（行程文字解析用）
export async function matchPlace(name, cityHint = '') {
  await loadAllForSearch();
  const n = norm(name);
  if (n.length < 2) return null;
  const nb = norm(String(name).replace(BRANCH, ''));      // 去掉分店後綴的版本
  const tries = nb && nb !== n && nb.length >= 2 ? [n, nb] : [n];

  let best = null;
  for (const p of allLoadedPlaces()) {
    const names = [norm(p.name), ...(p.aliases || []).map(norm)];
    let score = 0;
    for (const q of tries) {
      let s = 0;
      if (names.includes(q)) s = 100;
      else if (q.length >= 3 && names.some((x) => x.includes(q))) s = 70;
      else if (names.some((x) => x.length >= 3 && q.includes(x))) s = 65;
      else if (names.some((x) => looseHit(x, q))) s = 64;
      if (q !== n) s -= 3;                                 // 要去掉分店才對到的，稍微降一點
      score = Math.max(score, s);
    }
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
  await Promise.all([loadPlaceIndex(), loadTemplates(), loadThemes(), loadPhrases()]);
  const list = [...(items || [])];
  if (itineraryText) {
    for (const p of parseItinerary(itineraryText, region)) list.push({ name: p.name, region: p.region, day: p.day });
  }
  // 依「第幾天、幾點」排好再產生 —— 匯入的行程有時間，排序對了行程頁才會照真的順序走。
  // 沒有時間的維持原本的相對次序（stable sort）。
  list.forEach((x, i) => { if (x) x._i = i; });
  list.sort((a, b) => {
    if (!a || !b) return 0;
    const d = (a.day || 1) - (b.day || 1);
    if (d) return d;
    const at = Number.isFinite(a.startMin) ? a.startMin : Infinity;
    const bt = Number.isFinite(b.startMin) ? b.startMin : Infinity;
    return at === bt ? a._i - b._i : at - bt;
  });

  const spots = [];
  const quests = [];
  let order = 0;
  const ctx = makeCtx(tripId);   // 同一趟共用：避免句型重複

  for (const it of list) {
    if (!it) continue;
    const spotId = uuid();
    const day = it.day || 1;
    let place = null;
    if (it.placeId) { await loadAllForSearch(); place = placeById(it.placeId); }
    if (!place && it.name) place = await matchPlace(it.name, it.region || region);

    let spot;
    if (place) {
      spot = {
        id: spotId, type: 'spot', tripId, name: place.name, nameLocal: place.name,
        region: place.cityName || place.region || it.region || region,
        district: place.district || '', day, order: order++,
        lat: place.lat ?? null, lng: place.lng ?? null,
        wikiRef: place.wiki || null, commonsImg: place.img?.commons || null,
        emoji: primaryEmoji(place), blurb: place.blurb || '',
        must: place.must || [], primary: place.primary || '',
        tags: place.tags || [], source: 'curated', placeId: place.id,
      };
    } else {
      const name = it.name || '未命名景點';
      const type = inferType(name);
      spot = {
        id: spotId, type: 'spot', tripId, name, nameLocal: name,
        region: it.region || region, day, order: order++,
        lat: null, lng: null, wikiRef: null,
        emoji: nameEmoji(name) || typeEmoji(type) || '📍',
        blurb: '', must: [], tags: [], source: 'auto', inferredType: type,
      };
    }

    // 匯入行程表帶進來的時間（沒有就不寫，別留一堆 null 欄位）
    if (Number.isFinite(it.startMin)) spot.startMin = it.startMin;
    if (Number.isFinite(it.stayMin)) spot.stayMin = it.stayMin;

    // 主題判定 + 依主題組文案（同一趟不重複句型）
    spot.theme = themeForSpot(spot);
    const themed = composeQuestSet(spot, spot.theme, ctx, place);
    if (!spot.blurb) spot.blurb = composeBlurb(spot, spot.theme, ctx);
    delete spot.must; delete spot.primary;   // 這兩個只是產生時用，不落地

    spots.push(spot);
    for (const q of themed) quests.push(mkQuest(tripId, spotId, q));
  }
  return { spots, quests };
}

// 人工題組（若有）優先，再補主題化任務，去重
function composeQuestSet(spot, theme, ctx, place) {
  const out = [];
  if (place && Array.isArray(place.quests) && place.quests.length) {
    place.quests.forEach((q, i) => out.push({
      title: q.title, hint: q.hint, kind: q.type || q.kind || 'thing', source: 'curated', order: i,
    }));
  }
  for (const q of composeQuests({ ...spot, must: (place && place.must) || spot.must || [] }, theme, ctx, { max: out.length ? 2 : 4 })) {
    if (out.length >= 6) break;
    if (out.some((o) => o.title === q.title)) continue;
    out.push({ ...q, order: out.length });
  }
  return out.slice(0, 6);
}

function mkQuest(tripId, spotId, q) {
  return {
    id: uuid(), type: 'quest', tripId, spotId,
    title: q.title, hint: q.hint, kind: q.kind || 'thing',
    source: q.source || 'template', order: q.order ?? 0, refImage: null,
    when: q.when || null,
  };
}

// 依主題補任務（trip.js「補齊任務」用）
export async function themedQuestsForSpot(spot, tripId) {
  await Promise.all([loadThemes(), loadPhrases()]);
  const theme = spot.theme || themeForSpot(spot);
  const ctx = makeCtx(String(tripId) + ':regen:' + spot.id);
  return composeQuests({ ...spot, must: spot.must || [] }, theme, ctx, { max: 4 });
}

const TAG_EMOJI = { sight: '🏛️', food: '🍜', nightmarket: '🏮', snack: '🍢', checkin: '📸', culture: '🎎', nature: '🌄', shopping: '🛍️', view: '🌇' };
const NAME_EMOJI = [
  [/機場|机场|空港/, '✈️'], [/車站|车站|駅$|轉運站|转运站/, '🚉'],
  [/夜市/, '🏮'], [/神社|大社|稻荷|稲荷|[^海]宮$|鳥居/, '⛩️'], [/[^醫眼]城$|城堡|天守|古堡|赤崁|砲台/, '🏯'],
  [/寺$|寺院|大佛/, '🛕'], [/廟$|祠$|天后|媽祖/, '🀄'], [/塔$|101|晴空|鐵塔|tower/i, '🗼'],
  [/步道|林道|古道|健行/, '🥾'],
  [/牛肉麵|拉麵|[^泡]麵$|飯$|[^醫]粥$|火鍋|燒肉|小吃|食堂|餐廳|海鮮|豬心|蝦捲|肉圓|碗粿|米糕|肉羹|魚湯|水果店|冰店$|豆花|甜點|咖啡館|烘焙/, '🍜'],
  [/公園|草原|牧場|農場|花海|花園|植物園/, '🌳'], [/山$|岳$|峰$|嶺$/, '⛰️'], [/湖$|潭$|運河|瀑布|溪$|海$|灘$|岬$|漁港|碼頭|龍洞|鼻頭|奇岩/, '🌊'],
  [/溫泉|温泉/, '♨️'], [/水族館|美麗海|海生館/, '🐠'], [/教堂/, '⛪'], [/纜車/, '🚠'],
  [/博物館|美術館|文物|故宮|紀念館/, '🖼️'], [/老街|商店街/, '🏘️'], [/瞭望|觀景|展望/, '🔭'],
  [/百貨|購物|商場|outlet/i, '🛍️'], [/樂園|遊樂園|動物園/, '🎡'],
];
function nameEmoji(name) {
  for (const [re, e] of NAME_EMOJI) if (re.test(name || '')) return e;
  return null;
}
function primaryEmoji(place) {
  if (place.emoji) return place.emoji;
  return nameEmoji(place.name) || TAG_EMOJI[place.primary] || TAG_EMOJI[(place.tags || [])[0]] || '📍';
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
  return ({ temple: '⛩️', shrine: '⛩️', castle: '🏯', market: '🏮', park: '🌳', mountain: '🥾', water: '🌊', museum: '🖼️', street: '🏘️', station: '🚉', tower: '🗼', themepark: '🎡' })[type];
}


