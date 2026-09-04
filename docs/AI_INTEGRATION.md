# AI 加值層 —— 效益評估與決策

> 兩輪各三個獨立 opus 代理投票，都全數一致。
> **第一輪**（效益 / 成本 / 可行性）：查證官方文件，決定哪些值得接、哪些不接。
> **第二輪**（權限模型）：把 AI 從「維護者一個 Worker」改成「**每個行程由建立者自帶金鑰**」。
> 評估基準：一年 10 趟、每趟 5 人、每趟約 20 個任務 / 6–10 個景點。查證日期 2026-09。
> 實作見 `js/ai.js`、`js/aikeys.js`、`js/views/ai-config.js`、`js/db.js`（`tripSecrets` store）、
> `scripts/secret-leak-test.mjs`。

---

## 一句話總結

| 用途 | 建議 | 一年成本 | 誰要註冊 |
|---|---|---|---|
| 景點・美食一句話介紹（長尾） | ✅ 每個行程可選，用建立者自己的 Claude 金鑰即時補；也可維護者批次擴資料庫 | 建立者側 < $1；批次一次性 $1–23 | 想開的行程建立者：Anthropic |
| 回憶影片旁白文字 | ✅ 同上，開了才產生，仍可自己改 | < $0.1 | 同上 |
| 回憶影片旁白配音（TTS） | ✅ 選用，另貼 Google 金鑰；沒貼就只有文字字卡 | ~$0（免費額度內） | 同上（選用）：Google Cloud |
| 自動挑最佳照片 | 在裝置端做，不需金鑰、不上傳 | $0 | 無 |
| Google Places（評分・是否歇業） | ⏸️ 有價值但**資料不能落地**（快取上限 30 天），列為下一步 | $0（免費額度內） | 之後：Google Cloud |
| 海報水彩插畫 | ⏸️ 混合方案（插畫元素生成一次、快取重用），列為下一步 | 一次性 $1–25 | 之後：影像生成 |
| Instagram / Threads 抓「最近爆紅」 | ❌ 官方 API 做不到（無地點搜尋、無互動數）；爬蟲違反 ToS | — | — |
| 「最近爆紅」熱度分數 | ⚠️ 只能做建置期版本，誠實標「精選打卡」 | $0 | 維護者 |
| 授權音樂庫（配樂） | ❌ 全是訂閱制，10 支/年不划算，程式合成已足夠 | — | — |

**核心結論**：AI 是**每個行程各自決定要不要開的加值層**。沒開一切照舊、離線可用、零花費。
開了的行程用的是**建立者自己的 API 金鑰**，金鑰只留在建立者這台手機，旅伴只收到成果。

---

## 安全模型（第二輪投票決議，已實作為程式碼）

前端是公開靜態站。使用者的原始需求是：「讓每個行程建立者自行決定是否使用 AI，要用才輸入自己的 key，不會有我的用量被別人使用的疑慮」。三個代理實測後一致同意，並把方案簡化到比原本更乾淨：

### 1. 瀏覽器直連供應商，**沒有中間伺服器**

實測（2026-09-04）確認兩家都支援瀏覽器直接呼叫：

- **Anthropic**：帶 `anthropic-dangerous-direct-browser-access: true` header 就開放 CORS（`Access-Control-Allow-Origin: *`）。不帶這個 header 則完全沒有 ACAO —— 瀏覽器預設擋，是 fail-closed。「dangerous」是在警告「把**你自己的**金鑰包進公開 JS 發給所有訪客」；這裡金鑰屬於輸入它的人、只在他的裝置、花的是他自己的帳單，正是這個 header 設計來允許的情境。
- **Google Cloud TTS**：`OPTIONS texttospeech.googleapis.com/v1/text:synthesize` 回 `Access-Control-Allow-Origin: <origin>`，且允許 `x-goog-api-key` 這個 request header —— 金鑰放 header、不進網址。回應帶 `Vary: Referer`，代表**支援 HTTP 參照網址限制**，建議建立者把 TTS 金鑰鎖到自己的網站網址。

