#!/usr/bin/env bash
# tools/ev 分段重跑（2026-10-02；取代原本在 .logs 用 shell 寫出來的 run-all.sh）。
# 依序跑各驅動，每支對它當年跑的 commit；已跑完的情境由驅動的 seg_skip 跳過（有完成的證據才算跑完）。
# 要停：touch .logs/ev/STOP——正在跑的情境照常跑完，不開新的（不殺程序）。要接著跑：先刪掉 .logs/ev/STOP。
# 不跑 f9_mut2：它的 9 份補丁全包含在 f9_mut 裡（tools/ev/patch-population.mjs）。
# 用法：bash tools/ev/run-segment.sh            （記錄寫 .logs/ev/segment-<時間>.txt、資源寫 .logs/ev/run-<驅動>.txt）
set -u
cd "$(dirname "$0")/../.."
LOG=".logs/ev/segment-$(date +%Y%m%d-%H%M%S).txt"
mkdir -p .logs/ev
for pair in six_mut:18a7d94 f9_mut:936b3eb f10_mut:44eac70 di_mut:c79b4ca last_mut:f125671; do
  d="${pair%%:*}"; c="${pair#*:}"
  if [ -f .logs/ev/STOP ]; then echo "==== 停止旗標在，$d 起不跑 $(date +%T)" >> "$LOG"; break; fi
  echo "==== $d @ $c 開始 $(date +%T)" >> "$LOG"
  node tools/sample-run.mjs ".logs/ev/run-$d.txt" bash "tools/ev/$d.sh" "$c"
  echo "==== $d 結束 rc=$? $(date +%T)" >> "$LOG"
done
node tools/ev/progress.mjs >> "$LOG"
echo "==== 這一段結束 $(date +%T)" >> "$LOG"
