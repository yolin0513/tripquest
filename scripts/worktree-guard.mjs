// 工作區守衛：記下「這一刻工作區跟 HEAD 不一樣的檔」與它們的內容雜湊，事後比對有沒有多出來的改動。
// 用在兩個地方：
//   · run-affected.mjs 每一支測試前後各拍一次——測試把進版控的檔改掉、或丟下沒被 .gitignore 擋掉的新檔，
//     就紅並點名「哪一支、動了哪幾個檔」（2026-10-02：imgtest 每次跑都改寫 screenshots/features 的截圖，
//     v1.74.4、v1.74.5、2026-09-25 都是事後手動 git checkout 還原，沒有任何東西擋）。
//   · mutate.mjs 開跑前確認工作區等於 HEAD。
// 開跑前就已經不一樣的檔不算在測試頭上；但測試又改了它（雜湊變了），照樣算。
// 讀不到 git、算不出雜湊 → 丟錯（呼叫端當成「檢查器壞了」，不是「沒有改動」；共用慣例 §5.13）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const realGit = (root) => (args) => execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// git status --porcelain=v1 -z：每筆「XY 路徑」，改名時後面多一筆舊路徑
export function parsePorcelainZ(text) {
  const parts = text.split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const code = p.slice(0, 2);
    out.push({ code, path: p.slice(3) });
    if (code[0] === 'R' || code[0] === 'C') i++;   // 跳過舊路徑
  }
  return out;
}

const hashOf = (root, p) => {
  const f = path.join(root, p);
  let st;
  try { st = fs.statSync(f); } catch (e) { if (e.code === 'ENOENT') return 'missing'; throw e; }
  if (st.isDirectory()) return 'dir';
  return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
};

// untracked：'all'＝連沒被擋掉的新檔也算（測試用）；'no'＝只看進版控的檔（mutate 開跑前用）
export function snapshot({ root, git = realGit(root), untracked = 'all' } = {}) {
  const text = git(['status', '--porcelain=v1', '-z', `--untracked-files=${untracked}`]);
  if (typeof text !== 'string') throw new Error('git status 沒有輸出');
  const map = new Map();
  for (const e of parsePorcelainZ(text)) map.set(e.path, { code: e.code, hash: hashOf(root, e.path) });
  return map;
}

// 回傳 after 比 before 多出來或變了的檔：[{ path, why }]
export function changesBetween(before, after) {
  const out = [];
  for (const [p, a] of after) {
    const b = before.get(p);
    if (!b) out.push({ path: p, why: a.code.trim() === '??' ? '新檔' : '改了進版控的檔' });
    else if (b.hash !== a.hash) out.push({ path: p, why: '開跑前就有改動，測試又改了它' });
  }
  for (const [p] of before) if (!after.has(p)) out.push({ path: p, why: '開跑前的改動被測試還原或刪掉' });
  return out;
}

export const describe = (list) => list.map((c) => `${c.path}（${c.why}）`).join('、');
