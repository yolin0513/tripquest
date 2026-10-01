// 跑「底線＋受影響」的測試（npm run test:affected）；只印清單不跑：npm run affected。
// 規格：docs/SPEC_測試範圍.md。挑選邏輯在 scripts/affected.mjs（純函式），這支負責
// 讀 git、讀檔、依鏈的順序一次一支跑（不平行 —— 這個 repo 的測試會互相搶資源）。
//
// 用法：
//   node scripts/run-affected.mjs                 改動＝git diff HEAD ＋ 未追蹤的新檔
//   node scripts/run-affected.mjs --base <ref>    改動＝<ref> 到工作樹（一版分好幾個 commit 時用）
//   node scripts/run-affected.mjs --commit <sha>  改動＝那一個 commit（回放歷史用）
//   node scripts/run-affected.mjs --files a,b     直接指定改動清單（示範／試算，不讀 git）
//   node scripts/run-affected.mjs --only a,b      只跑鏈上這幾支（不經挑選器；名字不在鏈上就停）
//   node scripts/run-affected.mjs --all           完整的鏈（npm test 走這裡）
//   加 --dry 只印不跑（含耗時預測）；重負載要加 --approved 才跑（沒加回 8）。
//
// 每一支測試前後各拍一次工作區（scripts/worktree-guard.mjs）：測試改了進版控的檔、或丟下沒被
// .gitignore 擋掉的新檔 → 回 3 並點名哪一支、哪幾個檔；拍不到（git 讀不到）→ 回 4，不當成沒改動。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseChain, extractRefs, buildImportGraph, select, formatReport, classifyChanges } from './affected.mjs';
import { snapshot, changesBetween, describe } from './worktree-guard.mjs';
import { runWithTimeout } from './run-timeout.mjs';
import { predict, classify, loadTimes, saveTimes, loadHistory, appendHistory } from './predict.mjs';

// 單支測試的時限（秒）。最慢的 layouttest 實測 516～580 秒；20 分鐘留了兩倍餘裕。--timeout-sec 可改。
// 超過就整棵程序樹殺掉、回 7：**沒有結果**——不是通過，也不是紅。
export const DEFAULT_TIMEOUT_SEC = 1200;

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

function kindOf(root, p) {
  try { const st = fs.statSync(path.join(root, p)); return st.isDirectory() ? 'dir' : 'file'; } catch { return null; }
}

function walk(root, dir, out = []) {
  let list = [];
  try { list = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const d of list) {
    const rel = dir + '/' + d.name;
    if (d.isDirectory()) { if (d.name !== 'node_modules' && d.name !== 'data') walk(root, rel, out); }
    else if (/\.m?js$/.test(d.name)) out.push(rel);
  }
  return out;
}

// 讀出挑選器需要的三樣東西：鏈、每支測試的直接引用、import 圖
export function loadRepo(root = ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const exists = (p) => kindOf(root, p);
  const chain = parseChain(pkg, (p) => exists(p) === 'file');
  const refs = {};
  for (const t of chain) {
    const text = fs.readFileSync(path.join(root, t.file), 'utf8');
    // affectedtest 的 fixture 裡寫滿了歷史案例的路徑（js/app.js、css/style.css…），那是資料不是引用；
    // 算進去的話它會「涵蓋」一大片程式檔，放大器 D 就被它悶住了。它只認自己 import 的 helper。
    refs[t.name] = t.name === 'affectedtest'
      ? extractRefs(text, exists).filter((p) => p.startsWith('scripts/'))
      : extractRefs(text, exists);
  }
  const files = {};
  for (const dir of ['js', 'server', 'workers']) {
    for (const f of walk(root, dir)) files[f] = fs.readFileSync(path.join(root, f), 'utf8');
  }
  return { pkg, chain, refs, graph: buildImportGraph(files) };
}

const git = (args) => execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT, encoding: 'utf8' });

function parseNameStatus(text) {
  return text.split('\n').filter(Boolean).flatMap((line) => {
    const [st, ...ps] = line.split('\t');
    const s = st[0];
    // 改名：舊路徑算刪除、新路徑算新增
    if (s === 'R' || s === 'C') return [{ path: ps[0], status: s === 'R' ? 'D' : 'M' }, { path: ps[1], status: 'A' }];
    return [{ path: ps[0], status: s }];
  });
}

