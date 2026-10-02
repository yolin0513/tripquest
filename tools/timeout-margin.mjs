// 逾時餘裕表（2026-10-02，StockDiary／MealMate 撞到：修掉「逾時被當成紅」之後，讓測試變慢的突變會被判成「不算數」＝沒驗到）。
// 每一個「包住整支測試的逾時」×那支測試跑過最長的一次 → 倍數；不到 3 倍的標出來。**倍數用最長那次，不用中位數**
// （MealMate：中位數 3.1 倍剛好過、最長那次只有 2.3 倍）。只讀。
//   node tools/timeout-margin.mjs
// 耗時來源（都在 .logs/、不入庫）：run-affected 的逐支耗時（「  <測試> N 秒」）、sample-run 的結束行（檔名＝<測試>-*.txt）、
// 突變驅動每條一行（「回 N、S 秒」，那是改壞之後跑的——變慢的突變正是要看的）、tools/test-times.json（有的話）。
// 沒有任何量測的寫「沒量過」，不猜。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = path.join(ROOT, '.logs');
const RE_AFF = /^ {2}([a-z0-9-]+) (\d+(?:\.\d+)?) 秒$/gm;
const RE_END = /^結束：exit \S+、(\d+(?:\.\d+)?) 秒/m;
const RE_ROW = /^[✓✗] (\S[^：]*)：回 \S+、(\d+(?:\.\d+)?) 秒/gm;
// 對照組（同一組樣式、合成樣本）
{
  const a = [...'x\n  layouttest 516.2 秒\n  imgtest 9 秒\n   深一層 3 秒\n'.matchAll(RE_AFF)].map((m) => `${m[1]}=${m[2]}`).join(',');
  const b = RE_END.exec('a\n結束：exit 0、45.2 秒；b')?.[1];
  const c = [...'✓ M1 x：回 1、12.5 秒、y\n'.matchAll(RE_ROW)].map((m) => m[2]).join();
  if (!(a === 'layouttest=516.2,imgtest=9' && b === '45.2' && c === '12.5')) { console.log(`✗ 對照組沒過（${a}｜${b}｜${c}）——不採信`); process.exit(4); }
}
const max = {};
const put = (t, s, src) => { if (!max[t] || s > max[t].s) max[t] = { s, src }; };
for (const f of fs.existsSync(L) ? fs.readdirSync(L).filter((x) => /\.(txt|log)$/.test(x)) : []) {
  const t = fs.readFileSync(path.join(L, f), 'utf8');
  for (const m of t.matchAll(RE_AFF)) put(m[1], Number(m[2]), f);
  const e = RE_END.exec(t); const name = (f.match(/^([a-z0-9]+test)[-.]/) || [])[1];
  if (e && name) put(name, Number(e[1]), f);
}
// 突變驅動：改壞之後跑那支測試的耗時（每條一行）
const DRV = { 'mut_guard': 'mutatetest', 'mutguard': 'mutatetest', 'timeout-mut': null, 'run-timeout_mut': null, 'unformed': 'mutatetest' };
for (const f of fs.existsSync(L) ? fs.readdirSync(L).filter((x) => /mut.*\.txt$/.test(x)) : []) {
  const key = Object.keys(DRV).find((k) => f.includes(k));
  if (!key || !DRV[key]) continue;
  for (const m of fs.readFileSync(path.join(L, f), 'utf8').matchAll(RE_ROW)) put(`${DRV[key]}（改壞後）`, Number(m[2]), f);
}
const TT = path.join(ROOT, 'tools', 'test-times.json');
if (fs.existsSync(TT)) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(TT, 'utf8')))) put(k, v.sec, 'test-times.json');
// 文件裡的實測（2026-09-23 全面檢測；STATUS 有記、log 沒留）
put('layouttest', 580, 'STATUS／run-affected 註解：516～580 秒');
put('chunktest', 196, 'STATUS：2026-09-23 全面檢測最慢五支');
put('evtest', 45.1, 'STATUS：2026-10-02 實測約 45 秒');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const chain = [...pkg.scripts['test:chain'].matchAll(/node scripts\/([A-Za-z0-9_-]+)\.mjs/g)].map((m) => m[1]);
const rows = [];
const add = (where, limit, test, alt) => { const m = max[test] || (alt && max[alt]); rows.push({ where, limit, test, s: m ? m.s : null, src: m ? m.src : '' }); };
for (const t of chain) add('run-affected 單支（1800 秒）', 1800, t);
// App 突變（mutate.mjs）：照每條自己的 timeoutMs（沒寫＝預設 400 秒），同一支測試同一個逾時只列一次
const seenMut = new Set();
for (const f of fs.readdirSync(path.join(ROOT, 'tools', 'mutations')).filter((x) => x.endsWith('.json'))) {
  let j; try { j = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'mutations', f), 'utf8')); } catch { continue; }
  for (const m of Array.isArray(j) ? j : [j]) {
    if (!m || typeof m.cmd !== 'string') continue;
    const t = (m.cmd.match(/scripts\/([A-Za-z0-9_-]+)\.mjs/) || [])[1]; const lim = (m.timeoutMs || 400000) / 1000;
    if (!t || seenMut.has(`${t}@${lim}`)) continue;
    seenMut.add(`${t}@${lim}`); add(`mutate.mjs（${f}，${lim} 秒）`, lim, t);
  }
}
add('mut_guard_mut（300 秒）', 300, 'mutatetest（改壞後）', 'mutatetest');
add('unformed_mut（400 秒）', 400, 'mutatetest（改壞後）', 'mutatetest');
add('timeout_mut（400 秒）', 400, 'worktreeguardtest');
add('timeout_mut（400 秒）', 400, 'mutatetest（改壞後）', 'mutatetest');
add('predict_mut（300 秒）', 300, 'predicttest');
add('proctree_mut（120 秒）', 120, 'proctreetest');
const low = rows.filter((r) => r.s !== null && r.limit / r.s < 3);
const none = rows.filter((r) => r.s === null);
console.log(`逾時餘裕表：${rows.length} 列（有量測 ${rows.length - none.length}、沒量過 ${none.length}）；倍數＝逾時 ÷ 跑過最長的一次`);
for (const r of rows.filter((x) => x.s !== null).sort((a, b) => a.limit / a.s - b.limit / b.s)) {
  console.log(`  ${r.limit / r.s < 3 ? '✗' : ' '} ${(r.limit / r.s).toFixed(1)} 倍｜${r.where}｜${r.test} 最長 ${r.s} 秒（${r.src}）`);
}
console.log(`沒量過（不猜）：${none.map((r) => `${r.test}（${r.where}）`).join('、') || '無'}`);
console.log(low.length ? `不到 3 倍：${low.length} 列` : '全部 ≥ 3 倍');
process.exitCode = low.length ? 1 : 0;
