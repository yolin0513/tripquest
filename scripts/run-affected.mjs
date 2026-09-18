// 跑「底線＋受影響」的測試（npm run test:affected）；只印清單不跑：npm run affected。
// 規格：docs/SPEC_測試範圍.md。挑選邏輯在 scripts/affected.mjs（純函式），這支負責
// 讀 git、讀檔、依鏈的順序一次一支跑（不平行 —— 這個 repo 的測試會互相搶資源）。
//
// 用法：
//   node scripts/run-affected.mjs                 改動＝git diff HEAD ＋ 未追蹤的新檔
//   node scripts/run-affected.mjs --base <ref>    改動＝<ref> 到工作樹（一版分好幾個 commit 時用）
//   node scripts/run-affected.mjs --commit <sha>  改動＝那一個 commit（回放歷史用）
//   node scripts/run-affected.mjs --files a,b     直接指定改動清單（示範／試算，不讀 git）
//   加 --dry 只印不跑。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseChain, extractRefs, buildImportGraph, select, formatReport } from './affected.mjs';

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

export function changedFiles({ base = 'HEAD', commit = null } = {}) {
  if (commit) return parseNameStatus(git(['show', '--name-status', '--format=', commit]));
  const tracked = parseNameStatus(git(['diff', '--name-status', base]));
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean).map((p) => ({ path: p, status: 'A' }));
  return [...tracked, ...untracked];
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

function main() {
  const dry = process.argv.includes('--dry');
  const filesArg = arg('--files');
  const changed = filesArg
    ? filesArg.split(',').map((s) => s.trim()).filter(Boolean)
    : changedFiles({ base: arg('--base') || 'HEAD', commit: arg('--commit') });
  const repo = loadRepo();
  const r = select({ changed, ...repo });

  const shown = changed.map((c) => (typeof c === 'string' ? c : `${c.status} ${c.path}`));
  console.log(`改動 ${shown.length} 個檔：`);
  for (const s of shown.slice(0, 40)) console.log('  ' + s);
  if (shown.length > 40) console.log(`  …另 ${shown.length - 40} 個`);
  console.log('');
  console.log(formatReport(r));
  console.log('');
  console.log(sinceFullRun());
  if (dry) return;

  const times = [];
  for (const name of r.selected) {
    const t = repo.chain.find((x) => x.name === name);
    console.log(`\n━━━━ ${name}（${times.length + 1}/${r.n}）━━━━`);
    const t0 = Date.now();
    const res = spawnSync(process.execPath, [t.file], { cwd: ROOT, stdio: 'inherit' });
    const sec = (Date.now() - t0) / 1000;
    times.push([name, sec]);
    if (res.status !== 0) {
      console.log(`\n✗ ${name} 紅了（exit ${res.status}，${sec.toFixed(1)} 秒）—— 停在這裡，後面的沒跑`);
      process.exit(res.status || 1);
    }
  }
  const total = times.reduce((s, [, x]) => s + x, 0);
  console.log('\n━━━━ 結果 ━━━━');
  console.log(r.full
    ? `完整的鏈 ${r.n}/${r.m} 支全綠（${total.toFixed(0)} 秒）`
    : `底線＋受影響 ${r.n}/${r.m} 支綠（${total.toFixed(0)} 秒）—— 這不是全綠`);
  for (const [name, sec] of times.slice().sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`  ${name} ${sec.toFixed(1)} 秒`);
  console.log(sinceFullRun());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
