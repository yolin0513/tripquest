// 「照名字猜類別」的母體（npm run guesscensustest；2026-10-27，秒級、進鏈與底線）。
//
// 為什麼：猜類別的輸出變成使用者看得到的字，今天一處一處撞到三次（海報主題章、送給 AI 的文案、行程頁標題列）。
// 逐處修而沒有母體，看起來修完了，只是因為只看得到找到的那幾處（Dispatch 2026-10-27）。
//
// 母體：js/ 底下每一處呼叫猜類別函式的地方——themeForSpot（照名字猜的源頭）、themeForDay／themeForTrip（沒帶 theme
// 就呼叫它的多數決）、stayForSpot（同上，推停留分鐘數）。註解不算、函式定義不算。
// 登記制：每一處都要登記它的輸出拿去做什麼，而且只准四種——
//   color    只影響配色（顏色是裝飾、不主張「這是什麼地方」）
//   number   推算停留分鐘數，畫面標明是推算
//   curated  只在對得上策展景點庫時才走到（v1.74 規則允許自動出題）
//   internal theme.js 內部，它的呼叫端另外登記
// 印成字、送給 AI、選特定類別的圖——這三種**沒有登記的類別**：要給使用者看的一律用 trustedTheme（從景點庫重算；
// 帶著的 theme 也是猜的，2026-10-27 查到——讀存著的 .theme 的地方由 themetrusttest 登記）。
// curated 類別目前沒有任何登記在用（generate.js 改用 trustedTheme）；留著，類別清單不跟著登記增減。
// 新增一個呼叫點沒登記 → 紅；登記了卻對不到 → 紅（過期）；一條登記對到兩行 → 紅；類別不在那四種 → 紅。
// 先跑對照組（.logs/ 底下造真的 .js 檔，走同一個讀檔與掃描），沒過就停、不採信真實結果。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const NAMES_RE = /\b(themeForSpot|themeForDay|themeForTrip|stayForSpot)\s*\(/;
export const KINDS = ['color', 'number', 'curated', 'internal'];

// 2026-10-27：generate.js 那兩處（建立景點、補任務）改用 trustedTheme（從景點庫重算），不再呼叫 themeForSpot，登記拿掉。
export const REGISTRY = [
  { file: 'js/route.js', needle: 'stayForSpot(s)', kind: 'number', why: '停留分鐘數，plan.js 標「停留未設，先用 X 推算」' },
  { file: 'js/theme.js', needle: 'const key = guessed || spot.theme || themeForSpot(spot, themes);', kind: 'number', why: 'stayForSpot 內部' },
  { file: 'js/theme.js', needle: '.map((s) => s.theme || themeForSpot(s, themes));', kind: 'internal', why: 'majorityTheme（themeForDay／themeForTrip 的本體），呼叫端另外登記' },
  { file: 'js/views/quest.js', needle: 'paintRef(heroPhoto, refImageFor(q, spot, null), spot ? (spot.theme || themeForSpot(spot))', kind: 'color', why: '佔位圖 themePlaceholder 只是色圓與波浪' },
  { file: 'js/views/trip.js', needle: 'const tk = s.theme || themeForSpot(s);', kind: 'color', why: '只給 --theme-accent；標題列的字改用 s.theme（2026-10-27）' },
  { file: 'js/views/trip.js', needle: 'paintRef(el, pick, sp ? (sp.theme || themeForSpot(sp))', kind: 'color', why: '佔位圖 themePlaceholder 只是色圓與波浪' },
  { file: 'js/views/recap.js', needle: 'themeMeta(themeForTrip(store.spotsOf(tripId)))', kind: 'color', why: 'renderRecapCard 只讀 theme.poster 的顏色' },
];

let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + String(extra).slice(0, 800) : '')); process.exitCode = 1; }
};

const listJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? listJs(p) : d.name.endsWith('.js') ? [p] : [];
});

