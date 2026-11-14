// 行程海報（v1.88.0）的模型、版面、PDF、import 登記（npm run itinposterlayouttest；秒級、不開瀏覽器）
//
// 涵蓋：js/itinposter/model.js（放什麼）、js/itinposter/layout.js（放哪裡）、js/pdf.js（PDF 檔的結構）、
//       js/itinposter/*.js 與 js/views/itinposter.js 的 import（畫的那支不讀模型與類別；整條不接任何會上傳的模組）。
// 畫出來的樣子、canvas 真的字寬、從行程頁按進去、存檔，在瀏覽器那一支（scripts/itinpostertest.mjs）。
// 版面與 PDF 的檢查器放在 scripts/itinposterlib.mjs，兩支共用（同一個檢查器、兩種字寬）。
// 景點走真的景點庫、真的建立流程（generate.js 的 generateForTrip，跟匯入行程同一條）；名字、日期都是造的。
// 字寬在這裡是近似值（英數 0.58 個字、中文 1 個字）——這支驗的是「排版的算法」，真的字寬在瀏覽器那一支再驗一次。
//
// 對照組（先跑；任何一個沒過就停、不採信後面的結果）：每一個檢查器各餵一份一定要被抓到的樣本，和一份一定要放行的。
// A 模型（設計原則：猜出來的東西不准變成使用者看得到的字）
//   A0 前置：景點庫載得到；士林夜市的必吃有 5 項（比一站最多列的 3 項多，A1 才看得出有沒有截）；巷口麵店不在景點庫
//   A1 對得回景點庫的站：列景點庫人工整理的前 3 項，標在哪一站
//   A2 對不回的站（不在景點庫、分享匯入的同名景點）一項都不列，也不照名字猜
//   A3 名字被改過（現在的比對規則比不回同一筆）→ 不列
//   A4 建立時打的字比不回同一筆 → 不列
//   A5 景點庫沒載好 → 一項都沒有
//   A6 同一個地方第 3 天又去：第 3 天照樣列；A6b 整趟的清單只列一次、標第一次去的那天
//   A7 幾個地方：照名字數不重複的
//   A8 天氣只放旅程裡的日子（前一天、後一天的預報不放）
//   A9 天氣的字照預報寫（下雨、下雪跟天氣條同一個判斷），寫明哪天查的
//   A10 舊的預報（查不到新的）、不知道今天、沒有預報 → 整段不放
//   A11 幾天幾夜；A12 日期範圍（跨年第二段也寫年）；A13 交通（選過、而且前一站對得上才寫）；A14 時間（有填才寫）
//   （v1.89）A15 每天一隻吉祥物：預報下雪／下雨優先；不然看可信類別、對得上圖的那幾站多數決（平手取先出現的），
//             對不上的類別不算票；不在景點庫、名字改過、建立時打的字比不回、景點庫沒載好 → 打領結（不照名字猜）
//   （v1.89）A16 每一站的真資料：停留多久（有填才寫）、約幾點到（跟行程分頁同一條 etaChain：使用者填的時間不覆蓋、
//             鐵路公車那一段斷掉、上一站沒停留時間推不出來、沒有車程不推）、車程「約 N 分」（有才寫）
//   （v1.89）A17 每天一張那一隻的大小：A4 放得下的最大那一個（200～440）；站多放不下就停在 200、頁面往下長；
//             超過 A4 的頁面吉祥物一定是 200（放大過頭會讓頁面多出一截）
// B 版面：8 種行程 × 2 版型 × 2 張數＝32 組，每一條檢查都跑過全部 32 組
//   B0 每一組都排得出來；B1 張數與標籤；B2 寬固定、每天一張至少 A4；B3 字與框不出界；B4 框不疊框；B5 字不疊字；
//   B6 站名與時間在站牌框裡；B7 站數母體（畫出來的站＋「還有 N 站」＝那天的站數，而且是前幾站、照順序）；
//   B8 必吃母體；B9 天氣母體；B10 字的來源（只有模型裡的字與固定的幾個標題）；B11 沒有類別名、沒有類別 emoji；
//   （v1.89）B12 吉祥物不蓋到字；B13 每天一隻、種類照模型、扣在那一天的框上緣、沒有角落那一隻；B14 每天一張的站卡寫真資料；
//            B15 吉祥物夠大（全部一張至少 150、每天一張至少 200；下限寫在測試這邊，不讀版面的常數）
// C PDF：xref 每一個位置都正好指到那個物件、startxref、頁數、長度欄位與內容、頁面比例、空的會擋
// D import 登記（登記制＋孤兒檢查）；這幾支不直接打網路；畫的那支不碰模型與類別
// 突變見 tools/mutations/mut_v188.json、tools/mutations/mut_v189.json。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { texts, PAGE_CHECKS, pageListProblems, pdfProblems, layoutControls, pdfControls, fakeJpeg, PDF_IMGS } from './itinposterlib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// theme.js、generate.js 用 fetch 讀 data/；node 底下換成讀檔，只供應 data/ 底下的 .json，其餘照樣失敗
globalThis.fetch = async (u) => {
  const s = String(u);
  if (!/^\.\/data\/[\w/-]+\.json$/.test(s)) throw new Error('itinposterlayouttest 不供應：' + s);
  const text = fs.readFileSync(path.join(ROOT, s), 'utf8');
  return { ok: true, json: async () => JSON.parse(text) };
};
const theme = await import('../js/theme.js');
const gen = await import('../js/quests/generate.js');
const MD = await import('../js/itinposter/model.js');
const L = await import('../js/itinposter/layout.js');
const { pdfFromJpegs } = await import('../js/pdf.js');
const { LEG_ICON, LEG_LABEL } = await import('../js/legs.js');
const TH = await theme.loadThemes();
const LK = await gen.loadPlaceLookup().catch(() => null);

