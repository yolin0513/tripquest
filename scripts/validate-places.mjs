// 檢查 data/places/*.json 的完整性。CI / 手動編輯後跑；也在挑選器的底線裡，每版都跑。
// 用法：node scripts/validate-places.mjs
//
// 回傳值：0 通過；1 資料有錯；4 檢查器壞了（schema 讀不到、某個城市檔的對照組沒被抓到）。
// 守的三件事（2026-09-24 盤點實測過的洞）：
//   · 登記制：城市檔以 index.json 為準，兩個方向都查（index 指到的要在、在的要被指到）；0 個地點本身就是錯
//   · 欄位名稱以 schema.json 為準：沒登記的欄位名一律報（改名的欄位不能默默變成「沒有這個欄位」）
//   · 對照組：**每一個城市檔**拿它自己的第一個地點，對每一條規則各造一個壞樣本，丟進同一個檢查函式，
//     必須被那一條規則抓到——否則是檢查器壞了（原本拿掉 tag 那條檢查，錯誤 tag 照樣放行，沒有任何東西會紅）
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../data/places/', import.meta.url));
const TAGS = new Set(['sight', 'food', 'nightmarket', 'snack', 'checkin', 'culture', 'nature', 'shopping', 'view']);
let errs = 0;
const broken = [];
const err = (m) => { console.error('✗ ' + m); errs++; };
const ok = (m) => console.log('✓ ' + m);

// ---------- 欄位名稱的登記：schema.json ----------
const schema = JSON.parse(await readFile(DIR + 'schema.json', 'utf8'));
const FILE_KEYS = new Set(Object.keys(schema.properties || {}));
const META_KEYS = new Set(Object.keys(schema.properties?._meta?.properties || {}));
const PLACE_KEYS = new Set(Object.keys(schema.properties?.places?.items?.properties || {}));
if (!FILE_KEYS.size || !META_KEYS.size || !PLACE_KEYS.size) {
  console.log(`擋下：檢查器壞了（schema.json 讀不到欄位清單：檔 ${FILE_KEYS.size}、_meta ${META_KEYS.size}、地點 ${PLACE_KEYS.size}）`);
  process.exit(4);
}

// ---------- 一個地點的每一條規則（回傳 [{ rule, msg }]，對照組與正式檢查用同一個函式）----------
function placeErrors(file, p, ids) {
  const out = [];
  const e = (rule, msg) => out.push({ rule, msg: `${file}/${p.id}：${msg}` });
  if (!p.id || !/^[a-z0-9-]+$/.test(p.id)) out.push({ rule: 'id', msg: `${file}：id 不合法 "${p.id}"` });
  if (ids.has(p.id)) out.push({ rule: 'dupId', msg: `${file}：重複的 place id "${p.id}"` });
  for (const k of Object.keys(p)) if (!PLACE_KEYS.has(k)) e('unknownKey', `欄位名稱 "${k}" 不在 schema.json 裡（打錯或改名了？）`);
  if (!p.name) e('name', '缺 name');
  if (!Array.isArray(p.tags) || !p.tags.length) e('tags', '缺 tags');
  for (const tg of Array.isArray(p.tags) ? p.tags : []) if (!TAGS.has(tg)) e('tagUnknown', `未知 tag "${tg}"`);
  if (!p.src) e('src', '缺 src（hand/wikivoyage/osm）');
  if (p.src === 'hand' && !p.blurb) e('blurbHand', 'hand 資料應該有 blurb');
  if (p.blurb && p.blurb.length > 60) e('blurbLong', `blurb 太長（${p.blurb.length}）`);
  if ((p.lat != null) !== (p.lng != null)) e('latlngPair', 'lat/lng 要成對');
  if (p.lat != null && (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180)) e('latlngRange', '座標超出範圍');
  const hasQuests = Array.isArray(p.quests) && p.quests.length;
  if (!hasQuests && !p.questSeed && !(Array.isArray(p.tags) && p.tags.length)) e('noQuest', '無法產生任務（沒有 quests / questSeed / tags）');
  return out;
}

