// 「可信類別」（npm run themetrusttest；2026-10-27，秒級、不開瀏覽器）
//
// 為什麼：2026-10-27 查到存著的 spot.theme 全部是程式照名字猜的（themeForSpot，名字正規式排第一），
// 從來沒有使用者選的——「有 theme」當判準，等於把猜的當成可信的。Dispatch 核准改成從景點庫重算（js/theme.js 的 trustedTheme）。
//
// 兩段：
// 一、trustedTheme 本身，雙向（只驗拿得到，證不了它不會把不可信的也放行）。用真的景點庫、真的比對規則（loadPlaceLookup）：
//   R0 前置：「梧棲漁港」照名字猜是 coast、景點庫是 food——兩邊不同，R1 才分得出用的是哪一邊
//   R1 對上景點庫、複核通過 → 拿得到 food，而且帶來源（placeId、recheck、via）；存著的 theme 寫 coast 也不看
//   R2 對上但複核不通過（名字被改過、現在的比對規則比不回同一筆）→ 拿不到，存著的 theme 不看
//   R3 沒對上（分享匯入、沒有 placeId；或 source 不是 curated）→ 拿不到，存著的 theme 不看
//   R4 placeId 在景點庫裡找不到 → 拿不到
//   R5 景點庫沒載好（lookup 是 null）→ 拿不到
//   R6 景點庫的分類換出來是中性的 journey（清水寺 primary 是 sight）→ 拿不到、via 照寫
//   R7 一組景點的多數決只算拿得到的；一個都沒有 → null
// 二、登記制：js/ 底下每一處讀 `.theme` 的地方、每一處呼叫 storedThemeOf 的地方，都要登記用途，而且只准這幾種——
//   color    只影響配色（themeMeta(...).poster、佔位圖）
//   number   推停留分鐘數（畫面標明是推算）
//   internal theme.js 內部，呼叫端另外登記
//   write    建立景點時寫入（寫的值本身由 trustedTheme 決定）
//   fresh    讀的是同一段程式兩行前剛由 trustedTheme 寫進去的值
//   model    讀的是海報模型／AI 摘要裡的主題，那個值由 modelFrom／digestFrom 用 trustedThemeOf 算（postertruthtest 驗）
//   prefs    使用者介面的深色／和紙主題，跟景點類別無關
// 印成字、送給 AI、出任務、選類別插圖——**沒有登記的類別**：一律要走 trustedTheme。新增一處沒登記 → 紅。
// 已知限制：解構（const { theme } = spot）、方括號（spot['theme']）掃不到——在這個樣式範圍內未見，不是證明沒有。
// 先跑對照組（.logs/ 底下造真的 .js 檔，走同一個讀檔與掃描），沒過就停、不採信真實結果。
// 突變見 tools/mutations/mut_themetrust.json。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// theme.js、generate.js 用 fetch 讀 data/；node 底下換成讀檔，只供應 themes.json 與 data/places/ 底下的檔，其餘照樣失敗
globalThis.fetch = async (u) => {
  const s = String(u);
  if (s !== './data/themes.json' && !/^\.\/data\/places\/[\w-]+\.json$/.test(s)) throw new Error('themetrusttest 不供應：' + s);
  const text = fs.readFileSync(path.join(ROOT, s), 'utf8');
  return { ok: true, json: async () => JSON.parse(text) };
};
const theme = await import('../js/theme.js');
const gen = await import('../js/quests/generate.js');
await theme.loadThemes();

let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + String(extra).slice(0, 800) : '')); process.exitCode = 1; }
};

// ---------- 一、trustedTheme 雙向 ----------
yes(gen.placeLookupSync() === null, 'R5 前置：景點庫還沒載 → placeLookupSync() 是 null');
const r5 = theme.trustedTheme({ name: '梧棲漁港', source: 'curated', placeId: 'tc-wuqi', theme: 'food' }, gen.placeLookupSync());
yes(r5.key === null && r5.reason === 'no-lookup', `R5 景點庫沒載好 → 拿不到（實得 ${r5.key}、${r5.reason}）`);

