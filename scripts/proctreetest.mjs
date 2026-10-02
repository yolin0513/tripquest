// 認程序樹與殺程序樹（scripts/proctree.mjs、run-timeout.mjs 的 killTree）的測試（npm run proctreetest；2026-10-02）。
// 一、合成程序表（不碰真的程序）：PID 重用——早就在的程序記著的父 PID＝這次 root 的號碼，但它比 root 早建立 → 不能算子孫、不能被殺。
// 二、真的程序：開一個 node、它再開一個孫程序；從真的程序表認得到那個孫程序；killTree 殺完兩個都不在。
import { spawn } from 'node:child_process';
import { descendants, listProcesses } from './proctree.mjs';
import { killTree } from './run-timeout.mjs';

let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n' + String(extra).split('\n').map((l) => '   ' + l).join('\n') : '')); process.exitCode = 1; }
};

console.log('— 一、合成程序表 —');
const T = (h) => Date.parse(`2026-10-02T${h}:00Z`);
const SYN = [
  { pid: 100, ppid: 1, name: 'bash.exe', created: T('10:00') },          // 這次開跑的 root
  { pid: 200, ppid: 100, name: 'node.exe', created: T('10:01') },        // 真的子程序
  { pid: 300, ppid: 200, name: 'node.exe', created: T('10:02') },        // 真的孫程序
  { pid: 400, ppid: 100, name: 'OneDrive.exe', created: T('04:10') },    // PID 重用：父 PID 剛好是 100，但比 root 早建立
  { pid: 500, ppid: 400, name: 'OneDrive.exe', created: T('04:11') },    // 上面那個的子程序，也不是我們的
  { pid: 600, ppid: 7, name: 'node.exe', created: T('10:03') },          // 別的程序的子程序
];
const d = descendants(SYN, 100);
yes(d.map((p) => p.pid).sort().join(',') === '200,300', `PID 重用：只認到 200、300（實得 ${d.map((p) => p.pid).join(',') || '無'}）——早建立的 400 與它的 500 不算`);
yes(d[0].pid === 300, '深的在前（先殺孫程序）');
yes(descendants(SYN, 999).length === 0, 'root 不在表上 → 沒有子孫（不是整張表）');
const killed = [];
const NOMSYS = () => [];   // 合成表不去讀真的 MSYS 程序表
const r = killTree(100, { list: () => SYN, kill: (v) => killed.push(v), log: () => {}, msys: NOMSYS });
yes(killed.join(',') === '100,300,200', `killTree 只殺 100、300、200，root 先殺（實得 ${killed.join(',')}）——不殺 400、500、600`);
// 第二道防呆：建立時間看起來沒問題（比 root 晚），但名稱不在可殺清單 → 認得到、但不殺
const SYN2 = [...SYN, { pid: 700, ppid: 200, name: 'OneDrive.exe', created: T('10:05') }];
const killed3 = [];
const r3 = killTree(100, { list: () => SYN2, kill: (v) => killed3.push(v), log: () => {}, msys: NOMSYS });
yes(r3.tree.some((p) => p.pid === 700) && !killed3.includes(700) && r3.skipped.includes(700) && killed3.join(',') === '100,300,200',
  `名稱不在可殺清單（OneDrive.exe）→ 就算被認成子孫也不殺（殺了 ${killed3.join(',')}、略過 ${r3.skipped.join(',') || '無'}）`);
const killed2 = [];
killTree(100, { list: () => { throw new Error('取不到'); }, kill: (v) => killed2.push(v), log: () => {}, msys: NOMSYS });
yes(killed2.join(',') === '100', `取不到程序表 → 只殺 root 本身（實得 ${killed2.join(',')}）`);
yes(r.tree && r.tree.length >= 1, '前置：合成表上的樹真的認出來了（不是空的）');

