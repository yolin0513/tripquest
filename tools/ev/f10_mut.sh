#!/usr/bin/env bash
# F10 的突變與呼叫端的一次性實測；每條都 commit 在暫存複本裡跑（ev2.sh），印出紅的是哪幾條
set -u
S="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$S/../.." && pwd)"
M="$REPO/tools/mutations"; O="$REPO/.logs/ev"; mkdir -p "$O"
C="$1"
node "$S/mk_f10_patches.mjs" || exit 9
for k in q1 q2 q4 q5 q6 v6 v5 pg_nodrop pg_nodrop_start pg_nodrop_end; do [ -f "$M/pf10_$k.json" ] || { echo "✗ 沒有 pf10_$k.json"; exit 9; }; done
PG='node scripts/pushgatetest.mjs'
# 呼叫端：先放一份舊登記、確認它在，跑驗法，跑完看登記還在不在
REG='mkdir -p .logs; echo 舊登記 > .logs/pushgate.verified; if [ -f .logs/pushgate.verified ]; then echo "前置：登記原本在"; fi; node scripts/pushgatetest.mjs; echo "驗法回 $?"; if [ -f .logs/pushgate.verified ]; then echo "結果：登記還在（$(head -c 30 .logs/pushgate.verified)）"; else echo "結果：登記已不在"; fi'
FREG='mkdir -p .logs; echo 舊登記 > .logs/f8.verified; if [ -f .logs/f8.verified ]; then echo "前置：登記原本在"; fi; F8VERIFY_ONLY=bp node scripts/f8verify.mjs; echo "驗法回 $?"; if [ -f .logs/f8.verified ]; then echo "結果：登記還在（$(head -c 30 .logs/f8.verified)）"; else echo "結果：登記已不在"; fi'
show() {
  echo "==== $1"
  grep -E '^\[' "$O/ev2-$1.shell"
  grep -E '^✗|項通過|^擋下|^前置：登記|^結果：登記|^驗法回|^全部擋下|16 個城市：.*沒擋' "$O/ev_$1.log" | cut -c1-170 | head -30
}
. "$S/segment.sh"
run() { local l="$1" c="$2"; shift 2; seg_skip "$l" && return; bash "$S/ev2.sh" "$l" "$C" "$c" "$@" > "$O/ev2-$l.shell" 2>&1; show "$l"; }
SP=scripts/safe-push.sh; VR=scripts/verified-reg.mjs; PT=scripts/pushgatetest.mjs
run f10-base "$PG"
run f10-q1 "$PG" $SP=pf10_q1.json
run f10-q2 "$PG" $SP=pf10_q2.json
run f10-q4 "$PG" $SP=pf10_q4.json
run f10-q5 "$PG" $SP=pf10_q5.json
run f10-q6 "$PG" $SP=pf10_q6.json
run f10-v6 "$PG" $VR=pf10_v6.json
run f10-v5 "$PG" $VR=pf10_v5.json
run f10-reg-good "$REG"
run f10-reg-broken "$REG" $SP=pf10_q1.json
run f10-reg-broken-nostart "$REG" $SP=pf10_q1.json $PT=pf10_pg_nodrop_start.json
run f10-reg-broken-noend "$REG" $SP=pf10_q1.json $PT=pf10_pg_nodrop_end.json
run f10-reg-broken-noboth "$REG" $SP=pf10_q1.json $PT=pf10_pg_nodrop.json
run f10-freg-good "$FREG"
run f10-freg-broken "$FREG" scripts/build-places.mjs=pbp2_mut.json
run f10-freg-broken-nodrop "$FREG" scripts/build-places.mjs=pbp2_mut.json scripts/f8verify.mjs=pf10_fv_nodrop.json
echo alldone