// 一支檔裡的呼叫點：區塊註解換成等量的空行（行號不變），整行註解跳過，函式定義跳過
export function sitesIn(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  clean.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//')) return;
    if (!NAMES_RE.test(line)) return;
    if (/\bfunction\s+(themeForSpot|themeForDay|themeForTrip|stayForSpot)\s*\(/.test(line)) return;
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

// ---------- 對照組：在 .logs/ 底下造真的 .js 檔，走同一個 scan ----------
const CTL = path.join(ROOT, '.logs', 'guesscensus-ctl');
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
  yes(good, `對照組（${label}）`, `呼叫點 ${r.sites.length}：${r.sites.map((s) => s.file + ':' + s.line).join('、')}；問題：${r.problems.join('；') || '無'}`);
  return good;
};
const call = (name) => `export const x = ${name}(a);\n`;
let ctlOk = true;
for (const name of ['themeForSpot', 'themeForDay', 'themeForTrip', 'stayForSpot']) {
  ctlOk = ctl(`沒登記的 ${name}`, { [`js/${name}.js`]: call(name) }, [],
    (r) => r.sites.length === 1 && r.problems.length === 1 && r.problems[0].startsWith(`沒登記：js/${name}.js:1`)) && ctlOk;
}
ctlOk = ctl('註解與定義不算', {
  'js/a.js': '// themeForSpot(x) 只是提到\n/* 多行\n themeForDay(y)\n*/\nexport function themeForSpot(spot) { return 1; }\n',
}, [], (r) => r.sites.length === 0 && r.problems.length === 0) && ctlOk;
ctlOk = ctl('區塊註解之後的行號照舊', { 'js/b.js': '/*\n\n*/\nconst k = themeForSpot(s);\n' },
  [{ file: 'js/b.js', needle: 'const k = themeForSpot(s);', kind: 'color' }],
  (r) => r.sites.length === 1 && r.sites[0].line === 4 && r.problems.length === 0) && ctlOk;
ctlOk = ctl('登記過期', { 'js/c.js': 'const k = 1;\n' }, [{ file: 'js/c.js', needle: 'themeForSpot(gone)', kind: 'color' }],
  (r) => r.problems.length === 1 && r.problems[0].startsWith('登記過期')) && ctlOk;
ctlOk = ctl('類別不准（印成字）', { 'js/d.js': 'const k = themeForSpot(s);\n' }, [{ file: 'js/d.js', needle: 'themeForSpot(s)', kind: 'text' }],
  (r) => r.problems.length === 1 && r.problems[0].startsWith('類別「text」不准')) && ctlOk;
ctlOk = ctl('一條登記對到兩行', { 'js/e.js': 'const k = themeForSpot(s);\nconst j = themeForSpot(s);\n' }, [{ file: 'js/e.js', needle: 'themeForSpot(s)', kind: 'color' }],
  (r) => r.problems.length === 1 && r.problems[0].startsWith('一條登記對到 2 行')) && ctlOk;
fs.rmSync(CTL, { recursive: true, force: true });

if (!ctlOk) {
  console.log('✗ 對照組沒過——掃描器壞了，不採信下面的結果');
  process.exitCode = 4;
} else {
  const r = scan(ROOT, 'js', REGISTRY);
  const byKind = KINDS.map((k) => `${k} ${REGISTRY.filter((x) => x.kind === k).length}`).join('、');
  console.log(`掃了 js/ 底下 ${r.files} 支 .js，呼叫點 ${r.sites.length} 處；登記 ${REGISTRY.length} 條（${byKind}）`);
  yes(r.files > 0 && r.sites.length > 0, `母體非空（${r.files} 支檔、${r.sites.length} 處）`);
  yes(r.problems.length === 0 && r.sites.length === REGISTRY.length,
    `每一處都登記了、每一條登記剛好對到一處（呼叫點 ${r.sites.length}＝登記 ${REGISTRY.length}）`, r.problems.join('\n   '));
}
console.log(`\n${pass} 項通過` + (process.exitCode === 1 ? '，有失敗' : process.exitCode === 4 ? '，對照組沒過' : ''));