let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + String(extra).slice(0, 900) : '')); if (process.exitCode !== 4) process.exitCode = 1; }
};
// 被測的程式丟例外時不讓整支停：回傳 dflt，並記下來（印在相關斷言的說明裡）
const errs = [];
const tryDo = (label, fn, dflt) => { try { return fn(); } catch (e) { errs.push(`${label}：${e && e.message}`); return dflt; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const measure = (t, size, weight = 400) => [...String(t)].reduce((a, ch) => a + (ch.codePointAt(0) < 0x2e80 ? size * 0.58 : size), 0) * (weight >= 700 ? 1.03 : 1);
const LABELS = new Set(Object.values(TH.themes).map((t) => t.label));
const ICONS_LEG = Object.values(LEG_ICON).filter(Boolean);

// ---- 原始碼：import 登記、網路、畫的那支（只有這一支用，不放共用檔） ----
function codeOnly(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
}
function importsOf(text) {
  const code = codeOnly(text);
  const out = [...code.matchAll(/^\s*import\s+(?:[^;'"]*?\bfrom\s*)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  const dyn = [...code.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g)].map((m) => m[2]);
  const calls = [...code.matchAll(/\bimport\s*\(/g)].length;
  return { out: [...out, ...dyn], bad: calls !== dyn.length ? ['動態 import 不是字面字串'] : [] };
}
function auditImports(root, registry, dirs) {
  const problems = [];
  const listed = Object.keys(registry);
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, dir)).filter((x) => x.endsWith('.js')); } catch { problems.push(`讀不到資料夾：${dir}`); }
    for (const f of names) if (!listed.includes(`${dir}/${f}`)) problems.push(`沒登記的檔：${dir}/${f}`);
  }
  for (const rel of listed) {
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { problems.push(`讀不到：${rel}`); continue; }
    const { out, bad } = importsOf(text);
    bad.forEach((b) => problems.push(`${rel}：${b}`));
    for (const s of out) if (!registry[rel].includes(s)) problems.push(`沒登記的 import：${rel} → ${s}`);
    for (const s of registry[rel]) if (!out.includes(s)) problems.push(`登記過期：${rel} → ${s}`);
  }
  return problems;
}
const NET_RE = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/;
const DRAW_RE = /\b(themes?|model|must|foods|tips|stops|trustedTheme)\b/;
function lineHits(root, files, re) {
  const hits = [];
  for (const rel of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { hits.push(`讀不到：${rel}`); continue; }
    codeOnly(text).split('\n').forEach((line, i) => { const m = re.exec(line); if (m) hits.push(`${rel}:${i + 1} ${m[1]}`); });
  }
  return hits;
}

// ================= 對照組 =================
let ctlOk = true;
const ctl = (label, got, want) => {
  const good = same(got, want);
  yes(good, `對照組（${label}）`, `實得 ${JSON.stringify(got)}，應為 ${JSON.stringify(want)}`);
  ctlOk = ctlOk && good;
};
// 版面檢查器（共用檔）：近似字寬
layoutControls(ctl, { measure, foodEmoji: TH.themes.food.emoji, foodLabel: TH.themes.food.label, legText: `${LEG_ICON.car} ${LEG_LABEL.car}`, icons: ICONS_LEG, labels: LABELS });
// PDF 檢查器（共用檔）：「好的」用共用檔另外寫的參考產生器，不用被測的 pdfFromJpegs
pdfControls(ctl);
// 原始碼掃描：在 .logs/ 底下造真的 .js 檔，走同一個讀檔與掃描
const CTL = path.join(ROOT, '.logs', 'itinposter-ctl');
const mk = (files) => {
  fs.rmSync(CTL, { recursive: true, force: true });
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(CTL, f)), { recursive: true });
    fs.writeFileSync(path.join(CTL, f), body);
    if (fs.readFileSync(path.join(CTL, f), 'utf8') !== body) throw new Error('對照樣本寫進去讀回來不一樣：' + f);
  }
};
const A_ = 'js/itinposter/a.js';
mk({ [A_]: "import { x } from '../sync.js';\n" });
ctl('沒登記的 import', auditImports(CTL, { [A_]: [] }, ['js/itinposter']), [`沒登記的 import：${A_} → ../sync.js`]);
mk({ [A_]: "import {\n  a,\n  b,\n} from './m.js';\n" });
ctl('跨行的 import', auditImports(CTL, { [A_]: [] }, ['js/itinposter']), [`沒登記的 import：${A_} → ./m.js`]);
mk({ [A_]: "const m = await import('../api.js');\n" });
ctl('動態 import（字面字串）', auditImports(CTL, { [A_]: [] }, ['js/itinposter']), [`沒登記的 import：${A_} → ../api.js`]);
mk({ [A_]: 'const m = await import(name);\n' });
ctl('動態 import（不是字面字串）', auditImports(CTL, { [A_]: [] }, ['js/itinposter']), [`${A_}：動態 import 不是字面字串`]);
mk({ [A_]: 'export const k = 1;\n' });
ctl('登記過期', auditImports(CTL, { [A_]: ['../x.js'] }, ['js/itinposter']), [`登記過期：${A_} → ../x.js`]);
mk({ [A_]: 'export const k = 1;\n', 'js/itinposter/b.js': 'export const j = 2;\n' });
ctl('沒登記的檔', auditImports(CTL, { [A_]: [] }, ['js/itinposter']), ['沒登記的檔：js/itinposter/b.js']);
mk({ [A_]: "// import { y } from '../z.js';\n/* import { w } from '../w.js'; */\nexport const k = 1;\n" });
ctl('註解裡的 import 不算', auditImports(CTL, { [A_]: [] }, ['js/itinposter']), []);
mk({ [A_]: 'navigator.sendBeacon(u, b);\nawait fetch(u);\n// fetch(u)\n' });
ctl('打網路', lineHits(CTL, [A_], NET_RE), [`${A_}:1 sendBeacon`, `${A_}:2 fetch`]);
mk({ [A_]: 'const k = page.theme;\n// model.must\n' });
ctl('畫的那支碰到類別', lineHits(CTL, [A_], DRAW_RE), [`${A_}:1 theme`]);
fs.rmSync(CTL, { recursive: true, force: true });

