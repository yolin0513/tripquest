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
