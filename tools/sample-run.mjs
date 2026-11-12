// 跑一支指令並記錄**本 repo** 的資源（2026-10-02；原本在 Session 暫存區，搬進來並改用 scripts/proctree.mjs）：
// 每 2 秒取一次程序表，只數這支指令的子孫（子程序要比父程序晚建立——PID 重用時不會把早就在的別人家程序算進來），
// 工作程序＝node、python、瀏覽器實例（父程序不是瀏覽器的那個 chrome）；git、shell 不算個數、記憶體照算。
// 先做對照：一個只睡 4 秒的假工作，跑著時要數到 ≥1、結束後要數到 0；沒過就不採信、回 4。
// 同名的舊紀錄不覆寫：開跑前改名成帶時間戳的檔保留（2026-11-12，見「不覆寫舊紀錄」那段）；換不了名回 5。
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

// 取樣漏算多少＝逐一計數峰值 − 取樣峰值（Dispatch 2026-10-02：每一場直接看得到漏算幅度）。
// 差是負的＝取樣看到的比逐一計數多——逐一計數漏了（建立事件沒收到），照實印成異常，不夾成 0。
export function missLine(ev, peak, peakAll) {
  if (!ev.ready) return '取樣漏算：算不出（逐一計數沒啟動）';
  const dw = ev.peakWork - peak, da = ev.peakAll - peakAll;
  const part = (d, what) => (d >= 0 ? `${what} ${d} 個` : `${what} −${-d} 個（取樣比逐一計數多——逐一計數漏收事件，兩個峰值都要存疑）`);
  return `取樣漏算（逐一計數峰值 − 取樣峰值）：${part(dw, '工作程序')}、${part(da, '全部程序')}`;
}
// 結束時還記著活著的：all＝程序表（null＝取不到→全部當漏收）。真的還在＝同 pid、同名、在這一場開始之後建立
export function endCheck(ev, all, t0) {
  const live = [...ev.ours].filter(([, p]) => !p.gone);
  const byPid = new Map((all || []).map((p) => [p.pid, p]));
  const alive = [], missed = [];
  for (const [pid, p] of live) {
    const q = byPid.get(pid);
    (all && q && q.name.toLowerCase() === p.name.toLowerCase() && !(q.created < t0 - 1000) ? alive : missed).push(`${pid} ${p.name}`);
  }
  return { alive, missed };
}
export function endLine(ev, { alive, missed }) {
  if (!ev.ready) return '結束核對：逐一計數沒啟動，不核對';
  const head = `結束核對：被包住的指令結束後，逐一計數記著還活著的 ${alive.length + missed.length} 個（應為 0）`;
  if (!alive.length && !missed.length) return head + '——對得上，逐一計數峰值可信';
  return head + (missed.length ? `；✗ 結束事件漏收 ${missed.length} 個（程序表裡已經不在：${missed.slice(0, 5).join('、')}${missed.length > 5 ? '…' : ''}），逐一計數峰值不可信、不當成量到的` : '')
    + (alive.length ? `；真的還活著（留下的孤兒）${alive.length} 個：${alive.slice(0, 5).join('、')}` : '');
}
{
  const t = 1000000;
  const evx = { ready: true, ours: new Map([[1, { name: 'node.exe', gone: true }], [2, { name: 'sleep.exe' }], [3, { name: 'node.exe' }], [4, { name: 'bash.exe' }]]) };
  // 2：真的還在；3：不在表上→漏收；4：同 pid 但是更早就存在的別人（PID 重用）→漏收
  const r = endCheck(evx, [{ pid: 2, name: 'sleep.exe', created: t + 5 }, { pid: 4, name: 'bash.exe', created: t - 60000 }], t);
  const r0 = endCheck({ ready: true, ours: new Map([[1, { name: 'node.exe', gone: true }]]) }, [], t);
  const rn = endCheck(evx, null, t);
  const okEnd = r.alive.join() === '2 sleep.exe' && r.missed.join() === '3 node.exe,4 bash.exe' && /✗ 結束事件漏收 2 個/.test(endLine(evx, r))
    && r0.alive.length + r0.missed.length === 0 && /對得上/.test(endLine(evx, r0)) && rn.missed.length === 3;
  if (!okEnd) { console.log(`✗ endCheck 對照組沒過：${JSON.stringify(r)}｜${JSON.stringify(rn)}`); process.exit(4); }
}
{
  const a = missLine({ ready: true, peakWork: 3, peakAll: 5 }, 1, 2), b = missLine({ ready: true, peakWork: 1, peakAll: 2 }, 2, 2);
  const c = missLine({ ready: false }, 1, 1);
  if (!(a.includes('工作程序 2 個、全部程序 3 個') && b.includes('工作程序 −1 個（取樣比逐一計數多') && b.includes('全部程序 0 個') && c.includes('算不出'))) {
    console.log(`✗ missLine 對照組沒過：${a}｜${b}｜${c}`); process.exit(4);
  }
}

const [out, ...cmd] = process.argv.slice(2);
if (!out || !cmd.length) { console.log('用法：node tools/sample-run.mjs <紀錄檔> <指令> [參數...]'); process.exit(2); }
const lines = [];

