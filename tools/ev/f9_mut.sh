#!/usr/bin/env bash
# F9 的突變：每一條都 commit 在暫存複本裡跑（ev2.sh），印出紅的是哪幾條。先跑沒改壞的同一份當對照（應全綠）。
set -u
S="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$S/../.." && pwd)"
M="$REPO/tools/mutations"; O="$REPO/.logs/ev"; mkdir -p "$O"
C="$1"
node "$S/mk_f9_patches.mjs"
PG='node scripts/pushgatetest.mjs'
show() {   # $1 標籤
  echo "==== $1"
  grep -E '^\[' "$O/ev2-$1.shell"
  grep -E '^✗|項通過|^擋下|^判定的對照組|^全部擋下|^  scripts/.*複本|^build-places：|^importshots：|個城市：.*沒擋|｜沒擋' "$O/ev_$1.log" | cut -c1-160 | head -40
}
run() {   # $1 標籤 $2 指令 $3... patch
  local l="$1" c="$2"; shift 2
  bash "$S/ev2.sh" "$l" "$C" "$c" "$@" > "$O/ev2-$l.shell" 2>&1
  show "$l"
}
run f9-base-pg "$PG"
run f9-sp_f8off "$PG" scripts/safe-push.sh=pf9_sp_f8off.json
run f9-sp_f8always "$PG" scripts/safe-push.sh=pf9_sp_f8always.json
run f9-sp_pg_headonly "$PG" scripts/safe-push.sh=pf9_sp_pg_headonly.json
run f9-sp_pg_workonly "$PG" scripts/safe-push.sh=pf9_sp_pg_workonly.json
run f9-sp_lastcommit "$PG" scripts/safe-push.sh=pf9_sp_lastcommit.json
run f9-sp_f8work "$PG" scripts/safe-push.sh=pf9_sp_f8work.json
run f9-vr_noclean "$PG" scripts/verified-reg.mjs=pf9_vr_noclean.json
run f9-fv_extras "node scripts/f8verify.mjs" scripts/f8verify.mjs=pf9_fv_extras.json
run f9-dirty-base "printf '// dirty\n' >> scripts/build-places.mjs; F8VERIFY_ONLY=bp node scripts/f8verify.mjs"
run f9-dirty-mut "printf '// dirty\n' >> scripts/build-places.mjs; F8VERIFY_ONLY=bp node scripts/f8verify.mjs" scripts/f8verify.mjs=pf9_fv_precheck.json
run f9-base-bp "F8VERIFY_ONLY=bp node scripts/f8verify.mjs"
run f9-bp_mut "F8VERIFY_ONLY=bp node scripts/f8verify.mjs" scripts/build-places.mjs=pbp2_mut.json
run f9-bp_mut2 "F8VERIFY_ONLY=bp node scripts/f8verify.mjs" scripts/build-places.mjs=pbp2_mut2.json
run f9-base-is "F8VERIFY_ONLY=is node scripts/f8verify.mjs"
run f9-is_restore "F8VERIFY_ONLY=is node scripts/f8verify.mjs" scripts/importshots.mjs=pis_mut_restore.json
run f9-is_occupied "F8VERIFY_ONLY=is node scripts/f8verify.mjs" scripts/importshots.mjs=pis_mut_occupied.json
run f9-is_cleanout "F8VERIFY_ONLY=is node scripts/f8verify.mjs" scripts/importshots.mjs=pis_mut_cleanout.json
echo alldone
