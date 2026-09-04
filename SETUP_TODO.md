# 還剩一件事：開通 Cloudflare 同步

前端**已經上線**：<https://yolin0513.github.io/tripquest/>
（單機模式完全可用：建立行程、拍照解任務、按讚留言、做回憶影片、匯出備份。）

只剩「多人即時同步」的後端還沒部署 —— 因為要你在電腦前按一次授權。

---

## 回到電腦後：一行指令 + 按一次 Allow（約 5 分鐘）

```bash
cd D:/Claude/App/TripQuest
bash scripts/publish-cloud.sh
```

過程中會**開瀏覽器跳出 Cloudflare 授權頁 → 按「Allow」**。其餘全自動：
建 D1 資料庫 → 建資料表 → 建 R2 bucket → 部署 Worker → 印出網址。

完成後它會印出 `https://tripquest.你的名字.workers.dev`。

**把那個網址貼給我**，我會：
1. 對它跑一次線上端到端驗證（`node scripts/synctest.mjs --url <網址>`）
2. 確認 Cloudflare 用量在免費額度內
3. 把網址填進 `js/sync.js` 的 `BUILT_IN`（已預留好欄位），commit + push
   → 之後家人開 `yolin0513.github.io/tripquest/` 就**自動連同步**，連「設定」都不用點

前提（你說已完成）：Cloudflare 帳號、啟用 R2、綁好卡。
費用全在免費額度內；建議去 Cloudflare 後台 Billing → Notifications 設一個「超過 US$0」通知。

---

## 完全不想碰 Cloudflare 的話（替代方案，免綁卡）

在家裡任一台電腦跑：
```bash
cd D:/Claude/App/TripQuest && node server/index.mjs
```
另開視窗：`cloudflared tunnel --url http://localhost:8787`，把它給的網址填進 App 設定頁
（設定 → 多人同步 → 設定同步伺服器 → 自架伺服器）。
代價：那台電腦出遊期間要保持開機。協定與 Worker 完全一致，已測過。

---

## 已完成（不用再管）

| 項目 | 狀態 |
|---|---|
| 前端上線 | ✅ `yolin0513.github.io/tripquest/`（repo `yolin0513/tripquest`，Pages 從 `main`/root） |
| GitHub repo + push + Pages | ✅ 用你既有的 gh 授權完成 |
| Worker 程式碼 | ✅ 用 `wrangler dev`（本機 D1+R2 模擬）跑完整端到端測試，全綠 |
| 一鍵部署腳本 | ✅ `scripts/publish-cloud.sh` |
| 自架伺服器 | ✅ `server/index.mjs`，協定同 Worker，測過 |
| 帳號 / 註冊功能 | 決定不做（身分靠邀請連結 + 裝置 + 名字） |
| Supabase / Firebase / 網域 | 否決 / 不需要 |
