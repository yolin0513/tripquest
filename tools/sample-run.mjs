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
const { listProcesses, descendants, msysEdges } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'proctree.mjs')).href);
const WORK = /^(node|python3?|chrome|msedge|chromium)(\.exe)?$/i;
const BROWSER = /^(chrome|msedge|chromium)(\.exe)?$/i;

// 子孫＝Windows 的父子關係＋MSYS 補的連結（2026-10-02：只看 Windows 的，Git Bash 下記到「工作程序 0」——量尺壞的，那一場峰值作廢）
export function count(all, rootPid, edges = []) {
  const root = all.find((p) => p.pid === rootPid);
  const tree = [...(root ? [root] : []), ...descendants(all, rootPid, { edges })];
  const byPid = new Map(all.map((p) => [p.pid, p]));
  const work = tree.filter((p) => WORK.test(p.name) && !(BROWSER.test(p.name) && BROWSER.test((byPid.get(p.ppid) || {}).name || '')));
  return { n: work.length, all: tree.length, memMB: Math.round(tree.reduce((s, p) => s + (p.mem || 0), 0) / 1048576) };
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
// bash／sh／python 先解成完整路徑：裸寫交給 Windows PATH，從 PowerShell 起點會解到 WSL 的 bash（本機實測），驗法根本沒跑起來
const { resolveExe } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'resolve-exe.mjs')).href);
let exe = cmd[0];
if (/^(bash|sh|python3?)$/i.test(exe)) {
  try { exe = resolveExe(exe); lines.push(`${cmd[0]} 解成：${exe}`); }
  catch (e) { lines.push(`⊘ 情境未成立：${e.message}`); fs.writeFileSync(out, lines.join('\n') + '\n'); process.exit(3); }
}
try { fs.writeFileSync(out + '.partial', lines.join('\n') + '\n'); } catch { /* 同上 */ }

// ---------- 逐一計數（2026-10-02）：程序建立加一、結束減一，峰值不靠定時取樣 ----------
// 取樣抓不到活不到 2 秒的程序（遊戲那邊實測：三支只活 0.8 秒的子程序，逐一計數得峰值 3）。用 tools/proc-watch.ps1 收 WMI 的建立／結束事件
// （WITHIN 0.1；沒有系統管理員權限，拿不到最準的 Win32_ProcessStartTrace）。本 repo 的程序＝父程序是本 repo 的，或 MSYS 程序表說它的父程序是。
const stopFile = out + '.stop';
try { fs.rmSync(stopFile, { force: true }); } catch { /* 沒有就算了 */ }
const watcher = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'tools', 'proc-watch.ps1'), '-StopFile', stopFile], { stdio: ['pipe', 'pipe', 'pipe'] });
const ev = { ours: new Map(), liveWork: 0, liveAll: 0, peakWork: 0, peakAll: 0, events: 0, ready: false, failed: null };
const isWork = (name, ppidName) => WORK.test(name) && !(BROWSER.test(name) && BROWSER.test(ppidName || ''));
let msysCache = { at: 0, edges: [] };
const msysParentOf = (pid) => {
  if (Date.now() - msysCache.at > 300) { try { msysCache = { at: Date.now(), edges: msysEdges() }; } catch { msysCache = { at: Date.now(), edges: [] }; } }
  const e = msysCache.edges.find(([, c]) => c === pid);
  return e ? e[0] : null;
};
let buf = '';
watcher.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
    if (l === 'READY') { ev.ready = true; continue; }
    const f = l.split('\t');
    if (f[0] === 'C') {
      ev.events++;
      const pid = Number(f[1]), ppid = Number(f[2]), name = f[3];
      let parent = ev.ours.has(ppid) ? ppid : null;
      if (parent === null && /^(bash|sh|node|python3?|git|chrome|msedge|cmd|conhost)(\.exe)?$/i.test(name)) {
        const mp = msysParentOf(pid);
        if (mp !== null && ev.ours.has(mp)) parent = mp;
      }
      if (parent !== null) {
        const work = isWork(name, (ev.ours.get(parent) || {}).name);
        ev.ours.set(pid, { name, work });
        ev.liveAll++; if (work) ev.liveWork++;
        ev.peakAll = Math.max(ev.peakAll, ev.liveAll); ev.peakWork = Math.max(ev.peakWork, ev.liveWork);
      }
    } else if (f[0] === 'D') {
      const p = ev.ours.get(Number(f[1]));
      if (p && !p.gone) { p.gone = true; ev.liveAll--; if (p.work) ev.liveWork--; }
    }
  }
});
watcher.on('error', (e) => { ev.failed = e.message; });
for (let i = 0; i < 100 && !ev.ready && !ev.failed; i++) await new Promise((r) => setTimeout(r, 100));
if (!ev.ready) lines.push(`（逐一計數沒啟動：${ev.failed || '監看程式 10 秒內沒回 READY'}——峰值只剩取樣，可能漏算短命程序）`);