// sw.js 只改 VERSION 行的，換成虛擬路徑 sw.js#VERSION（修訂 1-A；判斷邏輯在 affected.mjs）
export function changedFiles({ base = 'HEAD', commit = null } = {}) {
  if (commit) {
    const list = parseNameStatus(git(['show', '--name-status', '--format=', commit]));
    return classifyChanges(list, (p) => git(['show', '--format=', '-U0', commit, '--', p]));
  }
  const tracked = parseNameStatus(git(['diff', '--name-status', base]));
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean).map((p) => ({ path: p, status: 'A' }));
  return classifyChanges([...tracked, ...untracked], (p) => git(['diff', '-U0', base, '--', p]));
}

// 距上次全面檢測：讀 STATUS「上次全面檢測」那一行的日期與版本
export function sinceFullRun(root = ROOT, today = new Date()) {
  try {
    const status = fs.readFileSync(path.join(root, 'docs/STATUS.md'), 'utf8');
    const m = status.match(/上次全面檢測：(\d{4}-\d{2}-\d{2})、(v[\d.]+)/);
    if (!m) return '距上次全面檢測：讀不到 STATUS 的「上次全面檢測」那一行';
    const days = Math.floor((today - new Date(m[1] + 'T00:00:00+08:00')) / 86400000);
    const intro = git(['log', '--format=%h', '-S', `'tripquest-${m[2]}'`, '--', 'sw.js']).split('\n').filter(Boolean).pop();
    const vers = intro ? git(['log', '--format=%h', '-G', '^const VERSION', `${intro}..HEAD`, '--', 'sw.js']).split('\n').filter(Boolean).length : '?';
    return `距上次全面檢測（${m[2]}，${m[1]}）：${vers} 版／${days} 天`;
  } catch (e) {
    return '距上次全面檢測：算不出來（' + e.message + '）';
  }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const approved = process.argv.includes('--approved');
  const timeoutSec = arg('--timeout-sec') ? Number(arg('--timeout-sec')) : DEFAULT_TIMEOUT_SEC;
  if (!(timeoutSec > 0)) { console.log(`✗ --timeout-sec 要是正數（拿到 ${arg('--timeout-sec')}）`); process.exit(2); }
  const repo = loadRepo();
  const onlyArg = arg('--only');
  let r, mode;
  if (process.argv.includes('--all')) {
    // npm test：完整的鏈也走這裡（工作區守衛、單支逾時、按次預測都蓋得到）
    const names = repo.chain.map((t) => t.name);
    r = { selected: names, n: names.length, m: names.length, full: true };
    mode = 'all';
    console.log(`完整的鏈 ${names.length} 支（npm test）`);
  } else if (onlyArg) {
    const want = onlyArg.split(',').map((s) => s.trim()).filter(Boolean);
    const missing = want.filter((n) => !repo.chain.some((t) => t.name === n));
    if (!want.length || missing.length) {
      console.log(`✗ --only 指定的測試不在鏈上：${missing.join('、') || '（沒有指定任何一支）'}`);
      process.exit(2);
    }
    r = { selected: want, n: want.length, m: repo.chain.length, full: false };
    mode = 'only';
    console.log(`只跑指定的 ${want.length} 支：${want.join('、')}（不經挑選器）`);
  } else {
    const filesArg = arg('--files');
    const changed = filesArg
      ? filesArg.split(',').map((s) => s.trim()).filter(Boolean)
      : changedFiles({ base: arg('--base') || 'HEAD', commit: arg('--commit') });
    r = select({ changed, ...repo });
    mode = r.full ? 'affected-full' : 'affected';

    const shown = changed.map((c) => (typeof c === 'string' ? c : `${c.status} ${c.path}`));
    console.log(`改動 ${shown.length} 個檔：`);
    for (const s of shown.slice(0, 40)) console.log('  ' + s);
    if (shown.length > 40) console.log(`  …另 ${shown.length - 40} 個`);
    console.log('');
    console.log(formatReport(r));
    console.log('');
    console.log(sinceFullRun());
  }

  // 按次預測（v11.3 §5.19）：依這次實際要跑的那幾支預測，不按指令名稱
  let tbl, hist;
  try { tbl = loadTimes(ROOT); hist = loadHistory(ROOT); }
  catch (e) { console.log(`✗ 讀不到耗時紀錄（${e.message}）——預測不出，不當成 0 秒`); process.exit(4); }
  const pred = predict(r.selected, tbl);
  const cls = classify({ pred, history: hist });
  console.log(`\n耗時預測：${pred.sec === null ? '預測不出' : `${pred.sec.toFixed(0)} 秒`}（${pred.known}/${r.selected.length} 支量過）→ ${cls.heavy ? '重負載' : '常規'}：${cls.reason}`);
  if (dry) return;
  if (cls.heavy && !approved) {
    console.log('✗ 重負載：開跑前要先向 Dispatch 要許可；拿到之後加 --approved 再跑（npm test -- --approved）');
    process.exit(8);
  }

  const t00 = Date.now();
  const record = (end, extra = {}) => {
    try {
      appendHistory(ROOT, { mode, n: r.selected.length, predictedSec: pred.sec, unknown: pred.unknown.length, heavy: cls.heavy, approved,
        actualSec: Math.round((Date.now() - t00) / 100) / 10, end, ...extra });
    } catch (e) { console.log(`✗ 寫不進 run-history（${e.message}）`); }
    console.log(`預估與實際：預估 ${pred.sec === null ? '預測不出' : pred.sec.toFixed(0) + ' 秒'}、實際 ${((Date.now() - t00) / 1000).toFixed(0)} 秒（記進 .logs/run-history.jsonl）`);
  };
  const shot = (when) => {
    try { return snapshot({ root: ROOT }); }
    catch (e) {
      console.log(`\n✗ 工作區守衛壞了：${when}拍不到工作區（${String(e.message).split('\n')[0]}）—— 不當成沒有改動，停在這裡`);
      record('守衛壞了');
      process.exit(4);
    }
  };
  const times = [];
  for (const name of r.selected) {
    const t = repo.chain.find((x) => x.name === name);
    console.log(`\n━━━━ ${name}（${times.length + 1}/${r.n}）━━━━`);
    const before = shot(`${name} 開跑前`);
    const t0 = Date.now();
    const res = await runWithTimeout(process.execPath, [t.file], { cwd: ROOT, inherit: true, timeoutMs: timeoutSec * 1000 });
    const sec = (Date.now() - t0) / 1000;
    times.push([name, sec]);
    // 這支的實測秒數只在「算數的結束」（跑完、不論紅綠）時更新；逾時被殺的不算量過
    if (!res.timedOut) { tbl[name] = Math.round(sec * 10) / 10; try { saveTimes(ROOT, tbl); } catch (e) { console.log(`✗ 寫不進 test-times（${e.message}）`); } }
    const touched = changesBetween(before, shot(`${name} 跑完後`));
    console.log(`工作區守衛：${name} 開跑前不一樣的檔 ${before.size} 個，跑完多出或變了 ${touched.length} 個`);
    // 逾時先講（它決定這一支「沒有結果」）；同時動到工作區的話也一起點名，兩件都不吞掉
    if (res.timedOut) {
      console.log(`\n✗ ${name} 逾時（${timeoutSec} 秒）被殺——沒有結果，不是通過也不是紅；停在這裡，後面的沒跑`);
      if (touched.length) console.log(`✗ ${name} 被殺之前動到工作區的檔：${describe(touched)}`);
      record('逾時', { at_test: name });
      process.exit(7);
    }
    if (touched.length) {
      console.log(`\n✗ ${name} 動到工作區的檔：${describe(touched)} —— 測試的輸出要寫到 .gitignore 擋掉的目錄；停在這裡，後面的沒跑`);
      record('動到工作區', { at_test: name });
      process.exit(3);
    }
    if (res.status !== 0) {
      console.log(`\n✗ ${name} 紅了（exit ${res.status}，${sec.toFixed(1)} 秒）—— 停在這裡，後面的沒跑`);
      record('紅', { at_test: name });
      process.exit(res.status || 1);
    }
  }
  const total = times.reduce((s, [, x]) => s + x, 0);
  console.log('\n━━━━ 結果 ━━━━');
  console.log(r.full
    ? `完整的鏈 ${r.n}/${r.m} 支全綠（${total.toFixed(0)} 秒）`
    : `底線＋受影響 ${r.n}/${r.m} 支綠（${total.toFixed(0)} 秒）—— 這不是全綠`);
  for (const [name, sec] of times.slice().sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`  ${name} ${sec.toFixed(1)} 秒`);
  record('綠');
  console.log(sinceFullRun());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
