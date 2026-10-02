# 突變逐項證據：wtg_mut

> 由 `scripts/evidence.mjs` 從 `run-wtg_mut.txt` 產生（原始 log 在 .logs/、不入庫）。個資詞 14 個已遮蔽。

共 6 條。分類統計：基準全綠 1、成立且紅在預期 5

| 來源 | 名稱 | 分類 | 預期紅 | 實際紅 | 情境未成立 | 回傳值 | 被驗那份 | clone 裡跑的＝改壞那份 |
|---|---|---|---|---|---|---|---|---|
| wtg_mut | M0 不改（基準） | 基準全綠 | （基準） | — | — | 0 | 被驗的 run-affected bb2f4d9629de、worktree-guard 8c727f9288c4 | 基準（沒改檔） |
| wtg_mut | M1 比對永遠回空 | 成立且紅在預期 | ‹已遮蔽›改了進版控的 zz-fixture-a.txt／‹已遮蔽›丟下沒被擋掉的新檔／開跑前就改過的 zz-fixture-b.txt | ‹已遮蔽›改了進版控的 zz-fixture-a.txt → 回 3、點名 zz-wtg-writer 與 zz-fixture-a.txt（實得 0、undefined、undefined）／‹已遮蔽›丟下沒被擋掉的新檔 → 回 3、點名 docs/zz-junk.txt（實得 0、undefined、undefined）／開跑前就改過的 zz-fixture-b.txt、‹已遮蔽›又改一次 → 回 3、點名它（實得 0、undefined、undefined） | — | 1 | 被驗的 run-affected bb2f4d9629de、worktree-guard bb8257398b26 | ✓ scripts/worktree-guard.mjs bb8257398b26 |
| wtg_mut | M2 run-affected 不看比對結果 | 成立且紅在預期 | ‹已遮蔽›改了進版控的 zz-fixture-a.txt／‹已遮蔽›丟下沒被擋掉的新檔／開跑前就改過的 zz-fixture-b.txt | ‹已遮蔽›改了進版控的 zz-fixture-a.txt → 回 3、點名 zz-wtg-writer 與 zz-fixture-a.txt（實得 0、undefined、undefined）／‹已遮蔽›丟下沒被擋掉的新檔 → 回 3、點名 docs/zz-junk.txt（實得 0、undefined、undefined）／開跑前就改過的 zz-fixture-b.txt、‹已遮蔽›又改一次 → 回 3、點名它（實得 0、undefined、undefined） | — | 1 | 被驗的 run-affected e3a70f89207a、worktree-guard 8c727f9288c4 | ✓ scripts/run-affected.mjs e3a70f89207a |
| wtg_mut | M3 不看沒進版控的新檔 | 成立且紅在預期 | ‹已遮蔽›丟下沒被擋掉的新檔 | ‹已遮蔽›丟下沒被擋掉的新檔 → 回 3、點名 docs/zz-junk.txt（實得 0、undefined、undefined） | — | 1 | 被驗的 run-affected bb2f4d9629de、worktree-guard 7a3f9be0006b | ✓ scripts/worktree-guard.mjs 7a3f9be0006b |
| wtg_mut | M4 開跑前就改過的檔不比雜湊 | 成立且紅在預期 | 開跑前就改過的 zz-fixture-b.txt | 開跑前就改過的 zz-fixture-b.txt、‹已遮蔽›又改一次 → 回 3、點名它（實得 0、undefined、undefined） | — | 1 | 被驗的 run-affected bb2f4d9629de、worktree-guard e95bd2d226cb | ✓ scripts/worktree-guard.mjs e95bd2d226cb |
| wtg_mut | M5 拍不到就當成沒改動 | 成立且紅在預期 | git 讀不到 | git 讀不到 → 回 4、寫明守衛壞了，不當成沒改動（實得 0） | — | 1 | 被驗的 run-affected c74c65061443、worktree-guard 8c727f9288c4 | ✓ scripts/run-affected.mjs c74c65061443 |