const child = spawn(exe, cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
// 主程式（child）自己算一個；它的建立事件可能比這一行早到，所以直接放進來
ev.ours.set(child.pid, { name: path.basename(exe), work: WORK.test(path.basename(exe)) });
ev.liveAll++; if (WORK.test(path.basename(exe))) ev.liveWork++;
ev.peakAll = Math.max(ev.peakAll, ev.liveAll); ev.peakWork = Math.max(ev.peakWork, ev.liveWork);
const seenBash = new Set();
let log = '';
child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
let done = false;
child.on('exit', () => { done = true; });
let peak = 0, peakAll = 0, peakMem = 0, minFree = Infinity, samples = 0;
while (!done) {
  try {
    const all = listProcesses();
    let edges = [], msysNote = '';
    try { edges = msysEdges(); } catch (e) { msysNote = '（取不到 MSYS 程序表：這一筆只照 Windows 的父子關係數，Git Bash 裡再開的程序可能漏算）'; }
    const c = count(all, child.pid, edges);
    // 正在跑的每一支 bash：記下執行檔路徑與父程序（第一次看到時記一行）——跑的是不是 Git Bash，看程序本身
    for (const p of [all.find((q) => q.pid === child.pid), ...descendants(all, child.pid, { edges })].filter(Boolean)) {
      if (/^(bash|sh)\.exe$/i.test(p.name) && !seenBash.has(p.pid)) {
        seenBash.add(p.pid);
        const parent = all.find((q) => q.pid === p.ppid);
        const note = `${new Date().toISOString()} bash 程序 ${p.pid}：${p.exe || '（讀不到執行檔路徑）'}；父程序 ${p.ppid} ${parent ? parent.name : '（已不在）'}${p.exe && /\\Windows\\System32\\/i.test(p.exe) ? '  ← WSL！' : ''}`;
        lines.push(note);
        try { fs.appendFileSync(out + '.partial', note + '\n'); } catch { /* 同上 */ }
      }
    }
    const free = Math.round(os.freemem() / 1048576);
    samples++; peak = Math.max(peak, c.n); peakAll = Math.max(peakAll, c.all); peakMem = Math.max(peakMem, c.memMB); minFree = Math.min(minFree, free);
    const line = `${new Date().toISOString()} 本 repo 工作程序 ${c.n}（含啟動它的主程式）、全部程序 ${c.all}、合計 ${c.memMB} MB、系統可用 ${free} MB${msysNote}`;
    lines.push(line);
    // 每取一次就先寫進 .partial：被中途停掉時紀錄不會整個沒有（2026-10-02 實測：分段停下時 six 的取樣全部沒留下）
    try { fs.appendFileSync(out + '.partial', line + '\n'); } catch { /* 寫不進就算了，最後還會整份寫 */ }
  } catch { lines.push(`${new Date().toISOString()} 取不到程序表`); }
  await new Promise((r) => setTimeout(r, 2000));
}
await new Promise((r) => setTimeout(r, 400));   // 讓最後幾個結束事件進來
try { fs.writeFileSync(stopFile, 'stop'); } catch { /* 寫不進就直接收掉 */ }
await new Promise((r) => setTimeout(r, 1500));
try { watcher.kill(); } catch { /* 已經結束 */ }
try { fs.rmSync(stopFile, { force: true }); } catch { /* 沒有就算了 */ }
const evPart = ev.ready
  ? `逐一計數峰值：工作程序 ${ev.peakWork} 個、全部程序 ${ev.peakAll} 個（事件 ${ev.events} 筆、認到本 repo 的 ${ev.ours.size} 支；含主程式；活不到約 0.1 秒的可能漏）`
  : '逐一計數沒啟動';
lines.push(`結束：exit ${child.exitCode}、${((Date.now() - t0) / 1000).toFixed(1)} 秒；${evPart}；取樣（每 2 秒，${samples} 次）峰值：工作程序 ${peak} 個、全部程序 ${peakAll} 個；合計記憶體峰值 ${peakMem} MB、系統可用最低 ${minFree === Infinity ? '—' : minFree} MB`);
fs.writeFileSync(out, lines.join('\n') + '\n\n' + log);
process.exitCode = child.exitCode;
