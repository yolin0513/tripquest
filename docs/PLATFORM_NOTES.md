# 平台行為筆記

這一份記的是「查證過的第三方平台行為」——那些在程式碼裡看不出來、但會決定
設計要怎麼做的事。每一條都附查證方式與日期，因為這些行為**會隨版本改變**。

---

## 1. iPhone 主畫面 App 與 Safari 的儲存空間是分開的

**狀態：確認（Apple 官方說法）** · 2026-09-06

Apple 在 WWDC23〈What's new in web apps〉明講：

> "Home Screen web apps have a standalone, app-like experience on iOS,
> **with separate cookies and storage from the browser**."
> "From that point on, cookies are separate between Safari and the web app."

**造成的實際問題**（使用者實機回報）：旅伴在 Safari 點邀請連結、加入旅程、
選好身分，然後把網頁加到主畫面 —— 從主畫面打開時是**另一個空的儲存區**，
旅程「不見了」。

**幫兇**：主畫面圖示打開的是 manifest 的 `start_url`（我們是 `./`），
不是那個帶邀請碼的網址，所以連自動重加一次的機會都沒有。

**Android 不一樣**：WebAPK 跑在同一個 Chrome profile，儲存空間與瀏覽器
**共用**（登入狀態、cookie、IndexedDB 都通）。所以這個 bug 是 iPhone 專屬的，
程式必須分平台，不要拿 iPhone 那套去嚇 Android 使用者。

**我們的做法**：iPhone 上把順序倒過來（先裝再加入），並在跳教學時把邀請
連結複製到剪貼簿當「橋」；首頁在 standalone 且零旅程時直接給「貼上邀請連結」。
見 `js/install.js`、`js/views/join.js`、`js/views/home.js`。

### 走不通的路：每張邀請一份動態 manifest

用 CDP `Page.getAppManifest` 實測過：

| 做法 | 結果 |
| --- | --- |
| 執行期換 `<link rel="manifest">` 到**同源**網址 | ✅ Chrome 會重新讀，`start_url` 真的變了 |
| 換成 `blob:` | ❌ CSP 擋掉 |
| 換成 `data:` | ❌ CSP 擋掉 |

Chrome 的訊息：`Refused to load manifest … violates "default-src 'self'".
Note that 'manifest-src' was not explicitly set, so 'default-src' is used as a
fallback.` 而 GitHub Pages 是靜態的，產不出每張邀請專屬的同源 manifest；
放到 Worker 也不行（manifest 的 `scope`/`start_url` 必須與 manifest 同源）。

---

## 2. LINE 的 `openExternalBrowser=1`

**狀態：實機確認有效（2026-09-06，使用者的手機：從 LINE 點連結直接用 Safari 開啟）**
**但不是官方文件裡的 API。**

在網址加上 `openExternalBrowser=1`，LINE 會用系統預設瀏覽器開啟
（iOS → Safari、Android → Chrome），而不是它自己的內建瀏覽器。

**為什麼重要**：LINE 的內建瀏覽器**不能把 App 加到主畫面**，而台灣的長輩
十之八九是從 LINE 點連結的。有這個參數就根本不用教他「怎麼跳出 LINE」。

### 查證來源

| 來源 | 內容 |
| --- | --- |
| LINE 自家網站在用 | `help.line.me/line/ios/pc?lang=en&openExternalBrowser=1`、`manager.line.biz/u/a/ra/coupon/create?openExternalBrowser=true` |
| Classmethod DevelopersIO | iOS 與 Android 兩邊實測過 |
| SocialPlus / KARTE / Poster 等 LINE 工具商 | 都有教學 |
| **LINE Developers 官方文件** | **找不到**（翻過 LINE MINI App external-browser、URL scheme、LINE for Business FAQ） |

### 已知限制

- **LIFF URL 上無效**（我們不是 LIFF app，不受影響）
- **Facebook / Instagram / Messenger 沒有等效參數**
- 沒有官方保證 → **可能隨時失效**

