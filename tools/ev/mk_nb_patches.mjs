import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 輸出到 tools/mutations/（mutlint 檢查的那個目錄）；第一個參數可指定別的目錄（驗證「重新產生＝入庫的那份」用）
const S = process.argv[2] ? path.resolve(process.argv[2]) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mutations');
const P = {
  // 翻頁標籤改回一般空白 → v147shots 新斷言要紅
  nb_poster: [["label: groups.length > 1 ? nth(groups[gi][0].day, '天') : '整趟',", "label: groups.length > 1 ? `第 ${groups[gi][0].day} 天` : '整趟',"]],
  // 規則改回「160 字以內都檢查」→ 長說明那條對照組要紅
  lt_wide: [["const shortPhrase = fullText.length <= 40 && !fullText.includes('。') && !fullText.includes('——');", 'const shortPhrase = fullText.length <= 160;']],
  // 規則改成全部不檢查 → 短片語那條對照組要紅
  lt_none: [["const shortPhrase = fullText.length <= 40 && !fullText.includes('。') && !fullText.includes('——');", 'const shortPhrase = false;']],
};
for (const [k, list] of Object.entries(P)) fs.writeFileSync(path.join(S, `pnb_${k}.json`), JSON.stringify(list.map(([from, to]) => ({ from, to }))));
console.log(Object.keys(P).length + ' 個');
