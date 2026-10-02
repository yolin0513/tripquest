#!/usr/bin/env bash
# 證據外殼第二版：跟 ev.sh 一樣切到明確的 commit、套 patch（沒套上就不跑），但**把突變 commit 起來**再跑——
# f8verify 只驗 HEAD（開 HEAD 的暫存複本），突變不 commit 就跑不到（統籌者 2026-09-24 踩的坑）。
# commit 之後先斷言：HEAD 裡那一支的雜湊＝套完 patch 的雜湊（複本裡確實有改壞的段落），不成立就不跑。
# 用法：ev2.sh <標籤> <commit> <指令> [檔案=patch.json ...]
set -u
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
bash -c "$CMD" > "$LOG" 2>&1; CODE=$?
echo "[$LABEL] exit=$CODE"
git checkout -q --detach "$C"; git checkout -q -- .; git clean -qfd -e node_modules > /dev/null 2>&1
exit 0