const L = await gen.loadPlaceLookup();
const place = L && L.placeById('tc-wuqi');
yes(!!place && place.name === '梧棲漁港' && place.primary === 'food', `前置：景點庫裡有 tc-wuqi「梧棲漁港」、primary 是 food（實得 ${place && place.name}、${place && place.primary}）`);
const guess = theme.themeForSpot({ name: '梧棲漁港' });
yes(guess === 'coast', `R0 前置：照名字猜「梧棲漁港」是 coast（實得 ${guess}）——跟景點庫的 food 不同`);

const R1 = { name: '梧棲漁港', region: '台中市', source: 'curated', placeId: 'tc-wuqi', theme: 'coast' };
const r1 = theme.trustedTheme(R1, L);
yes(r1.key === 'food' && r1.placeId === 'tc-wuqi' && r1.recheck === true && r1.via === 'primary:food' && r1.reason === null,
  `R1 對上、複核通過 → food，帶來源（實得 ${JSON.stringify(r1)}）；存著的 coast 不看`);

const R2 = { ...R1, name: '阿嬤家巷口', theme: 'food' };
const again2 = L.matchPlace(R2.name, R2.region);
yes(!again2 || again2.id !== 'tc-wuqi', `R2 前置：現在的比對規則拿「${R2.name}」比不回 tc-wuqi（實得 ${again2 && again2.id}）`);
const r2 = theme.trustedTheme(R2, L);
yes(r2.key === null && r2.reason === 'recheck-mismatch' && r2.recheck === false,
  `R2 對上但複核不通過 → 拿不到，存著的 food 不看（實得 ${JSON.stringify(r2)}）`);

const r3a = theme.trustedTheme({ name: '梧棲漁港', region: '台中市', source: 'shared', theme: 'food' }, L);
const r3b = theme.trustedTheme({ name: '梧棲漁港', region: '台中市', source: 'auto', placeId: 'tc-wuqi', theme: 'food' }, L);
yes(r3a.key === null && r3a.reason === 'not-curated' && r3b.key === null && r3b.reason === 'not-curated',
  `R3 沒對上（分享匯入沒有 placeId；source 不是 curated）→ 都拿不到，存著的 food 不看（實得 ${r3a.reason}、${r3b.reason}）`);

const r4 = theme.trustedTheme({ ...R1, placeId: 'no-such-place' }, L);
yes(r4.key === null && r4.reason === 'place-gone', `R4 placeId 在景點庫裡找不到 → 拿不到（實得 ${r4.key}、${r4.reason}）`);

const kyo = L.placeById('kyoto-kiyomizu');
const r6 = kyo && theme.trustedTheme({ name: kyo.name, region: kyo.cityName, source: 'curated', placeId: kyo.id, theme: 'heritage' }, L);
yes(!!kyo && kyo.primary === 'sight' && r6.key === null && r6.reason === 'neutral' && r6.via === 'primary:sight' && r6.recheck === true,
  `R6 景點庫分類換出來是中性的（清水寺 sight）→ 拿不到、via 照寫（實得 ${JSON.stringify(r6)}）`);

const shared = { name: '甲山', source: 'shared', theme: 'nature' };
const r7a = theme.trustedThemeOf([R1, shared, { ...shared, name: '乙山' }], L);
const r7b = theme.trustedThemeOf([shared, R2], L);
yes(r7a === 'food' && r7b === null,
  `R7 多數決只算拿得到的：一個可信 food＋兩個存著 nature 的 → food（實得 ${r7a}）；全都拿不到 → null（實得 ${r7b}）`);

