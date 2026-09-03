# TripQuest 旅圖任務

> 一群人共建行程，把每個景點變成拍照任務，像解任務一樣蒐集照片，全部解鎖後把照片做成回憶影片。

手機優先的 **PWA**，純前端、免註冊、可離線使用，所有資料（含照片）只存在你自己的瀏覽器裡。可直接部署到 GitHub Pages。

---

## 這個 App 在做什麼

1. **建立行程** —— 取個名字、加旅伴、把出遊清單貼進去（一行一個景點，或用「、」分隔）。
2. **系統出題** —— 每個景點自動產生「代表性拍照任務」：知名建築、必吃美食、經典角度、在地文化⋯⋯
   - 內建 **策展資料庫**（京都、大阪、東京、台北、九份、台南、首爾等熱門景點）→ 直接帶入人工撰寫的高品質任務。
   - 沒收錄的景點 → 依名稱判斷類型（寺 / 神社 / 城 / 市場 / 公園 / 山 / 老街⋯）套用**規則式模板**。
   - 一律再補一組通用題，所以**產生結果永遠不會是空的**。
   - 任何任務都能**自己改、自己加、自己刪**。
3. **解任務** —— 到現場拍照上傳，一個任務至少一張照片就解鎖。可以標記是誰拍的、加說明。
4. **回憶影片** —— 全部任務解鎖後，把照片做成：
   - **動態相簿頁**（單一 HTML 檔，照片內嵌，任何裝置都能開、可直接傳給朋友）——主要交付。
   - **影片檔**（.mp4 / .webm）——瀏覽器支援時提供，於手機本機即時錄製。

---

## 隱私

- **照片永遠不會上傳到任何地方。** 只存在這支手機的 IndexedDB 裡。
- 匯入時照片會**重新編碼壓縮**（長邊 1600px、JPEG）——這個過程會**清掉所有 EXIF 中繼資料，包含 GPS 位置**。
- 拍攝時間會保留（用來排序、決定影片順序）。
- GPS 座標**預設丟棄**；只有你在「行程設定」裡手動開啟「記錄照片拍攝位置」後，之後匯入的照片才會把座標留在本機（供未來的相簿地圖用）。
- 唯一的對外連線：你在行程設定開啟「維基百科參考照片」時，會向 `zh.wikipedia.org` 查詢景點（只送景點名稱，不送任何個人資料）。預設關閉。

---

## 多人協作

第一版是 **local-first（單機優先）**：

| 情境 | 做法 |
|------|------|
| 出遊當下，大家一起解同一份任務 | **分享任務代碼 / 連結**：行程 + 景點 + 任務壓縮進網址，旅伴開連結就得到同一份清單，各自拍照解任務（不含照片，只有幾 KB）。 |
| 事後合併大家的照片 | **匯出 / 匯入完整備份**（`.tripquest.json`，含照片）：用 LINE / AirDrop 互傳，匯入時自動合併，重複照片會自動去重。 |

資料模型從第一天就設計成可同步：每筆記錄有 UUID 與 `updatedAt` / `deviceId`，中繼資料用「後寫入者勝 + 墓碑」合併，照片投稿**只新增不修改**（以內容雜湊定址），所以合併時是集合聯集、永不衝突。**第二版**要接雲端即時同步時，只需補一個同步 adapter，不動資料層。

---

## 技術架構

**原生 JavaScript ES Modules + IndexedDB + Service Worker，無框架、無打包、無建置步驟。** 開檔即跑。

> 這個決策由 3 個獨立的架構評估代理一致投票通過（詳見下方「架構決策紀錄」）。

```
index.html            單一入口
manifest.webmanifest  PWA manifest
sw.js                 Service Worker（app shell 預快取 + stale-while-revalidate）
css/style.css         深色為主、手機優先
js/
  app.js              進入點：註冊 SW、初始化、頂列
  router.js           極簡 hash 路由
  store.js            狀態層：所有寫入的唯一入口，含合併邏輯
  db.js               IndexedDB 封裝（records 面 + blobs 面）
  ids.js              UUID / 裝置 ID / SHA-256
  photos.js           照片匯入：讀 EXIF → 壓縮去中繼資料 → 雜湊 → 存 blob
  exif.js             極簡 JPEG EXIF 讀取器（只取時間與 GPS）
  worker-image.js     背景執行緒影像壓縮（OffscreenCanvas）
  share.js            任務代碼 / 完整備份的匯出匯入
  memory.js           回憶影片：Canvas 動畫 + MediaRecorder + 動態相簿頁
  quests/generate.js  任務產生：策展比對 → 類型模板 → 通用題保底
  views/              各畫面（home / create / trip / spot / quest / album / settings / join）
data/
  curated.json        策展景點資料庫（可自行擴充）
  templates.json      規則式任務模板
icons/                App 圖示（由 scripts/make-icons.mjs 產生，純 Node 無相依）
scripts/
  make-icons.mjs      產生 PNG 圖示
  screenshots.mjs     Puppeteer 截圖 / 冒煙測試（唯一的 devDependency）
```

