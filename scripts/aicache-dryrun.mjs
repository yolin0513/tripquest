// 乾跑：雲端快取的 AI 行程文案（aiText／tripText）裡，有幾天的句子是照「猜出來的類別」寫的（一次性工具，不進鏈）
//
// Yolin 2026-10-27 選 (a)：只清那幾天的句子——記錄與 sig 留著、payload 只拿掉那幾天的 dayLines／narration、不重產。
// 這支**只讀、只算、只印數字**，不寫任何東西（D1、檔案都不寫）。Dispatch 看過數字、放行之後，才另外寫入。
//
// 用法（輸出檔含真實行程與文案，只能放 .logs/，不進 repo）：
//   cd workers && npx wrangler d1 execute tripquest --remote --json \
//     --command "SELECT type, json FROM records WHERE type IN ('trip','spot','aiText')" > ../.logs/d1-aicache.json
//   node scripts/aicache-dryrun.mjs .logs/d1-aicache.json
// 不給檔案：只跑對照組（突變清單 tools/mutations/mut_aicachedry.json 用這個模式）。
// **只印數字與結構**，不印任何名字、景點名、句子內容、ID、日期。
//
// 判準（一天一天看）：
//   舊的 prompt 每天附 themeForSpot(那天第一站) 的類別名（b32b538 起到 ef11f53 拿掉，中間沒改過；
//   js/theme.js 的 themeForSpot 與 data/themes.json 在 PROMPT_V=2 之後也沒改過）。
//   猜的天 ＝ 那個類別不是「旅途」，而且跟「景點自己帶著的 theme」（storedThemeOf）不一樣。
//   三種不動、單獨數：
//   · 無法判定（sig）：記錄的 sig 跟現在的行程內容對不上——當時送的是哪些景點已經不知道
//   · 無法判定（欄位）：猜的類別不是從名字來的，而是從 primary／tags／inferredType——那些欄位產文案之後可能變過，
//     現在重算不一定等於當時送的（名字進 sig，sig 對得上就沒變）
//   · 行程已不在、同一趟有兩筆 tripText、payload 不是物件：都不動
//   寧可留著一句可能錯的，也不要刪掉一句本來是對的（Dispatch 2026-10-27）。
// 已知限制：v1.74 以前建立時就把猜的類別「存成」theme 的景點，storedThemeOf 會把它當成帶著的——那種天算成乾淨、不動（保守方向）。
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
const { digestFrom, tripTextSig } = await import('../js/aicontent.js');
await theme.loadThemes();

const alive = (r) => r && !r.deleted;
const isStr = (v) => typeof v === 'string' && v.trim() !== '';

// 一天的判定：'guessed'（清）／'field'（無法判定，欄位）／'clean'
export function judgeDay(list) {
  const oldK = theme.themeForSpot(list[0]);
  if (oldK === 'journey' || oldK === theme.storedThemeOf(list)) return 'clean';
  const byName = theme.themeForSpot({ name: list[0].name, nameLocal: list[0].nameLocal });
  return byName === oldK ? 'guessed' : 'field';
}

