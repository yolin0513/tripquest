// 原生插入沒有收到可能是空的值（npm run nullinserttest；秒級、不開瀏覽器、掃描型——在底線與 SCAN_ONLY）
//
// 涵蓋的程式：js/**/*.js
//
// 起因：同一種 bug 第三次上畫面。
//   v1.23（sweep.mjs 檔頭）：replaceChildren(null) 把「null」印在畫面上；
//   v1.86.0（2026-11-11 Yolin iPhone 截圖）：行程頁「怎麼去」的選項旁一個 null（trip.js 的 legRow）、結束的旅程「nullnull」（buildPlan）；
//   v1.87.1（2026-11-14 Yolin 實機截圖）：照片牆「動態」表情列右邊一個 null（people.js 的 feedItem）。
// 成因都一樣：我們自己的 h() 會略過 null／false，DOM 原生的 append／prepend／replaceChildren／before／after／replaceWith 不會——
// 它把 null 轉成文字「null」、false 轉成「false」。前兩次都只修了那一處；這次照 §5.16「已知的壞寫法要做成機器掃得到的」。
// 同一輪掃出另外兩處同形狀、還沒被看到的：photoimg.js「照片下載中…nullnull」、import.js「要建立 N 個景點null」。
//
// 掃什麼：js/ 底下每一個原生插入呼叫（.append( .prepend( .replaceChildren( .before( .after( .replaceWith(）的每一個頂層參數。
//   T 三元：頂層 a ? b : c，有一支（含巢狀的三元）是 null／undefined／false／空字串
//   A 且：頂層 a && b（a 不成立時整個是 false／0／空字串／null）
//   O 或預設空：頂層 a || null、a ?? null（undefined 也算）
//   S 展開陣列：...[ … ] 裡有一個元素是上面三種之一，而且這個陣列後面沒有接 .filter(
// 註解、字串、樣板字面裡的字不算（先遮掉；樣板的 ${ } 裡面是程式，照樣掃）。
// 不掃的（已知限制）：參數是一個名字或函式呼叫，而它的值可能是空的（const x = c ? 節點 : null; el.append(x)）——
//   靜態看不出來；2026-11-14 一次性追過全部 137 個（追同檔的每一次賦值與函式回傳），沒有一處會是空的。畫面上那一層由
//   scripts/blanktext.mjs（瀏覽器測試共用的全畫面掃描）補。
// 登記的例外：沒有（§5.16：例外只能在實際命中、逐行看過之後補登，不預先猜）。
//
// 用法：node scripts/nullinserttest.mjs                 → 先跑對照組，再斷言 0 處
//       node scripts/nullinserttest.mjs --list          → 先跑對照組，再逐條列出命中（不斷言 0）
//       （--root <目錄> --json 只給對照組用：對著暫存複本掃、印 JSON）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argRoot = process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : null;
const LIST = process.argv.includes('--list');
const METHODS = ['append', 'prepend', 'replaceChildren', 'before', 'after', 'replaceWith'];
const CALL = new RegExp(`\\.(${METHODS.join('|')})\\(`, 'g');

