// data/places 的離線擴充工具（骨架）—— 目前的資料是「人工策展」，這支腳本尚未實際跑過。
//
// 目的：從免金鑰來源批次補地點，但**永遠不覆寫人工資料**。
//   Wikivoyage  每個城市的 See / Eat / Do 清單（有人寫的描述、座標、有時有價位）
//   Wikipedia   REST summary（extract 當 blurb）、pageview API（近 30 天 vs 前 90 天 → trend）
//   Overpass    amenity=marketplace/restaurant、tourism=attraction/viewpoint（座標、cuisine、hours）
//   Commons     以座標 geosearch 找免費授權圖片檔名
//
// 安全規則（3 代理一致）：
//   1. 機器產出只寫到 data/places/_staging/<city>.json，人工看過才 promote 進正式檔。
//   2. 合併以「name + 座標 80m 內」為同一地點。
//   3. src:"hand" 或 lock 內列出的欄位 —— 一律不動。
//   4. 只補空欄位、更新 trend / coords 這類衍生資料。
//
// 用法（實作後）：node scripts/build-places.mjs tw-taipei

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../data/places/', import.meta.url));
const STAGING = DIR + '_staging/';
const RAW = fileURLToPath(new URL('../data/_raw/', import.meta.url));   // gitignore

const cityId = process.argv[2];
if (!cityId) { console.error('用法：node scripts/build-places.mjs <cityId>'); process.exit(1); }

await mkdir(STAGING, { recursive: true });
await mkdir(RAW, { recursive: true });

// --- 各來源（TODO：實作）---
async function fromWikivoyage(cityName) { void cityName; return []; }        // See/Eat/Do listings
async function fromOverpass(bbox) { void bbox; return []; }                  // marketplace / restaurant / viewpoint
async function pageviewTrend(wikiTitle) { void wikiTitle; return null; }     // 30d mean / prior 90d mean
async function commonsImageFor(lat, lng) { void lat; void lng; return null; }// geosearch → File:xxx.jpg

// --- 合併：機器候選 vs 現有正式檔 ---
function sameSpot(a, b) {
  if (norm(a.name) === norm(b.name)) return true;
  if (a.lat != null && b.lat != null) {
    const d = haversine(a.lat, a.lng, b.lat, b.lng);
    return d < 80 && norm(a.name).slice(0, 2) === norm(b.name).slice(0, 2);
  }
  return false;
}
function mergeInto(existing, candidate) {
  const locked = new Set(['name', 'blurb', 'quests', ...(existing.lock || [])]);
  const out = { ...existing };
  for (const [k, v] of Object.entries(candidate)) {
    if (existing.src === 'hand' && locked.has(k)) continue;
    if (out[k] == null || out[k] === '') out[k] = v;
  }
  if (candidate.trend != null) out.trend = candidate.trend;   // 衍生資料可更新
  return out;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[\s・.,、。（）()]+/g, '');
function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const dla = (la2 - la1) * r, dlo = (lo2 - lo1) * r;
  const x = Math.sin(dla / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// --- 主流程 ---
const existingFile = DIR + cityId + '.json';
const existing = existsSync(existingFile) ? JSON.parse(await readFile(existingFile, 'utf8')) : { _meta: { schema: 1, city: cityId }, places: [] };

console.log('（骨架）尚未實作各來源擷取。合併邏輯與 staging 流程已就緒。');
console.log(`現有 ${existing.places.length} 個地點會被保留；機器候選會寫到 ${STAGING}${cityId}.json 供人工審閱。`);

const candidates = [
  ...(await fromWikivoyage(cityId)),
  ...(await fromOverpass(null)),
];
void pageviewTrend; void commonsImageFor; void sameSpot; void mergeInto;

await writeFile(STAGING + cityId + '.json', JSON.stringify({ _meta: { generated: Date.now(), city: cityId }, candidates }, null, 2));
console.log('done（目前 candidates 為空——待實作來源擷取）');
