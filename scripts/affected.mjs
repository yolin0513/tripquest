// 受影響測試挑選器（純函式；規格見 docs/SPEC_測試範圍.md）。
//
// 這支檔案不讀 git、不跑測試、不碰檔案系統 —— 需要的東西全部由呼叫端餵進來
// （scripts/run-affected.mjs 讀 git 與檔案；scripts/affectedtest.mjs 餵 fixture）。
// 這樣七個歷史案例才能原封回放、假的 import 圖才造得出來。
//
// 挑中一支測試的條件（R3）：
//   1. 那支測試的腳本檔本身被改到
//   2. 它直接引用的檔（或目錄）被改到
//   3. 它直接引用的程式檔的閉包（沿 import 往下展開）裡有檔被改到
//   4. 命中放大器（R4，寫死在下面）
// 另外兩條保守的退路：改到的程式檔沒有任何規則認領（放大器 D）、或改到的檔不屬於
// 任何已知類別 → 都放大到全套。挑選器壞掉的樣子就是「少挑幾支、看起來照樣全綠」，
// 寧可多跑。

import path from 'node:path';

// ---------- 底線（R2）：不論改了什麼，每版都跑 ----------
export const BASELINE = ['affectedtest', 'validate-places', 'zhtest', 'nearbytest', 'emptytest', 'tabbartest'];

// ---------- 放大器（R4） ----------
export const AMP_A_TESTS = ['layouttest', 'tabbartest', 'scrolltest', 'densitytest', 'recapcardtest', 'screenshots', 'tagtest', 'walltest'];
export const AMP_B_FILES = ['js/store.js', 'js/db.js', 'js/outbox.js', 'js/sync.js', 'js/ids.js', 'js/share.js', 'js/photos.js'];
const AMP_C_FILES = ['sw.js', 'index.html', 'js/app.js', 'js/router.js', 'js/merge.js'];
const SERVER_ENTRY = 'server/index.mjs';

