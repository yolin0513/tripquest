#!/usr/bin/env bash
# 第一輪 patch 沒產生出來的那幾條重跑（外殼當時正確拒跑）
set -u
S="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$S/../.." && pwd)"
M="$REPO/tools/mutations"; O="$REPO/.logs/ev"; mkdir -p "$O"
C="$1"
node "$S/mk_f9_patches.mjs" || exit 9
for k in sp_f8off sp_f8always sp_pg_headonly sp_pg_workonly sp_lastcommit sp_f8work vr_noclean fv_extras fv_precheck; do [ -f "$M/pf9_$k.json" ] || { echo "✗ 沒有 pf9_$k.json"; exit 9; }; done
PG='node scripts/pushgatetest.mjs'
show() {
  echo "==== $1"
  grep -E '^\[' "$O/ev2-$1.shell"
  grep -E '^✗|項通過|^擋下|^判定的對照組|^全部擋下|^  scripts/.*複本|^build-places：|^importshots：|個城市：.*沒擋|｜沒擋' "$O/ev_$1.log" | cut -c1-160 | head -40
}
run() {
  local l="$1" c="$2"; shift 2
  bash "$S/ev2.sh" "$l" "$C" "$c" "$@" > "$O/ev2-$l.shell" 2>&1
  show "$l"
}
run f9-sp_f8off "$PG" scripts/safe-push.sh=pf9_sp_f8off.json
run f9-sp_f8always "$PG" scripts/safe-push.sh=pf9_sp_f8always.json
run f9-sp_pg_headonly "$PG" scripts/safe-push.sh=pf9_sp_pg_headonly.json
run f9-sp_pg_workonly "$PG" scripts/safe-push.sh=pf9_sp_pg_workonly.json
run f9-sp_lastcommit "$PG" scripts/safe-push.sh=pf9_sp_lastcommit.json
run f9-sp_f8work "$PG" scripts/safe-push.sh=pf9_sp_f8work.json
run f9-vr_noclean "$PG" scripts/verified-reg.mjs=pf9_vr_noclean.json
run f9-fv_extras "node scripts/f8verify.mjs" scripts/f8verify.mjs=pf9_fv_extras.json
run f9-dirty-mut "printf '// dirty\n' >> scripts/build-places.mjs; F8VERIFY_ONLY=bp node scripts/f8verify.mjs" scripts/f8verify.mjs=pf9_fv_precheck.json
echo alldone
