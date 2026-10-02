// 在暫存 clone 裡跑的測試，開跑時印出「這一次實際讀到的被測檔」與雜湊（2026-10-02）：
//   被驗的檔：scripts/mutate.mjs=1a2b3c4d5e6f；scripts/run-timeout.mjs=…
// 為什麼：clone 拿到的是已 commit 的版本，不是外層改壞的工作區（MealMate 2026-10-02：一組對照組在 clone 裡跑的一直是原版、
// 顯示成「跑完了」）。突變驅動拿這一行跟外層改壞那份的雜湊比，對不上＝改壞的那份沒在跑＝情境未成立。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const sha12 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 12);
export const testedLine = (root, files) => '被驗的檔：' + files.map((f) => `${f}=${sha12(path.join(root, f))}`).join('；');
export function parseTested(out) {
  const m = out.match(/^被驗的檔：(.+)$/m);
  if (!m) return null;
  return Object.fromEntries(m[1].split('；').map((x) => x.split('=')));
}