// ---- 遮罩：註解換成空白、字串與樣板的字換成 x（引號留著），樣板 ${ } 裡的程式照留；換行一律保留（行號不變）----
const REGEX_BEFORE = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '']);
export function mask(src) {
  let out = '';
  let i = 0;
  const lastSig = () => { const m = out.match(/(\S)\s*$/); return m ? m[1] : ''; };
  const keepNl = (s) => s.replace(/[^\n]/g, ' ');
  const fill = (s) => s.replace(/[^\n]/g, 'x');
  function code(stopAtBrace) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; out += keepNl(src.slice(i, end)); i = end; continue; }
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; out += keepNl(src.slice(i, end)); i = end; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1; while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
        out += c + fill(src.slice(i + 1, j)) + (src[j] === c ? c : ''); i = src[j] === c ? j + 1 : j; continue;
      }
      if (c === '`') { out += '`'; i++; tpl(); continue; }
      if (c === '/' && REGEX_BEFORE.has(lastSig()) && !/[\w$)\]]\s*$/.test(out.slice(-40))) {
        // 正規式字面：讀到沒跳脫的 /（字元類別 [] 裡的 / 不算），旗標一起帶走
        let j = i + 1, cls = false;
        while (j < src.length && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break;
          j++;
        }
        j++; while (/[a-z]/i.test(src[j] || '')) j++;
        out += '/' + fill(src.slice(i + 1, j - 1)) + '/'; i = j; continue;
      }
      if (stopAtBrace) {
        if (c === '{') depth++;
        else if (c === '}') { if (depth === 0) return; depth--; }
      }
      out += c; i++;
    }
  }
  function tpl() {
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { out += fill(src.slice(i, i + 2)); i += 2; continue; }
      if (c === '`') { out += '`'; i++; return; }
      if (c === '$' && src[i + 1] === '{') { out += '${'; i += 2; code(true); if (src[i] === '}') { out += '}'; i++; } continue; }
      out += c === '\n' ? '\n' : 'x'; i++;
    }
  }
  code(false);
  return out;
}

// ---- 遮罩後的程式：配對括號、頂層切逗號、找頂層運算子 ----
const OPEN = '([{', CLOSE = ')]}';
function matchClose(s, i) {       // s[i] 是左括號 → 回傳配對的右括號位置；樣板字面的 ` 之間略過（裡面的 ${ } 已是平衡的）
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) { depth--; if (depth === 0) return j; }
  }
  return -1;
}
function topSplit(s, sep) {        // 頂層依 sep（單一字元）切開
  const out = []; let depth = 0, start = 0;
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (c === sep && depth === 0) { out.push(s.slice(start, j)); start = j + 1; }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}
function topIndexes(s, test) {     // 頂層每一個位置 j，test(s, j) 成立的都列出來
  const out = []; let depth = 0;
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (depth === 0 && test(s, j)) out.push(j);
  }
  return out;
}
const isQ = (s, j) => s[j] === '?' && s[j + 1] !== '.' && s[j + 1] !== '?' && s[j - 1] !== '?';
const isColon = (s, j) => s[j] === ':';
const NULLISH = /^(null|undefined|false|''|""|``|void 0)$/;
const nullish = (e) => NULLISH.test(e.trim());
// 頂層三元 → [條件, 成立, 不成立]；巢狀的三元留在分支裡（遞迴看）
function ternary(e) {
  const qs = topIndexes(e, isQ);
  if (!qs.length) return null;
  const q = qs[0];
  // 從 q 往後找配對的冒號：中間每多一個 ? 就要多跳過一個 :
  let need = 1;
  const marks = topIndexes(e, (s, j) => j > q && (isQ(s, j) || isColon(s, j)));
  for (const j of marks) {
    if (e[j] === '?') need++;
    else if (--need === 0) return [e.slice(0, q), e.slice(q + 1, j), e.slice(j + 1)];
  }
  return null;
}
function hasNullBranch(e) {
  const t = ternary(e.trim());
  if (!t) return nullish(e);
  return hasNullBranch(t[1]) || hasNullBranch(t[2]);
}
// 一個參數（或展開陣列裡的一個元素）是哪一種：'T'｜'A'｜'O'｜null
export function kindOf(arg) {
  const e = arg.trim();
  if (ternary(e) && hasNullBranch(e)) return 'T';
  if (topIndexes(e, (s, j) => s[j] === '&' && s[j + 1] === '&').length) return 'A';
  const ors = topIndexes(e, (s, j) => (s[j] === '|' && s[j + 1] === '|') || (s[j] === '?' && s[j + 1] === '?'));
  if (ors.length && nullish(e.slice(ors[ors.length - 1] + 2))) return 'O';
  return null;
}

