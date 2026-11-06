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
export const BASELINE = ['affectedtest', 'guesscensustest', 'themetrusttest', 'validate-places', 'zhtest', 'nearbytest', 'emptytest', 'tabbartest', 'gatelint', 'convtest', 'shelltest', 'viewentrytest'];   // viewentrytest：主畫面只有路由器一個入口（新的繞路可能出現在任何一支 js，只有每次都跑才抓得到；2026-10-28 settletest 的根因）；themetrusttest：讀存著的 .theme 的每一處都要登記用途，給使用者看的一律走可信類別（同 guesscensustest 的理由，2026-10-27）；guesscensustest：照名字猜類別的每一個呼叫點都要登記用途（新增的呼叫點可能落在任何一支 js，只有每次都跑才抓得到；2026-10-27 一處一處撞到三次）；shelltest：每支 js 都在 SW 離線清單（新增 js 檔不一定會改到 sw.js，漏列時有網路照樣正常，只有每次都跑才抓得到；v1.74.11 漏過 tripday.js）；gatelint：推送閘的壞寫法掃描（共用慣例 v9 §5.16），不論改了什麼每版都跑；convtest：共用慣例副本跟主檔一致（主檔在別的 repo，它改了本 repo 什麼都沒動，只有每次都跑才抓得到）

// ---------- 放大器（R4） ----------
// imgtest：案例 ②（v1.41）就是 trip.js 的畫面結構改動讓它紅的（修訂 1-C）
export const AMP_A_TESTS = ['layouttest', 'tabbartest', 'scrolltest', 'densitytest', 'recapcardtest', 'screenshots', 'tagtest', 'walltest', 'imgtest'];
export const AMP_B_FILES = ['js/store.js', 'js/db.js', 'js/outbox.js', 'js/sync.js', 'js/ids.js', 'js/share.js', 'js/photos.js'];
const AMP_C_FILES = ['sw.js', 'index.html', 'js/app.js', 'js/router.js', 'js/merge.js'];
const SERVER_ENTRY = 'server/index.mjs';

// ---------- sw.js 只改 VERSION 那一行（修訂 1-A） ----------
// 每一版都 bump VERSION；若整個 sw.js 都算放大器 C，每一版都會跑全套、放寬等於沒放寬。
// 呼叫端用 classifyChanges() 把「只改 VERSION 行」的 sw.js 換成這個虛擬路徑；
// 判斷不出來（取不到 diff、新檔、樣式對不上）就維持 sw.js → 照舊命中 C。
export const SW_VERSION_ONLY = 'sw.js#VERSION';
export const SW_VERSION_TESTS = ['updatetest', 'nearbytest'];   // 案例 ⑦ 當年的兩個受害者，當便宜的保險
const VERSION_LINE = /^[-+]const VERSION = '[^'\n]*';\s*$/;
// diff：`git diff -U0 … -- sw.js` 的文字。只有 VERSION 那一行一刪一增才算。
export function swVersionOnly(diff) {
  if (typeof diff !== 'string') return false;
  const lines = diff.split('\n').filter((l) => /^[-+]/.test(l) && !/^(\+\+\+|---)( |$)/.test(l));
  const plus = lines.filter((l) => l.startsWith('+')).length;
  const minus = lines.filter((l) => l.startsWith('-')).length;
  return plus === 1 && minus === 1 && lines.every((l) => VERSION_LINE.test(l));
}
// entries: [{ path, status }]；diffOf(path) 回傳 diff 文字（取不到回 null 或丟錯）
export function classifyChanges(entries, diffOf) {
  return entries.map((e) => {
    const c = typeof e === 'string' ? { path: e, status: 'M' } : e;
    if (c.path !== 'sw.js' || c.status !== 'M') return c;
    let diff = null;
    try { diff = diffOf('sw.js'); } catch { diff = null; }
    return swVersionOnly(diff) ? { path: SW_VERSION_ONLY, status: 'M' } : c;
  });
}