執行 App 本身**不需要任何 npm 套件**。`puppeteer` 只有截圖腳本會用到。

---

## 本機執行

```bash
# 任何靜態伺服器都行，例如：
python -m http.server 5174
#   或
npx serve
```

開 <http://localhost:5174>。（用 `file://` 直接開也能跑大部分功能，但 Service Worker 與 module worker 需要 http。）

## 部署到 GitHub Pages

1. 把整個資料夾推到 repo（例如 `tripquest`）。
2. repo Settings → Pages → Source 選 `Deploy from a branch`，branch 選 `main` / root。
3. 幾分鐘後即可在 `https://yolin0513.github.io/tripquest/` 開啟。

已包含 `.nojekyll`，Pages 不會忽略 `js/` 等資料夾。所有路徑都是相對路徑，放在子目錄也能運作。

---

## 開發者指令

```bash
npm run dev          # 啟動本機伺服器（python http.server）
npm run icons        # 重新產生 App 圖示
npm run screenshots  # Puppeteer 冒煙測試 + 產生 screenshots/
```

---

## 架構決策紀錄（3 代理一致投票）

在動手前，用 3 個獨立的 Opus 代理各自評估以下難點並投票，結果**七項全數一致、無分歧**：

| # | 決策 | 結論 |
|---|------|------|
| 1 | 技術棧 | **原生 ES Modules、無建置**。沿用上一個專案已驗證的架構；框架換來的響應式不值得它帶來的 SW 快取複雜度與離線相依風險。 |
| 2 | 多人協作 | **第一版 local-first**（任務代碼分享 + 完整備份匯入匯出），所有寫入走 `store.js` 這道縫，未來補同步 adapter 即可。**第二版目標指向 Supabase**（免費、匿名金鑰可安全內嵌於靜態站）。**排除 Firebase**——其 Cloud Storage 自 2024 年底起需綁定信用卡，違反「不需付費」的限制。 |
| 3 | 任務產生 | **三層 fallback 混合**：策展 JSON → 維基百科 / 類型判斷 → 規則式模板保底。任務文案品質是產品核心，所以策展資料庫是骨幹。自訂任務為第一級公民。 |
| 4 | 回憶影片 | **動態相簿頁為主，MediaRecorder 為輔**（用 `MediaRecorder.isTypeSupported` 偵測後才提供）。**排除 ffmpeg.wasm**——25MB+ 下載、GitHub Pages 無法送 COOP/COEP 標頭、手機記憶體不足。 |
| 5 | 照片儲存 | **IndexedDB blob**（非 OPFS，Safari 支援度考量）。1600px / JPEG q0.82 + 320px 縮圖，於 Worker 壓縮。EXIF 靠重新編碼順帶清除，GPS 僅在使用者為該行程明確開啟時才保留。呼叫 `navigator.storage.persist()`。**零上傳。** |
| 6 | 資料模型 | 全部 `crypto.randomUUID()`；每筆記錄帶 `updatedAt` + `deviceId`；中繼資料 LWW + 墓碑；`PhotoSubmission` 只新增不可變（集合聯集合併）；任務完成狀態**推導不落地**。 |
| 7 | 需付費 / 需註冊的服務 | **第一版：完全沒有。** 只需要既有的 GitHub 帳號。維基百科 / Wikidata 免金鑰、CORS 開放，且為可選。 |

---

## 需要使用者本人配合的事項

### 第一版（現在）

**沒有任何需要註冊或付費的服務。** 部署只需要你已經有的 GitHub 帳號（`yolin0513`）。

建議事項（非必須）：

- **把 App 加到手機主畫面**：iOS 上，若長期（約 7 天）不開啟且未加到主畫面，Safari 可能清除本機資料。加到主畫面後 `navigator.storage.persist()` 較容易獲准。
- **定期用「行程設定 → 匯出完整備份」留一份檔案**，特別是出遊剛結束、照片還沒被別的裝置收走前。

### 第二版（未來要接雲端即時同步時，才需要）

- 你本人到 <https://supabase.com> 註冊一個**免費**帳號，建立一個 project。
- 把該 project 的 **URL** 與 **anon public key** 貼到 App 的設定頁（會新增這個欄位）。
- 注意：Supabase 免費 project 閒置約 7 天會自動暫停（重新開啟即可恢復），且免費儲存空間約 1GB —— 屆時同步策略會是「只同步中繼資料 + 縮圖，原圖仍留在各自裝置」。
- 這些都由你本人操作，我不會、也無法代替你註冊。

---

## 已知限制

- **iOS Safari 的 MediaRecorder** 對 canvas 串流錄影支援不穩定。偵測不到時 App 會自動只提供動態相簿頁（一樣可分享、一樣好看）。
- 錄影是**即時**進行的（30 張照片約 90 秒），過程中需讓畫面保持開啟。
- 完整備份是單一 JSON 檔，含 base64 照片，30 張約 10–15MB —— 適合 LINE / AirDrop 傳遞，不適合 email 附件。
- 策展資料庫目前收錄約 12 個熱門景點，可自行擴充 `data/curated.json`。

---

## 授權

MIT
