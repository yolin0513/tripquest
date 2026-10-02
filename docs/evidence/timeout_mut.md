# 突變逐項證據：timeout_mut

> 由 `scripts/evidence.mjs` 從 `run-timeout_mut.txt` 產生（原始 log 在 .logs/、不入庫）。個資詞 14 個已遮蔽。

共 7 條。分類統計：基準全綠 3、成立且紅在預期 4

| 來源 | 名稱 | 分類 | 預期紅 | 實際紅 | 情境未成立 | 回傳值 | 被驗那份 | clone 裡跑的＝改壞那份 |
|---|---|---|---|---|---|---|---|---|
| timeout_mut | T0 不改（基準，worktreeguardtest） | 基準全綠 | （基準） | — | — | 0 | （沒改） | 基準（沒改檔） |
| timeout_mut | T0b 不改（基準，mutatetest） | 基準全綠 | （基準） | — | — | 0 | （沒改） | 基準（沒改檔） |
| timeout_mut | T1 逾時時什麼都不殺 | 成立且紅在預期 | 卡住的‹已遮蔽› → 回 7 | 卡住的‹已遮蔽› → 回 7、寫明「沒有結果」、60.0 秒內結束（實得 null） | — | 1 | 911ed165cf2e | ✓ scripts/run-timeout.mjs 911ed165cf2e |
| timeout_mut | T1x 只殺 root、不殺子孫 | 基準全綠 | （基準） | — | — | 0 | 95168bf52bda | ✓ scripts/run-timeout.mjs 95168bf52bda |
| timeout_mut | T2 run-affected 不設時限 | 成立且紅在預期 | 卡住的‹已遮蔽› → 回 7 | 卡住的‹已遮蔽› → 回 7、寫明「沒有結果」、60.0 秒內結束（實得 null） | — | 1 | 729fc055e1f3 | ✓ scripts/run-affected.mjs 729fc055e1f3 |
| timeout_mut | T3 逾時照樣記成沒紅 | 成立且紅在預期 | G 卡住／G 帳本記成 no-result／G --no-result 列出／G 再正常跑一次 | G 卡住 → 回 1、寫明沒有結果、4.0 秒結束（實得 0）／G 帳本記成 no-result（實得 red）——不是 done 了事／G --no-result 列出「會卡住的」、並印出那段說明／G 再正常跑一次「會紅的」→ 它不再列出，「會卡住的」還在 | — | 1 | 838bd84bb4c1 | ✓ scripts/mutate.mjs 838bd84bb4c1 |
| timeout_mut | T4 沒有結果的清單永遠是空的 | 成立且紅在預期 | B 被中斷的那一次／G --no-result 列出／G 手動把／G 再正常跑一次 | B 被中斷的那一次記成沒有結果、--no-result 列得出來／G --no-result 列出「會卡住的」、並印出那段說明／G 手動把「會紅的」改成 no-result → --no-result 列得出來（欄位真的被讀）／G 再正常跑一次「會紅的」→ 它不再列出，「會卡住的」還在 | — | 1 | 370c5b1a58c1 | ✓ scripts/mutate.mjs 370c5b1a58c1 |
