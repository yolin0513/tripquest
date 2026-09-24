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

import { mkdir, readFile, rename, open, unlink } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../data/places/', import.meta.url));
const STAGING = DIR + '_staging/';
const RAW = fileURLToPath(new URL('../data/_raw/', import.meta.url));   // gitignore

const cityId = process.argv[2];
if (!cityId) { console.error('用法：node scripts/build-places.mjs <cityId>'); process.exit(1); }

// ---------- 動手寫任何檔之前，先確認來源都在、都不是空的（2026-09-24 盤點實測）----------
// 原本：不存在的城市當成「0 個地點」、照樣寫出 staging 檔、印 done 回 0；城市檔欄位改名／格式壞掉時當掉，
// 錯誤沒講是哪個檔。缺任何一樣就停、一個檔都不寫——staging 維持上一次成功的輸出（App 或人讀到的仍是完整的那一份）。
const stagingOut = STAGING + cityId + '.json';
const stop = (why, kind = '來源不齊') => {
  let prev = '沒有上一次的輸出';
  try { if (existsSync(stagingOut)) prev = `上一次的輸出還在（${new Date(statSync(stagingOut).mtimeMs).toISOString()}），沒有被換掉`; } catch (e) { prev = `上一次的輸出讀不了狀態（${e.code || e.message}）`; }
  console.error(`✗ ${why}`);
  console.error(`擋下：${kind}，一個檔都沒寫（${prev}）`);
  process.exit(1);
};
let index;
try { index = JSON.parse(await readFile(DIR + 'index.json', 'utf8')); } catch (e) { stop(`讀不到 data/places/index.json：${e.message}`); }
const cities = new Map();
for (const c of index.countries || []) for (const r of c.regions || []) for (const ci of r.cities || []) cities.set(ci.id, ci.file);
if (!cities.size) stop('index.json 一個城市都沒有');
if (!cities.has(cityId)) stop(`城市「${cityId}」不在 index.json 登記的 ${cities.size} 個城市裡`);
const existingFile = DIR + cities.get(cityId);
if (!existsSync(existingFile)) stop(`${cityId}：index.json 指到的 ${cities.get(cityId)} 不存在`);
let existing;
const F = cities.get(cityId);
try { existing = JSON.parse(await readFile(existingFile, 'utf8')); } catch (e) { stop(`${cityId}（${F}）解析不了：${e.message}`); }
// 每一種狀況各自講明（F8：停下的理由要點名是哪個單位、哪一種狀況）
if (!('places' in existing)) stop(`${cityId}（${F}）沒有 places 這個欄位——欄位名稱對不上？檔裡的欄位：${Object.keys(existing).join('、')}`);
if (!Array.isArray(existing.places)) stop(`${cityId}（${F}）的 places 不是陣列`);
if (!existing.places.length) stop(`${cityId}（${F}）的 places 是空的`);
// 有效筆數：每個地點都要有 id、name、非空的 tags——有一筆無效就停，並點名是哪幾筆
const invalid = existing.places.map((p, i) => [i, p]).filter(([, p]) => !p || !p.id || !p.name || !Array.isArray(p.tags) || !p.tags.length);
if (invalid.length) stop(`${cityId}（${F}）有 ${invalid.length} 個地點無效（缺 id／name／tags）：第 ${invalid.map(([i, p]) => `${i + 1} 個（${(p && p.id) || '沒有 id'}）`).join('、')}`);
// 資料變少也要停：上一次成功的輸出記著當時讀到幾個地點，這次比它少就停（改過資料確定要變少，先刪掉那份 staging 再跑）
if (existsSync(stagingOut)) {
  let prev = null;
  try { prev = JSON.parse(await readFile(stagingOut, 'utf8'))?._meta?.existingCount; } catch (e) { stop(`${cityId} 上一次的輸出 _staging/${cityId}.json 讀不了：${e.message}`); }
  if (Number.isInteger(prev) && existing.places.length < prev) stop(`${cityId}（${F}）資料變少：上一次 ${prev} 個地點、這次 ${existing.places.length} 個`);
}

try { await mkdir(STAGING, { recursive: true }); await mkdir(RAW, { recursive: true }); }
catch (e) { stop(`${cityId}：建不了輸出資料夾（${e.code || e.message}：${e.path || ''}）——data/places/_staging 或 data/_raw 被同名的檔案佔住？`, '寫檔失敗'); }

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

// --- 主流程（來源已在最上面確認過：existing 是 index 登記的那個城市檔，places 是非空陣列）---
console.log('（骨架）尚未實作各來源擷取。合併邏輯與 staging 流程已就緒。');
console.log(`現有 ${existing.places.length} 個地點會被保留；機器候選會寫到 data/places/_staging/${cityId}.json 供人工審閱。`);

const candidates = [
  ...(await fromWikivoyage(cityId)),
  ...(await fromOverpass(null)),
];
void pageviewTrend; void commonsImageFor; void sameSpot; void mergeInto;

// 先寫暫存檔、寫完才換上：寫到一半失敗時，上一次成功的輸出不會被半份檔蓋掉。
// 清理也要能失敗、不能中斷（2026-09-24 F8；JLPT、MealMate 都中過同一個錯：暫存位置先放一個同名資料夾，清理程式去刪它、
// 刪不掉、再丟一次例外，吐堆疊而不是設計好的訊息）：只清這次自己建出來的暫存檔；清不掉也點名，不再丟例外。
const tmpOut = stagingOut + '.partial';
const tmpRel = `data/places/_staging/${cityId}.json.partial`;
if (existsSync(tmpOut)) stop(`${cityId}：暫存位置 ${tmpRel} 已經有東西（${statSync(tmpOut).isDirectory() ? '資料夾' : '檔案'}，不是這次寫的，不動它）——確認後自己移掉再跑`, '暫存位置被占用');
let created = false;
const cleanup = async () => {
  if (!created) return '';
  try { await unlink(tmpOut); return '，暫存檔已清掉'; } catch (e) { return `，暫存檔 ${tmpRel} 清不掉（${e.code || e.message}），請自己刪`; }
};
try {
  const fh = await open(tmpOut, 'wx');       // wx：只能新建——建成功了才算自己的
  created = true;
  try { await fh.writeFile(JSON.stringify({ _meta: { generated: Date.now(), city: cityId, existingCount: existing.places.length }, candidates }, null, 2)); }
  finally { await fh.close(); }
} catch (e) {
  stop(`${cityId}：寫不進暫存檔 ${tmpRel}（${e.code || e.message}）${await cleanup()}`, '寫檔失敗');
}
try { await rename(tmpOut, stagingOut); } catch (e) {
  stop(`${cityId}：換不上 data/places/_staging/${cityId}.json（${e.code || e.message}）${await cleanup()}`, '寫檔失敗');
}
console.log(`done：data/places/_staging/${cityId}.json（候選 ${candidates.length} 個——各來源擷取尚未實作，所以目前是 0）`);