因此 **AI 完全不經過 Cloudflare Worker**。`workers/ai.mjs` 已刪除，`worker.mjs` 只剩同步端點。金鑰經 TLS 直達 `api.anthropic.com` / `texttospeech.googleapis.com`，不經任何我們或第三方控制的機器，也就沒有「中間伺服器可能記 log」的信任問題。

Anthropic 金鑰無法綁 origin（bearer-only），所以那一側的防線是**建立者自己設的花費上限**：建議去 console.anthropic.com 開一把**專用**金鑰、在 Billing 設每月硬上限（例如 US$5）。

### 2. 金鑰存哪裡 —— 結構性隔離，不是靠過濾

金鑰存在 IndexedDB 一個**獨立的 object store `tripSecrets`**（keyPath `tripId`，`js/db.js` DB v3）。**不是** `records`、**不是** `meta`。

`tripSecrets` 從設計上就在所有匯出路徑之外——它們全都只讀 `records`：

| 路徑 | 為什麼碰不到金鑰 |
|---|---|
| `store.exportGroup(groupId)` | 純粹過濾 `state.byId`（= `records` store），金鑰從來不是 record |
| `store.exportRecords()` | 同上，就是 `[...state.byId.values()]` |
| 「匯出完整備份」`share.exportBundle()` | 讀 `records` + `blobs`，從不讀 `meta` / `tripSecrets` |
| 身分備份卡 `identity.exportCard()` | 明確的欄位白名單（deviceId / name / 群組祕鑰），不 spread 任何東西 |
| `store.importRecords()` | 只寫 `records`，惡意 record 也植不進 `tripSecrets` |
| Service Worker | `sw.js` 兩道關卡：非 GET 直接跳過、跨網域直接跳過。AI 呼叫是跨網域 POST，SW 根本沒看到 |
| 邀請連結 | 只帶 128-bit 群組祕鑰，不帶行程內容以外的東西 |

**回歸測試**：`scripts/secret-leak-test.mjs`（已納入 `npm test`）存入假金鑰後，斷言 `exportRecords` / `exportGroup` / `exportBundle` / `exportCard` / `encodeCard` / `shareURL` 的序列化結果都不含 `sk-ant-` / `AIza`，且 SW 快取沒有 `anthropic` / `googleapis` 主機。

### 3. 用量與上限

只有建立者這台裝置會呼叫供應商，所以裝置端計量就是完整的。每次 Claude 回應帶 `usage.input_tokens` / `output_tokens`，乘上費率（Haiku 4.5：$1 / $5 每百萬 token）換成微美金，累加存在 `tripSecrets` 那一列的 `usedMicroUsd`。

- 達到建立者設的每月上限（預設 US$2）→ `aiOn()` 回 false → App 自動改用免金鑰做法。
- 這個上限是**參考用的儀表板**，不是硬性防護。真正的硬上限是**供應商後台的 Billing 上限**，那個才跨裝置、由供應商強制執行，也是為什麼要用專用金鑰。
- 建立者用兩台以上自己的裝置 → 各自一份計數器，會低估。誠實標示為「這台手機這趟已用約 $X」。

### 4. 結果如何給旅伴

AI 產出走一般的同步 record，旅伴直接看到成果、看不到也用不到金鑰：

- `spot.blurb` + `spot.aiBlurb: true` + `spot.aiAt`（時間戳，可分辨 AI 句與維基句）——**只填空白欄位**，寫入前重讀最新記錄，若已有 blurb 或 `spot.blurbManual` 就跳過，不覆蓋別人改過的。
- 回憶影片旁白：獨立 record `{ type:'aiText', tripId, key:'narration', lines:[…] }`，放在**自己的 record** 而不是塞進 `trip` 欄位，避免整筆 trip record 的 LWW 覆蓋掉旅伴的其他改動。
- TTS 音檔（下一版接進影片時）：走內容定址 blob，用雜湊參照，不 base64 進 record。

**金鑰外洩到結果裡的風險**：金鑰只在 HTTP header，永遠不進 prompt，所以模型沒有東西可以複述。保險起見，所有 AI 輸出與錯誤訊息在寫入 / 顯示前都用 `/sk-ant-…/` 與 `/AIza…/` 正則洗掉。

