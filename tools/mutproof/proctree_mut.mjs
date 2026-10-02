// proctree 的突變（2026-10-02）：把 proctree.mjs、run-timeout.mjs、proctreetest.mjs 複製到 .logs/pt-mut/scripts/，改壞一處後跑複本的 proctreetest。
// 用法：node tools/mutproof/proctree_mut.mjs <repo>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evidHeader, evid, expectGate, itemsOf, gateOrExit } from './evid.mjs';

const REPO = process.argv[2];
const DIR = path.join(REPO, '.logs', 'pt-mut');
const FILES = ['proctree.mjs', 'run-timeout.mjs', 'proctreetest.mjs', 'resolve-exe.mjs'];
const MUTS = [
  { name: 'P0 不改（基準）', expect: [] },
  { name: 'P1 不看建立時間（PID 重用的程序也算子孫）', file: 'proctree.mjs',
    find: '      if (c.created == null || parent.created == null || c.created < parent.created) continue;\n', repl: '',
    expect: ['PID 重用：只認到 200、300'] },   // 「殺了誰」被第二道（可殺清單）補上＝在殺這件事上是等價突變，見 P5
  { name: 'P5 建立時間與可殺清單兩道一起拿掉', edits: [
      ['proctree.mjs', '      if (c.created == null || parent.created == null || c.created < parent.created) continue;\n', ''],
      ['run-timeout.mjs', "const victims = [pid, ...(tree || []).filter((p) => KILLABLE.test(p.name || '')).map((p) => p.pid)];", 'const victims = [pid, ...(tree || []).map((p) => p.pid)];']],
    expect: ['PID 重用：只認到 200、300', 'killTree 只殺 100、300、200', '名稱不在可殺清單'] },
  { name: 'P4 拿掉可殺清單（名稱不檢查）', file: 'run-timeout.mjs',
    find: "const victims = [pid, ...(tree || []).filter((p) => KILLABLE.test(p.name || '')).map((p) => p.pid)];",
    repl: 'const victims = [pid, ...(tree || []).map((p) => p.pid)];', expect: ['名稱不在可殺清單'] },
  { name: 'P3 先殺葉子、最後才殺 root', file: 'run-timeout.mjs',
    find: "const victims = [pid, ...(tree || []).filter((p) => KILLABLE.test(p.name || '')).map((p) => p.pid)];",
    repl: "const victims = [...(tree || []).filter((p) => KILLABLE.test(p.name || '')).map((p) => p.pid), pid];",
    expect: ['killTree 只殺 100、300、200', '名稱不在可殺清單'] },   // 兩條都比對殺的順序
  { name: 'P6 拒絕清單什麼都不擋（System32、WindowsApps 照用）', file: 'resolve-exe.mjs',
    find: 'export const REJECT = /[\\\\/]Windows[\\\\/](System32|SysWOW64|Sysnative)[\\\\/]|[\\\\/]WindowsApps[\\\\/]/i;', repl: 'export const REJECT = /$^/;',
    expect: ['PATH 第一支是 System32（WSL）', 'PATH 上只有 System32 與 WindowsApps', '正斜線寫法的系統目錄也擋'] },
  // 2026-10-02「預期需要複審」抓到的：proctreetest 新增的 4 條裡，這一條原本沒有任何突變守著
  { name: 'P7 解不出來時照裸寫的名字跑', file: 'resolve-exe.mjs',
    find: '  try { list = where(name); } catch { list = []; }', repl: '  try { list = where(name); } catch { return name; }',
    expect: ['解不出來（where 失敗）'] },
  { name: 'P2 取不到程序表時改用 /T 照殺', file: 'run-timeout.mjs',
    find: "catch (e) { log(`（取不到程序表：${String(e.message).split('\\n')[0]}——只殺 ${pid} 本身，不用 /T）`); tree = null; }",
    repl: "catch (e) { tree = [{ pid: -1, name: 'node.exe' }]; }",
    expect: ['取不到程序表 → 只殺 root 本身'] },
];
evidHeader('proctree_mut', MUTS.map((m) => m.name));
let bad = 0;
for (const m of MUTS) {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIR, 'scripts'), { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(REPO, 'scripts', f), path.join(DIR, 'scripts', f));
  for (const [file, find, repl] of m.edits || (m.file ? [[m.file, m.find, m.repl]] : [])) {
    const p = path.join(DIR, 'scripts', file);
    const s = fs.readFileSync(p, 'utf8');
    const n = s.split(find).length - 1;
    if (n !== 1) { console.log(`✗ ${m.name}：${file} 的 find 出現 ${n} 次，突變沒造成，中止`); process.exit(9); }
    fs.writeFileSync(p, s.replace(find, repl));
    if (fs.readFileSync(p, 'utf8').includes(find)) { console.log(`✗ ${m.name}：讀回還有原字串，中止`); process.exit(9); }
  }
  const r = spawnSync(process.execPath, [path.join(DIR, 'scripts', 'proctreetest.mjs')], { cwd: DIR, encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  if (m === MUTS[0]) gateOrExit(m.name.startsWith('P0') && expectGate('proctree_mut', m.name, out, itemsOf(MUTS.slice(1), ['expect'])));
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