if (!ctlOk) {
  console.log('✗ 對照組沒過——檢查器壞了，不採信下面的結果');
  process.exitCode = 4;
  console.log(`\n${pass} 項通過，對照組沒過`);
  process.exit();
}

// ================= A 模型 =================
const REGION = '台北';
async function spotsFor(days) {
  const items = days.flatMap((names, di) => names.map((name) => ({ name, day: di + 1, region: REGION })));
  const { spots } = await gen.generateForTrip({ tripId: 't-syn', region: REGION, items });
  spots.forEach((s, i) => { s.createdAt = i; });
  return spots;
}
const byName = (spots, name, day) => spots.find((s) => s.name === name && (day == null || s.day === day));
const TRIP = { title: '合成的台北行', startDate: '2026-05-10', endDate: '2026-05-12', groupId: 'g' };
const FC = {
  stale: false,
  days: [
    { date: '2026-05-09', code: 1, tmax: 26, tmin: 19, rainProb: 10, rainMm: 0, snowCm: 0 },
    { date: '2026-05-10', code: 1, tmax: 25, tmin: 18, rainProb: 10, rainMm: 0, snowCm: 0 },
    { date: '2026-05-11', code: 63, tmax: 24, tmin: 19, rainProb: 80, rainMm: 12, snowCm: 0 },
    { date: '2026-05-12', code: 3, tmax: 2, tmin: -3, rainProb: 10, rainMm: 0, snowCm: 3 },
    { date: '2026-05-13', code: 1, tmax: 27, tmin: 20, rainProb: 0, rainMm: 0, snowCm: 0 },
  ],
};
const SP = await spotsFor([['士林夜市', '巷口麵店', '饒河街觀光夜市'], ['九份老街'], ['士林夜市']]);
const shilin = byName(SP, '士林夜市', 1), alley = byName(SP, '巷口麵店', 1), raohe = SP.find((s) => s.day === 1 && s.placeId === 'taipei-raohe-nm');
if (alley) alley.startMin = 570;
if (alley && shilin) { alley.legFrom = shilin.id; alley.legMode = 'car'; }
if (raohe && alley) { raohe.legFrom = alley.id; raohe.legMode = 'walk'; }
const model = (over = {}) => tryDo('posterModel', () => MD.posterModel({ trip: TRIP, spots: SP, members: [{}, {}, {}], lookup: LK, forecast: FC, today: '2026-05-08', ...over }), null);
const M0 = model();
const day = (m, k) => (m && m.days.find((d) => d.day === k)) || { stops: [], foods: [], placeCount: -1 };
const shilinPlace = LK && LK.placeById('taipei-shilin-nm'), raohePlace = LK && LK.placeById('taipei-raohe-nm');
const must3 = (p, at, d) => (p ? p.must.slice(0, MD.MUST_PER_SPOT).map((name) => ({ day: d, name, at })) : []);

yes(!!LK && !!shilinPlace && shilinPlace.must.length > MD.MUST_PER_SPOT && !!raohePlace && MD.MUST_PER_SPOT === 3
  && !!shilin && shilin.source === 'curated' && shilin.placeId === 'taipei-shilin-nm' && !!raohe && !!alley && alley.source !== 'curated' && !!M0,
  `A0 前置：景點庫載得到；士林夜市必吃 ${shilinPlace && shilinPlace.must.length} 項＞一站最多 ${MD.MUST_PER_SPOT} 項；士林夜市、饒河街對上景點庫；巷口麵店沒對上（${alley && alley.source}）`, errs.join('；'));
