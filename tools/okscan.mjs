// 盤點「helper 會回失敗值、呼叫端卻沒接」（2026-10-29 入庫）
//   node tools/okscan.mjs          先跑對照組，對照組沒過就停（回 1）；過了才掃 scripts/*.mjs
//
// 為什麼入庫：2026-10-28 報過一個「33 處」，搜法沒留下來，隔天無法複核、重搜得到 36。
// 一個數字沒有留下產生它的方法，就不是結果、只是傳聞——產生數字的腳本跟數字一起入庫（docs/OKCHECK_盤點.md）。
//
// 搜法（在搜的樣式範圍內）：
//   helper：任何縮排層級的 `function X` 或 `const X = (async) (...) =>`，本體裡有 return false／return null／return !!／ok:
//           本體＝定義行到下一個縮排不深於它的行（單行箭頭只算那一行）。
//   沒接：那一行以 `(await )X(` 開頭——陳述式，回傳值直接丟掉。
// 盲點（看不到的，不是 0）：
//   - 失敗時什麼都不回（回 undefined）的 helper，例如 `el?.click()`——呼叫端接不接都看不出點沒點到。
//     layouttest 的 MODALS 開法就是這種（docs/LAYOUT_COVERAGE.md「順帶發現」）。
//   - helper 定義在別支檔、被 import 進來的（只在同一支檔裡配對定義與呼叫）。
//   - 一個陳述式跨行、或被包在 Promise.all([...]) 裡的呼叫（行首不是 X( 的不算「沒接」）。
//   - 誤報：本體有 ok: 的假回應（例 moneytest 的 resp）、失敗時自己丟例外或記紅的——要逐處看。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function scan(files) {
  const out = [];
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    const helpers = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(\s*)(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/.exec(lines[i]);
      if (!m) continue;
      const name = m[2] || m[4];
      const ind = (m[1] ?? m[3] ?? '').length;
      const indOf = (s) => /^\s*/.exec(s)[0].length;
      let j = i + 1;
      if (/[{(]\s*$/.test(lines[i].replace(/\/\/.*$/, ''))) {
        while (j < lines.length && (!lines[j].trim() || indOf(lines[j]) > ind)) j++;
        if (j < lines.length && /^\s*[}\)]/.test(lines[j])) j++;
      }
      const body = lines.slice(i, j).join('\n');
      if (/return\s+false\b|return\s+null\b|return\s+!!|\bok\s*:/.test(body)) helpers.push({ name, def: i + 1, end: j });
    }
    for (const h of helpers) {
      for (let k = 0; k < lines.length; k++) {
        if (k + 1 >= h.def && k + 1 <= h.end) continue;
        const L = lines[k];
        if (!new RegExp(`\\b${h.name}\\(`).test(L) || /^\s*\/\//.test(L)) continue;
        out.push({ file: f, helper: h.name, line: k + 1, bare: new RegExp(`^\\s*(?:await\\s+)?${h.name}\\(`).test(L), text: L.trim().slice(0, 140) });
      }
    }
  }
  return out;
}

// 對照組：合成檔走同一個 scan()。頂層 helper、單行箭頭 helper、巢狀在函式裡的 helper 各一個沒接；
// 三處有接；一個不回失敗值的函式的呼叫不能算進來。巢狀那一種是第一版漏掉 membergonetest pressModal 之後補的。
function control() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okscan-'));
  const f = path.join(dir, 'ctl.mjs');
  fs.writeFileSync(f, [
    'async function clickX(p) {', '  if (!p) return false;', '  return true;', '}',
    'const tapY = async (p) => { return { ok: false, why: "x" }; };',
    'function plain() {', '  return 1;', '}',
    'await clickX(1);', 'const r = await clickX(2);', 'if (!(await clickX(3))) throw 1;',
    'await tapY(1);', 'plain();',
    'async function main() {', '  const pressZ = async (l) => {', '    if (!l) return false;', '    return true;', '  };',
    '  await pressZ(1);', '  if (await pressZ(2)) {}', '}', '',
  ].join('\n'));
  const r = scan([f]);
  fs.rmSync(dir, { recursive: true, force: true });
  const bare = r.filter((x) => x.bare).map((x) => `${x.helper}@${x.line}`).sort().join(',');
  const want = 'clickX@9,pressZ@19,tapY@12';
  const ok = bare === want && r.length === 6;
  console.log(`${ok ? '✓' : '✗'} 對照組：沒接 ${bare || '（無）'}；呼叫共 ${r.length}（應為 ${want}；6）`);
  return ok;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!control()) process.exit(1);
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.mjs')).map((n) => path.join(dir, n));
  if (!files.length) { console.log('scripts/ 底下讀到 0 支 .mjs——不是沒有命中，是沒讀到'); process.exit(2); }
  const r = scan(files);
  const helpers = new Set(r.map((x) => `${path.basename(x.file)}:${x.helper}`));
  const bare = r.filter((x) => x.bare);
  console.log(`掃 ${files.length} 支 .mjs；有呼叫的 helper ${helpers.size} 個；呼叫 ${r.length} 處；沒接 ${bare.length} 處（含誤報，要逐處看）`);
  for (const x of bare) console.log(`${path.basename(x.file)}:${x.line}\t${x.helper}\t${x.text}`);
}