// ---------- 目錄引用不展開閉包（修訂二） ----------
// 辨認方式：extractRefs() 給的引用路徑**以 `/` 結尾**就是目錄引用（它只在指到的真的是目錄時
// 才加那個斜線）。`nearbytest`、`emptytest` 引用整個 `js/views/`，是把檔案當文字讀來做路由與
// 原始碼稽核、並不執行它們；沿著 23 個 view 的 import 往下算涵蓋，等於宣稱它們涵蓋了整個 App，
// 放大器 D 就永遠不會響。改到目錄底下的檔，那支測試照樣被挑中（規則 2），只是不再往下展開。
const isDirRef = (r) => r.endsWith('/');

// ---------- 閉包的終點（修訂 1-B） ----------
// js/app.js 是整個 App 的入口，它的閉包就是全部程式檔；拿它算「誰涵蓋誰」沒有鑑別力，
// 放大器 D 會永遠不響。引用它的測試只算直接引用它這一個檔，閉包展開到它就停。
export const CLOSURE_STOP = ['js/app.js'];

// 放大器 D 放大到哪裡：由最近十個版本的統計決定（修訂 1-B 的門檻：觸發 ≤ 3 版 → 全套；
// ≥ 4 版 → 放大器 A ∪ B 那兩組）。2026-09-19 實測十版裡觸發 N 版，見 STATUS「測試範圍」。
export const AMP_D_MODE = 'full';

// ---------- 突變清單（2026-11-05 守夜；共用慣例 §5.18.1「縮小範圍」，Dispatch 選 B） ----------
// 原本 tools/mutations/*.json 沒有規則認領 → 每加一份清單就放大成全套 74 支（會開瀏覽器）。
// 正確性依據（為什麼「清單 cmd 點名的測試＋讀清單的兩支」就夠）：
//   · 突變清單是資料，App 的程式（js／css／workers／server）一個都不讀它（搜過 js/、workers/、server/：0 處）。
//     改清單不會改變 App 的任何行為，所以沒有「改了 A、紅在 B」的路徑可以落到別的測試上。
//   · 鏈上讀這個目錄的只有 mutlint（格式、find 對得到、母體）與 mutcmdtest（每一條 cmd 合形狀）——兩支都挑。
//     evtest 也複製整個目錄，但它跑的是補丁格式那批；補丁格式的清單不走這條規則，照舊放大成全套。
//   · cmd 點名的測試：突變要靠它變紅，挑它是確認那支測試原樣是綠的（§5.11 原樣先綠）。突變本身會不會紅，
//     不是 test:affected 驗的——新寫的突變當場用 mutate.mjs 單獨跑（§5.18.5）。
// ⚠ 這條規則成立的前提是「cmd 欄列全了該跑的測試」。任何一條沒有 cmd、或 cmd 不是 `node scripts/<名字>.mjs`，
//   就**判紅**（errors，run-affected 回 9、一支都不跑）——不靜默跳過：漏填 cmd 時挑選器會挑不到東西、輸出卻一切正常。
//   讀不到、解析不了、刪掉的清單 → 照舊放大成全套（讀不到不是「沒有關係」）。
export const MUT_LIST_RE = /^tools\/mutations\/[^/]+\.json$/;
export const MUT_LIST_TESTS = ['mutlint', 'mutcmdtest'];
const MUT_CMD_RE = /^node scripts\/([a-z0-9-]+)\.mjs$/;
// j：清單解析出來的 JSON（讀不到傳 null）。回 null（認不出）、{ kind:'patch' }、或 { kind:'mutate', tests, missingCmd }
export function mutListInfo(j) {
  if (!Array.isArray(j) || !j.length) return null;
  if (j.every((m) => m && typeof m.from === 'string' && typeof m.to === 'string')) return { kind: 'patch' };
  if (!j.every((m) => m && typeof m.name === 'string')) return null;
  const tests = new Set(), missingCmd = [];
  for (const m of j) {
    const x = MUT_CMD_RE.exec(typeof m.cmd === 'string' ? m.cmd : '');
    if (x) tests.add(x[1]); else missingCmd.push(m.name);
  }
  return { kind: 'mutate', tests: [...tests].sort(), missingCmd };
}

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
  const s = pkg && pkg.scripts && pkg.scripts['test:chain'];   // 2026-10-02 起鏈的定義在 test:chain；npm test 走 run-affected --all
  if (typeof s !== 'string' || !s.trim()) throw new Error('package.json 沒有 test:chain script');
  return s.split('&&').map((seg) => {
    const m = seg.trim().match(/^node\s+(scripts\/([A-Za-z0-9_-]+)\.mjs)$/);
    if (!m) throw new Error(`鏈裡有一段看不懂：「${seg.trim()}」`);
    if (!exists(m[1])) throw new Error(`鏈裡的 ${m[1]} 不存在`);
    return { name: m[2], file: m[1] };
  });
}