// 一筆 tripText 記錄的計畫。newPayload 只在 kind === 'change' 時有。
export function planFor(rec, trip, spots) {
  if (!trip || !alive(trip)) return { kind: 'tripGone' };
  const p = rec.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { kind: 'badPayload' };
  const d = digestFrom(trip, spots);
  if (!d.days.length || rec.sig !== tripTextSig(d)) return { kind: 'sigMismatch' };
  const byDay = new Map();
  for (const s of d.spots) {
    const k = s.day || 1;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const guessedDays = [], fieldDays = [];
  for (const x of d.days) {
    const j = judgeDay(byDay.get(x.day));
    if (j === 'guessed') guessedDays.push(String(x.day));
    else if (j === 'field') fieldDays.push(String(x.day));
  }
  const has = (m, k) => !!(m && typeof m === 'object' && isStr(m[k]));
  const sentences = guessedDays.reduce((n, k) => n + (has(p.dayLines, k) ? 1 : 0) + (has(p.narration, k) ? 1 : 0), 0);
  const fieldSentences = fieldDays.reduce((n, k) => n + (has(p.dayLines, k) ? 1 : 0) + (has(p.narration, k) ? 1 : 0), 0);
  const base = { days: d.days.length, guessedDays, fieldDays, sentences, fieldSentences };
  if (!sentences) return { kind: 'noChange', ...base };
  const drop = (m) => {
    if (!m || typeof m !== 'object') return m;
    const out = { ...m };
    for (const k of guessedDays) delete out[k];
    return out;
  };
  const newPayload = { ...p, dayLines: drop(p.dayLines), narration: drop(p.narration) };
  const tripLevel = ['subtitle', 'videoIntro', 'videoOutro'].filter((k) => isStr(p[k])).length;
  return { kind: 'change', ...base, tripLevel, newPayload };
}

export function dryRun(records) {
  const trips = new Map(records.filter((r) => r.type === 'trip').map((r) => [r.id, r]));
  const spotsOf = new Map();
  for (const s of records) {
    if (s.type !== 'spot' || !alive(s)) continue;
    if (!spotsOf.has(s.tripId)) spotsOf.set(s.tripId, []);
    spotsOf.get(s.tripId).push(s);
  }
  const tt = records.filter((r) => r.type === 'aiText' && r.key === 'tripText' && alive(r));
  const perTrip = new Map();
  for (const r of tt) perTrip.set(r.tripId, (perTrip.get(r.tripId) || 0) + 1);
  const out = {
    tripText: tt.length, change: 0, noChange: 0, sigMismatch: 0, tripGone: 0, badPayload: 0, dup: 0,
    days: 0, guessedDays: 0, sentences: 0, fieldDays: 0, fieldSentences: 0, tripLevelInChange: 0,
    tripsChanged: 0, groupsChanged: 0, plans: [],
  };
  const tripsChanged = new Set(), groupsChanged = new Set();
  for (const r of tt) {
    if (perTrip.get(r.tripId) > 1) { out.dup++; continue; }
    const pl = planFor(r, trips.get(r.tripId), spotsOf.get(r.tripId) || []);
    out[pl.kind]++;
    if (pl.kind === 'change' || pl.kind === 'noChange') {
      out.days += pl.days;
      out.fieldDays += pl.fieldDays.length;
      out.fieldSentences += pl.fieldSentences;
    }
    if (pl.kind === 'change') {
      out.guessedDays += pl.guessedDays.length;
      out.sentences += pl.sentences;
      if (pl.tripLevel) out.tripLevelInChange++;
      tripsChanged.add(r.tripId);
      groupsChanged.add(r.groupId);
      out.plans.push({ rec: r, ...pl });
    }
  }
  out.tripsChanged = tripsChanged.size;
  out.groupsChanged = groupsChanged.size;
  return out;
}

function rowsOf(raw) {
  const top = JSON.parse(raw);
  const res = (Array.isArray(top) ? top : [top]).flatMap((x) => x.results || []);
  return res.map((r) => ({ ...JSON.parse(r.json), type: r.type }));
}

// ---- 對照組：合成資料，答案事先寫好 ----
const trip = (id, extra = {}) => ({ type: 'trip', id, title: '合成' + id, ...extra });
const spot = (id, tripId, day, order, name, extra = {}) => ({ type: 'spot', id, tripId, day, order, name, ...extra });
const sigFor = (t, list) => tripTextSig(digestFrom(t, list));
const SYN_TRIPS = [trip('T1'), trip('T2'), trip('T3'), trip('T4'), trip('T5'), trip('T6'), trip('T7', { deleted: true }), trip('T8'), trip('T9')];
const SYN_SPOTS = [
  // T1 第 1 天：沒帶 theme、名字猜成 nature → 猜的天（名字來的）；第 2 天：名字猜不出（旅途）→ 乾淨
  spot('a', 'T1', 1, 0, '甲山'), spot('b', 'T1', 2, 0, '丁'),
  // T2：帶 nature、名字也猜成 nature → 猜的剛好對 → 乾淨（不准被選）
  spot('c', 'T2', 1, 0, '辛山', { theme: 'nature' }),
  // T3：同 T1 的形狀，但記錄的 sig 對不上 → 無法判定（sig）
  spot('d', 'T3', 1, 0, '甲山'),
  // T4：名字猜不出、tags 有 food → 舊 AI 送 food，跟帶著的（沒有）不一樣，但是從欄位來的 → 無法判定（欄位）
  spot('e', 'T4', 1, 0, '戊', { tags: ['food'] }),
  // T5：v1.74 以後沒對上策展庫的景點帶著中性的 journey；名字猜成 nature → 猜的天（線上最主要的形狀）
  spot('f', 'T5', 1, 0, '甲山', { theme: 'journey' }),
  // T6：第一站帶 food、名字猜成 nature → 舊 AI 送 nature → 猜的天；這筆 payload 沒有那天的句子 → 不動（noChange）
  spot('g', 'T6', 1, 0, '庚山', { theme: 'food' }),
  // T7：行程已刪 → 不動
  spot('h', 'T7', 1, 0, '甲山'),
  // T8：兩筆 tripText → 不動
  spot('i', 'T8', 1, 0, '甲山'),
  // T9：payload 不是物件 → 不動
  spot('j', 'T9', 1, 0, '甲山'),
];
const tOf = (id) => SYN_TRIPS.find((t) => t.id === id);
const sOf = (id) => SYN_SPOTS.filter((s) => s.tripId === id);
const PAY = () => ({ subtitle: '副標', dayLines: { 1: '一', 2: '二' }, videoIntro: '頭', videoOutro: '尾', narration: { 1: '甲', 2: '乙' } });
const aiRec = (id, tripId, extra = {}) => ({ type: 'aiText', id, tripId, groupId: 'G' + tripId, key: 'tripText', payload: PAY(), sig: sigFor(tOf(tripId), sOf(tripId)), aiAt: 1, ...extra });
const SYN = [
  ...SYN_TRIPS, ...SYN_SPOTS,
  aiRec('r1', 'T1'), aiRec('r2', 'T2'), aiRec('r3', 'T3', { sig: '0' }), aiRec('r4', 'T4'), aiRec('r5', 'T5'),
  aiRec('r6', 'T6', { payload: { subtitle: '副標', dayLines: {}, narration: {} } }), aiRec('r7', 'T7'),
  aiRec('r8a', 'T8'), aiRec('r8b', 'T8'), aiRec('r11', 'T9', { payload: '舊格式' }),
  aiRec('r9', 'T1', { key: 'spotBlurbs' }), aiRec('r10', 'T2', { deleted: true }),
];
const want = {
  tripText: 10, change: 2, noChange: 3, sigMismatch: 1, tripGone: 1, badPayload: 1, dup: 2,
  days: 6, guessedDays: 2, sentences: 4, fieldDays: 1, fieldSentences: 2, tripLevelInChange: 2, tripsChanged: 2, groupsChanged: 2,
};
const got = dryRun(SYN);
const bad = Object.keys(want).filter((k) => got[k] !== want[k]);
// 雙向：被選的正好是 r1、r5；r2（猜對的）、r3（sig）、r4（欄位）一個都不准被選
const picked = got.plans.map((p) => p.rec.id).sort().join(',');
if (picked !== 'r1,r5') bad.push(`被選的應是 r1,r5 實得 ${picked || '（無）'}`);
// 改寫後的 payload：只少了猜的那天的兩句；第 2 天、整趟的三個欄位原封不動；原記錄沒被動到
const p1 = got.plans.find((p) => p.rec.id === 'r1');
if (p1) {
  const np = p1.newPayload, op = p1.rec.payload;
  const ok = !('1' in np.dayLines) && !('1' in np.narration) && np.dayLines['2'] === '二' && np.narration['2'] === '乙'
    && np.subtitle === op.subtitle && np.videoIntro === op.videoIntro && np.videoOutro === op.videoOutro
    && op.dayLines['1'] === '一' && op.narration['1'] === '甲' && Object.keys(np).sort().join() === Object.keys(op).sort().join();
  if (!ok) bad.push('r1 改寫後的 payload 不是「只少第 1 天兩句」，或原記錄被動到');
}
if (bad.length) {
  console.log('✗ 對照組對不上，不跑真實資料：' + bad.map((k) => (k in want ? `${k} 應 ${want[k]} 實得 ${got[k]}` : k)).join('；'));
  process.exit(3);
}
console.log(`✓ 對照組（合成 9 趟、12 筆 aiText，答案事先寫好；被選 r1,r5，猜對的／sig 不符／欄位來的都沒被選）全對`);

const file = process.argv[2];
if (!file) { console.log('（沒給檔案：只跑了對照組）'); process.exit(0); }
let rows;
try { rows = rowsOf(fs.readFileSync(file, 'utf8')); } catch (e) { console.log('✗ 讀不到或解析不了：' + e.message); process.exit(2); }
if (!rows.length) { console.log('✗ 讀到 0 筆記錄——不當成「沒有問題」'); process.exit(2); }
const kinds = { trip: 0, spot: 0, aiText: 0 };
for (const r of rows) if (r.type in kinds) kinds[r.type]++;
console.log(`讀到 ${rows.length} 筆記錄（trip ${kinds.trip}、spot ${kinds.spot}、aiText ${kinds.aiText}）`);
if (!kinds.trip || !kinds.spot) { console.log('✗ trip 或 spot 是 0 筆——匯出的查詢不對，不下結論'); process.exit(2); }
const r = dryRun(rows);
const sum = r.change + r.noChange + r.sigMismatch + r.tripGone + r.badPayload + r.dup;
console.log(`還在的 tripText 記錄 ${r.tripText} 筆：會改 ${r.change}、不用改 ${r.noChange}、無法判定（sig 不符）${r.sigMismatch}、行程已不在 ${r.tripGone}、payload 不是物件 ${r.badPayload}、同一趟兩筆 ${r.dup}`);
// 每筆只會落進一類，所以相加必然等於總數——那不是檢查（§5.21），只印出來讓人對得上
console.log(`（相加 ${sum}／總數 ${r.tripText}：每筆只落一類，這行不是檢查）`);
console.log(`sig 對得上的記錄共 ${r.change + r.noChange} 筆、${r.days} 天`);
console.log(`會清：${r.guessedDays} 天、${r.sentences} 句（dayLines＋narration），分布在 ${r.tripsChanged} 趟、${r.groupsChanged} 個群組`);
console.log(`無法判定（欄位來的猜測，不動）：${r.fieldDays} 天、${r.fieldSentences} 句`);
console.log(`會改的 ${r.change} 筆裡，帶著整趟層級句子（副標／片頭／片尾）的 ${r.tripLevelInChange} 筆——這次不動，要不要清另外決定`);
console.log('（只讀、只算：沒有寫任何東西）');