const wantD1 = [...must3(shilinPlace, '士林夜市', 1), ...must3(raohePlace, raohe && raohe.name, 1)];
yes(same(day(M0, 1).foods, wantD1), `A1 對得回景點庫的站：列景點庫的前 ${MD.MUST_PER_SPOT} 項、標在哪一站（第 1 天 ${day(M0, 1).foods.length} 項）`, JSON.stringify(day(M0, 1).foods));
const SHARED = { id: 'sh1', name: '士林夜市', region: REGION, day: 4, source: 'shared', createdAt: 99 };
const M2 = model({ spots: [...SP, SHARED], trip: { ...TRIP, endDate: '2026-05-13' } });
yes(!day(M0, 1).foods.some((f) => f.at === '巷口麵店') && same(day(M2, 4).foods, []) && day(M2, 4).stops.length === 1,
  'A2 對不回的站一項都不列（巷口麵店；分享匯入的同名「士林夜市」也不照名字補）', JSON.stringify(day(M2, 4)));
const renamed = { ...shilin, id: 'rn', name: '阿嬤家巷口', day: 4 };
const why3 = theme.trustedTheme(renamed, LK).reason;
const M3 = model({ spots: [...SP, renamed], trip: { ...TRIP, endDate: '2026-05-13' } });
yes(why3 === 'recheck-mismatch' && same(day(M3, 4).foods, []), `A3 名字被改過（比不回同一筆：${why3}）→ 不列`, JSON.stringify(day(M3, 4).foods));
const reinput = { ...shilin, id: 'ri', day: 4, matchInput: '阿嬤家巷口' };
const why4 = theme.trustedTheme(reinput, LK).reason;
const M4 = model({ spots: [...SP, reinput], trip: { ...TRIP, endDate: '2026-05-13' } });
yes(why4 === 'input-mismatch' && same(day(M4, 4).foods, []), `A4 建立時打的字比不回同一筆（${why4}）→ 不列`, JSON.stringify(day(M4, 4).foods));
const M5 = model({ lookup: null });
yes(!!M5 && M0 && M0.foods.length > 0 && M5.foods.length === 0 && M5.days.every((d) => d.foods.length === 0),
  `A5 景點庫沒載好 → 一項都沒有（載好時 ${M0 && M0.foods.length} 項）`);
const wantD3 = must3(shilinPlace, '士林夜市', 3);
const foodNames0 = M0 ? M0.foods.map((f) => f.name) : [];
yes(same(day(M0, 3).foods, wantD3), `A6 第 3 天又去士林夜市：第 3 天那一天照列（${day(M0, 3).foods.length} 項）`, JSON.stringify(day(M0, 3).foods));
yes(M0 && new Set(foodNames0).size === foodNames0.length && M0.foods.length === 9
  && M0.foods.filter((f) => shilinPlace.must.includes(f.name)).length === 3 && M0.foods.filter((f) => shilinPlace.must.includes(f.name)).every((f) => f.day === 1),
  `A6b 整趟的必吃清單同一項只列一次、標第一次去的那天（${M0 && M0.foods.length} 項）`, JSON.stringify(M0 && M0.foods));
yes(M0 && M0.placeCount === 4 && day(M0, 1).placeCount === 3 && day(M0, 3).placeCount === 1,
  `A7 幾個地方照名字數不重複的（整趟 ${M0 && M0.placeCount}、第 1 天 ${day(M0, 1).placeCount}、第 3 天 ${day(M0, 3).placeCount}）`);
yes(M0 && same(M0.tips.map((t) => [t.day, t.date]), [[1, '5/10'], [2, '5/11'], [3, '5/12']]),
  `A8 天氣只放旅程裡的日子（預報 5 天，前一天、後一天不放；實得 ${M0 && M0.tips.map((t) => t.date).join('、')}）`);
const tp = (k) => (M0 && M0.tips.find((t) => t.day === k)) || {};
yes(tp(1).text === '18～25°C' && tp(1).warn === false && tp(2).text === '19～24°C，可能下雨（降雨機率 80%）' && tp(2).warn === true
  && tp(3).text === '-3～2°C，可能下雪（預估積雪 3 公分）' && tp(3).warn === true && M0.tipsAsOf === '5/8',
  `A9 天氣的字照預報寫、寫明哪天查的（${[1, 2, 3].map((k) => tp(k).text).join('｜')}；${M0 && M0.tipsAsOf} 查）`);
const M10a = model({ forecast: { ...FC, stale: true } }), M10b = model({ today: '' }), M10c = model({ forecast: null });
yes([M10a, M10b, M10c].every((m) => m && m.tips.length === 0 && m.tipsAsOf === ''), 'A10 舊的預報、不知道今天、沒有預報 → 小提醒整段不放');
const sp = (t, k) => tryDo('spanOf', () => MD.spanOf(t, k), 'x');
yes(same(sp(TRIP, 9), { days: 3, nights: 2, label: '3天2夜' }) && same(sp({}, 4), { days: 4, nights: 3, label: '4天3夜' })
  && same(sp({ startDate: '2026-05-10', endDate: '2026-05-10' }, 2), { days: 1, nights: 0, label: '一日遊' })
  && same(sp({ startDate: '2026-05-10', endDate: '2026-05-09' }, 2), { days: 2, nights: 1, label: '2天1夜' }) && sp({}, 0) === null,
  'A11 幾天幾夜：日期都有照日期；沒有照排到第幾天；一天寫一日遊；結束日在出發日前面不採用');
const dr = (a, b) => tryDo('dateRangeLabel', () => MD.dateRangeLabel(a, b), 'x');
yes(dr('2026-05-10', '2026-05-12') === '2026/5/10（週日） – 5/12（週二）' && dr('2026-12-30', '2027-01-02') === '2026/12/30（週三） – 2027/1/2（週六）'
  && dr('', '2026-05-12') === '' && dr('2026-05-10', '') === '2026/5/10（週日）',
  `A12 日期範圍（跨年第二段也寫年；沒有出發日不寫）：${dr('2026-12-30', '2027-01-02')}`);
