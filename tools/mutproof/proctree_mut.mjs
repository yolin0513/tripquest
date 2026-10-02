// proctree 的突變（2026-10-02）：把 proctree.mjs、run-timeout.mjs、proctreetest.mjs 複製到 .logs/pt-mut/scripts/，改壞一處後跑複本的 proctreetest。
// 用法：node tools/mutproof/proctree_mut.mjs <repo>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evidHeader, evid } from './evid.mjs';

const REPO = process.argv[2];
const DIR = path.join(REPO, '.logs', 'pt-mut');
const FILES = ['proctree.mjs', 'run-timeout.mjs', 'proctreetest.mjs'];
const MUTS = [
  { name: 'P0 不改（基準）', expect: [] },
  { name: 'P1 不看建立時間（PID 重用的程序也算子孫）', file: 'proctree.mjs',
    find: '      if (c.created == null || parent.created == null || c.created < parent.created) continue;\n', repl: '',
    expect: ['PID 重用：只認到 200、300', 'killTree 只殺 100、300、200'] },
  { name: 'P3 先殺葉子、最後才殺 root', file: 'run-timeout.mjs',
    find: 'const victims = [pid, ...(tree || []).map((p) => p.pid)];', repl: 'const victims = [...(tree || []).map((p) => p.pid), pid];',
    expect: ['killTree 只殺 100、300、200'] },
  { name: 'P2 取不到程序表時改用 /T 照殺', file: 'run-timeout.mjs',
    find: "catch (e) { log(`（取不到程序表：${String(e.message).split('\\n')[0]}——只殺 ${pid} 本身，不用 /T）`); tree = null; }",
    repl: "catch (e) { tree = [{ pid: -1 }]; }",
    expect: ['取不到程序表 → 只殺 root 本身'] },
];
evidHeader('proctree_mut', MUTS.map((m) => m.name));
let bad = 0;
for (const m of MUTS) {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIR, 'scripts'), { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(REPO, 'scripts', f), path.join(DIR, 'scripts', f));
  if (m.file) {
    const p = path.join(DIR, 'scripts', m.file);
    const s = fs.readFileSync(p, 'utf8');
    const n = s.split(m.find).length - 1;
    if (n !== 1) { console.log(`✗ ${m.name}：find 出現 ${n} 次，突變沒造成，中止`); process.exit(9); }
    fs.writeFileSync(p, s.replace(m.find, m.repl));
    if (fs.readFileSync(p, 'utf8').includes(m.find)) { console.log(`✗ ${m.name}：讀回還有原字串，中止`); process.exit(9); }
  }
  const r = spawnSync(process.execPath, [path.join(DIR, 'scripts', 'proctreetest.mjs')], { cwd: DIR, encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const reds = out.split('\n').filter((l) => l.startsWith('✗ ')).map((l) => l.slice(2));
  const hit = m.expect.every((e) => reds.some((l) => l.startsWith(e)));
  const extra = reds.filter((l) => !m.expect.some((e) => l.startsWith(e)));
  const ok = m.expect.length ? r.status !== 0 && hit && !extra.length : r.status === 0 && !reds.length;
  if (!ok) bad++;
  evid({ runner: 'proctree_mut', name: m.name, expect: m.expect, expectUnformed: [], reds, unformed: [], status: r.status, sha: '' });
  console.log(`${ok ? '✓' : '✗'} ${m.name}：回 ${r.status}、紅 ${reds.length} 條${extra.length ? '（預期外：' + extra.join('／').slice(0, 80) + '）' : ''}`);
  for (const l of reds) console.log('     ✗ ' + l.slice(0, 90));
}
fs.rmSync(DIR, { recursive: true, force: true });
console.log(bad ? `${bad} 條不照預期` : '全部照預期');
process.exitCode = bad ? 1 : 0;
