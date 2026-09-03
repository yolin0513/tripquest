# TripQuest 旅圖任務

> 一群人（特別是帶著長輩）出遊時，把每個景點變成一張張「拍照任務」，
> 像闖關一樣一起完成、互相按讚，旅程結束後自動做成一支精美的回憶影片。

手機優先的 **PWA**：純前端、免註冊、可離線、所有資料（含照片）只存在自己的裝置。
可直接部署到 GitHub Pages。

---

## 設計核心：讓長輩也玩得起來、有參與感

- **大字、大按鈕**：全站用 rem 排版，字級可在設定切「標準 / 大 / 特大」，另有高對比模式。觸控目標 ≥ 56px。
- **少打字**：建立行程時用「點選熱門景點」為主（京都、大阪、東京、台北、九份、太魯閣…），打字搜尋為輔；貼整段行程文字則收在「進階」裡給年輕人代勞。
- **一鍵拍照**：任務頁只有一顆大大的「📷 拍照」。「這張誰拍的」每個旅程只問一次就記住。
- **明確的成就回饋**：每完成一個任務跳出全螢幕慶祝畫面（打勾 + 彩帶 + 震動 + 進度），全部完成再放大絕。
- **看得到彼此**：「照片牆」顯示每個人的進度，和所有人拍的照片；可以按 ❤️👍😍👏、留言互相鼓勵。
- **景點示意圖**：任務卡會顯示「要拍的東西長怎樣」的參考照片（來自維基百科，抓回後離線可看）。

---

## 回憶影片（核心產出）

不是把照片排一排——是一支能拿給家人看的短片：

- **片頭**：旅程名稱、日期、「X 個人 · Y 個景點 · Z 張照片」，帶動畫
- **每天的日期字卡**：「第 1 天 · 京都」
- **照片**：Ken Burns 緩慢推移 + 交叉淡入淡出 + 字幕（地點 · 人物 · 日期）
- **路線地圖**：用景點座標畫出這趟走過的地方，路線一段一段畫出來
- **片尾**：「謝謝這趟旅程」+ 統計（含大家互相按了幾個讚）
- **配樂**：程式即時合成（溫柔 / 輕快，天生無版權），或選自己手機裡的音樂
- **輸出**：① 動態相簿頁（單一 HTML，離線可開、直接傳給家人）② 影片檔 .mp4/.webm（偵測到支援才提供）

在瀏覽器端全部做完，**不上傳任何東西**。

---

## 隱私

- **照片永遠不上傳。** 只存在這支手機的 IndexedDB。
- 匯入時照片會重新編碼壓縮（長邊 1600px），這個過程**清掉所有 EXIF，包含 GPS 位置**。
- 拍攝時間保留（用於影片排序）；GPS 座標**預設丟棄**，只有你為某個行程手動開啟「記錄位置」後才留在本機。
- 對外連線只有一種：抓景點示意圖時向 `zh.wikipedia.org` 查詢（只送景點名稱）。可在行程設定關閉。

---

## 多人協作

第一版 **local-first**，同步層可插拔：

| 想做的事 | 現在的做法 |
|---|---|
| 出遊當下大家解同一份任務 | **分享連結**：行程 + 景點 + 任務壓進網址，旅伴打開就有同一份清單 |
| 合併大家的照片 | **匯出 / 匯入備份**（`.tripquest.json`，含照片，自動去重合併） |
| 照片自動出現在彼此手機 | **自架伺服器**：`node server/index.mjs`（零相依、免註冊），手機在設定填入電腦網址即可互相同步 |

資料模型從第一天就設計成可同步：UUID + `updatedAt`/`deviceId`，中繼資料「後寫入者勝 + 墓碑」，
照片投稿 / 讚 / 留言**只新增不修改**（合併即集合聯集，永不衝突）。雲端同步（Supabase）之後補一個 adapter 即可，不動資料層與畫面。

**需要你本人處理的事整理在 [`SETUP_TODO.md`](./SETUP_TODO.md)。**

---

## 技術架構

**原生 JavaScript ES Modules + IndexedDB + Service Worker，無框架、無打包、無建置步驟。**
（由 3 個獨立的架構評估代理一致投票通過，七項決策全數一致——見文末。）

