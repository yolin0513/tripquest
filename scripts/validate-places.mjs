// 檢查 data/places/*.json 的完整性。CI / 手動編輯後跑。
// 用法：node scripts/validate-places.mjs
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../data/places/', import.meta.url));
const TAGS = new Set(['sight', 'food', 'nightmarket', 'snack', 'checkin', 'culture', 'nature', 'shopping', 'view']);
let errs = 0;
const err = (m) => { console.error('✗ ' + m); errs++; };
const ok = (m) => console.log('✓ ' + m);

const index = JSON.parse(await readFile(DIR + 'index.json', 'utf8'));
const cityFiles = new Map();     // cityId -> file
for (const c of index.countries) {
  for (const r of c.regions) {
    for (const ci of r.cities) {
      if (cityFiles.has(ci.id)) err(`重複的 city id：${ci.id}`);
      cityFiles.set(ci.id, ci.file);
      if (!ci.file) err(`${ci.id} 沒有 file`);
      if (!ci.districts?.length) err(`${ci.id} 沒有 districts`);
    }
  }
}
ok(`index.json：${cityFiles.size} 個城市`);

const files = (await readdir(DIR)).filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'schema.json');
const allIds = new Set();
let placeCount = 0;

// 反方向也要查：index 指到的每一個城市檔都要在（2026-09-24 盤點實測：16 個城市檔全刪、只留 index，
// 原本印「總計 0 個地點，0 個錯誤」照樣通過——任務只對得上這份資料才出題，資料沒了卻說通過）
for (const [id, f] of cityFiles) if (f && !files.includes(f)) err(`${id}：index.json 指到的 ${f} 不存在`);

for (const file of files) {
  const data = JSON.parse(await readFile(DIR + file, 'utf8'));
  if (data._meta?.schema !== 1) err(`${file}：_meta.schema 應為 1`);
  if (![...cityFiles.values()].includes(file)) err(`${file}：index.json 沒有指到這個檔`);
  // places 必須是非空陣列（實測：欄位改名，那個城市的 12 個地點默默消失、照樣通過）
  if (!Array.isArray(data.places) || !data.places.length) err(`${file}：沒有 places（不是陣列或是空的）——這個城市的地點讀不到`);

  for (const p of data.places || []) {
    placeCount++;
    if (!p.id || !/^[a-z0-9-]+$/.test(p.id)) err(`${file}：id 不合法 "${p.id}"`);
    if (allIds.has(p.id)) err(`${file}：重複的 place id "${p.id}"`);
    allIds.add(p.id);
    if (!p.name) err(`${file}/${p.id}：缺 name`);
    if (!Array.isArray(p.tags) || !p.tags.length) err(`${file}/${p.id}：缺 tags`);
    for (const tg of p.tags || []) if (!TAGS.has(tg)) err(`${file}/${p.id}：未知 tag "${tg}"`);
    if (!p.src) err(`${file}/${p.id}：缺 src（hand/wikivoyage/osm）`);
    if (p.src === 'hand' && !p.blurb) err(`${file}/${p.id}：hand 資料應該有 blurb`);
    if (p.blurb && p.blurb.length > 60) err(`${file}/${p.id}：blurb 太長（${p.blurb.length}）`);
    if ((p.lat != null) !== (p.lng != null)) err(`${file}/${p.id}：lat/lng 要成對`);
    if (p.lat != null && (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180)) err(`${file}/${p.id}：座標超出範圍`);
    const hasQuests = Array.isArray(p.quests) && p.quests.length;
    if (!hasQuests && !p.questSeed && !p.tags?.length) err(`${file}/${p.id}：無法產生任務（沒有 quests / questSeed / tags）`);
  }
  ok(`${file}：${(data.places || []).length} 個地點`);
}

// 「0 個地點」本身就是紅的：讀到的東西是空的，不能當成「沒有錯誤」
if (!cityFiles.size) err('index.json 一個城市都沒有');
if (!placeCount) err('總共讀到 0 個地點——資料不見了或讀不到');
console.log(`\n總計 ${placeCount} 個地點（${files.length} 個城市檔、index 指到 ${cityFiles.size} 個），${errs} 個錯誤`);
process.exit(errs ? 1 : 0);
