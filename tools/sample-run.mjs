// 跑一支指令並記錄**本 repo** 的資源（2026-10-02；原本在 Session 暫存區，搬進來並改用 scripts/proctree.mjs）：
// 每 2 秒取一次程序表，只數這支指令的子孫（子程序要比父程序晚建立——PID 重用時不會把早就在的別人家程序算進來），
// 工作程序＝node、python、瀏覽器實例（父程序不是瀏覽器的那個 chrome）；git、shell 不算個數、記憶體照算。
// 先做對照：一個只睡 4 秒的假工作，跑著時要數到 ≥1、結束後要數到 0；沒過就不採信、回 4。
//   node tools/sample-run.mjs <紀錄檔> <指令> [參數...]
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { listProcesses, descendants } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'proctree.mjs')).href);
const WORK = /^(node|python3?|chrome|msedge|chromium)(\.exe)?$/i;
const BROWSER = /^(chrome|msedge|chromium)(\.exe)?$/i;

export function count(all, rootPid) {
  const root = all.find((p) => p.pid === rootPid);
  const tree = [...(root ? [root] : []), ...descendants(all, rootPid)];
  const byPid = new Map(all.map((p) => [p.pid, p]));
  const work = tree.filter((p) => WORK.test(p.name) && !(BROWSER.test(p.name) && BROWSER.test((byPid.get(p.ppid) || {}).name || '')));
  return { n: work.length, memMB: Math.round(tree.reduce((s, p) => s + (p.mem || 0), 0) / 1048576) };
}

const [out, ...cmd] = process.argv.slice(2);
if (!out || !cmd.length) { console.log('用法：node tools/sample-run.mjs <紀錄檔> <指令> [參數...]'); process.exit(2); }
const lines = [];
{
  const probe = spawn(process.execPath, ['-e', 'setTimeout(()=>{},4000)']);
  await new Promise((r) => setTimeout(r, 800));
  const c1 = count(listProcesses(), probe.pid);
  await new Promise((r) => probe.on('exit', r));
  const c0 = count(listProcesses(), probe.pid);
  lines.push(`對照：睡覺的假工作在跑時數到 ${c1.n} 個、結束後 ${c0.n} 個`);
  if (!(c1.n >= 1 && c0.n === 0)) { lines.push('✗ 取樣器對照沒過，不採信'); fs.writeFileSync(out, lines.join('\n') + '\n'); process.exit(4); }
}
const t0 = Date.now();
const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
let done = false;
child.on('exit', () => { done = true; });
let peak = 0, peakMem = 0, minFree = Infinity, samples = 0;
while (!done) {
  try {
    const c = count(listProcesses(), child.pid);
    const free = Math.round(os.freemem() / 1048576);
    samples++; peak = Math.max(peak, c.n); peakMem = Math.max(peakMem, c.memMB); minFree = Math.min(minFree, free);
    lines.push(`${new Date().toISOString()} 本 repo 工作程序 ${c.n}（含啟動它的主程式）、合計 ${c.memMB} MB、系統可用 ${free} MB`);
  } catch { lines.push(`${new Date().toISOString()} 取不到程序表`); }
  await new Promise((r) => setTimeout(r, 2000));
}
lines.push(`結束：exit ${child.exitCode}、${((Date.now() - t0) / 1000).toFixed(1)} 秒、取樣 ${samples} 次、峰值 ${peak} 個工作程序（含主程式）、合計記憶體峰值 ${peakMem} MB、系統可用最低 ${minFree === Infinity ? '—' : minFree} MB`);
fs.writeFileSync(out, lines.join('\n') + '\n\n' + log);
process.exitCode = child.exitCode;