// ---------- 不覆寫舊紀錄（2026-11-12）----------
// 原本每一場都整份覆寫紀錄檔：11-12 下午一直用同一個檔名，前面幾場的資源紀錄被蓋掉、找不回來（Dispatch：「把覆寫這件事本身修掉」）。
// 現在：開跑前，同名的紀錄檔、以及上一場被中途停掉留下的 <紀錄檔>.partial，先改名成帶時間戳的檔——
//   res.log → res.20261112-193512.log；res.log.partial → res.log.20261112-193512.partial
//   （時間＝那個檔最後寫入的時間；同一秒撞名就加 -2、-3…）。新的這一場照樣寫原本的名字，讀固定檔名的呼叫端不用改。
// 為什麼不是「附加」、也不是「新檔帶時間戳」：tools/ev/progress.mjs 讀固定的 .logs/ev/run-<驅動>.txt，而且假設一個檔＝一次輸出
//   （同一次輸出裡同一個情境出現兩次就報錯）——附加會把重跑的情境誤報成重複；新檔帶時間戳它讀不到檔，會直接跳過那道檢查、不報錯。
// 換名：COPYFILE_EXCL 複製（目標已經在就失敗、不蓋掉任何檔；撞名換下一個號碼）再刪原檔。換不了名就停、回 5，不覆寫。
// 跑完、整份紀錄寫好之後刪掉自己的 .partial（內容整份都在紀錄檔裡）；所以留下來的 .partial 只會是被中途停掉的那一場。
// 驗法：scripts/samplerun-keep-check.mjs（從這支的命令列入口連跑四場＋一場換不了名）。
const stampOf = (ms) => {
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
function keepOld(file) {
  if (!fs.existsSync(file)) return null;
  const { dir, name, ext } = path.parse(file);
  const stamp = stampOf(fs.statSync(file).mtimeMs);
  for (let i = 1; i < 100; i++) {
    const to = path.join(dir, `${name}.${stamp}${i > 1 ? `-${i}` : ''}${ext}`);
    try { fs.copyFileSync(file, to, fs.constants.COPYFILE_EXCL); } catch (e) { if (e.code === 'EEXIST') continue; throw e; }
    fs.rmSync(file);
    return to;
  }
  throw new Error('帶時間戳的檔名 1～99 號都被占用');
}
for (const f of [out, out + '.partial']) {
  let to;
  try { to = keepOld(f); } catch (e) { console.log(`✗ 舊的紀錄檔換不了名（${f}：${String(e.message).split('\n')[0]}）——不覆寫，停`); process.exit(5); }
  if (to) lines.push(`舊紀錄改名保留：${path.basename(f)} → ${path.basename(to)}`);
}
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
        ev.ours.set(pid, { name, work, at: Date.now() });
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
// 結束時的自我核對（JLPT 2026-10-02 撞到：負載重時 WMI 結束事件會掉，那一支就一直被當成活著→峰值多算，它那一場記到 362 個）：
// 被包住的指令結束後，逐一計數記著還活著的應該是 0。不是 0 的，逐支拿程序表核對——真的還在（同名、在這一場開始之後建立）＝
// 留下來的孤兒，數字可信、另外點名；不在＝結束事件漏收，逐一計數的峰值不可信、不當成量到的（多算會讓排程無謂拉長）。
// 建立事件漏收（少算）這一道抓不到——那一支根本沒進帳；取樣峰值大於逐一計數時 missLine 會印成負數，那是它的訊號。
let ender = { missed: [], alive: [] };
if (ev.ready) {
  let all = null;
  try { all = listProcesses(); } catch { /* 取不到就全部當漏收：寧可不信 */ }
  ender = endCheck(ev, all, t0);
}
const evPart = ev.ready
  ? `逐一計數峰值${ender.missed.length ? `【不可信：結束事件漏收 ${ender.missed.length} 個】` : ''}：工作程序 ${ev.peakWork} 個、全部程序 ${ev.peakAll} 個（事件 ${ev.events} 筆、認到本 repo 的 ${ev.ours.size} 支；含主程式；活不到約 0.1 秒的可能漏）`
  : '逐一計數沒啟動';
lines.push(`結束：exit ${child.exitCode}、${((Date.now() - t0) / 1000).toFixed(1)} 秒；${evPart}；取樣（每 2 秒，${samples} 次）峰值：工作程序 ${peak} 個、全部程序 ${peakAll} 個；合計記憶體峰值 ${peakMem} MB、系統可用最低 ${minFree === Infinity ? '—' : minFree} MB`);
lines.push(endLine(ev, ender));
lines.push(ender.missed.length ? '取樣漏算：算不出（逐一計數的峰值不可信）' : missLine(ev, peak, peakAll));
fs.writeFileSync(out, lines.join('\n') + '\n\n' + log);
// 整份寫好了才刪 .partial（刪不掉也不會遺失：下一場開跑時它會被改名保留）
try { fs.rmSync(out + '.partial', { force: true }); } catch (e) { console.log(`（${path.basename(out)}.partial 刪不掉：${e.code || e.message}——下一場開跑時會被改名保留）`); }
process.exitCode = child.exitCode;