### 5. 威脅模型（誠實列出）

| 風險 | 可能性 | 緩解 |
|---|---|---|
| 金鑰躺在 IndexedDB | 必然（設計如此） | 同源隔離，其他網站讀不到。惡意瀏覽器擴充功能讀得到 → 無法完全防，靠花費上限把損失限縮在已知的小額 |
| **手機遺失 / 被偷（未鎖定）** | 中（長輩族群真實存在） | 「清除這個行程的金鑰」+「清除所有 AI 金鑰」按鈕；**並提醒：本機刪除不等於停用，還要到 Anthropic 後台把金鑰 Delete**。專用金鑰 + 花費上限把最壞情況變成「已知的一筆小錢」 |
| **家人共用平板** | 中 | 同上；每個行程可獨立關閉 |
| 貼錯欄位（把金鑰貼進留言 / 群組聊天） | 中 | 金鑰欄位驗證前綴（`sk-ant-` / `AIza`）才收；一般文字欄位如偵測到金鑰樣式字串會擋下 |
| PWA 頁面被 XSS | 低（見下） | `script-src 'self'` CSP：注入的腳本一律不執行，沒有程式碼能讀 IndexedDB 送出去 |

**要不要加密儲存（PIN）？三個代理一致：不要。** 一個 4–6 位 PIN 的金鑰強度很弱、用的時候明文還是得進記憶體、對惡意擴充功能與 XSS 都沒用、又跟手機本身的鎖屏重複；而長輩會忘記 PIN 然後永久失去金鑰——把罕見的安全事件換成頻繁的可用性故障。**專用金鑰 + 供應商 Billing 硬上限就夠了**，力氣花在「清除鈕」「TTS 金鑰的參照網址限制」「CSP」上。

**`js/ui.js` 的 XSS 收口（第二輪 blocker）**：
- 移除 `h()` 的 `html:` prop（會 `el.innerHTML = v`）。動態字串一律走 `document.createTextNode`。
- `modal({ body })` 的字串分支改成 textNode（原本會走 `html:`）。
- `href` / `src` / `action` 等網址屬性加白名單（只允許 `https:` `http:` `blob:` `mailto:` `tel:` `#` `./`），擋掉 `javascript:`。
- `index.html` 加 `<meta http-equiv="Content-Security-Policy">`：`script-src 'self'`（關鍵）、`object-src 'none'`、`base-uri 'self'`。

### 6. 建立行程時的操作（長輩友善）

- 預設**關**。建立行程的「進階（可略過）」區有一個「建立後開啟 AI 加值」勾選框——不勾就完全看不到 AI 相關的東西。
- 勾了只是把 `trip.aiEnabled` 設 true（無害的同步旗標），**金鑰可以稍後再貼**。這是預設路徑——逼在建立流程裡貼金鑰正是長輩會放棄的地方。
- 到「行程 → 旅程設定 → AI 加值」貼金鑰：`type="password"` 欄位 + 「📋 貼上」鈕（讀剪貼簿，免得在手機上打 100 個字）+ 前綴驗證 + 一次真的最小呼叫測試 + 之後只顯示遮罩（`sk-ant-…4f2a`）。
- **非建立者完全看不到金鑰輸入**（用 `trip.createdByDevice === myDeviceId()` 判斷），只看到一個「AI 由建立者提供」的標記。

---

## 第一輪：逐項效益評估（研究內容不變）

### 1. 景點 / 美食一句話介紹（LLM）

**驗證計價**（每百萬 token 進 / 出）：Haiku 4.5 `claude-haiku-4-5` $1 / $5；Sonnet 5 `claude-sonnet-5` $2 / $10；Opus 5 `claude-opus-5` $5 / $25。Batch API 進出都打 5 折。

100 個景點 × (500 進 + 400 出) ≈ Haiku **$0.25**。以每行程自帶金鑰的模型來說，一趟旅程頂多幾十個沒有內建資料的景點，成本是**幾分美金**。

