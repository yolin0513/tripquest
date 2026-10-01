#!/usr/bin/env bash
# 最後一批的突變：commit 在暫存複本裡、正反兩種順序各跑一次 pushgatetest
set -u
S="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$S/../.." && pwd)"
M="$REPO/tools/mutations"; O="$REPO/.logs/ev"; mkdir -p "$O"
C="$1"
node "$S/mk_last_patches.mjs" || exit 9
BOTH='echo "== 預設順序"; node scripts/pushgatetest.mjs; echo "== 倒序"; PUSHGATE_ORDER=reverse node scripts/pushgatetest.mjs'
show() {
  echo "==== $1"
  grep -E '^\[' "$O/ev2-$1.shell" | grep -v '版本：'
  grep -E '^== |^✗|項通過' "$O/ev_$1.log" | grep -v '^✗ 沒有登記' | cut -c1-150
}
run() { local l="$1" c="$2"; shift 2; bash "$S/ev2.sh" "$l" "$C" "$c" "$@" > "$O/ev2-$l.shell" 2>&1; show "$l"; }
PS=scripts/prepush-scan.mjs; SP=scripts/safe-push.sh; VR=scripts/verified-reg.mjs
for k in ps_noae ps_noce ps_nopathctl ps_noghnot; do run "last-$k" "$BOTH" $PS=plast_$k.json; done
for k in sp_p3det sp_p2det; do run "last-$k" "$BOTH" $SP=plast_$k.json; done
run "last-vr_s4det" "$BOTH" $VR=plast_vr_s4det.json
echo alldone
