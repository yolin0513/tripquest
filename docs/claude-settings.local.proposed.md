# 建議的權限檔：`claude-settings.local.proposed.json`（2026-10-27）

**這份檔現在不生效。** 要生效，得由 Yolin 在機器前把它複製到 `.claude/settings.local.json`。
Session 自己寫那個位置會被 auto mode 分類器以「Self-Modification」擋下（2026-10-27 實測），
這是對的：放寬權限的範圍不該由被限制的那一方決定。

## 怎麼放進去

在專案根目錄的 PowerShell 貼這一行：

```powershell
Copy-Item docs\claude-settings.local.proposed.json .claude\settings.local.json
```

`.claude/settings.local.json` 已被 `.gitignore` 擋掉，不會被 commit。改了不用重開 Session，會自動重新載入
（出處：https://code.claude.com/docs/en/settings.md 的 "When edits take effect"）。

## 它放行什麼、不放行什麼

- 逐支點名 8 支瀏覽器測試、`run-affected.mjs`（不帶參數），以及 `mutate.mjs --only` 加上三份指定的突變清單。
- **不寫 `node scripts/*.mjs`**：Bash 規則裡的 `*` 會比對任何文字，scripts/ 底下的每一支都會被放行，
  包括 `publish-cloud.mjs`（部署）與 `livetest.mjs`（打正式站）。
- 串接指令會拆開、逐段比對（`... && 別的指令` 不會被放行；出處：https://code.claude.com/docs/en/permissions.md 的 "Compound commands"）。
- `run-affected.mjs` 只放不帶參數的那一種；`--all`、`--approved` 都不在範圍內。

## 間接的門（規則管不到被放行指令開出來的子程序）

1. **`mutate.mjs` 用 shell 跑突變清單裡寫的 `cmd`。** 2026-10-27 起 `mutate.mjs` 只接受 `node scripts/<名字>.mjs`
   這一種形狀，其餘整份清單拒絕（`scripts/mutcmdtest.mjs` 驗兩個方向）。這是防意外——清單裡順手帶了 `&&`、
   重導向的 `cmd`——不是防故意：清單檔本身改得到。
2. **`run-affected.mjs` 跑 `package.json` 裡 `test:chain` 的每一支。** 2026-10-27 查過那 67 支：搜部署、正式站
   相關的樣式（`workers.dev`、`github.io`、`publish-cloud`、`livecheck`、`livetest`、`wrangler`、`safe-push`、
   `git push`、`api.anthropic`），在這些樣式的範圍內只見三支碰外部，而且在 `run-affected` 的用法下都不打正式站：
   `workertest` 的 wrangler 只用 `--local`；`pushgatetest` 推的是暫存目錄的本機 bare repo；`synctest` 要帶 `--url`
   才打已部署的 Worker，`run-affected` 不帶參數。**這扇門沒有加機制守著**（Dispatch 2026-10-27 決定）：`package.json`
   改得到，鏈改了就要重查。不是證明沒有，是在搜的樣式範圍內未見。