// ---------- 二、登記制 ----------
export const READ_RE = /\.theme\b|\bstoredThemeOf\s*\(/;
export const KINDS = ['color', 'number', 'internal', 'write', 'fresh', 'model', 'prefs'];
export const REGISTRY = [
  { file: 'js/aicontent.js', needle: "[x.region || '—', x.theme]", kind: 'model', why: 'tripTextDayList：x.theme 是 digestFrom 用 trustedThemeOf 算的類別名' },
  { file: 'js/boot-theme.js', needle: "p.theme === 'washi'", kind: 'prefs', why: '介面主題' },
  { file: 'js/prefs.js', needle: "const washi = prefs.theme === 'washi';", kind: 'prefs', why: '介面主題' },
  { file: 'js/prefs.js', needle: "el.dataset.theme = 'washi'", kind: 'prefs', why: '介面主題（同一行兩處算一處）' },
  { file: 'js/poster/index.js', needle: "if (!day || !day.theme) return '';", kind: 'model', why: 'stampText：day.theme 是 modelFrom 用 trustedThemeOf 算的' },
  { file: 'js/poster/index.js', needle: 'const tm = themeMeta(day.theme);', kind: 'model', why: '同上' },
  { file: 'js/poster/index.js', needle: 'const dp = styleFor(preset, themeMeta(d.theme));', kind: 'model', why: '當天配色與主題插圖；d.theme 同上' },
  { file: 'js/quests/generate.js', needle: 'spot.theme = trustedTheme(spot, placeLookupSync()).key', kind: 'write', why: '建立時寫入可信類別' },
  { file: 'js/quests/generate.js', needle: 'composeQuestSet(spot, spot.theme, ctx, place)', kind: 'fresh', why: '上一行剛由 trustedTheme 寫入' },
  { file: 'js/quests/generate.js', needle: 'composeBlurb(spot, spot.theme, ctx)', kind: 'fresh', why: '同上' },
  { file: 'js/quests/generate.js', needle: "spot.theme = 'journey';", kind: 'write', why: '沒對上景點庫寫中性值' },
  { file: 'js/theme.js', needle: 'const key = guessed || spot.theme || themeForSpot(spot, themes);', kind: 'number', why: 'stayForSpot' },
  { file: 'js/theme.js', needle: '.map((s) => s && s.theme).filter(Boolean);', kind: 'internal', why: 'storedThemeOf 本體；js/ 沒有呼叫端（只給 scripts/ 數存了什麼）' },
  { file: 'js/theme.js', needle: '.map((s) => s.theme || themeForSpot(s, themes));', kind: 'internal', why: 'majorityTheme；呼叫端在 guesscensustest 登記' },
  { file: 'js/views/quest.js', needle: 'spot ? (spot.theme || themeForSpot(spot))', kind: 'color', why: '佔位圖只是色圓與波浪' },
  { file: 'js/views/settings.js', needle: "(prefs.theme === 'washi' ? 'washi' : 'dark')", kind: 'prefs', why: '介面主題' },
  { file: 'js/views/settings.js', needle: "h('div', { class: 'form-hint' }, prefs.theme === 'washi'", kind: 'prefs', why: '介面主題' },
  { file: 'js/views/trip.js', needle: 'const tk = s.theme || themeForSpot(s);', kind: 'color', why: '只給 --theme-accent；標題列的字用 trustedTheme' },
  { file: 'js/views/trip.js', needle: 'sp ? (sp.theme || themeForSpot(sp))', kind: 'color', why: '佔位圖只是色圓與波浪' },
];

const listJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? listJs(p) : d.name.endsWith('.js') ? [p] : [];
});

// 區塊註解換成等量空白（行號不變），整行註解跳過，storedThemeOf 的定義跳過
export function sitesIn(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  clean.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//')) return;
    if (!READ_RE.test(line)) return;
    if (/\bfunction\s+storedThemeOf\s*\(/.test(line)) return;
    out.push({ line: i + 1, text: t });
  });
  return out;
}

export function scan(root, sub, registry) {
  const files = listJs(path.join(root, sub));
  const sites = [];
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    for (const s of sitesIn(fs.readFileSync(f, 'utf8'))) sites.push({ file: rel, ...s });
  }
  const problems = [];
  const used = new Map();
  for (const s of sites) {
    const hits = registry.filter((r) => r.file === s.file && s.text.includes(r.needle));
    if (hits.length === 0) problems.push(`沒登記：${s.file}:${s.line}  ${s.text.slice(0, 100)}`);
    else if (hits.length > 1) problems.push(`一行對到 ${hits.length} 條登記：${s.file}:${s.line}`);
    for (const r of hits) used.set(r, (used.get(r) || 0) + 1);
  }
  for (const r of registry) {
    const n = used.get(r) || 0;
    if (n === 0) problems.push(`登記過期（對不到任何一行）：${r.file}「${r.needle}」`);
    if (n > 1) problems.push(`一條登記對到 ${n} 行：${r.file}「${r.needle}」`);
    if (!KINDS.includes(r.kind)) problems.push(`類別「${r.kind}」不准（只准 ${KINDS.join('、')}）：${r.file}「${r.needle}」`);
  }
  return { files: files.length, sites, problems };
}

