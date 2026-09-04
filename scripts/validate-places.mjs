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

for (const file of files) {
  const data = JSON.parse(await readFile(DIR + file, 'utf8'));
  if (data._meta?.schema !== 1) err(`${file}：_meta.schema 應為 1`);
  if (![...cityFiles.values()].includes(file)) err(`${file}：index.json 沒有指到這個檔`);

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

console.log(`\n總計 ${placeCount} 個地點，${errs} 個錯誤`);
process.exit(errs ? 1 : 0);
