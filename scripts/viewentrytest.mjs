// 畫面只有一個入口（npm run viewentrytest）
//
// 起因（2026-10-28，settletest）：路由器記了「哪一次換頁是最新的」（gen），但畫面怎麼畫它管不到——
// 每個畫面自己 import app.js 的 render() 直接寫進 #view，畫面重畫時又直接呼叫自己、不經路由器。
// 行程頁還在載景點庫時使用者點了「分帳」，分帳頁先畫好，行程頁晚一步畫完把它蓋掉。
// 修法是讓路由器成為唯一畫畫面的地方（drawPage、setTop、refreshPage，見 js/router.js）；這支盯著「有沒有人繞過它」。三類：
//   A 直接寫主畫面：router.js 以外的檔 import render／renderLoading／setTop（頂列）並呼叫、或直接碰 #view
//   B 畫面自己重畫：路由表裡的畫面（登記制：讀 app.js 的 route(...) 表）直接呼叫自己或別的畫面的 default 函式
//   C 畫面函式的參數沒收下 drawPage、setTop（函式裡用到時會是不存在的名字）
// 用法：node scripts/viewentrytest.mjs          → 先跑對照組，再斷言 A、B、C 都是 0
//       node scripts/viewentrytest.mjs --list   → 先跑對照組，再逐條列出現況（不斷言 0；遷移期間看進度用）
//       （--root <目錄> 只給對照組用：對著暫存複本掃）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argRoot = process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : null;
const LIST = process.argv.includes('--list');

// 只去掉註解（保留行號）；字串裡的 // 以「前面是 : 」粗略判斷成網址、不當註解
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    // 不用 .*$：CRLF 的檔每行尾有 \r，「.」不吃 \r、$ 又只認字串尾，整行註解就留下來了（2026-10-28 實測 app.js）
    .split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/[^\r\n]*/, '$1')).join('\n');
}
const lineOf = (code, idx) => code.slice(0, idx).split('\n').length;

function listJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJs(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

export function scan(root) {
  const js = path.join(root, 'js');
  const files = listJs(js);
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const appSrc = strip(fs.readFileSync(path.join(js, 'app.js'), 'utf8'));
  // 路由表：route('…', async (…) => (await import('./views/X.js')).default(…))，或 .<具名匯出>(…)（例：trip.js 的 settings）
  const routeLines = appSrc.split('\n').filter((l) => /^\s*route\(/.test(l));
  const routes = [...appSrc.matchAll(/route\('[^']*',[^\n]*?import\('\.\/views\/([\w-]+)\.js'\)\)\.([\w$]+)\(/g)].map((m) => ({ file: m[1], exp: m[2] }));
  const viewNames = new Map();     // 檔名 → 路由會呼叫的函式名（一個檔可以有好幾個）
  let unresolved = 0;
  const sigMiss = [];
  for (const { file: v, exp } of routes) {
    const src = strip(fs.readFileSync(path.join(js, 'views', v + '.js'), 'utf8'));
    const m = exp === 'default'
      ? src.match(/export\s+default\s+(?:async\s+)?function\s+([\w$]+)/)
      : src.match(new RegExp(`export\\s+(?:async\\s+)?function\\s+(${exp})\\b`));
    if (!m) { unresolved++; continue; }
    if (!viewNames.has(v)) viewNames.set(v, new Set());
    viewNames.get(v).add(m[1]);
    // C：畫面函式的參數要收下 drawPage 與 setTop——沒收下的話，函式裡的 drawPage(…) 是一個不存在的名字，
    // 一進那一頁就丟 ReferenceError（遷移途中 trip.js 的 settings 就漏過一次，A、B 都看不出來）
    const params = src.slice(m.index).match(/\(([\s\S]*?)\)\s*\{/);
    for (const need of ['drawPage', 'setTop']) {
      // 同一支函式掛在兩條路由上（sos.js）只算一次
      if (sigMiss.some((x) => x.file === `js/views/${v}.js` && x.what.startsWith(`${m[1]}(…) 參數沒有 ${need}`))) continue;
      if (!params || !new RegExp(`\\b${need}\\b`).test(params[1])) {
        sigMiss.push({ kind: 'C', file: `js/views/${v}.js`, line: lineOf(src, m.index), what: `${m[1]}(…) 參數沒有 ${need}` });
      }
    }
  }
  const routeViews = routes;
  const hits = [...sigMiss];
  for (const f of files) {
    const r = rel(f);
    if (r === 'js/router.js') continue;
    const code = strip(fs.readFileSync(f, 'utf8'));
    // A：碰 #view
    for (const m of code.matchAll(/getElementById\(\s*['"]view['"]\s*\)|querySelector(?:All)?\(\s*['"]#view\b/g)) hits.push({ kind: 'A', file: r, line: lineOf(code, m.index), what: m[0] });
    // A：import render／renderLoading（來自 app.js），以及呼叫
    const imp = code.match(/import\s*\{([^}]*)\}\s*from\s*['"](?:\.\.\/|\.\/)app\.js['"]/);
    // setTop：頂列也是畫面的一部分（2026-10-28 遷移途中 settletest 抓到：過期的行程頁改掉了分帳頁的頂列按鈕）
    const names = imp ? imp[1].split(',').map((s) => s.trim().split(/\s+as\s+/)).filter(([orig]) => /render/i.test(orig) || orig === 'setTop').map((p) => p.pop()) : [];
    if (r === 'js/app.js') names.push('render', 'renderLoading', 'setTop');
    for (const n of new Set(names)) {
      for (const m of code.matchAll(new RegExp(`(?<![\\w$.])${n}\\s*\\(`, 'g'))) {
        const before = code.slice(Math.max(0, m.index - 9), m.index);
        if (/function\s+$/.test(before)) continue;     // 定義本身不算呼叫
        hits.push({ kind: 'A', file: r, line: lineOf(code, m.index), what: `${n}(…)` });
      }
    }
    // A：app.js 自己 mount(view, …)
    for (const m of code.matchAll(/mount\(\s*view\b/g)) hits.push({ kind: 'A', file: r, line: lineOf(code, m.index), what: 'mount(view, …)' });
    // B：路由畫面直接呼叫自己（或別的路由畫面的 default 函式）
    const self = r.match(/^js\/views\/([\w-]+)\.js$/);
    if (self && viewNames.has(self[1])) {
      const targets = [...viewNames.get(self[1])];
      // 別的路由畫面：default import 進來的名字（具名匯出的畫面函式用原名 import）
      for (const m of code.matchAll(/import\s+([\w$]+)\s+from\s*['"]\.\/([\w-]+)\.js['"]/g)) if (viewNames.has(m[2])) targets.push(m[1]);
      for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/([\w-]+)\.js['"]/g)) {
        if (!viewNames.has(m[2])) continue;
        for (const part of m[1].split(',')) { const [orig, alias] = part.trim().split(/\s+as\s+/); if (viewNames.get(m[2]).has(orig)) targets.push(alias || orig); }
      }
      for (const t of targets) {
        for (const m of code.matchAll(new RegExp(`(?<![\\w$.])${t.replace(/\$/g, '\\$')}\\s*\\(`, 'g'))) {
          const before = code.slice(Math.max(0, m.index - 9), m.index);
          if (/function\s+$/.test(before)) continue;
          hits.push({ kind: 'B', file: r, line: lineOf(code, m.index), what: `${t}(…)` });
        }
      }
    }
  }
  return { files: files.length, routeLines: routeLines.length, routeViews: routeViews.length, unresolved, viewFiles: viewNames.size, hits };
}

// ---------- 對照組：暫存複本裡各放一處繞路，從命令列入口掃 ----------
function controls() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viewentry-'));
  const results = [];
  try {
    fs.cpSync(path.join(ROOT, 'js'), path.join(tmp, 'js'), { recursive: true });
    const run = () => {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', tmp, '--json'], { encoding: 'utf8' });
      try { return JSON.parse(r.stdout); } catch { return null; }
    };
    const base = run();
    if (!base || !base.files || !base.routeViews) return { ok: false, why: `複本掃不到東西：${JSON.stringify(base)}` };
    // A：一個新的工具檔直接 import render 並呼叫
    const pa = path.join(tmp, 'js', 'zz-bypass.js');
    fs.writeFileSync(pa, "import { render } from './app.js';\nexport function zz() { render(document.createElement('div')); }\n");
    if (!fs.readFileSync(pa, 'utf8').includes('render(document')) return { ok: false, why: '樣本 A 沒寫進去' };
    const a = run();
    fs.rmSync(pa);
    const aNew = a && a.hits.length - base.hits.length;
    results.push(['A 新檔直接 render', aNew === 1 && a.hits.some((h) => h.kind === 'A' && h.file === 'js/zz-bypass.js')]);
    // A：一個新檔改頂列（import setTop 並呼叫）
    const pt = path.join(tmp, 'js', 'zz-top.js');
    fs.writeFileSync(pt, "import { setTop } from './app.js';\nexport function zz() { setTop({ title: 'x' }); }\n");
    if (!fs.readFileSync(pt, 'utf8').includes('setTop({')) return { ok: false, why: '樣本 A（頂列）沒寫進去' };
    const at = run();
    fs.rmSync(pt);
    const atNew = at && at.hits.length - base.hits.length;
    results.push(['A 新檔直接改頂列', atNew === 1 && at.hits.some((h) => h.kind === 'A' && h.file === 'js/zz-top.js' && h.what.startsWith('setTop'))]);
    // B：在一個登記過的畫面（album）裡加一處自我重畫
    const pb = path.join(tmp, 'js', 'views', 'album.js');
    const orig = fs.readFileSync(pb, 'utf8');
    fs.writeFileSync(pb, orig + "\nexport function zzAgain(t) { album(t); }\n");
    if (!fs.readFileSync(pb, 'utf8').includes('album(t)')) return { ok: false, why: '樣本 B 沒寫進去' };
    const b = run();
    fs.writeFileSync(pb, orig);
    const bNew = b && b.hits.length - base.hits.length;
    results.push(['B 畫面自我重畫', bNew === 1 && b.hits.some((h) => h.kind === 'B' && h.file === 'js/views/album.js')]);
    // C：畫面函式的參數拿掉 drawPage（album 的簽名是登記過的路由函式）
    const sigA = 'export default async function album(';
    const origSig = fs.readFileSync(pb, 'utf8');
    const i0 = origSig.indexOf(sigA);
    const close = i0 < 0 ? -1 : origSig.indexOf(')', i0);
    if (i0 < 0 || close < 0) return { ok: false, why: '樣本 C：找不到 album 的簽名' };
    const stripped = origSig.slice(0, i0) + origSig.slice(i0, close).replace(/\bdrawPage\b,?\s*/, '') + origSig.slice(close);
    fs.writeFileSync(pb, stripped);
    if (fs.readFileSync(pb, 'utf8') === origSig) return { ok: false, why: '樣本 C 沒改到（album 的簽名本來就沒有 drawPage？）' };
    const cc = run();
    fs.writeFileSync(pb, origSig);
    const ccNew = cc && cc.hits.length - base.hits.length;
    results.push(['C 畫面函式沒收下 drawPage', ccNew === 1 && cc.hits.some((h) => h.kind === 'C' && h.file === 'js/views/album.js' && h.what.includes('drawPage'))]);
    // 反向：拿掉樣本之後回到原數
    const back = run();
    results.push(['拿掉樣本後回到原數', back && back.hits.length === base.hits.length]);
    // 反向：註解裡的寫法不算
    fs.writeFileSync(pb, orig + "\n// album(t); render(x);\n");
    const c = run();
    fs.writeFileSync(pb, orig);
    results.push(['註解裡的不算', c && c.hits.length === base.hits.length]);
    // 反向：CRLF 換行的檔，註解一樣不算（app.js 等幾支是 CRLF）
    fs.writeFileSync(pb, orig + "\r\n// album(t); render(x);\r\nexport const zzCrlf = 1;\r\n");
    if (!fs.readFileSync(pb, 'utf8').includes('\r\n// album(t)')) return { ok: false, why: '樣本（CRLF 註解）沒寫進去' };
    const cr = run();
    fs.writeFileSync(pb, orig);
    results.push(['CRLF 檔的註解也不算', cr && cr.hits.length === base.hits.length]);
    return { ok: results.every((x) => x[1]), results, base: base.hits.length };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(scan(argRoot || ROOT)));
} else {
  let fail = 0;
  const yes = (c, m, x) => { if (c) console.log('✓ ' + m); else { console.log('✗ ' + m + (x ? '\n   ' + x : '')); fail++; } };
  const ctl = controls();
  if (ctl.results) for (const [n, okk] of ctl.results) yes(okk, `對照組：${n}`);
  else yes(false, '對照組跑不起來', ctl.why);
  const s = scan(ROOT);
  const A = s.hits.filter((h) => h.kind === 'A'), B = s.hits.filter((h) => h.kind === 'B'), C = s.hits.filter((h) => h.kind === 'C');
  console.log(`掃了 js/ 底下 ${s.files} 支 .js；app.js 有 ${s.routeLines} 行 route(…)，認得 ${s.routeViews} 條、畫面檔 ${s.viewFiles} 個、找不到函式的 ${s.unresolved} 條`);
  yes(s.files > 0 && s.routeLines > 0 && s.routeViews === s.routeLines && s.unresolved === 0,
    '母體：路由表每一行都認得、每一條都找得到它呼叫的函式', `route 行 ${s.routeLines}、認得 ${s.routeViews}、找不到 ${s.unresolved}`);
  if (LIST) {
    console.log(`\n現況：A 直接寫主畫面 ${A.length} 處、B 畫面自我重畫 ${B.length} 處、C 畫面函式沒收下畫筆 ${C.length} 處，共 ${A.length + B.length + C.length}`);
    for (const h of s.hits) console.log(`  ${h.kind}  ${h.file}:${h.line}  ${h.what}`);
    const byFile = {};
    for (const h of s.hits) byFile[h.file] = (byFile[h.file] || 0) + 1;
    console.log(`  涉及 ${Object.keys(byFile).length} 個檔`);
  } else {
    yes(A.length === 0, `A 直接寫主畫面 0 處（實得 ${A.length}）`, A.slice(0, 5).map((h) => `${h.file}:${h.line} ${h.what}`).join('\n   '));
    yes(B.length === 0, `B 畫面自我重畫 0 處（實得 ${B.length}）`, B.slice(0, 5).map((h) => `${h.file}:${h.line} ${h.what}`).join('\n   '));
    yes(C.length === 0, `C 畫面函式都收下 drawPage 與 setTop（沒收下 ${C.length} 處）`, C.slice(0, 5).map((h) => `${h.file}:${h.line} ${h.what}`).join('\n   '));
  }
  console.log(fail ? `\n✗ 有失敗（${fail} 項）` : '\n✓ 全部通過');
  process.exitCode = fail ? 1 : 0;
}