const CTL = path.join(ROOT, '.logs', 'themetrust-ctl');
const mk = (files) => {
  fs.rmSync(CTL, { recursive: true, force: true });
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(CTL, f)), { recursive: true });
    fs.writeFileSync(path.join(CTL, f), body);
    if (fs.readFileSync(path.join(CTL, f), 'utf8') !== body) throw new Error('對照樣本寫進去讀回來不一樣：' + f);
  }
};
const ctl = (label, files, registry, ok) => {
  mk(files);
  const r = scan(CTL, 'js', registry);
  const good = ok(r);
  yes(good, `對照組（${label}）`, `讀點 ${r.sites.length}：${r.sites.map((s) => s.file + ':' + s.line).join('、')}；問題：${r.problems.join('；') || '無'}`);
  return good;
};
let ctlOk = true;
ctlOk = ctl('沒登記的 .theme 讀取（印成字）', { 'js/a.js': "export const label = themeMeta(s.theme).label;\n" }, [],
  (r) => r.sites.length === 1 && r.problems.length === 1 && r.problems[0].startsWith('沒登記：js/a.js:1')) && ctlOk;
ctlOk = ctl('沒登記的 storedThemeOf 呼叫', { 'js/b.js': 'const k = storedThemeOf(list);\n' }, [],
  (r) => r.sites.length === 1 && r.problems.length === 1 && r.problems[0].startsWith('沒登記：js/b.js:1')) && ctlOk;
ctlOk = ctl('註解、定義、.themes 不算', {
  'js/c.js': '// s.theme 只是提到\n/* 多行\n d.theme\n*/\nexport function storedThemeOf(spots) { return 1; }\nconst t = x.themes;\n',
}, [], (r) => r.sites.length === 0 && r.problems.length === 0) && ctlOk;
ctlOk = ctl('區塊註解之後的行號照舊', { 'js/d.js': '/*\n\n*/\nconst k = s.theme;\n' },
  [{ file: 'js/d.js', needle: 'const k = s.theme;', kind: 'color' }],
  (r) => r.sites.length === 1 && r.sites[0].line === 4 && r.problems.length === 0) && ctlOk;
ctlOk = ctl('登記過期', { 'js/e.js': 'const k = 1;\n' }, [{ file: 'js/e.js', needle: 's.theme', kind: 'color' }],
  (r) => r.problems.length === 1 && r.problems[0].startsWith('登記過期')) && ctlOk;
ctlOk = ctl('類別不准（印成字）', { 'js/f.js': 'const k = s.theme;\n' }, [{ file: 'js/f.js', needle: 's.theme', kind: 'text' }],
  (r) => r.problems.length === 1 && r.problems[0].startsWith('類別「text」不准')) && ctlOk;
ctlOk = ctl('一條登記對到兩行', { 'js/g.js': 'const k = s.theme;\nconst j = s.theme;\n' }, [{ file: 'js/g.js', needle: 's.theme', kind: 'color' }],
  (r) => r.problems.length === 1 && r.problems[0].startsWith('一條登記對到 2 行')) && ctlOk;
fs.rmSync(CTL, { recursive: true, force: true });

if (!ctlOk) {
  console.log('✗ 對照組沒過——掃描器壞了，不採信下面的結果');
  process.exitCode = 4;
} else {
  const r = scan(ROOT, 'js', REGISTRY);
  const byKind = KINDS.map((k) => `${k} ${REGISTRY.filter((x) => x.kind === k).length}`).join('、');
  console.log(`掃了 js/ 底下 ${r.files} 支 .js，讀點 ${r.sites.length} 處；登記 ${REGISTRY.length} 條（${byKind}）`);
  yes(r.files > 0 && r.sites.length > 0, `母體非空（${r.files} 支檔、${r.sites.length} 處）`);
  yes(r.problems.length === 0 && r.sites.length === REGISTRY.length,
    `每一處都登記了、每一條登記剛好對到一處（讀點 ${r.sites.length}＝登記 ${REGISTRY.length}）`, r.problems.join('\n   '));
}
console.log(`\n${pass} 項通過` + (process.exitCode === 1 ? '，有失敗' : process.exitCode === 4 ? '，對照組沒過' : ''));