export function scanSource(src) {
  const m = mask(src);
  const hits = []; let calls = 0, args = 0, spreads = 0;
  CALL.lastIndex = 0;
  let x;
  while ((x = CALL.exec(m))) {
    const open = x.index + x[0].length - 1;
    const close = matchClose(m, open);
    const line = m.slice(0, x.index).split('\n').length;
    if (close < 0) { hits.push({ line, kind: '?', method: x[1], arg: '（括號配不起來：檢查器讀不懂這一段）' }); continue; }
    calls++;
    for (const a of topSplit(m.slice(open + 1, close), ',')) {
      args++;
      const show = a.replace(/\s+/g, ' ').slice(0, 90);
      if (a.startsWith('...')) {
        const body = a.slice(3).trim();
        if (body.startsWith('[')) {
          spreads++;
          const end = matchClose(body, 0);
          const after = end < 0 ? '' : body.slice(end + 1).trim();
          if (end >= 0 && !after.startsWith('.filter(')) {
            const bad = topSplit(body.slice(1, end), ',').map(kindOf).filter(Boolean);
            if (bad.length) hits.push({ line, kind: 'S', method: x[1], arg: show });
          }
        }
        continue;
      }
      const k = kindOf(a);
      if (k) hits.push({ line, kind: k, method: x[1], arg: show });
    }
  }
  return { hits, calls, args, spreads };
}

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
  const files = listJs(path.join(root, 'js'));
  const all = { files: files.length, calls: 0, args: 0, spreads: 0, hits: [] };
  for (const f of files) {
    const r = scanSource(fs.readFileSync(f, 'utf8'));
    all.calls += r.calls; all.args += r.args; all.spreads += r.spreads;
    const rel = path.relative(root, f).split(path.sep).join('/');
    for (const h of r.hits) all.hits.push({ file: rel, ...h });
  }
  return all;
}

