// 跑一個子程序，超過時限就把**整棵程序樹**殺掉（2026-10-02）。
// 為什麼不用 spawnSync 的 timeout：Windows 上它只殺得到直接的子程序（shell），孫程序（真正的測試、瀏覽器）會留著；
// 而且「只剩一個在跑」跟「剩一個卡死」從外面看一模一樣——沒有時限，一條卡住整串就永遠掛著，不會有任何東西紅。
// 回傳 { status, timedOut, out }：timedOut 為 true 時 status 是 null——**沒有結果，不是通過也不是紅**，呼叫端要照這樣記。
//
// 殺程序樹（2026-10-02 改）：不用 `taskkill /T`——它只照父 PID 找子程序，PID 重用時會殺到不相干、早就在跑的程序
// （JLPT 實例：OneDrive）。改成 scripts/proctree.mjs 認子孫（要求子程序比父程序晚建立），逐支 `taskkill /PID x /F`（不加 /T）。
// 取不到程序表時只殺 root 本身，並印出來——寧可留下一個孫程序（實測：Windows 上 node 的子程序在父程序結束時會跟著被收掉），
// 也不殺認不清的程序。

import { spawn, spawnSync } from 'node:child_process';
import { listProcesses, descendants } from './proctree.mjs';

const taskkill = (v) => spawnSync('taskkill', ['/PID', String(v), '/F'], { stdio: 'ignore' });
// list、kill 可注入：對照組用合成的程序表時**絕不能真的 taskkill 那些合成的 PID**（可能剛好對到真的程序）
export function killTree(pid, { list = listProcesses, kill = taskkill, log = (s) => console.log(s) } = {}) {
  if (process.platform !== 'win32') {
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* 已經不在 */ } }
    return { killed: [pid], tree: null };
  }
  let tree = [];
  try { tree = descendants(list(), pid); }
  catch (e) { log(`（取不到程序表：${String(e.message).split('\n')[0]}——只殺 ${pid} 本身，不用 /T）`); tree = null; }
  // 先殺 root、再殺子孫（名單在殺之前就取好了）：先殺葉子的話，root 會收到「子程序結束」而有時間跑它的 finally
  // ——mutatetest 的「殺到一半」就是這樣造不出來的（2026-10-02 實測：五個殺程序情境全部判成情境未成立）
  const victims = [pid, ...(tree || []).map((p) => p.pid)];
  for (const v of victims) kill(v);
  return { killed: victims, tree };
}

// opts：{ cwd, shell, inherit（輸出直接印到這個程序）, timeoutMs }
export function runWithTimeout(cmd, args, { cwd, shell = false, inherit = false, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let out = '';
    if (!inherit) { child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; }); }
    let timedOut = false;
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs) : null;
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ status: timedOut ? null : code, timedOut, out });
    });
    child.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ status: null, timedOut: false, out: out + String(e.message), error: e }); });
  });
}
