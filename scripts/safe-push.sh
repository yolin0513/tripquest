#!/usr/bin/env bash
# 推送閘：公開前自查 → 推送 → 確認遠端等於本機。任何一步失敗就停、回傳非 0。
#   bash scripts/safe-push.sh          （在 repo 根目錄執行；推 main 到 origin）
#
# 回傳值——一看就知道是哪一關擋的：
#   0 已推送、遠端 main ＝ 本機 HEAD
#   1 自查有命中（新增行裡真的有金鑰／email／使用者名稱／本機路徑）——不推
#   4 自查的檢查器壞了（某一類的對照組沒命中、無法檢查、或讀不到範圍）——不推
#   2 git push 失敗（被拒、連不上）——停
#   3 推完了但遠端不等於本機（推了卻沒更新）——停
#   5 閘門本身沒驗過：safe-push.sh／prepush-scan.mjs／pushgatetest.mjs／verified-reg.mjs 在 HEAD 裡的版本
#     跟 .logs/pushgate.verified 登記的雜湊對不上（或沒有登記）——不推。新 clone 一律要先跑 npm run pushgatetest
#   6 F8 的驗法沒驗過：這次要推的 commit 動到 build-places.mjs／importshots.mjs／f8verify.mjs／verified-reg.mjs，而它們在 HEAD 裡的版本
#     跟 .logs/f8.verified 登記的對不上（或沒有登記）——不推。先跑 npm run f8verify。沒動到就不看這一關
#
# 為什麼長這樣（2026-09-23 實測踩到的）：
# - 不接管線。管線的回傳值是最後一個指令的：`git push ... | tail -1` 在 push 失敗時照樣回 0，後面的線上確認
#   會對著舊版驗、看起來還是綠的。所以輸出都寫到檔案，最後才印。
# - 自查掃的是「遠端還沒有的**每一個** commit」，不是只看 HEAD：一次推兩個 commit 時，前一個也會公開。
# - 最後一關比對遠端 HEAD：前兩關都失效時（例如有人又接了管線），它仍擋得住「推了但沒成功」。
# - 放在 repo 裡，不放 Session 的暫存區：防線不該跟著 Session 生死。
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 閘門本身驗過了沒（共用慣例 v9 §5.15：「改過就要重跑」能做成機器擋的就不要靠人記得）：
# pushgatetest 全部通過時把下面四支的雜湊寫進 .logs/pushgate.verified（不進版控、驗法失敗就刪）；沒有或對不上 → 回 5，不推。
REG=".logs/pushgate.verified"   # 不進版控：換一台機器 clone 下來就沒有，第一次推送前一定要先跑 pushgatetest
if [ ! -f "$REG" ]; then
  echo "✗ 沒有 $REG（閘門從沒驗過、或登記檔不見了）——先跑 npm run pushgatetest"
  echo "擋下：閘門沒有驗過（沒有登記檔）"; exit 5
fi
# 兩邊都要等於登記：工作區那一份（現在正在執行的就是它）、HEAD 裡那一份（推出去的是它；F9：改過的版本已經 commit、
# 工作區又改回原樣，照樣要擋）。登記檔一行一支「雜湊 路徑」，路徑要整欄相等才算（不用子字串比對：說明行或別的路徑剛好含有它時會對錯行）。
reg_want() { local h p; WANT=""; while read -r h p; do if [ "$p" = "$2" ]; then WANT="$h"; fi; done < "$1"; }
head_hash() { if HAVE="$(git rev-parse -q --verify "HEAD:$1" 2>/dev/null)"; then :; else HAVE="HEAD 裡沒有"; fi; }
for f in scripts/safe-push.sh scripts/prepush-scan.mjs scripts/pushgatetest.mjs scripts/verified-reg.mjs; do
  reg_want "$REG" "$f"; head_hash "$f"
  if WORK="$(git hash-object -- "$f" 2>/dev/null)"; then :; else WORK="工作區沒有"; fi
  if [ "$WANT" != "$HAVE" ] || [ "$WANT" != "$WORK" ]; then
    echo "✗ $f 改過了（登記 ${WANT:-沒有}、HEAD 裡是 $HAVE、工作區是 $WORK）——commit 之後跑 npm run pushgatetest，全過之後會重寫 $REG"
    echo "擋下：閘門沒有驗過（$f 改過、驗法還沒重跑）"; exit 5
  fi
done

# 遠端現在的 main——**問遠端的實際狀態，不讀本機的追蹤分支**（共用慣例 v8 §2.5）：上一次「推了卻沒更新」之後，
# 本機的追蹤分支會跑在遠端前面；照它算範圍，那個 commit 會落在範圍外，下一次就不經檢查被帶出去。
# 先把輸出存到檔案再取值，不接管線（ls-remote 失敗時才擋得下來）。本機沒有那個 commit 就先抓下來。
if ! git ls-remote origin refs/heads/main > "$TMP/remote" 2> "$TMP/remote.err"; then
  cat "$TMP/remote.err"; echo "✗ 抓不到遠端，無法決定要檢查哪些 commit"; echo "擋下：檢查器壞了（抓不到遠端）"; exit 4