**已實作**（`js/enrich.js` 第 3 步）：景點沒有 blurb、行程有開 AI 且有金鑰時，補一句 25–40 字的在地介紹，標記 `aiBlurb`。**只填空白、不覆蓋、以最新記錄為準。**

**維護者批次仍值得做**：把 135 筆策展資料庫用 Batch API 擴充到 ~1,000 筆、人工抽查後 commit，一次性 $1–23，讓「沒開 AI 的行程」也有更好的長尾覆蓋。（幻覺在這裡是安全問題——掰一家不存在的店等於叫長輩白跑，批次工作有人把關。）

**不接 AI 的替代**：規則模板 + 主題句型庫（`data/phrases.json`）+ Wikipedia REST 摘要。**效果差距**：中——句型庫已做到不罐頭，但 LLM 能講出更具體的「這家的湯頭 / 這個角度」。

### 2. Google Places API（新版）

**欄位**（對照官方 Place Details 文件）：`rating`、`userRatingCount`、`regularOpeningHours`、`priceLevel` = Enterprise SKU；`businessStatus` = Pro；`editorialSummary` / `reviews` = Enterprise + Atmosphere。**熱門時段 / 即時人潮 API 沒有這個欄位**，只有 Google 地圖 App 有。

**計價**：2025 年 3 月起 $200 統一額度取消，改成每個 SKU 各自的每月免費上限（Essentials 10,000 / Pro 5,000 / Enterprise 1,000 次/月）。基準用量 **$0/年**，但仍必須綁卡。

**快取條款（關鍵）**：Place ID 可無限期存；經緯度可暫存 30 個連續日曆天；**評分、評論數、營業時間沒有快取豁免**，不能長存 IndexedDB；照片名稱不可快取。

**架構後果**：Places 資料**永遠不能進 `data/places/`**（git 追蹤的靜態檔 = 違規儲存），只能是「檢視當下即時查、即時顯示、不落地」。

**決議**：✅ 有價值（`businessStatus`「已歇業」對長輩最關鍵），但需要即時查詢的快取管理，**列為下一步**。若做，同樣走「每行程建立者的 Google 金鑰、瀏覽器直連」——Places API 也支援 CORS + 參照網址限制。

### 3. Instagram —— ❌ 不可行

官方 Graph API 沒有公開地區熱門、沒有一般 hashtag 探索。Hashtag Search 上限每帳號每 7 天 30 個不重複 hashtag、需商業帳號綁粉專、回傳媒體物件不是熱度訊號，**無法查「台南附近的熱門餐廳」**。Basic Display 已於 2024/12 關閉。**爬蟲一律不採用**：違反 Meta Platform Terms，會導致帳號 / IP 終止與法律風險。

### 4. Threads —— ❌ 不可行

`GET /keyword_search` 確實存在（`search_type=TOP|RECENT`），但：① 必須通過 App Review 才能搜公開貼文；② 沒有地點搜尋；③ **拿不到別人公開貼文的互動數**——只能測「被提到幾次」，測不到「爆紅」。每人做 Threads OAuth 對長輩是不可跨越的牆。

### 5. 「最近爆紅」熱度分數

即時社群風向免費 / 官方管道都拿不到。設計一個**建置期**複合分數（維基瀏覽量成長 + 旅遊媒體 RSS + 觀光署開放資料 + OSM 新增時間），每城市各自 z 分數，只存最後分級。**誠實侷限**：全部有延遲，偵測的是「在百科 / 官方統計上有名氣且上升」，**抓不到 Threads 上爆紅的甜點店**。**標籤**：預設「精選打卡」；絕不寫「爆紅」。

### 6. 海報水彩插畫

單張 $0.02–0.17。**混合方案**（版面照片用程式排、裝飾插畫元素每風格生成一次 ~24 張、人工挑過、commit 成靜態資產、之後重複用）一次性 $5–25、之後 $0。執行期維持純 canvas 2D。**列為下一步**（需影像 API 帳號才能實作）。

### 7. 回憶影片 AI