const legs = day(M0, 1).stops.map((s) => s.leg);
const M13 = model({ spots: SP.map((s) => (s === raohe ? { ...s, legFrom: 'not-the-previous-stop' } : s)) });
yes(same(legs, [null, { mode: 'car', icon: LEG_ICON.car, label: LEG_LABEL.car, dur: '' }, { mode: 'walk', icon: LEG_ICON.walk, label: LEG_LABEL.walk, dur: '' }])
  && day(M13, 1).stops[2] && day(M13, 1).stops[2].leg === null,
  'A13 交通：選過、而且前一站對得上才寫（前一站換掉了 → 不寫）', JSON.stringify(legs));
yes(same(day(M0, 1).stops.map((s) => s.time), ['', '09:30', '']), `A14 時間有填才寫（${day(M0, 1).stops.map((s) => s.time || '—').join('、')}）`);

// A15 吉祥物（期望寫死成圖名，不從 THEME_PEEK 算：那張表本身也在被驗的範圍裡）
const peeksOf = (m) => (m ? m.days.map((d) => d.peek) : []);
yes(same(peeksOf(M0), ['grill', 'rain', 'snow']), `A15a 預報下雨／下雪優先；第 1 天兩個夜市（巷口麵店不在景點庫、不算票）→ 烤串（實得 ${peeksOf(M0).join('、')}）`);
yes(same(peeksOf(M10c), ['grill', 'cam', 'grill']), `A15b 沒有預報 → 照可信類別（九份老街是打卡 → 相機）（實得 ${peeksOf(M10c).join('、')}）`);
yes(same(peeksOf(M5), ['done', 'rain', 'snow']), `A15c 景點庫沒載好 → 類別一個都拿不到、打領結；天氣照樣（實得 ${peeksOf(M5).join('、')}）`);
yes(day(M2, 4).peek === 'done' && day(M3, 4).peek === 'done' && day(M4, 4).peek === 'done' && day(M2, 4).stops.length === 1,
  `A15d 分享匯入的同名景點、名字改過、建立時打的字比不回 → 打領結，不照名字猜（${day(M2, 4).peek}、${day(M3, 4).peek}、${day(M4, 4).peek}）`);
const SP15 = await spotsFor([['永康街', '士林夜市', '寧夏夜市'], ['永康街', '士林夜市'], ['龍山寺', '永康街'], ['龍山寺'], ['台北101']]);
const M15 = model({ spots: SP15, forecast: null, trip: { ...TRIP, endDate: '2026-05-14' } });
const keys15 = SP15.map((s) => `${s.name}=${theme.trustedTheme(s, LK).key}`).join('、');
yes(same(peeksOf(M15), ['grill', 'eat', 'eat', 'done', 'done']) && /永康街=food/.test(keys15) && /龍山寺=heritage/.test(keys15),
  `A15e 多數決（美食 1 票、夜市 2 票 → 烤串）、平手取先出現的（美食、夜市 → 吃麵）、對不上圖的類別不算票（古蹟、美食 → 吃麵）、只有對不上的 → 打領結（實得 ${peeksOf(M15).join('、')}；${keys15}）`);

// A16 每一站的真資料（合成的站，不走景點庫：只驗時間、停留、車程的規則）
const R16 = [
  { id: 'r1', name: '甲站', day: 1, startMin: 600, stayMin: 120 },
  { id: 'r2', name: '乙站', day: 1, stayMin: 90, legFrom: 'r1', legMode: 'car' },
  { id: 'r3', name: '丙站', day: 1, startMin: 900, legFrom: 'r2', legMode: 'walk' },
  { id: 'r4', name: '丁站', day: 1, stayMin: 60, legFrom: 'r3', legMode: 'train' },
  { id: 'r5', name: '戊站', day: 1, legFrom: 'r4', legMode: 'car' },
  { id: 'r6', name: '己站', day: 1, startMin: 1080, legFrom: 'r5', legMode: 'car' },
  { id: 'r7', name: '庚站', day: 1, legFrom: 'r6', legMode: 'car' },
  { id: 'q1', name: '子站', day: 2, startMin: 540, stayMin: 60 },
  { id: 'q2', name: '丑站', day: 2, stayMin: 30, legFrom: 'q1', legMode: 'car' },
  { id: 'q3', name: '寅站', day: 2, legFrom: 'q2', legMode: 'walk' },
];
const LT16 = new Map([['r1>r2', [25, '約 25 分']], ['r2>r3', [10, '約 10 分']], ['r4>r5', [15, '約 15 分']], ['r5>r6', [20, '約 20 分']], ['r6>r7', [30, '約 30 分']],
  ['q1>q2', [30, '約 30 分']], ['q2>q3', [12, '約 12 分']]].map(([k, [min, text]]) => [k, { min, text }]));