const isView = (f) => /^js\/views\/[^/]+\.js$/.test(f);
const isAmpA = (f) => isView(f) || f === 'css/style.css';
const isAmpB = (f) => AMP_B_FILES.includes(f);
function ampCReason(f, status) {
  if (AMP_C_FILES.includes(f)) return `${f}（骨架／合併語意）`;
  if (/^(workers|server)\//.test(f)) return `${f}（Worker／伺服器）`;
  if (isView(f) && (status === 'A' || status === 'D')) return `${status === 'A' ? '新增' : '刪除'}了 ${f}（路由表會變）`;
  return null;
}
// 放大器 D 的範圍：這幾個目錄底下的檔沒人認領 → 全套
const isCode = (f) => /^(js|css|workers|server)\//.test(f);
// 只是文件或工具：不觸發任何測試（底線照跑）
function isDocLike(f, chainFiles) {
  if (/^docs\//.test(f) || /^screenshots\//.test(f) || /\.md$/i.test(f)) return true;
  if (/^\.claude\//.test(f) || /^\.git(ignore|attributes)$/.test(f) || f === '.nojekyll') return true;
  // scripts/ 底下不在鏈裡的工具（截圖、巡檢、發佈腳本）；鏈裡的測試走規則 1、
  // 被測試 import 的 helper 走規則 2
  if (/^scripts\//.test(f) && !chainFiles.has(f)) return true;
  return false;
}

// ---------- 鏈（package.json 的 test script） ----------
// 回傳 [{ name, file }]，依鏈的順序。任何一段對不上格式、或對不到實際存在的檔，就丟錯 ——
// 靜默略過的話，少掉的那一支永遠不會被挑、也永遠不會有人發現。
export function parseChain(pkg, exists) {
  const s = pkg && pkg.scripts && pkg.scripts.test;
  if (typeof s !== 'string' || !s.trim()) throw new Error('package.json 沒有 test script');
  return s.split('&&').map((seg) => {
    const m = seg.trim().match(/^node\s+(scripts\/([A-Za-z0-9_-]+)\.mjs)$/);
    if (!m) throw new Error(`鏈裡有一段看不懂：「${seg.trim()}」`);
    if (!exists(m[1])) throw new Error(`鏈裡的 ${m[1]} 不存在`);
    return { name: m[2], file: m[1] };
  });
}

// ---------- 直接引用 ----------
// 從測試腳本的文字裡撈出 repo 內的路徑：'/js/store.js'（page.evaluate 裡的動態 import）、
// '../js/merge.js'、'server/index.mjs'（spawn 的伺服器）、'js/views'（整個目錄）、
// sw.js、index.html，以及測試自己 import 的 scripts/ helper（'./affected.mjs'）。
// exists(p) 回傳 'file' | 'dir' | null；不存在的一律丟掉（網址裡剛好長得像 data/ 的片段）。
// 路徑後面必須接分隔字元（引號、空白、括號…）才算完整的一段：否則 '/js/中文.js' 會在
// 第一個中文字被截斷成 'js/'，變成「引用整個 js 目錄」—— 那支測試從此什麼都涵蓋，放大器 D 永遠不響。
const REF_RE = /(?:^|[^A-Za-z0-9_.-])((?:js|css|workers|server|data|icons|media|scripts\/fixtures)\/[A-Za-z0-9_./-]*|sw\.js|index\.html|manifest\.webmanifest)(?=$|['"`\s),;?#\]}])/g;
const HELPER_RE = /(?:from\s*|import\(\s*)['"]\.\/([A-Za-z0-9_-]+\.mjs)['"]/g;
export function extractRefs(text, exists) {
  const out = new Set();
  for (const m of text.matchAll(REF_RE)) {
    const p = m[1].replace(/\.+$/, '').replace(/\/+$/, '');   // 句尾的點、目錄結尾的斜線
    const kind = p && exists(p);
    if (kind) out.add(kind === 'dir' ? p + '/' : p);
  }
  for (const m of text.matchAll(HELPER_RE)) {
    const p = 'scripts/' + m[1];
    if (exists(p) === 'file') out.add(p);
  }
  return [...out].sort();
}

// ---------- import 圖 ----------
// files: { 'js/store.js': '<原始碼>', ... }（js/、server/、workers/ 底下的 .js／.mjs）。
// 靜態 import、export…from、動態 import()、以及 new URL('./x.js', import.meta.url)
// （Web Worker 的載入方式）都算一條邊。只收相對路徑（'./'、'../'）。
const IMPORT_RES = [
  /\bimport\s+[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bexport\s+[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
  /\bnew\s+URL\(\s*['"](\.{1,2}\/[^'"]+\.m?js)['"]\s*,\s*import\.meta\.url/g,
];
export function buildImportGraph(files) {
  const graph = new Map();
  for (const [file, text] of Object.entries(files)) {
    const deps = new Set();
    for (const re of IMPORT_RES) {
      for (const m of text.matchAll(re)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
        if (Object.prototype.hasOwnProperty.call(files, target)) deps.add(target);
      }
    }
    graph.set(file, [...deps].sort());
  }
  return graph;
}

// 從 start 沿 import 往下展開（含 start 自己）
export function closure(graph, start) {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const d of graph.get(f) || []) stack.push(d);
  }
  return seen;
}

const refHits = (ref, f) => (ref.endsWith('/') ? f.startsWith(ref) : ref === f);

// ---------- 挑選 ----------
// changed: ['js/x.js', ...] 或 [{ path, status }]（status 為 git 的 A/M/D/R…，字串視為 M）
// chain:   parseChain() 的結果
// refs:    { 測試名: extractRefs() 的結果 }
// graph:   buildImportGraph() 的結果
// 回傳 { selected: [測試名，依鏈順序], reasons: {測試名: [理由…]}, full, fullReasons, notes, n, m }
export function select({ changed, chain, refs, graph }) {
  const entries = changed.map((c) => (typeof c === 'string' ? { path: c, status: 'M' } : c));
  const names = chain.map((t) => t.name);
  const chainFiles = new Set(chain.map((t) => t.file));
  const reasons = {};
  const add = (name, why) => {
    if (!names.includes(name)) return;          // 放大器／底線裡寫了鏈上沒有的名字：不假裝有跑
    (reasons[name] ||= []).push(why);
  };
  const fullReasons = [];
  const notes = [];

  for (const t of BASELINE) add(t, '底線');

  // 每支測試引用到的程式檔的閉包（目錄引用 → 目錄底下每一個程式檔都算起點）
  const graphFiles = [...graph.keys()];
  const cover = {};
  for (const t of chain) {
    const set = new Set();
    for (const r of refs[t.name] || []) {
      const starts = r.endsWith('/') ? graphFiles.filter((f) => f.startsWith(r)) : (graph.has(r) ? [r] : []);
      for (const s of starts) for (const f of closure(graph, s)) set.add(f);
    }
    cover[t.name] = set;
  }

  const serverTests = chain.filter((t) => (refs[t.name] || []).includes(SERVER_ENTRY)).map((t) => t.name);

  for (const { path: f, status } of entries) {
    let claimed = false;

    // 規則 1：測試腳本本身
    const self = chain.find((t) => t.file === f);
    if (self) { add(self.name, `腳本本身被改（${f}）`); claimed = true; }

    // 規則 2、3：直接引用、閉包
    for (const t of chain) {
      if ((refs[t.name] || []).some((r) => refHits(r, f))) { add(t.name, `直接引用 ${f}`); claimed = true; }
      else if (cover[t.name].has(f)) { add(t.name, `閉包涵蓋 ${f}`); claimed = true; }
    }

    // 放大器 A、B
    if (isAmpA(f)) { for (const t of AMP_A_TESTS) add(t, `放大器 A：${f}`); claimed = true; }
    if (isAmpB(f)) { for (const t of serverTests) add(t, `放大器 B：${f}`); claimed = true; }

    // 放大器 C
    const c = ampCReason(f, status);
    if (c) { fullReasons.push(`放大器 C：${c}`); claimed = true; }

    if (claimed) continue;
    if (isDocLike(f, chainFiles)) continue;
    if (f === 'package.json') { notes.push('package.json：底線（affectedtest 會驗鏈）'); continue; }
    if (isCode(f)) fullReasons.push(`放大器 D：${f} 沒有任何一支測試涵蓋`);
    else fullReasons.push(`沒有規則認領的檔：${f}`);
  }

  const full = fullReasons.length > 0;
  if (full) for (const n of names) (reasons[n] ||= []).push('全套');
  const selected = names.filter((n) => reasons[n]);
  return { selected, reasons, full, fullReasons, notes, n: selected.length, m: names.length };
}

// ---------- 輸出（R5） ----------
export function formatReport(r) {
  const lines = [];
  if (r.full) {
    lines.push(`放大到全套：本次跑 ${r.n}/${r.m} 支（完整的鏈）`);
    for (const why of r.fullReasons) lines.push('  · ' + why);
  } else {
    lines.push(`這不是全綠：本次跑 ${r.n}/${r.m} 支（底線＋受影響）`);
  }
  for (const n of r.notes) lines.push('  · ' + n);
  lines.push('');
  for (const name of r.selected) {
    const why = r.full ? '' : '  ← ' + [...new Set(r.reasons[name])].join('；');
    lines.push(`  ${name}${why}`);
  }
  return lines.join('\n');
}