fi
REMOTE="$(cut -f1 < "$TMP/remote")"
if [ -n "$REMOTE" ] && ! git cat-file -e "$REMOTE^{commit}" 2>/dev/null; then
  git fetch -q origin main > "$TMP/fetch" 2>&1 || true
fi
if [ -n "$REMOTE" ] && ! git cat-file -e "$REMOTE^{commit}" 2>/dev/null; then
  echo "✗ 遠端的 main（$REMOTE）本機沒有、也抓不下來——無法決定要檢查哪些 commit"; echo "擋下：檢查器壞了（範圍）"; exit 4
fi
RANGE="${REMOTE:+$REMOTE..}HEAD"
[ -z "$REMOTE" ] && RANGE="HEAD"

# F8 的建置腳本與它的驗法（F9）：這次要推的 commit（每一個，不只兩端）動到其中任何一支，才看 .logs/f8.verified；
# 看的時候整組都要對得上 HEAD 裡的版本。驗法要跑四五分鐘、還會開瀏覽器，沒動到就不擋。
F8_GUARD="scripts/build-places.mjs scripts/importshots.mjs scripts/f8verify.mjs scripts/verified-reg.mjs"
F8REG=".logs/f8.verified"
if ! git log --format= --name-only "$RANGE" > "$TMP/touched" 2> "$TMP/touched.err"; then
  cat "$TMP/touched.err"; echo "✗ 列不出這次要推的 commit 動到哪些檔"; echo "擋下：檢查器壞了（動到的檔）"; exit 4
fi
TOUCHED=""
# 逐行整行比對（不用 grep：grep 自己出錯時回 2，在 if 裡會跟「沒動到」長得一樣，這一關就默默不看了）
while read -r t; do
  for f in $F8_GUARD; do
    if [ "$t" = "$f" ]; then case " $TOUCHED " in *" $f "*) ;; *) TOUCHED="$TOUCHED $f" ;; esac; fi
  done
done < "$TMP/touched"
if [ -n "$TOUCHED" ]; then
  if [ ! -f "$F8REG" ]; then
    echo "✗ 這次要推的 commit 動到了$TOUCHED，但沒有 $F8REG——commit 之後跑 npm run f8verify"
    echo "擋下：F8 驗法沒有驗過（沒有登記檔）"; exit 6
  fi
  for f in $F8_GUARD; do
    reg_want "$F8REG" "$f"; head_hash "$f"
    if [ "$WANT" != "$HAVE" ]; then
      echo "✗ $f 跟 $F8REG 登記的不一樣（登記 ${WANT:-沒有}、HEAD 裡是 $HAVE）——commit 之後跑 npm run f8verify"
      echo "擋下：F8 驗法沒有驗過（$f 改過、驗法還沒重跑）"; exit 6
    fi
  done
  echo "F8 驗法：這次動到了$TOUCHED，登記相符"
fi

set +e
node scripts/prepush-scan.mjs "$RANGE" > "$TMP/check" 2>&1
CHECK=$?
set -e
cat "$TMP/check"
if [ "$CHECK" -ne 0 ]; then
  if [ "$CHECK" -eq 1 ]; then echo "✗ 公開前自查有命中——不推"; exit 1; fi
  echo "✗ 公開前自查的檢查器壞了——不推"; exit 4
fi
# 回 0 還不夠：輸出裡要真的有「通過」那一行（自查一行都沒掃就結束、照樣回 0 時，擋在這裡）
if ! grep -qx "通過" "$TMP/check"; then
  echo "✗ 公開前自查回 0，卻沒有印出「通過」——它可能根本沒有跑"; echo "擋下：檢查器壞了（自查沒有跑）"; exit 4
fi

if ! git push origin main > "$TMP/push" 2>&1; then
  cat "$TMP/push"; echo "✗ git push 失敗——停"; exit 2
fi
tail -n 1 "$TMP/push"
LOCAL="$(git rev-parse HEAD)"
if ! git ls-remote origin refs/heads/main > "$TMP/after" 2> "$TMP/after.err"; then
  cat "$TMP/after.err"; echo "✗ 推完了但讀不到遠端，無法確認有沒有推上去——停"; exit 3
fi
AFTER="$(cut -f1 < "$TMP/after")"
if [ "$LOCAL" != "$AFTER" ]; then
  echo "✗ 推完了但遠端（${AFTER:-讀不到}）不等於本機（$LOCAL）——停"; exit 3
fi
echo "✓ 已推送，遠端 main ＝ 本機 HEAD（$LOCAL）"
