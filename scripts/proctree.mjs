// 認程序樹（2026-10-02）：子程序＝ParentProcessId 等於父程序、**而且建立時間不早於父程序**。
// 為什麼要看建立時間：Windows 的 PID 會重用。一個早就在跑的程序（JLPT 2026-10-02 實例：OneDrive 的同步服務，早上四點就在），
// 它記著的父 PID 早就結束；這次開跑的程序剛好拿到同一個號碼，只看 ParentProcessId 就會把它認成自己的子程序——
// 資源紀錄被灌水，`taskkill /T` 更可能把不相干的程序一起殺掉。
// 取不到程序表 → 丟錯（呼叫端決定怎麼辦），不當成「沒有子程序」。

import { execFileSync } from 'node:child_process';
import { resolveExe } from './resolve-exe.mjs';

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
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,CreationDate,ExecutablePath | ConvertTo-Json -Compress'],
  { encoding: 'utf8', maxBuffer: 64 << 20 });
  const arr = JSON.parse(json);
  // exe：執行檔的完整路徑（拿來直接確認跑的是哪一支 bash——Git Bash 還是 WSL——不靠推論）
  return (Array.isArray(arr) ? arr : [arr]).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, mem: p.WorkingSetSize || 0, created: msOf(p.CreationDate), exe: p.ExecutablePath || null }));
}

// Git Bash（MSYS）裡再開的程序，Windows 那邊的父 PID 常常指向一支已經結束的中繼程序，照 Windows 的 ParentProcessId 往下找會斷掉
// （2026-10-02 實測：取樣器因此記到「工作程序 0」、停外殼時漏掉驅動那支 bash）。MSYS 自己的程序表（Git 的 ps -a）保有完整的父子關係，
// 每一列有 MSYS PID、MSYS 父 PID 與對應的 WINPID——換算成「父的 WINPID → 子的 WINPID」補上去。
// 回傳 [[父 WINPID, 子 WINPID], …]；讀不到就丟錯（呼叫端決定：不能當成「沒有補充的連結」默默少算）。
export function parseMsysPs(text) {
  const rows = text.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 4 && /^\d+$/.test(c[0]) && /^\d+$/.test(c[3]));
  const win = new Map(rows.map((c) => [Number(c[0]), Number(c[3])]));
  return rows.filter((c) => win.has(Number(c[1])) && Number(c[1]) !== Number(c[0])).map((c) => [win.get(Number(c[1])), Number(c[3])]);
}
export function msysEdges() {
  let ps;
  try { ps = resolveExe('ps'); } catch { ps = resolveExe('bash').replace(/bash\.exe$/i, 'ps.exe'); }
  return parseMsysPs(execFileSync(ps, ['-a'], { encoding: 'utf8' }));
}

// root 的子孫（不含 root），深的在前（殺的時候先殺葉子）。edges：補充的父子連結（MSYS 的），一樣要過建立時間那一關
export function descendants(all, rootPid, { edges = [] } = {}) {
  const byPid = new Map(all.map((p) => [p.pid, p]));
  const root = byPid.get(rootPid);
  if (!root) return [];
  const extra = new Map();
  for (const [p, c] of edges) (extra.get(p) || extra.set(p, new Set()).get(p)).add(c);
  const out = [];
  const seen = new Set([rootPid]);
  const walk = (parent, depth) => {
    for (const c of all) {
      if (seen.has(c.pid)) continue;
      if (c.ppid !== parent.pid && !(extra.get(parent.pid) || new Set()).has(c.pid)) continue;
      // 建立時間不早於父程序才算——早於的是 PID 被重用之前就在的別人家的程序
      // ⚠ 這一道與 run-timeout.mjs 的可殺名稱清單（KILLABLE）互為備援：單獨移除這一道，「殺了誰」不會讓任何測試紅
      //   （只有「認到哪幾支」那一條會紅）。移除前先確認另一道仍然存在。刻意接受的例外：安全機制要冗餘。
      if (c.created == null || parent.created == null || c.created < parent.created) continue;
      seen.add(c.pid);
      out.push({ ...c, depth });
      walk(c, depth + 1);
    }
  };
  walk(root, 1);
  return out.sort((a, b) => b.depth - a.depth);
}