// ---------- 孤兒檢查（2026-09-24，共用慣例 v9 §5.2 登記制的另一半）----------
// 鏈是登記制：沒登記進 package.json test 的測試，挑選器和完整的鏈都**永遠不會跑它、也沒有任何警告**（盤點實測）。
// 所以反過來查：scripts/ 底下名字看起來是檢查的（test／lint／check／validate／scan），不在鏈裡就報出來，
// 除非列在 ORPHAN_OK 並寫理由。例外過期（檔不在了、或已經進鏈）也報，免得例外清單變成默默的豁免。
export const ORPHAN_RE = /(test|lint|check|validate|scan|verify)/i;   // verify：2026-09-24 加 f8verify 時補（原本會漏掉它）
export const ORPHAN_OK = {
  f8verify: 'F8 的驗法，約 4.5 分鐘、要 PowerShell 鎖檔；推送閘在推送動到它守的三支時要求登記相符（回 6），不靠鏈',
  livetest: '打正式站（共用慣例 §5.6：打真網路的不進 npm test）；手動跑',
  'livecheck-import': '打正式站、會寫入正式 D1；接在 npm run sweep 後面，只在 Yolin 明確許可時手動跑（2026-10-29 起不是每版流程）',
  'prepush-scan': '推送閘自己呼叫的公開前自查；行為由 pushgatetest 驗',
  convcheck: '共用慣例副本與主檔的比對器（函式庫）；行為由 convtest 驗（convtest 在鏈裡、也在底線）',
};
// scriptNames：scripts/ 底下 .mjs／.js 的檔名（不含副檔名）；chainNames：鏈上的名字
export function findOrphans(scriptNames, chainNames, ok = ORPHAN_OK) {
  const inChain = new Set(chainNames), have = new Set(scriptNames);
  const orphans = scriptNames.filter((n) => ORPHAN_RE.test(n) && !inChain.has(n) && !(n in ok)).sort();
  // 過期：檔不在、已經進鏈、或名字根本不像檢查（樣式認不得它，這條例外就沒在豁免任何東西——多半是樣式漏了一種寫法）
  const stale = Object.keys(ok).filter((n) => !have.has(n) || inChain.has(n) || !ORPHAN_RE.test(n)).sort();
  return { orphans, stale };
}