const T16 = { title: '合成', startDate: '', endDate: '', groupId: 'g' };
const M16 = tryDo('posterModel A16', () => MD.posterModel({ trip: T16, spots: R16, legTimes: LT16 }), null);
const M16n = tryDo('posterModel A16 沒有車程', () => MD.posterModel({ trip: T16, spots: R16 }), null);
const col16 = (m, k, f) => day(m, k).stops.map(f);
yes(same(col16(M16, 1, (s) => s.stay), ['停留 2 小時', '停留 1 小時 30 分', '', '停留 1 小時', '', '', '']),
  `A16a 停留多久：有填才寫（${col16(M16, 1, (s) => s.stay || '—').join('、')}）`);
yes(same(col16(M16, 1, (s) => s.eta), ['', '約 12:25 到', '', '', '', '', '']) && same(col16(M16, 1, (s) => s.time), ['10:00', '', '15:00', '', '', '18:00', ''])
  && same(col16(M16, 2, (s) => s.eta), ['', '約 10:30 到', '約 11:12 到']),
  `A16b 約幾點到：10:00 到＋停 2 小時＋車程 25 分 → 約 12:25；連推兩站；自己填了時間的不覆蓋；鐵路那一段、上一站斷了、上一站沒停留都不推（第 1 天 ${col16(M16, 1, (s) => s.eta || s.time || '—').join('、')}；第 2 天 ${col16(M16, 2, (s) => s.eta || s.time || '—').join('、')}）`);
yes(same(col16(M16, 1, (s) => (s.leg ? s.leg.dur : null)), [null, '約 25 分', '約 10 分', '', '約 15 分', '約 20 分', '約 30 分']),
  `A16c 車程：有算出來的那一段才寫（鐵路那一段沒有）（${col16(M16, 1, (s) => (s.leg ? s.leg.dur || '—' : '×')).join('、')}）`);
yes(!!M16n && M16n.days.every((d) => d.stops.every((s) => s.eta === '' && (!s.leg || s.leg.dur === ''))) && same(col16(M16n, 1, (s) => s.time), ['10:00', '', '15:00', '', '', '18:00', '']),
  'A16d 沒有車程（快取裡沒有）→ 約幾點到、車程一個都不寫；使用者填的時間照寫');

