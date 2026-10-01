// 依賴注入後的突變，以及 F9 對照表「共同依靠的一環」的突變（用程式寫 JSON，不經 shell）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 輸出到 tools/mutations/（mutlint 檢查的那個目錄）；第一個參數可指定別的目錄（驗證「重新產生＝入庫的那份」用）
const S = process.argv[2] ? path.resolve(process.argv[2]) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mutations');
const P = {
  // C2：對照組沒命中就算壞了
  d_c2: [['    if (!ctrlHit) broken.push(name);', '    if (false) broken.push(name);']],
  // K：筆數；K2：訊息；I 兩條都靠（單拿一條時另一條接住）
  d_k: [["if (commits > 0 && parsed !== commits) metaFaults.push('筆數');", "if (false) metaFaults.push('筆數');"]],
  d_k2: [["if (commits > 0 && count('commit 訊息') < commits) metaFaults.push('訊息');", "if (false) metaFaults.push('訊息');"]],
  d_i: [["if (commits > 0 && parsed !== commits) metaFaults.push('筆數');", "if (false) metaFaults.push('筆數');"],
    ["if (commits > 0 && count('commit 訊息') < commits) metaFaults.push('訊息');", "if (false) metaFaults.push('訊息');"]],
  // L：核對用 !==（抽多了也要擋），改成 < 會放行
  d_l: [['if (added.length !== expected) {', 'if (added.length < expected) {']],
  // R（隱式的擋 → 吞掉例外，F10 第 5 點）：catch 什麼都不做、往下走
  d_r: [["    log(`✗ 讀不到要檢查的範圍（${range || 'HEAD'}）：${String(e.message).split('\\n')[0]}`);\n    log('擋下：檢查器壞了（範圍）');\n    return 4;", '    void e;']],
  // T：不要求「通過」那一行
  d_t: [['if ! grep -qx "通過" "$TMP/check"; then', 'if false; then']],
  // F9 共同的一環：① 列出動到的檔（比對永遠對不上＝沒動到）② 沒有登記檔就停
  c_touched: [['    if [ "$t" = "$f" ]; then case', '    if false; then case']],
  c_noreg: [['    echo "擋下：F8 驗法沒有驗過（沒有登記檔）"; exit 6', '    :']],
};
for (const [k, list] of Object.entries(P)) fs.writeFileSync(path.join(S, `pdi_${k}.json`), JSON.stringify(list.map(([from, to]) => ({ from, to }))));
console.log(Object.keys(P).length + ' 個');