- **挑最佳照片：裝置端做，$0**（Laplacian 變異數判模糊 + 亮度直方圖 + `FaceDetector`）。雲端視覺 API 贏不了、又要上傳家庭照片。
- **旁白文字：已實作**（`aiNarrate`，開了 AI 才有，`aiText` record，仍可自己改）。
- **旁白配音（TTS）：已實作 `aiTTS`**（Google TTS，另貼金鑰）。基準用量每年 ~5,000 字，遠在免費額度內。影片配音的接線列為下一版。
- **配樂：維持程式合成的 Web Audio。** 授權音樂庫全訂閱制，10 支/年每支 $15–30，且打包 MP3 進公開 repo 多半違反授權。

### 8. 訂閱制 vs 用多少付多少

**只有訂閱制**：Epidemic Sound、Artlist、Suno、ElevenLabs。**其餘都是 metered + 免費額度**。以一年 10 趟來說沒有任何月費划算——只能按月買的東西要嘛維護者一次性買斷做成資產，要嘛不買。

---

## 使用者要註冊什麼

| 服務 | 誰 | 時間 | 綁卡 | 最低消費 |
|---|---|---|---|---|
| **Anthropic Console** | 想開 AI 的**行程建立者**（每人自己的） | ~10 分 | 是 | 預付 ~$5，無月費。**建議開專用金鑰 + 設每月上限** |
| **Google Cloud — Text-to-Speech** | 想要旁白配音的建立者（選用） | ~20 分 | 是 | 無；免費額度遠大於用量。**建議加參照網址限制** |
| **Cloudflare Workers**（只做同步，與 AI 無關） | 設定同步的人 | 見 `SETUP_TODO.md` | R2 需綁卡，免費額度內不扣 | 無 |
| Google Places / 影像生成 | 之後若實作 | — | 是 | 免費額度內 $0 |
| Meta / Instagram / Threads | —— | —— | —— | **不需要，否決** |
| 任何音樂 / 語音訂閱 | —— | —— | —— | **不建議** |

---

## 兩輪投票結果

**第一輪（效益 / 可行性）**

| # | 項目 | A | B | C |
|---|---|---|---|---|
| 1 | LLM 一句話介紹值得接（每行程 + 批次擴資料庫） | ✅ | ✅ | ✅ |
| 2 | Google Places 只即時查不落地；無 popular times；快取 30 天 | ✅ | ✅ | ✅ |
| 3 | Instagram 抓熱門 | ❌ | ❌ | ❌ |
| 4 | Threads 抓熱門 | ❌ | ❌ | ❌ |
| 5 | 熱度分數 → 建置期版本、標「精選打卡」 | ✅ | ✅ | ✅ |
| 6 | 海報 → 混合快取、非每張生成 | ✅ | ✅ | ✅ |
| 7 | 影片 → 裝置端挑照片 + 可選旁白 / TTS、配樂維持程式合成 | ✅ | ✅ | ✅ |
| 8 | 訂閱制 → 一律不建議 | ✅ | ✅ | ✅ |

**第二輪（權限模型，全數一致「ship」）**

| 問題 | 決議 |
|---|---|
| Q1 金鑰位置 & 呼叫路徑 | **(a) 瀏覽器直連供應商**，Claude 與 Google TTS 都經實測支援 CORS，Worker 退出 AI 路徑 |
| Q2 金鑰儲存 | IndexedDB 專用 store `tripSecrets`，結構性排除所有匯出 + 回歸測試斷言 |
| Q3 用量 / 上限 | 裝置端計量 + 供應商 Billing 硬上限（真正的防線） |
| Q4 結果同步 | blurb 填空不覆蓋 + `blurbManual` 旗標；旁白用獨立 record；輸出洗金鑰字串 |
| Q5 加密儲存 | **不加密**（PIN 對長輩是淨負面）；靠專用限額金鑰 + 清除鈕 + CSP |
| Q6 建立流程 | 預設關、收在「進階」、金鑰可延後貼、貼上為主 + 測試、非建立者看不到 |
| 4 個 blocker | ①專用 store + 匯出斷言 ②金鑰字串洗白（輸出 + 錯誤）③修 LWW 覆蓋 ④`ui.js` innerHTML 收口 + CSP — 全部完成 |

三份完整分析與引用連結存於 session log。
