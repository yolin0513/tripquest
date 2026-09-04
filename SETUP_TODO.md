# 明天早上再處理的事

App 現在**單機就完全可用**（建立行程、拍照解任務、按讚留言、做回憶影片、匯出備份）。
「多人即時同步」的**程式碼、伺服器、Cloudflare Worker 都已寫好**，只差你去註冊 + 部署。

架構決策的完整理由在 [`docs/ARCHITECTURE_DECISION.md`](./docs/ARCHITECTURE_DECISION.md)（3 個獨立代理投票，三項全數一致）。
一句話總結：**主力用 Cloudflare Workers + R2 + D1（免費、永遠開著、對外流量不收費）；不做帳號密碼；照片縮圖先同步、全圖點閱才傳。**

---

## 1. 部署到 GitHub Pages（約 5 分鐘，免綁卡）

**為什麼**：家人用網址就能開、能「加到主畫面」。
**需要**：你已有的 GitHub 帳號 `yolin0513`。

1. GitHub 建一個 repo，例如 `tripquest`（Public）。
2. 推上去：
   ```
   cd D:\Claude\App\TripQuest
   git remote add origin https://github.com/yolin0513/tripquest.git
   git push -u origin main
   ```
3. repo → **Settings → Pages** → Source：`Deploy from a branch` → `main` / `/ (root)` → Save。
4. 等 1–3 分鐘，開 `https://yolin0513.github.io/tripquest/`。
5. 手機用 Safari / Chrome 開 → 分享 → **加入主畫面**。

---

## 2. 開通多人即時同步（Cloudflare，約 40 分鐘）

> 做完這步，大家各自用行動網路就能建群組、拍照自動同步到彼此手機。

### 2a. 註冊 Cloudflare 帳號 — 約 5 分鐘・**免綁卡**

<https://dash.cloudflare.com/sign-up>，email + 驗證即可。

### 2b. 裝 wrangler 並登入 — 約 5 分鐘・**免綁卡**

```
npm install -g wrangler
wrangler login
```
（會開瀏覽器授權。）

### 2c. 建 D1 資料庫 — 約 5 分鐘・**免綁卡**

```
cd D:\Claude\App\TripQuest\workers
wrangler d1 create tripquest
```
把它印出來的 `database_id` 貼進 `workers/wrangler.toml` 裡對應的欄位，然後：
```
wrangler d1 execute tripquest --remote --file=./schema.sql
```

### 2d. 啟用 R2 物件儲存 — 約 10 分鐘・**⚠ 需要綁一張信用卡（在免費額度內不會扣款）**

- Cloudflare 後台 → **R2** → 第一次會要你**加一張付款卡**才能啟用。
- **免費額度**：儲存 10 GB、每月寫入 100 萬次 / 讀取 1000 萬次、**對外流量永久免費**。
  我們一趟旅行約用 90 MB / 500 次寫入 —— 大概十年都用不完免費額度。
- 建議去 **Billing → Notifications** 設一個「超過 $0」的通知，安心用。
- 建 bucket：
  ```
  wrangler r2 bucket create tripquest-photos
  ```

> **不想綁卡？** 跳過 2d，改用下面第 3 項（自架 + Tunnel，完全免綁卡），或就用單機模式（分享連結 + 匯出/匯入備份）。App 三種模式都支援。

### 2e. 部署 Worker — 約 5 分鐘

```
cd D:\Claude\App\TripQuest\workers
wrangler deploy
```
會給你一個網址，像 `https://tripquest.你的名字.workers.dev`。

### 2f. 把網址給我 / 填進 App

- **告訴我這個 workers.dev 網址**，我對著它跑一次端到端測試、確認沒問題。
- 或你自己在 App 的 **設定 → 多人同步 → 設定伺服器** 貼上這個網址，選「Cloudflare」模式。

> 域名（`workers.dev` 之外的自訂網址）**不需要**。要買的話約 NT$300–500/年、需綁卡，純粹是網址好記，非必要。

---

## 3.（替代方案，免綁卡）自架 + Cloudflare Tunnel

如果不想為了 R2 綁卡，這條路完全免費、免卡，資料 100% 在你自己電腦：

1. 註冊 Cloudflare 帳號（同 2a，免卡）。
2. 裝 `cloudflared`（<https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>）。
3. 在你電腦跑同步伺服器：
   ```
   cd D:\Claude\App\TripQuest
   node server/index.mjs
   ```
4. 另一個視窗開 tunnel：
   ```
   cloudflared tunnel --url http://localhost:8787
   ```
   會給一個 `https://xxxx.trycloudflare.com` 網址（**注意：這種快速 tunnel 每次重開網址會變**；要固定網址需設 named tunnel + 一個網域，約多 15 分鐘）。
5. 把網址填進 App 設定頁。

- **代價**：出遊期間你家的電腦要保持開機、不能睡眠、不能關網路（去 Windows 電源設定關掉睡眠，Windows Update 設「使用時間」避開）。
- 適合「先驗證能不能用」或「堅持資料不進雲端」。

---

## 4. 不用管的事

| 項目 | 狀況 |
|---|---|
| **帳號 / 註冊功能** | 決定不做。身分靠「邀請連結 + 這台裝置 + 你取的名字」，換手機用同一條連結點回自己的名字就好。不需要任何 email / 簡訊 / 第三方登入服務。 |
| **Supabase** | 評估後否決 —— 免費 project 閒置 7 天自動暫停，旅行季節性使用等於每次都要手動喚醒。 |
| **Firebase** | 評估後否決 —— 檔案儲存強制綁卡且無硬性花費上限。 |
| **App 圖示** | 已用 `npm run icons` 自動產生。 |
| **配樂版權** | 影片配樂程式即時合成，無版權問題。 |

---

## 你要給我的東西（做完 2 之後）

1. Worker 網址（`https://....workers.dev`）
2. （如果 2d 綁卡了）確認 R2 bucket 名稱是 `tripquest-photos`

有這兩個，我就能把雲端同步接到底、跑完整測試。在那之前，單機模式與（第 3 項）自架模式都已經能用。
