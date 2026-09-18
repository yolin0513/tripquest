# TripQuest — 給每一個接手的工作階段

**開工前先讀 [`docs/STATUS.md`](docs/STATUS.md)。** 那是版本、功能、測試、決策、待辦、
帳號注意事項的**單一事實來源**；本檔只放「無論做什麼都必須遵守」的常設規則。
STATUS.md 開頭有「目前進行中／交接」一節，先看那節掌握現況與待決事項。

## 常設規則（不可違反）

1. **全程繁體中文**——回覆與**思考／判斷過程的文字敘述**都用繁中，讓 Yolin 跟得上推理與
   取捨。程式碼、變數與函式名、檔名與路徑、專有名詞、引用出處（指令輸出、錯誤訊息、原始碼
   註解）維持原樣，不用硬翻。

2. **嚴禁互動式提示框**——不准用 `AskUserQuestion` 或任何多選題／彈窗工具。Yolin 常從
   **手機或另一台電腦遠端**看，提示框只渲染在本機那台 PC 上，他點不到、Session 會卡死。
   需要他決定的事：**用純文字列出選項＋你的建議與理由，然後停下來等**。答案會由 Dispatch
   轉達再帶回來。

3. **代理投票與模型**——架構／資料結構／部署／付費或需註冊帳號的服務，先開 **3 個
   Fable 5.1（`claude-fable-5-1`）代理**獨立評估、多數決、分歧採保守方案。代理因額度用盡
   （429／quota）失敗時，**自動改用 `claude-opus-5` 整批重跑，不要停下來問**，事後在回報
   註明；只有連 Opus 5 也不可用才暫停。開發 Session 平常 Opus effort high，大工程才切 Max。

4. **測試紀律**——回歸斷言要用**突變測試證明會紅**；不寫假斷言；測試要走**使用者的真實
   路徑**（不是最短的 goto）；回報**明確區分「實測驗證過的」與「推論的」**。

5. **每版流程**——bump `sw.js` 的 `VERSION` → `npm test` 全綠 → commit/push → curl 確認
   線上 `VERSION` → `npm run sweep` 巡檢。**動到 `js/merge.js` 或 `workers/` 時：Worker
   先部署、客戶端後推**（反過來會造成永久分歧，v1.73.2 實測）。

## 授權邊界

- **git 操作可自行判斷**（branch／commit／push／改寫本地歷史都可以）。
- **這些要先問 Yolin，不可自行動手**：刪除或修改 D1 的任何群組（刪錯會毀掉家人正在用的真實
  行程 `a3cf5587`）、改動 GitHub 帳號層設定、對真實使用者資料做破壞性操作、任何付費或需註冊
  帳號的服務。
- **跨專案唯讀**——本 Session 只動 `D:\Claude\App\TripQuest` 這個 repo。同機還有別的專案
  Session 在跑（StockDiary、MealMate、JLPT 等），**一律不要碰它們的檔案**。

## 專案速記

原生 JS ESM PWA，無框架無打包；IndexedDB；版本化 Service Worker（每版 bump `VERSION`）。
前端 GitHub Pages（`yolin0513/tripquest`，push main 即部署），後端 Cloudflare Worker + D1 +
R2。繁體中文、手機優先、使用者是為長輩家庭設計。**含中文的 patch 腳本一律寫進 scratchpad
檔案再執行**（Windows python heredoc 帶中文會 cp950 走樣）。