// ---- 對照組：在暫存複本裡、從命令列入口跑（§5.20）。每個分支一個合成樣本，只該打到它自己那一支 ----
// 樣本的壞寫法在執行時才拼起來（§5.3：被擋的東西不原樣寫下——不然這支檔自己就是一處命中）。
const NUL = ['nu', 'll'].join('');
const SAMPLES = [
  { id: 'T 三元有一支是空的', kind: 'T', body: `x.append(c ? h('i') : ${NUL});` },
  { id: 'T 巢狀三元裡有空的', kind: 'T', body: `x.prepend(c ? h('i') : d ? h('b') : ${NUL});` },
  { id: 'A 頂層 &&', kind: 'A', body: `x.replaceChildren(h('i'), ok ${'&'}& h('b'));` },
  { id: 'O 或預設空', kind: 'O', body: `x.after(node ${'|'}| ${NUL});` },
  { id: 'S 展開陣列沒過濾', kind: 'S', body: `x.append(...[h('i'), c ? h('b') : ${NUL}]);` },
];
// 反向：這些都不能被報（正常的寫法、h() 裡面的、過濾過的、註解與字串裡的、兩支都是節點的三元）
const CLEAN = [
  `x.append(c ? h('i') : h('b'));`,
  `x.append(h('div', {}, c ? h('i') : ${NUL}));`,
  `x.append(...[c ? ${NUL} : h('i')].filter(Boolean));`,
  `x.append(...(c ? [h('i')] : []));`,
  `// x.append(c ? h('i') : ${NUL});`,
  `const s = "x.append(c ? h('i') : ${NUL})";`,
  `x.append(\`\${c ? 'a' : ''}\`);`,
  `x.append(n ?? h('i'));`,
];
function controls() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tq-nullins-'));
  const results = [];
  try {
    fs.cpSync(path.join(ROOT, 'js'), path.join(tmp, 'js'), { recursive: true });
    const self = fileURLToPath(import.meta.url);
    const run = (extra = []) => spawnSync(process.execPath, [self, '--root', tmp, ...extra], { encoding: 'utf8' });
    const json = () => { const r = run(['--json']); try { return JSON.parse(r.stdout); } catch { return null; } };
    const base = json();
    if (!base || !base.files || !base.calls) return { ok: false, why: `複本掃不到東西：${JSON.stringify(base)}` };
    const key = (h) => `${h.file}:${h.line}:${h.kind}`;
    const baseKeys = new Set(base.hits.map(key));
    const fresh = (r) => (r ? r.hits.filter((h) => !baseKeys.has(key(h))) : null);
    const smp = path.join(tmp, 'js', 'zz-nullins.js');
    const write = (body) => {
      fs.writeFileSync(smp, `import { h } from './ui.js';\nexport function zz(x, c, d, ok, node, n) {\n  ${body}\n}\n`);
      return fs.readFileSync(smp, 'utf8').includes(body);   // 讀回確認樣本真的寫進去了（§5.20）
    };
    for (const s of SAMPLES) {
      if (!write(s.body)) { results.push([s.id, false, '樣本沒寫進去']); continue; }
      const got = fresh(json());
      results.push([`${s.id}（${s.body.replace(NUL, '空值')}）`, !!got && got.length === 1 && got[0].kind === s.kind && got[0].file === 'js/zz-nullins.js',
        JSON.stringify(got)]);
    }
    for (const body of CLEAN) {
      if (!write(body)) { results.push(['反向樣本沒寫進去', false, body]); continue; }
      const got = fresh(json());
      results.push([`反向：不報「${body.replace(new RegExp(NUL, 'g'), '空值')}」`, !!got && got.length === 0, JSON.stringify(got)]);
    }
    // 整支跑（不是 --json）：有命中就回非 0、✗ 那一行點名那一個檔——「處置」那一環（斷言 0 處）自己的對照組。
    // 五個樣本一起放：拿掉任何一個分支，這一條照樣有命中（只有「處置」那一環壞了它才紅，§5.12 處置共用另列一條）
    write(SAMPLES.map((s) => s.body).join('\n  '));
    const full = run();
    const named = full.stdout.split('\n').some((l) => l.startsWith('✗ ') && l.includes('0 處')) && full.stdout.includes('js/zz-nullins.js');
    results.push(['整支跑：有一處就回非 0、點名那一個檔', full.status !== 0 && named, `回 ${full.status}`]);
    fs.rmSync(smp);
    const back = json();
    results.push(['拿掉樣本後回到原數', !!back && back.hits.length === base.hits.length && back.calls === base.calls]);
    return { ok: results.every((r) => r[1]), results };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(scan(argRoot || ROOT)));
} else {
  let pass = 0, fail = 0;
  const yes = (c, m, x) => { if (c) { pass++; console.log('✓ ' + m); } else { fail++; console.log('✗ ' + m + (x ? '\n   ' + x : '')); } };
  if (!argRoot) {
    const ctl = controls();
    if (ctl.results) for (const [n, okk, why] of ctl.results) yes(okk, `對照組：${n}`, okk ? '' : why);
    else yes(false, '對照組跑不起來', ctl.why);
  }
  const s = scan(argRoot || ROOT);
  const by = (k) => s.hits.filter((h) => h.kind === k).length;
  console.log(`  掃了 js/ 底下 ${s.files} 支 .js：原生插入呼叫 ${s.calls} 個、頂層參數 ${s.args} 個（其中展開陣列字面 ${s.spreads} 個）`);
  yes(s.files > 0 && s.calls > 0 && s.args >= s.calls, `母體：有檔、有呼叫（${s.files} 支、${s.calls} 個）`);
  if (LIST) {
    console.log(`  現況：T ${by('T')}、A ${by('A')}、O ${by('O')}、S ${by('S')}、讀不懂 ${by('?')}，共 ${s.hits.length}`);
    for (const h of s.hits) console.log(`  ${h.kind}  ${h.file}:${h.line}  .${h.method}(${h.arg})`);
  } else {
    yes(s.hits.length === 0, `原生插入收到可能是空的值：0 處（實得 ${s.hits.length}：T ${by('T')}、A ${by('A')}、O ${by('O')}、S ${by('S')}、讀不懂 ${by('?')}）`,
      s.hits.slice(0, 8).map((h) => `${h.kind} ${h.file}:${h.line} .${h.method}(${h.arg})`).join('\n   '));
  }
  console.log(`\n空值插入檢查：${pass} 項通過、${fail} 項失敗`);
  process.exitCode = fail ? 1 : 0;
}