// ---------- 孤兒檢查的第二半：scripts/ 以外（2026-11-06）----------
// 上面那半只看 scripts/ 底下一層。tools/mutproof/、tools/ev/ 也放了好幾支檢查與驗法，新放一支進去不會有任何警告
// （查詢島同一天撞到：42 支測試只有 1 支會被跑到，一支從 11-04 紅到 11-06 沒人發現）。
// 範圍：repo 裡每一個程式檔（已追蹤＋未追蹤但沒被 .gitignore 擋的，由呼叫端用 git 列），scripts/ 底下一層除外（上面那半管）。
// 名字像檢查、又不在鏈上 → 報；要放行就登記在 ORPHAN_OK_PATHS 並寫理由（登記制，不用排除目錄）。
export const CODE_RE = /\.(?:m?js|cjs|ts|sh|py|ps1)$/i;
export const ORPHAN_OK_PATHS = {
  'js/plancheck.js': 'App 本體的模組（行程檢查功能），名字剛好含 check；行為由 checktest、routetest 驗',
  'tools/ev/regen-check.mjs': 'tools/ev 入庫的自我檢查（能重新產生、引用都在、沒有本機路徑）；動 tools/ev 時手動跑',
  'tools/mutproof/evtest_mut.mjs': 'evtest 範圍縮小的突變驅動，重負載（約 4.5 分鐘）；STATUS 記何時手動跑',
  'tools/mutproof/expect-check.mjs': '突變驅動預期清單的過期／歧義檢查（函式庫）；由突變驅動呼叫',
  'tools/mutproof/gatelint_format.mjs': 'gatelint「判定與證據分行」的三格證明，一次性入庫的證據；動 gatelint 輸出格式時手動跑',
  'tools/mutproof/mutlint_mut.mjs': 'mutlint 的突變驅動，在暫存 clone 裡跑；動 mutlint 時手動跑',
  'tools/mutproof/rescan.mjs': '回頭掃舊突變輸出有沒有跑完（evidence.mjs 呼叫）；手動跑',
  'tools/okscan.mjs': '「helper 回失敗值、呼叫端沒接」的盤點工具（自帶對照組）；手動跑',
};
// paths：repo 相對路徑（正斜線）；chainFiles：鏈上每一支的檔案路徑（例 scripts/xxxtest.mjs）
export function findOrphanPaths(paths, chainFiles, ok = ORPHAN_OK_PATHS) {
  const inChain = new Set(chainFiles), have = new Set(paths);
  const base = (p) => p.split('/').pop().replace(CODE_RE, '');
  const outside = paths.filter((p) => CODE_RE.test(p) && !/^scripts\/[^/]+$/.test(p));
  const orphans = outside.filter((p) => ORPHAN_RE.test(base(p)) && !inChain.has(p) && !(p in ok)).sort();
  const stale = Object.keys(ok).filter((p) => !have.has(p) || inChain.has(p) || !ORPHAN_RE.test(base(p))).sort();
  return { scanned: outside.length, orphans, stale };
}

