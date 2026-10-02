// 認程序樹（2026-10-02）：子程序＝ParentProcessId 等於父程序、**而且建立時間不早於父程序**。
// 為什麼要看建立時間：Windows 的 PID 會重用。一個早就在跑的程序（JLPT 2026-10-02 實例：OneDrive 的同步服務，早上四點就在），
// 它記著的父 PID 早就結束；這次開跑的程序剛好拿到同一個號碼，只看 ParentProcessId 就會把它認成自己的子程序——
// 資源紀錄被灌水，`taskkill /T` 更可能把不相干的程序一起殺掉。
// 取不到程序表 → 丟錯（呼叫端決定怎麼辦），不當成「沒有子程序」。

import { execFileSync } from 'node:child_process';

// ConvertTo-Json 把 DateTime 寫成 "/Date(1696212345678)/"
const msOf = (v) => {
  if (typeof v === 'number') return v;
  const m = String(v || '').match(/Date\((\d+)/);
  if (m) return Number(m[1]);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

export function listProcesses() {
  if (process.platform !== 'win32') {
    const out = execFileSync('ps', ['-eo', 'pid=,ppid=,lstart=,rss=,comm='], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean).map((l) => {
      const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(\d+)\s+(.+)$/);
      return m ? { pid: Number(m[1]), ppid: Number(m[2]), created: Date.parse(m[3]), mem: Number(m[4]) * 1024, name: m[5] } : null;
    }).filter(Boolean);
  }
  const json = execFileSync('powershell', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,CreationDate | ConvertTo-Json -Compress'],
  { encoding: 'utf8', maxBuffer: 64 << 20 });
  const arr = JSON.parse(json);
  return (Array.isArray(arr) ? arr : [arr]).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, mem: p.WorkingSetSize || 0, created: msOf(p.CreationDate) }));
}

// root 的子孫（不含 root），深的在前（殺的時候先殺葉子）
export function descendants(all, rootPid) {
  const byPid = new Map(all.map((p) => [p.pid, p]));
  const root = byPid.get(rootPid);
  if (!root) return [];
  const out = [];
  const walk = (parent, depth) => {
    for (const c of all) {
      if (c.ppid !== parent.pid || c.pid === parent.pid) continue;
      // 建立時間不早於父程序才算——早於的是 PID 被重用之前就在的別人家的程序
      if (c.created == null || parent.created == null || c.created < parent.created) continue;
      out.push({ ...c, depth });
      walk(c, depth + 1);
    }
  };
  walk(root, 1);
  return out.sort((a, b) => b.depth - a.depth);
}
