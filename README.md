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

- **單機模式**：照片完全不上傳，只在這支手機的 IndexedDB。
- **同步模式**：照片會存一份到你 / 旅伴自己架的伺服器（Cloudflare R2 或自己的電腦），除此之外不送任何地方。
- 匯入時照片重新編碼壓縮（長邊 1600px，WebP 或 JPEG），過程**清掉所有 EXIF，包含 GPS**。
- 拍攝時間保留（用於影片排序）；GPS 座標**預設丟棄**，只有你為某行程手動開啟「記錄位置」後才留在本機，且只精確到 ~110 公尺；關閉開關會把已存座標一併清掉。
- 對外連線：同步（你自己的伺服器）＋ 抓景點示意圖時向 `zh.wikipedia.org` 查詢（只送景點名稱，可關）。

---

## 多人協作

三種模式，設定頁一鍵切換（見 [`docs/ARCHITECTURE_DECISION.md`](./docs/ARCHITECTURE_DECISION.md)，3 代理投票決定）：

| 模式 | 做什麼 |
|---|---|
| **單機**（預設） | 分享「邀請連結」給旅伴（含行程 + 任務，數 KB）；用「匯出 / 匯入備份」合併照片 |
| **Cloudflare**（推薦） | Workers + R2 + D1。各自用行動網路就能建群組、拍照自動同步。免費、永遠開著、對外流量不收費。Worker 程式碼在 `workers/`，等使用者 `wrangler deploy` |
| **自架伺服器** | `node server/index.mjs`（零相依）＋ Cloudflare Tunnel 打外網。不需綁卡，但電腦要保持開機 |

**同步設計**：
- 中繼資料（行程 / 任務 / 讚 / 留言）走 `push` / `pull`；照片走 `putBlob` / `getBlob`（R2 物件儲存）。
- **縮圖立即同步、全圖點開才抓** —— 一趟必要流量從 ~300 MB 降到 ~20 MB，爛訊號也順。
- **離線佇列**（IndexedDB `outbox`）：拍照當下就排隊，網路一好自動、有退避地補傳，不卡 UI、不漏。
- **不做帳號**：邀請連結帶 128-bit 群組祕鑰（放 URL fragment，不進伺服器紀錄）。身分 = 這台裝置 + 你取的名字，存在 IndexedDB。換手機用「身分備份卡」一鍵認回過去所有照片。
- 資料模型：UUID + `updatedAt`/`deviceId`，中繼資料「後寫入者勝 + 墓碑」，投稿 / 讚 / 留言 / 撤回**只新增**（合併即集合聯集，永不衝突），同步游標用伺服器指派的序號。

**需要你本人處理的事（註冊 Cloudflare、部署 Worker）整理在 [`SETUP_TODO.md`](./SETUP_TODO.md)。**

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
  identity.js              裝置身分（存 IndexedDB）+ 身分備份卡
  prefs.js                 字級 / 對比偏好
  photos.js exif.js        照片匯入：讀 EXIF → Worker 壓縮去中繼資料 → 內容雜湊 → 存 blob；全圖延遲下載
  worker-image.js          背景執行緒影像壓縮（WebP 探測 → JPEG 保險）
  quests/generate.js       任務產生：策展比對 → 類型模板 → 通用題保底
  enrich.js                景點示意圖（Wikipedia，抓回存 blob）
  memory.js music.js       回憶影片：時間軸繪製 + MediaRecorder + 程序配樂 + 動態相簿頁
  share.js                 邀請連結（同步 / 複製兩種）+ 備份匯入匯出
  sync.js outbox.js claim.js  可插拔同步層 + 離線重試佇列 + 「這是誰的手機」認領
  views/                   home create trip spot quest people album settings join
data/curated.json          策展景點資料庫（18 個熱門景點，可自行擴充）
data/templates.json        規則式任務模板
server/index.mjs           選配的自架同步伺服器（零相依，協定同 Worker）
workers/                   Cloudflare Worker（worker.mjs / schema.sql / wrangler.toml）
docs/ARCHITECTURE_DECISION.md   後端 / 身分 / 照片策略的決策紀錄（3 代理投票）
scripts/                   make-icons · screenshots（冒煙測試）· gallery（功能截圖）· synctest（同步端到端）
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

## 架構決策紀錄

兩輪 3 代理投票，全部一致：

**第一輪（技術棧）**：原生 ES Modules 無建置｜local-first + 可插拔同步（排除 Firebase）｜三層 fallback 任務產生｜相簿頁 + MediaRecorder（排除 ffmpeg.wasm）｜IndexedDB blob｜UUID + LWW + 墓碑。

**第二輪（後端 / 身分 / 照片，見 [`docs/ARCHITECTURE_DECISION.md`](./docs/ARCHITECTURE_DECISION.md)）**：
1. 託管：**Cloudflare Workers + R2 + D1**（R2 對外流量免費、永遠開著），自架 + Tunnel 為退路。排除 Supabase（7 天閒置暫停）、Firebase（Storage 需綁卡）。
2. 身分：**不做帳號**。邀請連結 + 裝置身分（存 IndexedDB）+ 顯示名稱；換手機用身分備份卡認回。
3. 照片：1600px（WebP 探測 / JPEG 保險）+ 320px 縮圖；縮圖先同步、全圖延遲抓；IndexedDB `outbox` 離線佇列 + HEAD 去重；GPS 精度降到 ~110m。

---

## 已知限制

- iOS Safari 的 MediaRecorder 對 canvas 錄影支援不穩 → 偵測不到時自動只提供動態相簿頁。
- 錄影是即時的（約每張 3–4 秒），過程需讓畫面開著別鎖螢幕。
- 完整備份是含 base64 照片的單一 JSON（30 張約 10–15MB）→ 適合 LINE / AirDrop。
- 自架伺服器需手機與電腦在同一 Wi-Fi（跨網路方案見 SETUP_TODO.md）。

## 授權　MIT
