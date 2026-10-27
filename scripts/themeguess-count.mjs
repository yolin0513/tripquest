// 量「主題章／AI 文案裡的主題是照名字猜的」佔多少（一次性工具，不進鏈；Dispatch 2026-10-27 要的第 1 步）
//
// 用法（輸出檔含真實行程，只能放 .logs/，不進 repo）：
//   cd workers && npx wrangler d1 execute tripquest --remote --json \
//     --command "SELECT type, json FROM records WHERE type IN ('trip','spot')" > ../.logs/d1-trip-spot.json
//   node scripts/themeguess-count.mjs .logs/d1-trip-spot.json
// **只印數字**（筆數與比例），不印任何名字、ID、日期——結果可以直接轉給 Yolin。
//
// 算的是「修正前的程式」在這份資料上會做什麼（用 js/theme.js 裡還留著的 themeForDay／themeForSpot）：
//   A 有幾天，至少一站沒帶 theme（主題章的多數決裡混進了猜測）
//   B 有幾天，舊的主題章跟「只看帶著的 theme」不一樣（猜測改變了印出來的字）；其中印成具體類別（不是「旅途」）的有幾天
//   C 有幾天，舊的 AI prompt 送了跟「只看帶著的 theme」不一樣的具體類別名。舊寫法只看第一站、照名字猜，
//     **第一站自己帶著 theme 也照樣猜**（2026-10-27 更正：第一版只算第一站沒帶 theme 的，漏了「帶著 food、名字猜成 nature」）
// 限制：只看得到同步到雲端的行程；只存在某支手機上、沒建群組的行程量不到。
// 跑之前先跑一組合成資料的對照組（答案事先寫好），對不上就停、不印真實資料的結果。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
globalThis.fetch = async (u) => {
  if (String(u) !== './data/themes.json') throw new Error('只供應 themes.json：' + u);
  const text = fs.readFileSync(path.join(ROOT, 'data/themes.json'), 'utf8');
  return { ok: true, json: async () => JSON.parse(text) };
};
const theme = await import('../js/theme.js');
await theme.loadThemes();

export function count(records) {
  const alive = (r) => r && !r.deleted;
  const trips = new Set(records.filter((r) => r.type === 'trip' && alive(r)).map((r) => r.id));
  const spots = records.filter((r) => r.type === 'spot' && alive(r) && trips.has(r.tripId));
  const byDay = new Map();
  for (const s of spots) {
    const k = s.tripId + '#' + (s.day || 1);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  let A = 0, B = 0, Bspecific = 0, C = 0;
  for (const list of byDay.values()) {
    list.sort((a, b) => (a.order || 0) - (b.order || 0));
    if (list.some((s) => !s.theme)) A++;
    const oldK = theme.themeForDay(list);
    const newK = theme.storedThemeOf(list);
    if (oldK !== newK) { B++; if (oldK !== 'journey') Bspecific++; }
    const oldAi = theme.themeForSpot(list[0]);
    if (oldAi !== 'journey' && oldAi !== newK) C++;
  }
  const tripsWithSpots = new Set(spots.map((s) => s.tripId)).size;
  return {
    trips: trips.size, tripsWithSpots, spots: spots.length,
    spotsNoTheme: spots.filter((s) => !s.theme).length,
    spotsShared: spots.filter((s) => s.source === 'shared').length,
    days: byDay.size, A, B, Bspecific, C,
  };
}

function rowsOf(raw) {
  const top = JSON.parse(raw);
  const res = (Array.isArray(top) ? top : [top]).flatMap((x) => x.results || []);
  return res.map((r) => ({ ...JSON.parse(r.json), type: r.type }));
}

// ---- 對照組：合成資料，答案事先寫好 ----
const SYN = [
  { type: 'trip', id: 'T1' }, { type: 'trip', id: 'T2' }, { type: 'trip', id: 'T3', deleted: true },
  // T1 第 1 天：都沒帶、名字會被猜成 nature → A、B（具體）、C 各 +1
  { type: 'spot', id: 'a', tripId: 'T1', day: 1, order: 0, name: '甲山', source: 'shared' },
  { type: 'spot', id: 'b', tripId: 'T1', day: 1, order: 1, name: '乙溪', source: 'shared' },
  // T1 第 2 天：都帶 food → 都不算
  { type: 'spot', id: 'c', tripId: 'T1', day: 2, order: 0, name: '丙店', theme: 'food', source: 'curated' },
  // T2 第 1 天：都沒帶、名字猜不出（journey）→ A +1、B +1（舊印「旅途」、新不印）但不算具體、C 不算
  { type: 'spot', id: 'd', tripId: 'T2', day: 1, order: 0, name: '丁', source: 'shared' },
  // T2 第 3 天：第一站帶 food、名字會被猜成 nature → 舊 AI 送了 nature → C +1（第一版漏算的形狀）；A、B 都不算
  { type: 'spot', id: 'g', tripId: 'T2', day: 3, order: 0, name: '庚山', theme: 'food', source: 'curated' },
  // T2 第 4 天：第一站帶 nature、名字也猜成 nature → 舊 AI 送的剛好是對的 → 都不算（反向）
  { type: 'spot', id: 'h', tripId: 'T2', day: 4, order: 0, name: '辛山', theme: 'nature', source: 'curated' },
  // 已刪的景點、已刪行程的景點 → 都不算
  { type: 'spot', id: 'e', tripId: 'T2', day: 2, order: 0, name: '戊山', deleted: true },
  { type: 'spot', id: 'f', tripId: 'T3', day: 1, order: 0, name: '己山' },
];
const want = { trips: 2, tripsWithSpots: 2, spots: 6, spotsNoTheme: 3, spotsShared: 3, days: 5, A: 2, B: 2, Bspecific: 1, C: 2 };
const got = count(SYN);
const bad = Object.keys(want).filter((k) => got[k] !== want[k]);
if (bad.length) {
  console.log('✗ 對照組對不上，不跑真實資料：' + bad.map((k) => `${k} 應 ${want[k]} 實得 ${got[k]}`).join('；'));
  process.exit(3);
}
console.log('✓ 對照組（合成 3 趟、8 站，答案事先寫好）全對');

const file = process.argv[2];
if (!file) { console.log('（沒給檔案：只跑了對照組）'); process.exit(0); }
let rows;
try { rows = rowsOf(fs.readFileSync(file, 'utf8')); } catch (e) { console.log('✗ 讀不到或解析不了：' + e.message); process.exit(2); }
if (!rows.length) { console.log('✗ 讀到 0 筆記錄——不當成「沒有問題」'); process.exit(2); }
const r = count(rows);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 + '%' : '—');
console.log(`讀到 ${rows.length} 筆記錄；還在的行程 ${r.trips} 趟（有景點的 ${r.tripsWithSpots} 趟）、景點 ${r.spots} 站、共 ${r.days} 天`);
console.log(`景點沒帶 theme：${r.spotsNoTheme}／${r.spots}（${pct(r.spotsNoTheme, r.spots)}）；其中從分享連結匯入的景點共 ${r.spotsShared} 站`);
console.log(`A 至少一站沒帶 theme 的天：${r.A}／${r.days}（${pct(r.A, r.days)}）`);
console.log(`B 舊主題章被猜測改變的天：${r.B}／${r.days}（${pct(r.B, r.days)}）；其中印成具體類別的 ${r.Bspecific} 天`);
console.log(`C 舊 AI prompt 送了猜出來的具體類別的天：${r.C}／${r.days}（${pct(r.C, r.days)}）`);