```
index.html · manifest.webmanifest · sw.js
css/style.css              深色為主、長輩友善（rem 排版、字級 data-fs、高對比）
js/
  app.js router.js         進入點 + hash 路由
  store.js db.js ids.js    狀態層（所有寫入的唯一入口）+ IndexedDB + UUID/雜湊
  prefs.js                 字級 / 對比偏好
  photos.js exif.js        照片匯入：讀 EXIF → Worker 壓縮去中繼資料 → 內容雜湊 → 存 blob
  worker-image.js          背景執行緒影像壓縮
  quests/generate.js       任務產生：策展比對 → 類型模板 → 通用題保底
  enrich.js                景點示意圖（Wikipedia，抓回存 blob）
  memory.js music.js       回憶影片：時間軸繪製 + MediaRecorder + 程序配樂 + 動態相簿頁
  share.js sync.js         分享代碼 / 備份匯入匯出 + 可插拔同步層（LocalAdapter / LanAdapter）
  views/                   home create trip spot quest people album settings join
data/curated.json          策展景點資料庫（18 個熱門景點，可自行擴充）
data/templates.json        規則式任務模板
server/index.mjs           選配的自架同步伺服器（零相依）
scripts/                   make-icons.mjs（純 Node 產圖示）· screenshots.mjs（Puppeteer 冒煙測試）
```

執行 App 本身**不需要任何 npm 套件**。`puppeteer` 只有測試腳本會用到。

---

## 本機執行

```bash
python -m http.server 5174        # 或 npx serve、或 node server/index.mjs
```

開 <http://localhost:5174>。（`file://` 直接開也能跑大部分功能，SW 與 module worker 需要 http。）

## 部署 GitHub Pages

見 [`SETUP_TODO.md`](./SETUP_TODO.md) 第 1 項。已含 `.nojekyll`，全相對路徑，可放子目錄。

## 開發者指令

```bash
npm run dev          # python http.server
npm run icons        # 重新產生 App 圖示
npm run screenshots  # Puppeteer 冒煙測試 + 產生 screenshots/
```

---

## 架構決策紀錄（3 代理一致投票，七項全數一致）

| # | 決策 | 結論 |
|---|------|------|
| 1 | 技術棧 | 原生 ES Modules、無建置。框架的響應式不值得它的 SW 快取複雜度與離線相依風險。 |
| 2 | 多人協作 | v1 local-first（分享代碼 + 備份匯入匯出），寫入集中於 `store.js`。**排除 Firebase**（Cloud Storage 2024 底起需綁卡）。之後可接自架伺服器或 Supabase。 |
| 3 | 任務產生 | 三層 fallback 混合：策展 JSON → 類型模板 → 通用題保底，永不落空。自訂任務為第一級功能。 |
| 4 | 回憶影片 | 動態相簿頁為主 + MediaRecorder 為輔（偵測支援才提供）。**排除 ffmpeg.wasm**（25MB+、GitHub Pages 無 COOP/COEP、手機記憶體不足）。 |
| 5 | 照片 | IndexedDB blob、Worker 壓到 1600px、重編碼順帶清 EXIF/GPS、`navigator.storage.persist()`、零上傳。 |
| 6 | 資料模型 | 全 UUID + `updatedAt`/`deviceId`；中繼資料 LWW + 墓碑；投稿 / 讚 / 留言只新增（集合聯集合併）；任務完成狀態推導不落地。 |
| 7 | 需付費 / 註冊的服務 | v1 完全沒有。只需既有的 GitHub 帳號。 |

---

## 已知限制

- iOS Safari 的 MediaRecorder 對 canvas 錄影支援不穩 → 偵測不到時自動只提供動態相簿頁。
- 錄影是即時的（約每張 3–4 秒），過程需讓畫面開著別鎖螢幕。
- 完整備份是含 base64 照片的單一 JSON（30 張約 10–15MB）→ 適合 LINE / AirDrop。
- 自架伺服器需手機與電腦在同一 Wi-Fi（跨網路方案見 SETUP_TODO.md）。

## 授權　MIT
