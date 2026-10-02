#!/usr/bin/env bash
# 依賴注入後的突變＋F9 共同一環的突變；commit 在暫存複本裡、正反兩種順序各跑一次 pushgatetest
set -u
S="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$S/../.." && pwd)"
M="$REPO/tools/mutations"; O="$REPO/.logs/ev"; mkdir -p "$O"
C="$1"
node "$S/mk_di_patches.mjs" || exit 9
BOTH='echo "== 預設順序"; node scripts/pushgatetest.mjs; echo "== 倒序"; PUSHGATE_ORDER=reverse node scripts/pushgatetest.mjs'
show() {
  echo "==== $1"
  grep -E '^\[' "$O/ev2-$1.shell" | grep -v '版本：'
  grep -E '^== |^✗|項通過' "$O/ev_$1.log" | grep -v '^✗ 沒有登記' | cut -c1-150
}
. "$S/segment.sh"
run() { local l="$1" c="$2"; shift 2; seg_skip "$l" && return; bash "$S/ev2.sh" "$l" "$C" "$c" "$@" > "$O/ev2-$l.shell" 2>&1; show "$l"; }
PS=scripts/prepush-scan.mjs; SP=scripts/safe-push.sh
for k in d_c2 d_i d_k d_k2 d_l d_r; do run "di-$k" "$BOTH" $PS=pdi_$k.json; done
for k in d_t c_touched c_noreg; do run "di-$k" "$BOTH" $SP=pdi_$k.json; done
echo alldone