// ---------- 直接引用 ----------
// 從測試腳本的文字裡撈出 repo 內的路徑：'/js/store.js'（page.evaluate 裡的動態 import）、
// '../js/merge.js'、'server/index.mjs'（spawn 的伺服器）、'js/views'（整個目錄）、
// sw.js、index.html，以及測試自己 import 的 scripts/ helper（'./affected.mjs'）。
// exists(p) 回傳 'file' | 'dir' | null；不存在的一律丟掉（網址裡剛好長得像 data/ 的片段）。
// 路徑後面必須接分隔字元（引號、空白、括號…）才算完整的一段：否則 '/js/中文.js' 會在
// 第一個中文字被截斷成 'js/'，變成「引用整個 js 目錄」—— 那支測試從此什麼都涵蓋，放大器 D 永遠不響。
// scripts/<名稱>.sh|.mjs 也算（2026-09-24）：pushgatetest 在檔頭寫「涵蓋的程式：scripts/safe-push.sh…」，
// 原本這個樣式不認 scripts/ 底下的檔，改推送閘時挑選器就不會挑中驗它的那支測試（盤點實測）。
// tools/ev/<名稱>.sh|.mjs 也算（2026-10-02）：evtest 在 OWN 列它真的去跑的那幾支；沒列的（ev2.sh、mk_*）照舊沒人認領→放大。
// 只認逐檔寫出的路徑、不認 tools/ev/ 整個目錄——寫成目錄就會把 evtest 換成空殼的 ev2.sh、mk_* 也算成「有測試」。
const REF_RE = /(?:^|[^A-Za-z0-9_.-])((?:js|css|workers|server|data|icons|media|scripts\/fixtures)\/[A-Za-z0-9_./-]*|scripts\/[A-Za-z0-9_-]+\.(?:sh|mjs)|tools\/ev\/[A-Za-z0-9_-]+\.(?:sh|mjs)|sw\.js|index\.html|manifest\.webmanifest)(?=$|['"`\s),;?#\]}])/g;
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

// 從 start 沿 import 往下展開（含 start 自己）；遇到 CLOSURE_STOP 的檔只收它本身、不再往下
export function closure(graph, start) {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (CLOSURE_STOP.includes(f)) continue;
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
// mutLists: { 'tools/mutations/x.json': mutListInfo() 的結果 }——沒給或沒有那一份＝讀不到，照舊放大
export function select({ changed, chain, refs, graph, dMode = AMP_D_MODE, mutLists = {} }) {
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
  const errors = [];

  for (const t of BASELINE) add(t, '底線');

  // 每支測試引用到的程式檔的閉包（目錄引用不展開，見 isDirRef）
  const cover = {};
  for (const t of chain) {
    const set = new Set();
    for (const r of refs[t.name] || []) {
      if (isDirRef(r)) continue;                    // 目錄引用：規則 2 就夠了，不展開閉包（修訂二）
      if (graph.has(r)) for (const f of closure(graph, r)) set.add(f);
    }
    cover[t.name] = set;
  }

  const serverTests = chain.filter((t) => (refs[t.name] || []).includes(SERVER_ENTRY)).map((t) => t.name);

  for (const { path: f, status } of entries) {
    let claimed = false;

    // sw.js 只改 VERSION 行（修訂 1-A）：不算放大器 C
    if (f === SW_VERSION_ONLY) {
      for (const t of SW_VERSION_TESTS) add(t, 'sw.js 只改了 VERSION 那一行');
      continue;
    }

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

    // 突變清單（見 MUT_LIST_RE 上面的正確性依據）
    if (!claimed && MUT_LIST_RE.test(f)) {
      const info = Object.prototype.hasOwnProperty.call(mutLists, f) ? mutLists[f] : null;
      if (info && info.kind === 'mutate') {
        if (info.missingCmd.length) {
          errors.push(`突變清單 ${f}：${info.missingCmd.length} 條沒有 cmd 或 cmd 不是「node scripts/<名字>.mjs」（${info.missingCmd.join('、')}）——挑不出該跑哪幾支，判紅`);
          fullReasons.push(`突變清單 ${f} 有沒填 cmd 的突變`);
        } else {
          for (const t of MUT_LIST_TESTS) add(t, `讀突變清單目錄：${f}`);
          for (const t of info.tests) {
            if (names.includes(t)) add(t, `突變清單 ${f} 的 cmd 點名`);
            else notes.push(`突變清單 ${f} 的 cmd 點名 ${t}——不在鏈裡，不跑（不是每版的測試）`);
          }
        }
        continue;
      }
      if (!info) { fullReasons.push(`突變清單 ${f}：讀不到、解析不了或已刪除 → 全套`); continue; }
      // 補丁格式：照舊落到下面「沒有規則認領」
    }

    if (claimed) continue;
    if (isDocLike(f, chainFiles)) continue;
    if (f === 'package.json') { notes.push('package.json：底線（affectedtest 會驗鏈）'); continue; }
    if (isCode(f)) {
      if (dMode === 'full') fullReasons.push(`放大器 D：${f} 沒有任何一支測試涵蓋`);
      else {
        notes.push(`放大器 D：${f} 沒有任何一支測試涵蓋 → 加跑畫面組＋資料組`);
        for (const t of AMP_A_TESTS) add(t, `放大器 D：${f}（沒人認領）`);
        for (const t of serverTests) add(t, `放大器 D：${f}（沒人認領）`);
      }
    } else fullReasons.push(`沒有規則認領的檔：${f}`);
  }

  const full = fullReasons.length > 0;
  if (full) for (const n of names) (reasons[n] ||= []).push('全套');
  const selected = names.filter((n) => reasons[n]);
  return { selected, reasons, full, fullReasons, notes, errors, n: selected.length, m: names.length };
}

// ---------- 輸出（R5） ----------
export function formatReport(r) {
  const lines = [];
  for (const e of r.errors || []) lines.push('✗ ' + e);
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
