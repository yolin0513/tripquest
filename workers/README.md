# TripQuest 同步 Worker

Cloudflare Workers + D1（中繼資料）+ R2（照片）。純同步 API，App 本身留在 GitHub Pages。

## 部署（詳細步驟見專案根目錄 `SETUP_TODO.md` 第 2 節）

```bash
npm install -g wrangler
wrangler login

cd workers
wrangler d1 create tripquest
#  → 把印出的 database_id 貼進 wrangler.toml

wrangler d1 execute tripquest --remote --file=./schema.sql
wrangler r2 bucket create tripquest-photos     # 需先在後台啟用 R2（要綁卡）

wrangler deploy
#  → 給你 https://tripquest.<你>.workers.dev
```

把那個網址填進 App 的「設定 → 多人同步」，選 Cloudflare 模式。

## 本機測試

```bash
wrangler dev --remote
```

## 資料隔離

每個群組 = `groupId` + 一組 128-bit 祕鑰。第一次 `push` 建立群組並綁定祕鑰，
之後所有請求（含照片存取）都要帶對的祕鑰，且只看得到自己群組的資料。

## 費用

免費額度：Workers 10 萬請求/日、D1 5 GB、R2 10 GB + 對外流量免費。
一趟旅行約用 500 次寫入、90 MB —— 一年 10 趟也用不到 1%。
R2 啟用需在帳戶綁卡，但在免費額度內不扣款；建議設 $0 通知。

## 與自架伺服器的關係

`../server/index.mjs` 是同一套協定的 Node 實作（給不想綁卡、要用 Cloudflare Tunnel 的人）。
兩者的 `/push` `/pull` `/blob` 行為一致，App 端同一個 adapter。