### 實作要點

參數必須是**真正的查詢字串（在 `#` 之前）**，邀請碼在 fragment 裡，順序不能反：

```
https://yolin0513.github.io/tripquest/?openExternalBrowser=1#/join?j=<邀請碼>
                                       └─ 查詢字串 ─┘        └─ fragment ─┘
```

`shareURL()` 曾經用 `location.href.split('#')[0]` 當網址前綴 —— 那會把現有的
query 一起帶進去，在已帶參數的頁面再分享一次就會疊。改成 `inviteBase()`
重建網址（見 `js/share.js`）。

### 失效時的降級（實測過，全部成立）

| 情境 | 行為 |
| --- | --- |
| 還在 LINE 內建瀏覽器（參數失效或沒帶） | 跳「先用 Safari 打開」教學；「直接加入」仍可走 |
| 已經跳到 Safari | **不再出現任何 LINE 相關內容**；改跳「把 TripQuest 加到主畫面」（那是另一件必要的事，見第 1 節） |
| 已經是主畫面 App | 完全不跳教學 |
| 任何情況 | 「直接加入」那條路一直都在，不會把人卡住 |

---

## 3. 不要在文案裡寫死第三方 App 的介面位置

**狀態：使用者實機打臉一次** · 2026-09-06

我們寫「LINE 右上角的三個點」，使用者手機上是**右下角**。第三方 App 的介面
會隨版本、機型、系統設定改變 —— 寫死位置只會讓人在錯的地方找。

**規則**：描述按鈕**長什麼樣子**與**功能叫什麼名字**，不要講位置；
同一個功能的不同措辭也要一起列（「用 Safari 開啟」／「用其他瀏覽器開啟」／
「在瀏覽器中開啟」）；每一份教學結尾都要有退路：

> 找不到也沒關係 —— 請家人幫忙用 Safari 開一次就好。

`scripts/installtest.mjs` 有一節是**常設防線**：三個平台的教學文字都不可以
出現「右上角／左上角／右下角／左下角／最上面／最下面／正中央／網址列右邊／
下半部」，而且都要有「找不到也沒關係」與「請家人幫忙」。

例外：講**我們自己的 UI** 且位置由我們的 CSS 決定時可以講位置
（例如設定頁提到「右下角紅色 🆘 按鈕」——那顆是 `position:fixed` 的浮動鈕）。

---

## 4. 內建瀏覽器與 iOS 上的第三方瀏覽器都不能加到主畫面

**狀態：確認** · 2026-09-06

- LINE / Facebook / Instagram / 微信的內建瀏覽器：不能
- **iPhone 上的 Chrome / Firefox / Edge：也不能**（只有 Safari 可以）

**判斷的坑**：iOS 版 Chrome 的 UA 裡**也有 `Safari/604.1`**，不能只用那個
字串判斷是不是 Safari。要看 `CriOS`（Chrome）、`FxiOS`（Firefox）、
`EdgiOS`（Edge）。iPadOS 13+ 的 Safari 會自稱 `Macintosh`，要靠
`navigator.maxTouchPoints > 1` 認出來。見 `js/install.js` 的 `platform()`。

---

## 5. GitHub Pages 的快取

**狀態：確認** · 之前的版本踩過

所有檔案都送 `Cache-Control: max-age=600`。Service Worker 在 install 時
`addAll` 會走瀏覽器的 HTTP 快取 —— 新版 SW 有機會把**舊的 JS** 預存進新快取，
使用者重開之後跑的還是舊程式。解法：`new Request(u, { cache: 'reload' })`。
見 `sw.js`。

---

## 6. Cloudflare D1 的綁定參數上限

**狀態：確認（二分搜尋實測，卡在 100）** · 之前的版本踩過

