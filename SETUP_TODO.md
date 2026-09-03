# 明天早上再處理的事

App 現在**單機就完全可用**（建立行程、拍照解任務、按讚留言、做回憶影片、匯出備份），
下面每一項都是「錦上添花」，不做也能用。已按「建議做的順序」排列。

---

## 1. 部署到 GitHub Pages（建議先做，約 5 分鐘）

**為什麼**：讓家人用網址就能開，不用傳檔案；也才能「加到手機主畫面」變成像 App 一樣。
**需要**：你已有的 GitHub 帳號 `yolin0513`，不用註冊新東西、免費。

1. 在 GitHub 建一個新的 repo，例如 `tripquest`（Public）。
2. 把整個 `D:\Claude\App\TripQuest\` 資料夾推上去：
   ```
   cd D:\Claude\App\TripQuest
   git remote add origin https://github.com/yolin0513/tripquest.git
   git push -u origin main
   ```
3. repo 頁面 → **Settings → Pages** → Source 選 **Deploy from a branch** → 分支 `main`、資料夾 `/ (root)` → Save。
4. 等 1–3 分鐘，開 `https://yolin0513.github.io/tripquest/`。
5. 手機用 Safari / Chrome 開這個網址 → 分享選單 → **加入主畫面**。

> 已經放好 `.nojekyll`，Pages 不會忽略 `js/` 資料夾；所有路徑都是相對的，放子目錄也能跑。

---

## 2.（選配）自架同步伺服器 —— 讓大家的手機看到彼此的照片

**為什麼**：目前多人是靠「分享連結（任務清單）」+「匯出/匯入備份（照片）」。
如果想要「大家拍完，照片自動出現在彼此手機」，需要一個大家都連得到的伺服器。

**最省事、不用註冊任何服務的做法**：用一台電腦（你的或家人的）當伺服器。

```
cd D:\Claude\App\TripQuest
node server/index.mjs
```

啟動後會印出幾個網址（例如 `http://192.168.0.10:8787`）。
在每支手機的 **設定 → 多人同步 → 設定伺服器**，填同一個網址即可。

- **免費、不用註冊。** 資料存在 `server/data/`（想清空就刪掉那個資料夾）。
- **限制**：手機和電腦要在**同一個 Wi-Fi**。出國時手機用行動網路，就連不到家裡的電腦——
  這種情況請看下面第 3 項，或就繼續用「匯出/匯入備份」的方式（旅程結束回家連上 Wi-Fi 再同步一次即可）。

---

## 3.（選配，需要你註冊）讓手機在外面也連得到自架伺服器

若希望**出遊當下即時同步**，要讓外網的手機連到你家的電腦，二選一：

| 方式 | 要註冊什麼 | 免費額度 | 大概時間 | 備註 |
|------|-----------|----------|----------|------|
| **Tailscale** | tailscale.com 帳號（可用 Google 登入） | 個人版免費、最多 100 台裝置 | 約 10 分鐘 | 在電腦和每支手機都裝 Tailscale App，手機就能用電腦的 Tailscale IP 連到 `:8787`。最推薦、最安全。 |
| **Cloudflare Tunnel** | Cloudflare 帳號 | 免費 | 約 15 分鐘 | `cloudflared tunnel --url http://localhost:8787` 會給一個公開網址，貼到手機設定即可。免裝手機 App。 |

（`ngrok` 也可以，但免費版網址每次重開會變，較麻煩。）

做完後，把「設定 → 多人同步」的網址改成 Tailscale IP 或 Cloudflare 給的網址就好。

---

## 4.（選配，需要你註冊）改用雲端同步，完全不用自己開電腦

如果不想維護自架伺服器，可以之後改接 **Supabase**（架構已預留，之後我補一個 adapter 就能用）。

- **要註冊**：到 <https://supabase.com> 用 GitHub 登入，建立一個新 project（選離台灣近的區域，如 Singapore）。
- **免費額度**：資料庫 500MB、檔案儲存 1GB、每月 5GB 流量。閒置 7 天會自動暫停（開一下就恢復）。
- **大概時間**：註冊 + 建 project 約 10 分鐘。
- **你要給我的東西**：project 的 **Project URL** 和 **anon public key**（在 project 的 Settings → API 裡）。
  這兩個貼到 App 設定頁即可，anon key 放在前端是安全的（靠資料庫的 Row Level Security 控管）。
- **為什麼不用 Firebase**：它的檔案儲存從 2024 年底起需要綁信用卡，不符合「免費」的要求。

> 因為這一步需要你本人註冊，我先跳過沒做。你弄好 project、把 URL 和 key 給我，我再把雲端同步接上。
> 在那之前，第 2 項（自架伺服器）已經能達到八成的效果。

---

## 現在不用管的事

- **App 圖示**：已用腳本自動產生（`npm run icons`），不用另外處理。
- **配樂版權**：影片配樂是程式即時合成的，天生無版權問題；也支援你選自己手機裡的音樂。
- **網域名稱**：GitHub Pages 的網址就夠用，要自訂網域再說。