// ================= B 版面 =================
const POOL = ['士林夜市', '饒河街觀光夜市', '寧夏夜市', '永康街', '九份老街', '淡水老街', '大稻埕', '龍山寺', '台北101', '西門町', '象山步道', '北投溫泉博物館'];
const isoPlus = (iso, k) => new Date(Date.parse(iso + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10);
const fcFor = (start, n) => ({ stale: false, days: Array.from({ length: n }, (_, i) => ({ date: isoPlus(start, i), code: i % 3 ? 63 : 1, tmax: 25 + i, tmin: 18, rainProb: i % 3 ? 70 : 10, rainMm: i % 3 ? 8 : 0, snowCm: 0 })) });
async function scenario({ label, title = '合成行程', startDate = '', days, people = 3, forecast = null, times = true }) {
  const spots = await spotsFor(days);
  if (times) spots.forEach((s, i) => { if (i % 3 === 1) s.startMin = 540 + (i % 20) * 30; });
  // 每天第二站：搭車（前一站對得上）
  const nd = days.length;
  for (let k = 1; k <= nd; k++) { const ds = spots.filter((s) => s.day === k); if (ds[1]) { ds[1].legFrom = ds[0].id; ds[1].legMode = k % 2 ? 'car' : 'other'; } }
  const trip = { title, startDate, endDate: startDate ? isoPlus(startDate, nd - 1) : '', groupId: 'g' };
  const m = tryDo(`${label} posterModel`, () => MD.posterModel({ trip, spots, members: Array.from({ length: people }, () => ({})), lookup: LK, forecast, today: startDate ? isoPlus(startDate, -2) : '' }), null);
  return { label, m };
}
const LONG = '很長很長的景點名字'.repeat(5);
const SCEN = [
  await scenario({ label: '一天一站、沒日期', days: [['巷口麵店']], people: 0, times: false }),
  { label: '三天（必吃、時間、交通、天氣）', m: M0 },
  await scenario({ label: '十天', startDate: '2026-05-10', days: Array.from({ length: 10 }, (_, d) => [0, 1, 2].map((i) => POOL[(d * 3 + i) % POOL.length])), forecast: fcFor('2026-05-10', 3) }),
  await scenario({ label: '一天 15 站', startDate: '2026-05-10', days: [Array.from({ length: 15 }, (_, i) => `第${i + 1}站`)] }),
  await scenario({ label: '名字很長', title: '標題'.repeat(30), startDate: '2026-05-10', days: [[LONG, '士林夜市', LONG + '二'], [LONG + '三']] }),
  await scenario({ label: '必吃與天氣超過上限', startDate: '2026-05-10', days: Array.from({ length: 8 }, (_, d) => [POOL[(d * 2) % 7], POOL[(d * 2 + 1) % 7]]), forecast: fcFor('2026-05-10', 8) }),
  await realScenario(),
  // v1.89 每天一張：吉祥物照 A4 放得下的最大那一個——八站、沒有必吃的這一天落在下限與上限之間（A17b）
  await scenario({ label: '一天 8 站、沒有必吃', startDate: '2026-05-10', days: [Array.from({ length: 8 }, (_, i) => `乙${i + 1}站`)] }),
];
// v1.89 真資料：時間、停留、約幾點到、車程都有的一天（四站），和站少的一天（一站）；第 2 天下雨
async function realScenario() {
  const spots = await spotsFor([['士林夜市', '永康街', '寧夏夜市', '九份老街'], ['龍山寺']]);
  const d1 = spots.filter((s) => s.day === 1);
  d1[0].startMin = 600; d1[0].stayMin = 120;
  d1[1].legFrom = d1[0].id; d1[1].legMode = 'car'; d1[1].stayMin = 90;
  d1[2].legFrom = d1[1].id; d1[2].legMode = 'walk';
  d1[3].legFrom = d1[2].id; d1[3].legMode = 'train';
  const legTimes = new Map([[`${d1[0].id}>${d1[1].id}`, { min: 25, text: '約 25 分' }], [`${d1[1].id}>${d1[2].id}`, { min: 10, text: '約 10 分' }]]);
  const trip = { title: '合成的真資料', startDate: '2026-05-10', endDate: '2026-05-11', groupId: 'g' };
  const m = tryDo('真資料 posterModel', () => MD.posterModel({ trip, spots, members: [{}], lookup: LK, forecast: fcFor('2026-05-10', 2), today: '2026-05-08', legTimes }), null);
  return { label: '真資料（時間、約幾點到、停留、車程）＋站少的一天', m };
}
const COMBOS = [['route', 'one'], ['route', 'day'], ['band', 'one'], ['band', 'day']];
const SETS = [];
for (const s of SCEN) for (const [kind, split] of COMBOS) {
  const pages = s.m ? tryDo(`${s.label} ${kind}/${split}`, () => L.posterPages(s.m, { kind, split }, measure), []) : [];
  SETS.push({ tag: `${s.label}｜${kind}/${split}`, m: s.m, kind, split, pages });
}
const sixM = SCEN[5].m, realM = SCEN[6].m;
const realStops = realM ? realM.days.flatMap((d) => d.stops) : [];
const peekKinds = new Set(SCEN.flatMap((s) => (s.m ? s.m.days.map((d) => d.peek) : [])));
yes(SETS.length === 32 && SETS.every((x) => x.m && x.pages.length > 0) && errs.length === 0
  && sixM && sixM.foods.length > L.FOOD_MAX && sixM.tips.length > L.TIP_MAX && SCEN[3].m && SCEN[3].m.days[0].stops.length > L.BAND_STOPS
  && realStops.some((s) => s.eta) && realStops.some((s) => s.stay) && realStops.some((s) => s.leg && s.leg.dur) && realStops.some((s) => s.time)
  && realM.days.some((d) => d.stops.length === 1) && peekKinds.size >= 4,
  `B0 ${SETS.length} 組都排得出來；情境成立：必吃 ${sixM && sixM.foods.length} 項＞${L.FOOD_MAX}、天氣 ${sixM && sixM.tips.length} 天＞${L.TIP_MAX}、一天 ${SCEN[3].m && SCEN[3].m.days[0].stops.length} 站＞${L.BAND_STOPS}；`
  + `真資料那一趟有約幾點到 ${realStops.filter((s) => s.eta).length}、停留 ${realStops.filter((s) => s.stay).length}、車程 ${realStops.filter((s) => s.leg && s.leg.dur).length}、時間 ${realStops.filter((s) => s.time).length} 站、站少的一天；吉祥物 ${peekKinds.size} 種（${[...peekKinds].join('、')}）`, errs.join('；'));
// A17 每天一張那一隻的大小（fitPeek）：取 A4 放得下的最大那一個，200～440。15 站的那天縮到下限 200 就不再縮、頁面往下長；
// 八站、沒有必吃的那天落在中間、整頁剛好 A4；一站的那天放大過 280；每一張每天一張的頁面：超過 A4 的，吉祥物一定是下限
// （頁面已經超過 A4 還留著大吉祥物＝放大過頭）。從真的排版入口（posterPages）量吉祥物外框的高
const dayPages = (s, kind) => (SETS.find((x) => x.tag === `${s.label}｜${kind}/day`) || { pages: [] }).pages;
const riseOf = (pg) => { const b = pg && pg.boxes.find((x) => x.kind === 'peek'); return b ? Math.round(b.h * 10) / 10 : NaN; };
const r15 = ['route', 'band'].map((k) => dayPages(SCEN[3], k)[0]);
const r8 = ['route', 'band'].map((k) => dayPages(SCEN[7], k)[0]);
const r1 = ['route', 'band'].map((k) => dayPages(SCEN[6], k)[1]);
yes(r15.every((pg) => pg && Math.abs(riseOf(pg) - 200) < 0.6 && pg.h > L.A4H),
  `A17a 15 站的那天：吉祥物縮到下限 200 就停、頁面往下長（路線圖 ${riseOf(r15[0])} 高、頁高 ${r15[0] && r15[0].h}；色帶 ${riseOf(r15[1])} 高、頁高 ${r15[1] && r15[1].h}）`);
yes(r8.every((pg) => pg && pg.h === L.A4H && riseOf(pg) > 200.6 && riseOf(pg) < 400),
  `A17b 八站、沒有必吃的那天：吉祥物在下限與上限之間、整頁剛好 A4（路線圖 ${riseOf(r8[0])} 高、頁高 ${r8[0] && r8[0].h}；色帶 ${riseOf(r8[1])} 高、頁高 ${r8[1] && r8[1].h}）`);
yes(r1.every((pg) => pg && riseOf(pg) > 280),
  `A17c 一站的那天：頁面有空就把吉祥物放大過 280（路線圖 ${riseOf(r1[0])}、色帶 ${riseOf(r1[1])}）`);
const dayAll = SETS.filter((x) => x.split === 'day').flatMap((x) => x.pages.map((pg, i) => ({ tag: `${x.tag} 第 ${i + 1} 張`, pg })));
const over = dayAll.filter((p) => p.pg.h > L.A4H);
const bigOver = over.filter((p) => riseOf(p.pg) > 200.6).map((p) => `${p.tag}：頁高 ${p.pg.h}、吉祥物 ${riseOf(p.pg)}`);
yes(over.length > 0 && bigOver.length === 0,
  `A17d 每天一張超過 A4 的頁面，吉祥物都是下限 200（每天一張 ${dayAll.length} 張、超過 A4 的 ${over.length} 張）`, bigOver.slice(0, 6).join('\n   '));
// 每一條檢查：跑全部組、每一張；說明裡印出查了幾組、幾張、幾個字
const allPages = SETS.flatMap((x) => x.pages.map((pg, i) => ({ x, pg, i })));
const nText = allPages.reduce((a, p) => a + texts(p.pg).length, 0);
const run = (fn) => {
  const bad = [];
  for (const p of allPages) for (const b of tryDo('檢查', () => fn(p), ['（檢查時例外）'])) bad.push(`${p.x.tag} 第 ${p.i + 1} 張：${b}`);
  return bad;
};
const report = (code, label, bad) => yes(allPages.length > 0 && nText > 0 && bad.length === 0, `${code} ${label}（${SETS.length} 組、${allPages.length} 張、${nText} 個字）`, bad.slice(0, 8).join('\n   '));

const b1 = SETS.filter((x) => x.m).flatMap((x) => pageListProblems(x).map((b) => `${x.tag}：${b}`));
yes(b1.length === 0, `B1 張數與標籤：全部一張 → 1 張；每天一張 → 天數張、照天排（${SETS.length} 組）`, b1.join('\n   '));
const OPTS = { icons: ICONS_LEG, labels: LABELS };
for (const [code, label, fn] of PAGE_CHECKS) report(code, label, run(({ x, pg, i }) => fn(x, pg, i, OPTS)));

// ================= C PDF =================
const goodPdf = tryDo('pdfFromJpegs', () => pdfFromJpegs(PDF_IMGS), new Uint8Array(0));
const pdfBad = pdfProblems(goodPdf, PDF_IMGS);
yes(goodPdf.length > 2500 && pdfBad.length === 0, `C1 PDF 結構：xref 每一筆指到它的物件、startxref、/Count 2、/Size 8、長度欄位與內容一致、頁面照圖的比例（${goodPdf.length} 位元組）`, pdfBad.join('；'));
const one = tryDo('pdfFromJpegs 一張', () => pdfFromJpegs([PDF_IMGS[1]]), new Uint8Array(0));
yes(pdfProblems(one, [PDF_IMGS[1]]).length === 0 && Buffer.from(one).toString('latin1').includes('/MediaBox [0 0 595.28 1440.67]'),
  'C2 一張長圖 → 一頁長頁（寬 595.28pt、高照比例 1440.67pt，不切、不縮進 A4）');
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
yes(throws(() => pdfFromJpegs([])) && throws(() => pdfFromJpegs([{ bytes: new Uint8Array(0), w: 10, h: 10 }])) && throws(() => pdfFromJpegs([{ bytes: fakeJpeg(10, 1), w: 0, h: 10 }])),
  'C3 沒有圖、圖是空的、寬是 0 → 擋下（不產生壞的 PDF）');

// ================= D 原始碼 =================
export const IMPORTS = {
  'js/itinposter/model.js': ['../theme.js', '../spottime.js', '../legs.js', '../tripday.js', '../weather.js', '../poster/layout.js', '../peeks.js'],
  'js/itinposter/layout.js': ['../peeks.js'],
  'js/itinposter/draw.js': ['../poster/presets.js', '../peeks.js', './layout.js'],
  'js/itinposter/index.js': ['../store.js', '../quests/generate.js', '../theme.js', './model.js', './layout.js', './draw.js', '../pdf.js', '../route.js', '../legs.js', '../views/weather.js', '../weather.js'],
  'js/pdf.js': [],
  'js/views/itinposter.js': ['../store.js', '../ui.js', '../router.js', '../share.js', '../itinposter/index.js'],
};
const impBad = auditImports(ROOT, IMPORTS, ['js/itinposter']);
yes(impBad.length === 0, `D1 import 登記：${Object.keys(IMPORTS).length} 支檔、${Object.values(IMPORTS).flat().length} 條，每一條都登記、沒有過期、資料夾裡沒有沒登記的檔`, impBad.join('\n   '));
const netBad = lineHits(ROOT, Object.keys(IMPORTS), NET_RE);
yes(netBad.length === 0, `D2 不直接打網路：這 ${Object.keys(IMPORTS).length} 支沒有 fetch、XMLHttpRequest、sendBeacon、WebSocket、EventSource`, netBad.join('；'));
const drawBad = lineHits(ROOT, ['js/itinposter/draw.js'], DRAW_RE);
yes(drawBad.length === 0, 'D3 畫的那支不碰模型與類別（只照 ops 畫）', drawBad.join('；'));

console.log(`\n${pass} 項通過` + (process.exitCode === 1 ? '，有失敗' : ''));