每條查詢的綁定參數上限約 **100**（比 SQLite 本身的 999 嚴格很多，而且文件
不顯眼）。超過時 Worker 被平台直接中止，回 Cloudflare 自己的 HTML 錯誤頁、
沒有 CORS 標頭 —— 瀏覽器端看到的是語意完全對不上的「CORS blocked」。

**規則**：D1 相關的批次操作（`.batch()` 陳述式數、單條 `IN (...)` 的參數數，
別忘了算上 `groupId` 這種額外參數）一律抓在 **≤99**。

## 7. 單檔 HTML 相簿：40 張就 46.6MB，手機打不開

使用者第一趟旅程結束後回報「匯出的 HTML 相簿頁在手機開啟後沒有內容，存到電腦可以正常顯示」。

量了才知道：把照片 base64 內嵌進單一 HTML，一張 1600px 的照片約 300–500KB，
高熵的實測是每張 1.2MB —— **40 張 46.6MB**，一百多張就是 60–200MB 的一個檔案。
電腦打得開；手機要把整份原始碼讀進記憶體、屬性字串又是 UTF-16 再翻一倍，常常撐不住。
無頭 Chrome（桌機記憶體）重現不出手機那個失敗，這點要誠實：我們只有大小這個硬數字。

### 做法（v1.45）

1. **分享網址（主要路徑）**：照片本來就在 R2（同步用的全圖），Worker 多開一個公開讀取端點
   `GET /a/<albumId>` 與 `GET /a/<albumId>/p/<hash>`。照片走 HTTP 一張一張載，檔案大小不再是問題。
   - albumId 是 128-bit 亂數，網址本身就是憑證（跟邀請連結同一套想法）
   - 只給清單裡的 hash，知道 groupId 也撈不走整個群組
   - 相簿頁是 App 上傳的 HTML → 回應**一定**送 `script-src 'none'` 的 CSP，不然這是自家網域上的儲存型 XSS
   - 「收回連結」刪掉 R2 上的清單與頁面，網址立刻 404
2. **單檔 HTML 保留為離線備援**：內嵌前先縮到長邊 1280、JPEG 0.78（大小約四成），超過 24MB 明講並建議改用網址。

## 8. 「無壓縮匯出」對既有照片做不到

`photos.js` 的匯入流程一律縮到長邊 1600px（WebP 0.80 / JPEG 0.82）後**只存壓縮後那一份**，
原始檔從來沒有被留下來。實測：4.8MB 的原檔存下來是 0.9MB（5.4 倍）。

所以 v1.45 的做法是：
- 匯出（`photoexport.js`）用 store 模式的 ZIP（不再壓一次），檔名帶第幾天／景點／拍的人／時間，
  附 `說明.txt` 逐張標「來源：1600px 或原檔」。每包最多 60 張或 250MB，手機才接得住。
- 新增「設定 → 照片品質 → 連原始檔一起留著」（預設關）。**只對打開之後拍的照片有效**。
  原檔只留在這台裝置：不進 outbox（不上雲）、不進備份檔、`gcBlobs` 不會清它。

## 9. 回憶影片：三個實測後才知道的重點

- **交界不可以重新淡入**：上一段最後 0.85 秒已經把下一張疊到全不透明，下一段再從 0 淡入一次
  就是使用者說的「再閃一下」。實測中央亮度 t=8.8 → 122，t=8.9 → 43。
- **不可以把整趟照片一次解碼**：一張 1600×1067 解碼後 6.5MB RGBA，170 張（10 分鐘片長）＞1GB。
  手機錄到後段被記憶體壓垮，結尾（地圖、片尾）就被截掉 —— 這是「路線回顧只出現不到一秒」最合理的解釋。
  現在只留 4 張的滑動視窗。
- **9:16 不可以無腦 cover**：4:3 橫幅 cover 進 9:16 只剩 42% 畫面。長寬比差太多就完整放進畫面、
  背景用同一張糊化填滿（小畫布放大，不用 `ctx.filter`，各家瀏覽器行為一致）。
