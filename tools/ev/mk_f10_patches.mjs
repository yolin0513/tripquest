// F10 的突變 patch（用程式寫 JSON，不經 shell）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 輸出到 tools/mutations/（mutlint 檢查的那個目錄）；第一個參數可指定別的目錄（驗證「重新產生＝入庫的那份」用）
const S = process.argv[2] ? path.resolve(process.argv[2]) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mutations');
const P = {
  q1: [['  cat "$TMP/touched.err"; echo "✗ 列不出這次要推的 commit 動到哪些檔"; echo "擋下：檢查器壞了（動到的檔）"; exit 4', '  :']],
  q2: [['  echo "✗ 遠端的 main（$REMOTE）本機沒有、也抓不下來——無法決定要檢查哪些 commit"; echo "擋下：檢查器壞了（範圍）"; exit 4', '  :']],
  q4: [['  cat "$TMP/after.err"; echo "✗ 推完了但讀不到遠端，無法確認有沒有推上去——停"; exit 3', '  :']],
  q5: [['else WORK="工作區沒有"; fi', 'else WORK="$WANT"; fi']],
  q6: [['else HAVE="HEAD 裡沒有"; fi', 'else HAVE="$WANT"; fi']],
  v6: [['if (!have.ok || !have.out) {', 'if (false) {']],
  v5: [["(failed ? 'drop' : partial ? 'keep' : 'write')", "(partial ? 'keep' : failed ? 'drop' : 'write')"]],
  // 呼叫端：開始前刪＋檔尾刪，兩道都拿掉（只拿一道時另一道接住＝等價，§5.12）
  pg_nodrop: [["if (!order) console.log(", "if (false) console.log("],
    ["if (regAction({ failed: !!process.exitCode, partial: !!order }) === 'drop')", "if (false)"]],
  pg_nodrop_start: [["if (!order) console.log(", "if (false) console.log("]],
  fv_nodrop: [["if (act === 'drop') {", 'if (false) {']],
  pg_nodrop_end: [["if (regAction({ failed: !!process.exitCode, partial: !!order }) === 'drop')", "if (false)"]],
};
for (const [k, list] of Object.entries(P)) fs.writeFileSync(path.join(S, `pf10_${k}.json`), JSON.stringify(list.map(([from, to]) => ({ from, to }))));
console.log(Object.keys(P).length + ' 個');
