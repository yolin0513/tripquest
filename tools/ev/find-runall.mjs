// 認「正在跑 run-all.sh 的 bash」，給 stop-after.mjs、stop-at-boundary.mjs 用（2026-11-12 從兩支各自內嵌的查詢抽出來修）。
//
// 修之前：Name='bash.exe' 且 CommandLine 含 run-all.sh 就算，認到就交給 killTree 整棵殺。
//   呼叫者自己的 shell 只要指令全文提到 run-all.sh（例：Claude Code 的 Bash 工具是 `bash -c "…"`，指令裡寫到這個檔名），
//   就被認進去——連同這支工具自己一起被殺；機器上任何一支命令列提到這個字的 bash（例：別的工作階段在 grep 它）也一樣。
//   2026-11-12 實測（只查不殺）：從同一行提到 run-all.sh 的指令叫，認到 3 支，3 支全是呼叫者自己的上層 bash。
//   誤差方向固定（永遠多認），而失敗的樣子是「整個工作階段莫名其妙沒了、現場被自己殺掉」。
//
// 現在兩道擋，各守不同的情境（驗法 scripts/find-runall-check.mjs，每一種情境都是真的程序；改了這支就手動跑它）：
//   (a) 只認拿 run-all.sh 當「腳本參數」在跑的 bash（它分叉出的子殼命令列一樣，也算）；
//       `bash -c "…run-all.sh…"`、`-lc` 這種只是字串裡提到的不算——守情境 C（機器上別的 shell 提到這個字）。
//   (b) 排除自己與自己的整條上層鏈（Win32 父程序鏈、父必須不晚於子建立；加上 MSYS 的父子連結）
//       ——守情境 D（呼叫者自己就是 run-all.sh 開出來的）。
//   ⚠ 這兩道在情境 B（呼叫者的 `bash -c` 提到 run-all.sh）互為備援：單獨移除任一道，B 不會紅（C 或 D 會紅）；
//     兩道一起移除 B 才紅。刻意接受的冗餘——移除其中一道之前，先確認另一道仍在。
// 列不出程序表、算不出上層鏈 → 丟例外；呼叫端照設計不殺任何東西（停下，不是放行）。
// 已知限制：(a) 的命令列解析只認常見寫法（選項在腳本之前、`-o`/`-O` 帶一個參數）；認不出腳本的一律不算目標（寧可少認、不殺錯）。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { msysEdges } = await import(pathToFileURL(path.join(REPO, 'scripts', 'proctree.mjs')).href);

export const TARGET = 'run-all.sh';

const msOf = (v) => {
  if (typeof v === 'number') return v;
  const m = String(v || '').match(/Date\((\d+)/);
  if (m) return Number(m[1]);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

// Windows 命令列切成參數（雙引號包起來的算一個）
export function tokenize(cmd) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(cmd || '')))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

// bash 的命令列 → 它當腳本在跑的檔案路徑；`-c` 形式（含 -lc、-ec…）或認不出 → null
export function scriptOf(cmd) {
  const t = tokenize(cmd).slice(1);
  for (let i = 0; i < t.length; i++) {
    const a = t[i];
    if (a === '--') return t[i + 1] ?? null;
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(a)) return null;
    if (/^[-+][oO]$/.test(a)) { i++; continue; }
    if (a.startsWith('-') || a.startsWith('+')) continue;
    return a;
  }
  return null;
}

export const runsTarget = (cmd) => {
  const s = scriptOf(cmd);
  return s != null && s.split(/[\\/]/).pop() === TARGET;
};

// 自己＋上層鏈（Win32 父程序鏈：父的建立時間不晚於子才往上走；再加 MSYS 連結的父）
export function ancestorsOf(all, selfPid, edges = []) {
  const byPid = new Map(all.map((p) => [p.pid, p]));
  if (!byPid.has(selfPid)) throw new Error(`程序表裡找不到自己（${selfPid}）——算不出上層鏈`);
  const msysParent = new Map(edges.map(([p, c]) => [c, p]));
  const seen = new Set([selfPid]);
  const stack = [selfPid];
  while (stack.length) {
    const c = byPid.get(stack.pop());
    if (!c) continue;
    for (const ppid of [c.ppid, msysParent.get(c.pid)]) {
      if (ppid == null || seen.has(ppid)) continue;
      const p = byPid.get(ppid);
      if (!p) continue;
      // 父比子晚建立＝PID 被重用、不是真的父；建立時間讀不到就當成是（多排除只會少殺，不會殺錯）
      if (p.created != null && c.created != null && p.created > c.created) continue;
      seen.add(ppid); stack.push(ppid);
    }
  }
  return seen;
}

// 純函式：給程序表，回 { targets, skippedSelf, skippedNotScript }
export function pickTargets(all, selfPid, edges = []) {
  const anc = ancestorsOf(all, selfPid, edges);
  const bash = all.filter((p) => /^bash(\.exe)?$/i.test(p.name || '') && String(p.cmd || '').includes(TARGET));
  const skippedNotScript = bash.filter((p) => !runsTarget(p.cmd)).map((p) => p.pid);
  const skippedSelf = bash.filter((p) => runsTarget(p.cmd) && anc.has(p.pid)).map((p) => p.pid);
  const targets = bash.filter((p) => runsTarget(p.cmd) && !anc.has(p.pid)).map((p) => p.pid);
  return { targets, skippedSelf, skippedNotScript };
}

export function listWithCmd() {
  const json = execFileSync('powershell', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine | ConvertTo-Json -Compress'],
  { encoding: 'utf8', maxBuffer: 64 << 20 });
  const arr = JSON.parse(json);
  const rows = (Array.isArray(arr) ? arr : [arr]).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, created: msOf(p.CreationDate), cmd: p.CommandLine || '' }));
  if (rows.length === 0) throw new Error('程序表是空的——列不出程序');
  return rows;
}

// 給兩支停程序工具用：列程序表、取 MSYS 連結、挑目標；任何一步失敗就丟例外（呼叫端不殺）
export function findRunAll({ list = listWithCmd, edges = msysEdges, selfPid = process.pid } = {}) {
  const all = list();
  const e = edges();
  return pickTargets(all, selfPid, e);
}
