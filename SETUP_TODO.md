# 全部完成 ✅

前端與多人同步後端**都已上線**：

| | 網址 |
|---|---|
| App（前端） | <https://yolin0513.github.io/tripquest/> |
| 同步 Worker | <https://tripquest.yolin0513.workers.dev> |

家人開 App 網址就**自動連上同步**（`js/sync.js` 的 `BUILT_IN` 已填好），連「設定」都不用點。

---

## 已部署的 Cloudflare 資源（你的帳號 `yolin870513@gmail.com`）

| 資源 | 名稱 | 說明 |
|---|---|---|
| Worker | `tripquest` | 純同步 API（`/health` `/push` `/pull` `/blob`）|
| D1 資料庫 | `tripquest`（`6b841a4d-…`）| `groups` + `records` 兩張表，region APAC |
| R2 bucket | `tripquest-photos` | 照片二進位，key = `<groupId>/<hash>` |
| workers.dev 子網域 | `yolin0513` | 帳號層級，一次性 |

`workers/wrangler.toml` 裡的 `database_id` 是公開識別碼、不是祕鑰，可以進 repo。
帳號沒有存任何 API token（同步驗證靠每個群組自己的 128-bit 邀請祕鑰）。

---

## 費用：全在免費額度內

- **Workers**：免費 10 萬次請求/日
- **D1**：免費 5GB 儲存、500 萬列讀取/日、10 萬列寫入/日
- **R2**：免費 10GB 儲存、100 萬 Class A / 1000 萬 Class B 操作/月，**無出站流量費**

一家人用量遠低於上述。建議去 Cloudflare 後台 **Billing → Notifications** 設一個「超過 US$0」的用量通知當保險。

---

## 日後要重新部署 / 換帳號

不需要 WSL，用 Node 版腳本：

```
cd D:\Claude\App\TripQuest
node scripts/publish-cloud.mjs
```

會開一次瀏覽器按 Allow，其餘全自動（登入 → 建 D1 → 建表 → 建 R2 → deploy → 把網址寫回 `js/sync.js`）。
只想更新前端網址：`node scripts/publish-cloud.mjs --url https://xxx.workers.dev`
（舊的 `scripts/publish-cloud.sh` 保留，需要 WSL/Git Bash。）

---

## 不想用 Cloudflare 的替代方案（免綁卡）

在家裡任一台電腦跑 `node server/index.mjs` + `cloudflared tunnel --url http://localhost:8787`，
把 tunnel 網址填進 App 設定頁（設定 → 多人同步 → 自架伺服器）。
代價：那台電腦出遊期間要開機。協定與 Worker 一致。

---

## 已完成（不用再管）

| 項目 | 狀態 |
|---|---|
| 前端上線 | ✅ `yolin0513.github.io/tripquest/` |
| 同步後端上線 | ✅ `tripquest.yolin0513.workers.dev`（線上端到端驗證 13 項全綠）|
| GitHub repo + push + Pages | ✅ |
| 一鍵部署腳本 | ✅ `scripts/publish-cloud.mjs`（Node，免 WSL）+ `.sh`（舊版）|
| 自架伺服器 | ✅ `server/index.mjs`，協定同 Worker |
| 帳號 / 註冊功能 | 決定不做（身分靠邀請連結 + 裝置 + 名字）|
| Supabase / Firebase / 網域 | 否決 / 不需要 |
