// 最後一批的突變 patch（用程式寫 JSON，不經 shell）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 輸出到 tools/mutations/（mutlint 檢查的那個目錄）；第一個參數可指定別的目錄（驗證「重新產生＝入庫的那份」用）
const S = process.argv[2] ? path.resolve(process.argv[2]) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mutations');
const P = {
  // 補充十一
  ps_noae: [["for (const t of [an, ae]) added.push({ src: '作者欄'", "for (const t of [an]) added.push({ src: '作者欄'"]],
  ps_noce: [["for (const t of [cn, ce]) added.push({ src: '提交者欄'", "for (const t of [cn]) added.push({ src: '提交者欄'"]],
  ps_nopathctl: [[", 'at ' + '~' + '/notes'],", '],']],
  ps_noghnot: [["ctrlNot: ['by ' + 'zz' + '@' + 'users.noreply.github.com', ", 'ctrlNot: [']],
  // F9 偵測層
  sp_p3det: [['  for f in $F8_GUARD; do\n    reg_want "$F8REG" "$f"; head_hash "$f"', '  for f in ${F8_GUARD%% *}; do\n    reg_want "$F8REG" "$f"; head_hash "$f"']],
  sp_p2det: [['    reg_want "$F8REG" "$f"; head_hash "$f"\n    if [ "$WANT" != "$HAVE" ]; then', '    reg_want "$F8REG" "$f"; head_hash "$f"\n    if true; then']],
  vr_s4det: [['    if (have.out !== want) bad.push(', '    if (false) bad.push(']],
};
for (const [k, list] of Object.entries(P)) fs.writeFileSync(path.join(S, `plast_${k}.json`), JSON.stringify(list.map(([from, to]) => ({ from, to }))));
console.log(Object.keys(P).length + ' 個');
