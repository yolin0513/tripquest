# tools/ev 分段用（2026-10-02）：由各驅動 source，run() 開頭呼叫 seg_skip "$標籤"，回 0＝這個情境不要跑。
# 分段不靠殺程序：第一段用 killTree 停外殼，Git Bash（MSYS）程序的父子關係在 Windows 上接不起來，驅動那支 bash 沒被殺到，
# 停下之後又開了下一個情境（six-3a）、多跑了約 2 分鐘。改成驅動自己停——
#   · 停止旗標：.logs/ev/STOP 存在 → 不開新的情境（正在跑的照常跑完）
#   · 已跑完：progress.mjs --is-done 回 0（有完成的證據）→ 跳過；progress 壞掉（回 4）→ 當成沒跑完、照常跑（寧可重跑，不可漏跑）
# 必須在 run() 裡、寫外殼紀錄之前判斷：run() 用 > 重新導向，一開跑就把上一段留下的外殼紀錄清空。
seg_skip() {
  if [ -f "$O/STOP" ]; then echo "[$1] 停止旗標在（.logs/ev/STOP），不開新情境"; return 0; fi
  if node "$S/progress.mjs" --is-done "$1"; then echo "[$1] 上一段已跑完（有完成的證據），跳過"; return 0; fi
  return 1
}