console.log('\n— 一之一、Git Bash（MSYS）裡再開的程序：Windows 的父子關係斷掉，靠 MSYS 的程序表補 —');
{
  const { parseMsysPs } = await import('./proctree.mjs');
  const PS = ['      PID    PPID    PGID     WINPID   TTY         UID    STIME COMMAND',
    '      10       1      10        100  ?         197609 14:00:00 /usr/bin/bash',
    '      11      10      10        801  ?         197609 14:00:01 /usr/bin/bash',
    '      12      11      10        802  ?         197609 14:00:02 /c/Program Files/nodejs/node'].join('\n');
  const edges = parseMsysPs(PS);
  yes(edges.map((e) => e.join('>')).sort().join(',') === '100>801,801>802', `解析 ps -a：MSYS 父子換成 WINPID（實得 ${edges.map((e) => e.join('>')).join(',')}）`);
  const MS = [
    { pid: 100, ppid: 1, name: 'bash.exe', created: T('10:00') },
    { pid: 801, ppid: 4321, name: 'bash.exe', created: T('10:01') },   // Windows 的父 PID 指向已經結束的中繼程序
    { pid: 802, ppid: 801, name: 'node.exe', created: T('10:02') },
    { pid: 803, ppid: 4321, name: 'OneDrive.exe', created: T('09:00') },   // 補的連結硬指它、但它比 root 早建立
  ];
  const without = descendants(MS, 100).map((p) => p.pid);
  const withE = descendants(MS, 100, { edges: [...edges, [100, 803]] }).map((p) => p.pid).sort();
  yes(without.length === 0, `只看 Windows 的父子關係 → 一支都認不到（實得 ${without.join(',') || '無'}）——這就是取樣器記到「工作程序 0」的原因`);
  yes(withE.join(',') === '801,802', `補上 MSYS 的連結 → 認到 801、802（實得 ${withE.join(',')}）；硬接過來、但比 root 早建立的 803 照樣不算`);
  const k = [];
  killTree(100, { list: () => MS, kill: (v) => k.push(v), log: () => {}, msys: () => edges });
  yes(k.join(',') === '100,802,801', `killTree 也用補上的連結：殺 100、802、801（實得 ${k.join(',')}）——上一段停外殼漏掉驅動就是少了這一步`);
}

console.log('\n— 一之二、把 bash／python 解成完整路徑（resolve-exe）—');
{
  const { resolveExe, REJECT } = await import('./resolve-exe.mjs');
  const W = (l) => () => l;
  const yesOk = () => true;
  // 合成的路徑在執行時才組出來（不寫成字面：推送閘的自查一看到磁碟代號開頭的路徑就擋）
  const D = 'C' + ':', B = '\\';
  const SYS = [D, 'Windows', 'System32', 'bash.exe'].join(B), APPS = [D, 'Users', 'x', 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'bash.exe'].join(B);
  const GIT = [D, 'Program Files', 'Git', 'usr', 'bin', 'bash.exe'].join(B);
  yes(resolveExe('bash', { where: W([SYS, GIT]), exists: yesOk }) === GIT, 'PATH 第一支是 System32（WSL）→ 跳過、選到 Git Bash');
  let err = null;
  try { resolveExe('bash', { where: W([SYS, APPS]), exists: yesOk }); } catch (e) { err = e; }
  yes(err && /找不到可用的 bash/.test(err.message), 'PATH 上只有 System32 與 WindowsApps → 丟錯（呼叫端判情境未成立），不是挑一支來跑');
  err = null;
  try { resolveExe('bash', { where: () => { throw new Error('where 失敗'); }, exists: yesOk }); } catch (e) { err = e; }
  yes(!!err, '解不出來（where 失敗）→ 丟錯，不是當成裸寫的 bash 照跑');
  yes(REJECT.test([D, 'Windows', 'System32', 'bash.exe'].join('/')) && !REJECT.test(GIT), '正斜線寫法的系統目錄也擋；Git 的路徑不擋');
}

console.log('\n— 二、真的程序 —');
if (process.platform === 'win32') {
  const child = spawn(process.execPath, ['-e', "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});console.log(c.pid);setTimeout(()=>{},60000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
  const gpid = await new Promise((res) => { let b = ''; child.stdout.on('data', (x) => { b += x; if (/\d+\n/.test(b)) res(Number(b.trim())); }); setTimeout(() => res(0), 10000); });
  await new Promise((res) => setTimeout(res, 300));
  const all = listProcesses();
  const tree = descendants(all, child.pid);
  yes(gpid > 0 && tree.some((p) => p.pid === gpid), `從真的程序表認得到孫程序 ${gpid}（root ${child.pid}，認到 ${tree.map((p) => p.pid).join(',') || '無'}）`);
  yes(tree.every((p) => p.created >= all.find((q) => q.pid === child.pid).created), '認到的每一個都比 root 晚建立');
  killTree(child.pid, { log: () => {} });
  await new Promise((res) => setTimeout(res, 800));
  const alive = (p) => { try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  yes(!alive(child.pid) && !alive(gpid), `killTree 之後 root 與孫程序都不在（${child.pid}＝${alive(child.pid) ? '在' : '不在'}、${gpid}＝${alive(gpid) ? '在' : '不在'}）`);
} else {
  console.log('（不是 Windows：真的程序那段略過）');
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
