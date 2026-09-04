# 回到電腦前要做的事

App 現在**單機完全可用**，也已上線（GitHub Pages）。多人即時同步的程式碼、Cloudflare Worker、
一鍵部署腳本都寫好測好了，只差兩個「需要你本人授權」的動作。

---

## ★ 動作 1：部署 Cloudflare 同步後端（約 5 分鐘，一行指令 + 按一次 Allow）

前提：你已註冊 Cloudflare、已啟用 R2、綁好卡（都做完了）。

```bash
cd D:/Claude/App/TripQuest
bash scripts/publish-cloud.sh
```

過程中會**開一次瀏覽器跳出 Cloudflare 授權頁 → 按「Allow」**。其餘全自動：
建 D1 資料庫 → 建資料表 → 建 R2 bucket → 部署 Worker → 印出網址。

完成後它會印出一個 `https://tripquest.你的名字.workers.dev`。

**把那個網址貼給我**，我跑一次線上端到端驗證、確認收尾。
（或你自己在手機 App：設定 → 多人同步 → 設定同步伺服器 → 選 Cloudflare → 貼網址。）

> 費用：全在免費額度內（Workers 10 萬請求/日、D1 5GB、R2 10GB + 對外流量免費）。
> 一趟旅行約用 500 次寫入、90 MB —— 一年也用不到 1%。建議去 Cloudflare 後台
> Billing → Notifications 設一個「超過 US$0」的通知，安心。

---

## ★ 動作 2：把前端推到你的 GitHub（約 3 分鐘）

前端目前在我這邊本機，還沒進你的 GitHub。做這步之後 `yolin0513.github.io/tripquest/` 才會是最新版。

**因為這台機器沒裝 `gh`，repo 要你手動建一次：**

1. 開 <https://github.com/new>
   - Repository name：`tripquest`
   - 選 **Public**
   - **不要**勾 “Add a README”
   - 按 Create repository
2. 回到電腦，跑：
   ```bash
   cd D:/Claude/App/TripQuest
   git remote add origin https://github.com/yolin0513/tripquest.git
   git push -u origin main
   ```
   （會用你電腦裡已存的 GitHub 登入，不會再問密碼。）
3. repo 頁面 → **Settings → Pages** → Source 選 `Deploy from a branch` → `main` / `/ (root)` → Save。
4. 等 1–3 分鐘，開 `https://yolin0513.github.io/tripquest/`。

> 我已經把 `.nojekyll`、相對路徑都處理好，Pages 直接就能跑。
> 做完動作 1 拿到 Worker 網址後，也可以把它預設寫進前端（告訴我，我改一行 commit 掉），
> 這樣家人開網址就自動連同步、連「設定同步伺服器」都不用點。

---

## 不用管的事

| 項目 | 狀況 |
|---|---|
| 帳號 / 註冊功能 | 決定不做。身分靠「邀請連結 + 這台裝置 + 你取的名字」。 |
| Supabase | 否決（閒置 7 天自動暫停）。 |
| Firebase | 否決（Storage 強制綁卡、無花費硬上限）。 |
| 網域名稱 | 不需要，`workers.dev` 和 `github.io` 就夠。 |
| App 圖示、配樂版權 | 已處理。 |

---

## 完全不想碰 Cloudflare 的話（替代方案）

在家裡任一台電腦跑：
```bash
cd D:/Claude/App/TripQuest && node server/index.mjs
```
另開一個視窗：`cloudflared tunnel --url http://localhost:8787`，把它給的網址填進 App 設定頁。
免綁卡，但那台電腦出遊期間要保持開機。（`server/index.mjs` 與 Worker 是同一套協定，已完整測過。）
