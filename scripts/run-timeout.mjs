// 跑一個子程序，超過時限就把**整棵程序樹**殺掉（2026-10-02）。
// 為什麼不用 spawnSync 的 timeout：Windows 上它只殺得到直接的子程序（shell），孫程序（真正的測試、瀏覽器）會留著；
// 而且「只剩一個在跑」跟「剩一個卡死」從外面看一模一樣——沒有時限，一條卡住整串就永遠掛著，不會有任何東西紅。
// 回傳 { status, timedOut, out }：timedOut 為 true 時 status 是 null——**沒有結果，不是通過也不是紅**，呼叫端要照這樣記。

import { spawn, spawnSync } from 'node:child_process';

export function killTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* 已經不在 */ } } }
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
