// 把 bash／sh／python 解成完整路徑，再交給 spawn（2026-10-02）。
// 為什麼：裸寫的 `bash` 交給 Windows 的 PATH 去解，從 PowerShell 起點第一支是系統目錄 System32 裡的 bash.exe（WSL）——
// 本機實測：從 Git Bash 起點解到 Git 安裝目錄下 usr/bin 的 bash.exe，從 PowerShell 起點解到 System32 的那支。
// （這裡不寫完整的磁碟路徑：推送閘的自查一看到磁碟代號開頭的路徑就擋，不去放寬它。）
// 被解成 WSL 時驗法根本沒跑起來（JLPT 2026-10-02：2 秒回 1、峰值 0 個程序）。python 同理：WindowsApps 裡的是商店替身。
// 規則：照 PATH 順序找第一支「不在系統目錄、不在 WindowsApps」的；全部都落在那裡、或一支都找不到 → 丟錯（呼叫端判情境未成立，不是紅）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// 路徑分隔用字元類別 [\\/]（反斜線或正斜線都認）；不寫成「兩個反斜線接字母」——那跟多跳脫一次長得一樣，gatelint 會擋
export const REJECT = /[\\/]Windows[\\/](System32|SysWOW64|Sysnative)[\\/]|[\\/]WindowsApps[\\/]/i;
const defaultWhere = (name) => {
  if (process.platform !== 'win32') return [execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim()];
  return execFileSync('where', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/).filter(Boolean);
};
export function resolveExe(name, { where = defaultWhere, exists = (p) => fs.existsSync(p) } = {}) {
  let list;
  try { list = where(name); } catch { list = []; }
  const ok = list.filter((p) => !REJECT.test(p) && exists(p));
  if (!ok.length) throw new Error(`找不到可用的 ${name}（PATH 上的：${list.join('、') || '一支都沒有'}；系統目錄與 WindowsApps 的不用）`);
  return ok[0];
}
