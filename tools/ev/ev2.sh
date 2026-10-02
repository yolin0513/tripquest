#!/usr/bin/env bash
# 證據外殼第二版：跟 ev.sh 一樣切到明確的 commit、套 patch（沒套上就不跑），但**把突變 commit 起來**再跑——
# f8verify 只驗 HEAD（開 HEAD 的暫存複本），突變不 commit 就跑不到（統籌者 2026-09-24 踩的坑）。
# commit 之後先斷言：HEAD 裡那一支的雜湊＝套完 patch 的雜湊（複本裡確實有改壞的段落），不成立就不跑。
# 用法：ev2.sh <標籤> <commit> <指令> [檔案=patch.json ...]
set -u
# 這支 bash 必須是 Git Bash（MSYS）：裸寫的 bash 從 PowerShell 起點會被解成 WSL（本機實測），驗法根本沒跑起來。
# 不是 Git Bash、或認不出來 → 印「情境未成立」、不寫 exit=（progress 判成開了頭沒跑完，不算數）。
BASHEXE="$(cygpath -w "$(command -v bash)" 2>/dev/null)"
case "$BASHEXE" in
  *'\Git\'*) echo "[$1] bash 執行檔：$BASHEXE（pid $$）" ;;
  *) echo "[$1] ⊘ 情境未成立：這支 bash 不是 Git Bash（${BASHEXE:-認不出來}）——不跑"; exit 9 ;;
esac
S="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$S/../.." && pwd)"
M="$REPO/tools/mutations"; O="$REPO/.logs/ev"; mkdir -p "$O"
W="$(cygpath -w "$REPO")\\.logs\\ev-wt"; U="$(cygpath -u "$W")"
LABEL="$1"; C="$2"; CMD="$3"; shift 3
LOG="$O/ev_$LABEL.log"; rm -f "$LOG"
if [ ! -d "$U/.git" ] && [ ! -f "$U/.git" ]; then
  git -C "$REPO" worktree add -q --detach "$U" "$C" || { echo "[$LABEL] ✗ 建暫存複本失敗"; exit 9; }
  cmd //c mklink //J "$W\\node_modules" "$(cygpath -w "$REPO")\\node_modules" > /dev/null
fi
cd "$U"
git checkout -q -- . 2>/dev/null; git clean -qfd -e node_modules -e .logs > /dev/null 2>&1; rm -rf .logs
git checkout -q --detach "$C" || { echo "[$LABEL] ✗ 切不到 $C"; exit 9; }
echo "[$LABEL] 版本：$(git log -1 --format='%h %s' | cut -c1-70)"
for fp in "$@"; do
  f="${fp%%=*}"; p="${fp#*=}"
  before="$(git hash-object "$f")"
  node "$S/inv_patch.mjs" "$f" "$M/$p" > /dev/null || { echo "[$LABEL] ✗ patch 沒套上（$fp）——不跑"; git checkout -q -- .; exit 9; }
  after="$(git hash-object "$f")"
  git add "$f"
  echo "[$LABEL] 改：$f（${before:0:12} → ${after:0:12}）"
  echo "[$LABEL] 補丁：$p"   # 給 tools/ev/patch-population.mjs --applied 對帳（實際套了哪幾份）
done
if [ "$#" -gt 0 ]; then
  git -c user.name=t -c user.email=t@users.noreply.github.com commit -q -m "突變：$LABEL" || { echo "[$LABEL] ✗ commit 突變失敗——不跑"; exit 9; }
  for fp in "$@"; do
    f="${fp%%=*}"; p="${fp#*=}"
    inhead="$(git rev-parse "HEAD:$f")"; work="$(git hash-object "$f")"
    if [ "$inhead" != "$work" ] || [ "$inhead" = "$(git rev-parse "$C:$f")" ]; then echo "[$LABEL] ✗ HEAD 裡的 $f 不是改壞的那一份——不跑"; exit 9; fi
    echo "[$LABEL] HEAD 裡的 $f＝改壞的那一份（${inhead:0:12}）"
  done
fi
# 逾時（2026-10-02，Dispatch：卡住的成本無上限，「有人注意」不是機制）：照指令裡跑幾次驗法算——pushgatetest 最長實測 167.4 秒、
# f8verify 約 4.5 分鐘（**暫定**：只有「約」，沒有逐次最長值；量到再調），乘 3；至少 300 秒。EV2_TIMEOUT_SEC 可蓋過。
# 逾時被殺的那一場印 ⊘、log 裡不會有完成的證據 → progress／evidence 判成「被中斷、不算數」，不進紅／沒紅。
# 已知限制：GNU timeout 殺的是 bash -c 這一層；簡單的 bash→node 實測殺得到（2026-10-02，對照組數得到 1 支、殺完 0 支），
# 更深的巢狀可能漏——Job Object 改好之後接上。
NPG=$(grep -oF 'pushgatetest.mjs' <<< "$CMD" | wc -l); NFV=$(grep -oF 'f8verify.mjs' <<< "$CMD" | wc -l)
LIMIT=$(( (NPG * 168 + NFV * 270) * 3 )); [ "$LIMIT" -lt 300 ] && LIMIT=300; LIMIT="${EV2_TIMEOUT_SEC:-$LIMIT}"
echo "[$LABEL] 逾時：$LIMIT 秒（pushgatetest ×$NPG、f8verify ×$NFV）"
timeout -k 15 "$LIMIT" bash -c "$CMD" > "$LOG" 2>&1; CODE=$?
if [ "$CODE" = 124 ] || [ "$CODE" = 137 ]; then echo "[$LABEL] ⊘ 逾時 $LIMIT 秒被殺——沒有結果、不算數"; fi
echo "[$LABEL] exit=$CODE"
git checkout -q --detach "$C"; git checkout -q -- .; git clean -qfd -e node_modules > /dev/null 2>&1
exit 0
