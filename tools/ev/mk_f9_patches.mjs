// 產生 F9 的突變 patch（用程式寫 JSON，不經 shell，免得反斜線與引號走樣）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 輸出到 tools/mutations/（mutlint 檢查的那個目錄）；第一個參數可指定別的目錄（驗證「重新產生＝入庫的那份」用）
const S = process.argv[2] ? path.resolve(process.argv[2]) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mutations');
const P = {
  sp_f8off: [['if [ -n "$TOUCHED" ]; then', 'if false; then']],
  sp_f8always: [['if [ -n "$TOUCHED" ]; then', 'if true; then']],
  sp_pg_headonly: [['if [ "$WANT" != "$HAVE" ] || [ "$WANT" != "$WORK" ]; then', 'if [ "$WANT" != "$HAVE" ]; then']],
  sp_pg_workonly: [['if [ "$WANT" != "$HAVE" ] || [ "$WANT" != "$WORK" ]; then', 'if [ "$WANT" != "$WORK" ]; then']],
  sp_lastcommit: [['git log --format= --name-only "$RANGE" >', 'git log -1 --format= --name-only HEAD >']],
  sp_f8work: [['reg_want "$F8REG" "$f"; head_hash "$f"', 'reg_want "$F8REG" "$f"; HAVE="$(git hash-object -- "$f")"']],
  vr_noclean: [['if (bad.length) return { ok: false', 'if (false) return { ok: false']],
  fv_extras: [['for (const [label, okay] of extras) if (!okay) miss.push(label);', 'for (const [label, okay] of extras) if (false) miss.push(label);']],
  fv_precheck: [['if (pre.length) give(', 'if (false) give(']],
};
for (const [k, list] of Object.entries(P)) fs.writeFileSync(path.join(S, `pf9_${k}.json`), JSON.stringify(list.map(([from, to]) => ({ from, to }))));
console.log(Object.keys(P).length + ' 個');
