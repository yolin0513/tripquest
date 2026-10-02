# 突變逐項證據：mut_guard_mut

> 由 `scripts/evidence.mjs` 從 `run-mut_guard_mut.txt` 產生（原始 log 在 .logs/、不入庫）。個資詞 14 個已遮蔽。

共 8 條。分類統計：基準全綠 1、成立且紅在預期 7

| 來源 | 名稱 | 分類 | 預期紅 | 實際紅 | 情境未成立 | 回傳值 | 被驗那份 | clone 裡跑的＝改壞那份 |
|---|---|---|---|---|---|---|---|---|
| mut_guard_mut | G0 不改（基準） | 基準全綠 | （基準） | — | — | 0 | e0def3b4bde9 | 基準（沒改檔） |
| mut_guard_mut | G1 拿掉嚴格模式的工作區檢查 | 成立且紅在預期 | A  | A 嚴格模式、zz-fixture-a.txt 不一致 → 回 2、點名 zz-fixture-a.txt（實得 4）／A 目標檔雜湊沒變、探針沒跑（標記 1 行） | — | 1 | 7bacd0bbe929 | ✓ scripts/mutate.mjs 7bacd0bbe929 |
| mut_guard_mut | G2 工作區檢查改成一律拒絕 | 成立且紅在預期 | A' ／A" ／E  | A' --only、不相干的改動 → 照跑：探針看到改壞版一次（標記 無）、目標檔還原（實得 2）／A" --only、目標檔已含改壞後的字串 → 回 2、點名、探針沒跑（實得 2）／E 正常跑完：探針看到改壞版一次、目標檔＝原檔、沒有還原紀錄、帳本第 1 次有開跑也有完成（實得 2） | 預期：B—／預期：C—／預期：C'—／預期：C"—／預期：D—／預期：前置：卡住的探針／B——殺程序造情境 3 次都沒成立／C——殺程序造情境 3 次都沒成立／C'——殺程序造情境 3 次都沒成立／C"——殺程序造情境 3 次都沒成立／D——殺程序造情境 3 次都沒成立／前置：卡住的探針真的跑起來了（pid 0） | 1 | deb14d3c8c7e | ✓ scripts/mutate.mjs deb14d3c8c7e |
| mut_guard_mut | G3 啟動時不寫回原檔 | 成立且紅在預期 | B  | B 重啟 → 點名第 1 次與 zz-target.txt／B 還原後目標檔雜湊＝原檔、還原紀錄不在／B 帳本記第 1 次已還原／B 還原後照跑：探針看到改壞版一次（實得 4、標記 sleep）／B 被中斷的那一次記成沒有結果、--no-result 列得出來 | — | 1 | de43cd70451e | ✓ scripts/mutate.mjs de43cd70451e |
| mut_guard_mut | G4 拿掉兩處一致的檢查 | 成立且紅在預期 | D  | D 還原紀錄在、帳本沒有對應的 → 回 6、目標檔不被動（實得 1） | — | 1 | a52b28a5641b | ✓ scripts/mutate.mjs a52b28a5641b |
| mut_guard_mut | G5 還原紀錄不見、檔案不是原檔也照跑 | 成立且紅在預期 | C  | C 刪掉還原紀錄 → 回 5、指出第 1 次與 zz-target.txt（實得 2） | — | 1 | aff3cf221b8c | ✓ scripts/mutate.mjs aff3cf221b8c |
| mut_guard_mut | G6 比「是不是原樣」時不統一行尾 | 成立且紅在預期 | C"  | C" 用 git 還原成 CRLF 版 → 統一行尾後是原樣，照跑（實得 5） | — | 1 | 9f5bef511747 | ✓ scripts/mutate.mjs 9f5bef511747 |
| mut_guard_mut | G7 登記檢查永遠不抓只改空白或行尾的 | 成立且紅在預期 | F  | F 清單裡有只改行尾、只改空白的 → 回 2、點名那兩條、整份不跑（連沒問題的那條也不跑）（實得 0） | — | 1 | d4fa0f0fffe9 | ✓ scripts/mutate.mjs d4fa0f0fffe9 |
