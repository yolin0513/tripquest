#!/usr/bin/env bash
# F9 六條：每條一個突變，commit 在暫存複本裡、正反兩種順序各跑一次 pushgatetest，印出紅的是哪幾條
set -u
S="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$S/../.." && pwd)"
M="$REPO/tools/mutations"; O="$REPO/.logs/ev"; mkdir -p "$O"
C="$1"
node "$S/mk_six_patches.mjs" || exit 9
for k in six1 six1b six2 six3 six3a six3b six4 six5 six6; do [ -f "$M/psix_$k.json" ] || { echo "✗ 沒有 psix_$k.json"; exit 9; }; done
BOTH='echo "== 預設順序"; node scripts/pushgatetest.mjs; echo "== 倒序"; PUSHGATE_ORDER=reverse node scripts/pushgatetest.mjs'
ONE='echo "== 預設順序"; node scripts/pushgatetest.mjs'
show() {
  echo "==== $1"
  grep -E '^\[' "$O/ev2-$1.shell"
  grep -E '^== |^✗|項通過' "$O/ev_$1.log" | grep -v '^✗ 沒有登記' | cut -c1-150
}
run() { local l="$1" c="$2"; shift 2; bash "$S/ev2.sh" "$l" "$C" "$c" "$@" > "$O/ev2-$l.shell" 2>&1; show "$l"; }
SP=scripts/safe-push.sh; FV=scripts/f8verify.mjs
run six-1 "$BOTH" $SP=psix_six1.json
run six-1b "$BOTH" $SP=psix_six1b.json
run six-2 "$BOTH" $SP=psix_six2.json
run six-3 "$BOTH" $FV=psix_six3.json
run six-3a "$ONE" $FV=psix_six3a.json
run six-3b "$ONE" $FV=psix_six3b.json
run six-4 "$BOTH" $FV=psix_six4.json
run six-5 "$BOTH" $SP=psix_six5.json
run six-6 "$BOTH" $SP=psix_six6.json
echo alldone