// 每一條規則的壞樣本：從一個真的地點改一處
const BAD = {
  id: (p) => ({ ...p, id: 'Bad ID!' }),
  dupId: (p) => ({ ...p }),                                  // ids 裡預先放進它自己的 id
  unknownKey: (p) => ({ ...p, zzUnlisted: 1 }),
  name: (p) => ({ ...p, name: '' }),
  tags: (p) => ({ ...p, tags: [] }),
  tagUnknown: (p) => ({ ...p, tags: ['zz-not-a-tag'] }),
  src: (p) => { const q = { ...p }; delete q.src; return q; },
  blurbHand: (p) => { const q = { ...p, src: 'hand' }; delete q.blurb; return q; },
  blurbLong: (p) => ({ ...p, blurb: '長'.repeat(61) }),
  latlngPair: (p) => { const q = { ...p, lat: 25 }; delete q.lng; return q; },
  latlngRange: (p) => ({ ...p, lat: 95, lng: 121 }),
  noQuest: (p) => { const q = { ...p, tags: [] }; delete q.quests; delete q.questSeed; return q; },
};
let controlsRun = 0;            // 實際跑過的對照組次數（印在總計那一行，不寫死）
function controlFor(file, sample) {
  for (const [rule, mk] of Object.entries(BAD)) {
    controlsRun++;
    const ids = new Set(rule === 'dupId' ? [sample.id] : []);
    const got = placeErrors(file, mk(sample), ids).some((x) => x.rule === rule);
    if (!got) broken.push(`對照組：${file} 的「${rule}」壞樣本沒被抓到`);
  }
}

// ---------- index.json：城市檔的登記 ----------
const index = JSON.parse(await readFile(DIR + 'index.json', 'utf8'));
const cityFiles = new Map();     // cityId -> file
for (const c of index.countries || []) {
  for (const r of c.regions || []) {
    for (const ci of r.cities || []) {
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
  for (const k of Object.keys(data)) if (!FILE_KEYS.has(k)) err(`${file}：檔案層級的欄位名稱 "${k}" 不在 schema.json 裡（打錯或改名了？）`);
  for (const k of Object.keys(data._meta || {})) if (!META_KEYS.has(k)) err(`${file}：_meta 的欄位名稱 "${k}" 不在 schema.json 裡`);
  if (data._meta?.schema !== 1) err(`${file}：_meta.schema 應為 1`);
  if (![...cityFiles.values()].includes(file)) err(`${file}：index.json 沒有指到這個檔`);
  // places 必須是非空陣列（實測：欄位改名，那個城市的 12 個地點默默消失、照樣通過）
  if (!Array.isArray(data.places) || !data.places.length) { err(`${file}：沒有 places（不是陣列或是空的）——這個城市的地點讀不到`); continue; }

  controlFor(file, data.places[0]);
  for (const p of data.places) {
    placeCount++;
    for (const x of placeErrors(file, p, allIds)) err(x.msg);
    allIds.add(p.id);
  }
  ok(`${file}：${data.places.length} 個地點`);
}

// 「0 個地點」本身就是紅的：讀到的東西是空的，不能當成「沒有錯誤」
if (!cityFiles.size) err('index.json 一個城市都沒有');
if (!placeCount) err('總共讀到 0 個地點——資料不見了或讀不到');
console.log(`\n總計 ${placeCount} 個地點（${files.length} 個城市檔、index 指到 ${cityFiles.size} 個），${errs} 個錯誤；`
  + `對照組實際跑了 ${controlsRun} 次（應為 ${files.length} 個城市檔 × ${Object.keys(BAD).length} 條規則）`);
// 對照組沒跑滿也是檢查器壞了（例如 places 是空的那個檔就沒有樣本可造——那種情況上面已經報錯）
if (controlsRun !== files.length * Object.keys(BAD).length && !errs) broken.push(`對照組只跑了 ${controlsRun} 次`);
if (broken.length) {
  for (const b of broken.slice(0, 10)) console.log('✗ ' + b);
  console.log(`擋下：檢查器壞了（${broken.length} 個對照組沒被抓到）`);
  process.exit(4);
}
process.exit(errs ? 1 : 0);
