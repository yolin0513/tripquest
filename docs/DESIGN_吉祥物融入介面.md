# 吉祥物融入介面：規劃（2026-11-18，只規劃、不寫程式）

**來由**：Yolin 經 Dispatch 問：

> 目前介面融入吉祥物的部分都做好了嗎？像是主頁或是各頁面請都適當加上吉祥物的動作，圖片可以給我提示詞轉給 GPT 產出。我需要的是融入介面，不是站在那邊，最好可以配合 UIUX 有反應做動作。請規劃後再實作。

Dispatch 要六樣：盤點現況、逐頁提案、圖從哪來（含 GPT 提示詞與點陣／向量評估）、動畫規矩、分版計畫、示意圖。
**這份交 Dispatch 轉 Yolin 看過才實作。**

**同日修訂**（交出前自己複查出來的）：H1 不是「幾乎不變」，出發那一句出現的那天會變高約 44px（不論晴雨）；「一個畫面一張」改成只管新加的，不拿掉已上線的組合；T2（按下拍照的反應）看不到，建議不做；T1 改成只有自己完成的才滑；第 8 節寫明測試支數的前提；提示詞逐字對過原文。示意圖與提示詞改用 04～06，01～03 作廢。

**Yolin 2026-11-18 答覆之後**：第 9 節八件的答覆記在第 9 節開頭；6.4 加上「保留 GPT 的融入感、第二版第一張先給他看」；底部分頁五格要做、另案排，規劃寫在 3.12、提示詞在 6.6（交件 07、小樣 08）；第 5 節的表加一欄；第 8 節加「第一版實作時的更動」。

---

## 0. 結論

**還沒有全做好：已經融入的 5 處，還站在那邊的 7 處。**

- 已經融入的有 **5 處**：
  - 完成任務：照片上緣探頭；
  - 天氣頁：出門提醒卡；
  - 主頁：「旅程結束了／任務全部完成了」那張卡；
  - 主頁：天氣那一句；
  - 任務列：拍照／相簿兩顆圖示。
- 還是「站在那邊」的有 **7 處**：頁首、空白頁、載入中、解鎖徽章、最終回顧、設定、主頁出發／結束那一句。
- **完全沒有吉祥物的頁面**：任務頁（拍照圖示以外）、行程分頁、照片、分帳、建立行程、加入失敗、多數空白狀態。

**建議分兩版做：**

- **第一版只用現有的向量圖**，不必等新圖：
  - 主頁出發那一句改成探頭（這一句會變高約 44px，推論）；
  - 任務頁：進度條前端放湯圓的圓形頭像，完成任務回來時滑到新進度；
  - 行程｜回顧分段鈕；
  - 照片空白頁；
  - 解鎖徽章。
- **第二版**：Yolin 用 GPT 生一張九宮格當參考，我照著畫成向量。這一版做：
  - 我的旅程空白、建立行程、主頁下一站卡；
  - 分帳、設定、最終回顧；
  - 錯誤狀態。
- **底部分頁列五格**是另案（Yolin 2026-11-18：要做、另案排；3.12、6.6）。

**圖的建議**：GPT 圖只當參考、照著畫成向量，不直接把點陣圖放進 App。理由在第 6 節，主要兩條：

- 探頭圖要拆上下兩層、手扣在卡片邊上、深色要有白邊、零件要能動，GPT 的點陣圖做不到。
- 新增點陣圖要改 `sw.js` 的快取清單，每版的測試會從 58～59 支放大成全套 97 支（乾跑實測，前提見第 8 節）。

---

## 1. 現況盤點（讀程式，2026-11-18 的 HEAD `81b8c7a`）

### 1.1 已經融入的（5 處）

| # | 位置 | 哪一隻 | 怎麼融入 | 什麼時候動 | 程式 |
|---|---|---|---|---|---|
| 1 | 完成任務的慶祝畫面（有照片） | 小鳳；美食換捧麵、夜市換北北烤串、自然換北北戴帽、打卡換鬍鬍相機 | 從照片上緣探頭，手扣在照片邊上，旁邊有對話框 | 完成那一刻跳上來，再做各自的動作（揮翅、晃串、閃光…） | `js/addphoto.js:72-78`、`js/ui.js:261` |
| 2 | 天氣頁：出門提醒卡 | 下雨是鬍鬍撐傘、下雪是湯圓踩雪板 | 從卡片上緣探頭 | 進頁時慢慢探上來，傘晃、雪板滑 | `js/views/weather.js:92-94` |
| 3 | 主頁：「旅程結束了」「任務全部完成了」那張卡 | 小鳳打領結 | 從卡片右上緣探頭 | 只有導覽進主頁時探上來、揮翅；主頁自己重畫時不動 | `js/views/trip.js:583-590` |
| 4 | 主頁：天氣那一句 | 鬍鬍撐傘／湯圓雪板 | 探頭在對話框上緣 | 同上 | `js/views/trip.js:882-887` |
| 5 | 任務列：拍照、從相簿選 | 鬍鬍扶相機、棉棉的耳朵從相片後面冒出來 | 功能的形狀當主體，吉祥物從邊上探出來 | 不動 | `js/glyphs.js` 的 `photoIcon`、`js/addphoto.js:114-132` |

### 1.2 還是站在那邊的（7 處）

| # | 位置 | 哪一隻 | 現在的樣子 | 程式 |
|---|---|---|---|---|
| 1 | 頁首標題左邊 | 鬍鬍的頭 | 靜態 | `js/app.js:67` |
| 2 | 我的旅程：還沒有旅程 | 棉棉 | 站在字上面揮手 | `js/views/home.js:49` |
| 3 | 載入中（讀邀請、整理回顧、查天氣） | 阿灰 | 站在轉圈上面，左右看（一直重複） | `js/ui.js:181` |
| 4 | 解鎖新徽章（慶祝畫面沒有照片） | 小鳳 | 站在標題上面彈跳 | `js/ui.js:266` |
| 5 | 最終回顧 | 北北 | 站在標題上面跳出來 | `js/views/recap.js:37` |
| 6 | 設定：「關於」卡 | 湯圓 | 靜態，站在卡片裡 | `js/views/settings.js:198` |
| 7 | 主頁：出發當天那一句、旅程結束那一句 | 鬍鬍、北北 | 站在對話框左邊（56px） | `js/views/trip.js:595-596`、`js/says.js:72` |

### 1.3 完全沒有吉祥物的

- **任務頁**：只有拍照圖示（上表第 5 項）。這幾處都沒有：
  - 進度那一行；
  - 日期列（有紙飛機，不是吉祥物）；
  - 各站的列。
- **任務詳情**（`js/views/quest.js`）。
- **行程分頁**（`trip.js` 的 `itinerary`）：
  - 「行程｜回顧」分段鈕；
  - 每天的行程；
  - 回顧那一格的入口卡。
- **照片分頁**（`js/views/people.js`）：包括空白的「快去拍第一張！」。
- **分帳**（`js/views/expenses.js`）：空白頁現在是 💰 表情符號。
- **建立行程**（`js/views/create.js`）。
- **加入**：連結解析失敗（`js/views/join.js:36`）、短連結的三種失敗訊息（`join.js:193-201`）。
- **其他空白狀態**：主頁與任務頁的「這個旅程還沒有景點」，找不到旅程、搜尋沒有結果等等。
- **底部分頁列**：五格都是表情符號。
- **toast**：一行字。

### 1.4 「下拉重新整理」

**App 沒有這個功能。**

- 在 `js/`、`css/` 搜過這幾個樣式，都沒有找到：`touchstart`、`pull-to`、`pullRefresh`、`overscroll`、`下拉`。
  - `js/ui.js:97` 的 `touchstart` 是別的用途。
  - 「下拉」命中的都是下拉選單。
- `css/style.css:131` 還寫了 `overscroll-behavior-y: none`，把瀏覽器自己的下拉也關掉了。
- **提案：不做。** 要加下拉重新整理是另一個功能，不在這次範圍。

---

## 2. 提案受這些既有決定限制

1. **任務頁不准變高。** 2026-11-13 Yolin 看了截圖，拿掉任務頁天氣條的探頭圖。他的話：「內容太多的話會讓任務那些資訊跑到下面」。所以任務頁只能用既有的空間：進度那一行、按鈕裡面。
2. **底部分頁要換就五格一起換**（2026-11-13）。只換一格會不一致，所以列成另案（第 3.12 節）。
3. **只在使用者觸發時動**，沿用主頁那張卡的做法：
   - 導覽進來那一次（`fresh`）才動；
   - 背景重畫（同步回來、AI 文案回來）停在靜止圖，不重播。
4. **不靠猜。**
   - 反應只綁兩種東西：明確的使用者動作（按下、存檔、完成任務），或可信的資料（完成數、天氣預報）。
   - 挑哪一張圖也照這條：例如完成任務的類別圖只認景點庫複核過的類別。
5. **融入，不是插圖**（2026-11-13 Yolin）。每一個位置先回答「牠跟哪個元件結合」：從按鈕或卡片邊緣探頭、坐在卡上、拿著畫面上的東西。**找不到能結合的元件就不放**，不放一張插圖湊數。
6. **六隻平等、次數差不多**（`js/glyphs.js` 的 `MASCOT_SPOT` 上面的註解）。

**我另外建議的一條規矩（第 9 節第 2 題請 Yolin 定）：新加的探頭圖，只在畫面上沒有別張探頭圖時出現。**

- **已經上線的組合不動。** 讀程式確認過：主頁的「任務全部完成了」卡（小鳳）跟下雨／下雪那一句（鬍鬍撐傘／湯圓雪板）現在**可以同時出現**，導覽進主頁時兩隻同時探上來、各自動（`js/views/trip.js:583-590` 與 `:639-642`、`:882-887`）。這條規矩不去拿掉它。
  - H1（出發那一句改探頭）算同一個組合：出發那一句出現時天氣那一句不出現（`trip.js:642` 的 `say: !sayDepart && !sayEnd`），所以不會變三張。
- **只管第二版新加的 H3（下一站卡）、H4（倒數卡）**：畫面上已經有完成卡或對話框的探頭圖時，H3、H4 不出現，卡片照現在的樣子。
- **要不要連既有組合也收成一張**，是第 9 節第 2 題。收的話要再定：被擠掉的那一句是退回「站在左邊」，還是整句不出現。

---

## 3. 逐頁提案

**欄位說明：**

- **新圖**：第二版要等 GPT 參考圖、再畫成向量的。
- **現有**：用現在 App 裡的向量圖。
- **多佔高度**：卡片上面要多留的空間，等於探頭圖露出來的那一段。例如現有的打卡那張（鬍鬍相機），縮放 0.3 時露出 51.6px（`peekGeom('cam').rise` 172 × 0.3；暫存區腳本從 `js/peeks.js` 算出來的）。

### 3.1 主頁

| | 融入在哪 | 連動的使用者動作 | 反應 | 圖 |
|---|---|---|---|---|
| H1 | 出發當天那一句：鬍鬍不再站在對話框左邊，改成從對話框上緣探頭（天氣那一句已經是這種做法，`sayRow` 有 `peek` 參數） | 導覽進主頁 | 探上來，相機閃一下（現有的 `cheer` cam） | 現有 cam |
| H2 | 旅程結束那一句：改由「旅程結束了」卡上的小鳳講，對話框接在牠旁邊（跟完成任務的慶祝畫面同一種做法）；北北不再站在那裡 | 導覽進主頁 | 跟著卡上的小鳳一起出現（已經會探上來、揮翅） | 現有 done |
| H3 | 下一站卡：阿灰趴在卡片右上緣，拿望遠鏡往前看 | 導覽進主頁；「現在這一站」換了（拍完上一站自動往下走，或手動改）之後回到主頁 | 探上來；站換了的那一次，舉望遠鏡轉向一次 | 新圖 |
| H4 | 出發倒數卡：湯圓坐在卡片上緣，尾巴垂在卡片前面 | 導覽進主頁 | 探上來一次 | 新圖 |

- 多佔高度：
  - **H1 這一句會變高約 44px（推論，從 CSS 算，沒有在畫面上量）。** 站在左邊時，那一行高＝max(左邊那一隻 56px, 對話框＋下緣 12px)，鬍鬍跟對話框並排；改成探頭，對話框上面要先留出牠露出來的 56px（`css/style.css:279` 的 `margin: var(--pk-rise) 0 0`，露出高度照 `WHO_PX`），再接對話框——並排變成上下疊。對話框不論一行或兩行，算出來都是多 56－12＝44px。**出發那一句出現的那天（第 1 天、那一句沒被關掉），不論晴雨都變高約 44px**：那一句出現時天氣那一句不出現（`trip.js:642` 的 `say: !sayDepart && !sayEnd`），所以下雨的出發日現在也是鬍鬍站在左邊。其他日子沒有這一句，不受影響。
  - **H2：未估。** 拿掉北北那一行（現在高＝max(56, 對話框＋12)），對話框改接在卡上的小鳳旁邊；接法還沒設計到像素，高度會增還是減要畫出來才知道。
  - H3、H4 各多一張卡上方的空間，縮放 0.25～0.3 時約 40～50px（推論，新圖畫出來才量得到）。
  - 照第 2 節的規矩，H3、H4 只在畫面上沒有別張探頭圖時出現。
- **不做**：今晚住、待買、照片列、這趟的數字、小工具列——都是資訊或入口，不再加。

### 3.2 任務頁（不准變高）

| | 融入在哪 | 連動的使用者動作 | 反應 | 圖 |
|---|---|---|---|---|
| T1 | 進度那一行：進度條的前端放湯圓的圓形頭像（直徑約 26px，圓框裡是臉和毛帽） | 完成任務、慶祝畫面關掉、回到任務頁 | 頭像從舊的進度滑到新的進度（`translateX`，約 0.5 秒）；全部完成時到終點、蹦一下 | 現有（從湯圓的全身圖裁臉和帽子，裝進圓框） |
| T2 | ~~任務列的拍照／相簿兩顆圖示：按下時相機閃一下、耳朵抖一下~~ **建議不做** | 按下 | 理由見下面 | — |
| T3 | 「這個旅程還沒有景點」：阿灰探頭在「＋去安排景點」按鈕上緣 | 導覽進來 | 探上來 | 新圖 |

- **T1 為什麼是圓形頭像、不是直接裁頭**：湯圓是蛋形的身體，頭跟身體沒有分界。畫示意圖時先試了直接裁，放大看底部是一條直的切口，兩角露出翅膀的粉紅，兩側還有動作線的殘點，像一隻被切斷的鳥。改成圓框，邊緣是有框線的圓，看起來是刻意設計的進度拇指。
- **T1 不加高的前提**：
  - 進度那一行高度由字決定，約 26px；進度條本身只有 12px 高。
  - 頭像不超過字高，就不會撐高那一行。**這要實測**，量那一行改前改後的高度一樣；量不到一樣就不做。
- **T1 什麼時候滑、什麼時候不滑**（讀 `js/addphoto.js` 的時序）：
  - 完成任務時，慶祝畫面關掉之後才呼叫 `onDone`、任務頁重畫。所以在**完成那一刻記一個旗標**（sessionStorage），**只有 `onDone` 觸發的那一次重畫才讀旗標**、讀掉，從舊進度滑到新進度。
  - 不能寫成「任務頁任何一次重畫都讀旗標」：慶祝畫面還開著時，旅伴同步進來會讓底下的任務頁先重畫一次，旗標會被那一次吃掉，關掉慶祝畫面後反而不滑。
  - 旅伴那邊同步進來的完成，也會讓任務頁重畫、進度變了，但**沒有旗標，頭像直接停在新位置、不滑**。這跟第 2 節「背景重畫不動」一致：只有自己按的完成才有反應。
  - 舊進度：上一次畫的比例記在 sessionStorage；第一次進來沒有舊值，不動。
- **T2 為什麼建議不做**（讀程式＋推論）：按下拍照那顆，`onclick` 裡**同步**呼叫 `camInput.click()`，手機會立刻切到系統相機，App 的畫面被蓋掉（`js/addphoto.js:112`；相簿那顆是 `:116` 的 `libInput.click()`）。圖示上的閃光就算做了，使用者多半看不到（推論，沒有在手機上實測）。相簿那顆同理，會立刻打開系統的相簿。為了一個看不到的反應多一段動畫和斷言，不划算。按下之後真正看得到的反應，是完成時的慶祝畫面（已經有）。
- **T1 的一個現況**：進度條的填色現在用 `transition: width 0.5s`（`css/style.css:519`），不是 transform。湯圓的頭另外用 `translateX` 定位，填色那一條不在這次範圍。
- **不做**：各站的列、日期列、全部展開／收合。這頁資訊密集，再加就是擠。

### 3.3 行程分頁

| | 融入在哪 | 連動的使用者動作 | 反應 | 圖 |
|---|---|---|---|---|
| I1 | 「行程｜回顧」分段鈕：選中那一格的字前面放一個頭。「行程」那格是阿灰，「回顧」那格是北北 | 切換分段 | 新選中那一格的頭從字後面冒出來（translateY＋opacity，約 0.25 秒） | 現有（從全身圖裁頭） |

- 多佔高度 0：分段鈕高 `--tap`（56px），頭放在原本的內距裡。
- **要驗**：按鈕不變小；320px 寬時字不換行。
- **不做**：每天的行程、地圖、站卡（資訊）；日期列已經有紙飛機。

### 3.4 照片分頁

| | 融入在哪 | 連動的使用者動作 | 反應 | 圖 |
|---|---|---|---|---|
| P1 | 「快去拍第一張！」：鬍鬍拿相機探頭在「回任務清單」按鈕上緣 | 導覽進來 | 探上來，相機閃一下 | 現有 cam |

- **不做**：
  - 照片牆有照片的時候：照片是主角。
  - 「這個條件下沒有照片」：同一頁換篩選就會出現、消失，動起來太頻繁。

### 3.5 分帳

| | 融入在哪 | 連動的使用者動作 | 反應 | 圖 |
|---|---|---|---|---|
| S1 | 還沒有花費：拿掉 💰 表情符號，棉棉抱著小錢包探頭在「＋記第一筆」按鈕上緣 | 導覽進來 | 探上來 | 新圖 |
| S2 | 有花費：總覽卡右上緣，同一張棉棉 | 記一筆、按存檔之後回到這頁（`toast('已記錄')` 那一次，`expenses.js:294`） | 一枚硬幣丟進錢包（硬幣 translateY＋opacity），一次 | 新圖 |
| S3 | 還沒有旅伴：棉棉探頭在「去旅程設定加旅伴」按鈕上緣 | 導覽進來 | 探上來 | 新圖（揮手那張） |

- **S1 不會變高**：拿掉的表情符號約 56px 高；`.empty` 原本就有下方留白 44px（`css/style.css:468`），夠探頭圖用。這要實測。
- **S2**：只在剛存檔的那一次動。存檔時記一個旗標，下一次畫的時候讀掉；其餘重畫不動。總覽卡上方會多一段（推論約 40px）。
- **不做**：「目前大家打平」（已經有 🎉）、結清方案、每個人那幾列（資訊）。

### 3.6 設定

| | 融入在哪 | 連動的使用者動作 | 反應 | 圖 |
|---|---|---|---|---|
| G1 | 「關於」卡：湯圓不再站在卡片裡，改坐在卡片上緣（同 H4 那張） | 切換主題（和紙／深色）那一刻 | 跳一下（深色的白邊本來就跟著主題換） | 新圖 |

- **進設定頁不動**：設定頁不需要打招呼。
- **開「減少動態效果」**：所有吉祥物立刻停住。這正好示範那個開關有效。

### 3.7 建立行程

| | 融入在哪 | 連動的使用者動作 | 反應 | 圖 |
|---|---|---|---|---|
| C1 | 「產生拍照任務」大按鈕：阿灰拿望遠鏡探頭在按鈕上緣（同 H3 那張） | 按下，按鈕變「產生中…」 | 左右看（跟載入中同一個動作；只有等待時重複） | 新圖 |
| C2 | 同上 | 名稱沒填就按，被擋下（`toast('先幫這趟旅程取個名字')`，`create.js:256`） | 搖頭一次（rotate） | 新圖 |
| C3 | 同上 | 產生失敗（`create.js:323`） | 停下，回到靜止圖 | 新圖 |

- 成功就直接換頁，不另外做反應。
- **「輸入時」不做**：每打一個字動一次會吵，而且吉祥物在欄位旁邊動，會擋到正在打的字。改成 C2：沒填就按、被擋下的那一刻搖頭一次。
- 多佔高度：表單最下面多一段（推論約 40px）。表單本來就要捲動，不影響第一畫面。

### 3.8 回顧

| | 融入在哪 | 連動的使用者動作 | 反應 | 圖 |
|---|---|---|---|---|
| R1 | 最終回顧（`recap.js`）：北北不再站在標題上，改趴在第一張數字卡的上緣，雙手舉一塊空白小牌子 | 整理完、轉圈換成內容的那一刻 | 跳上來一次 | 新圖 |

- **待核**：第一張數字卡是哪一個元素，我還沒讀 `recap.js` 的版面。實作前先讀。
- **不做**：
  - 回顧入口的三張卡（`memories.js` 的 `bigCard`）：是入口，按下就換頁。
  - 「大家的表現」：資訊。
  - 鎖住的卡：🔒 是資訊，吉祥物不取代它。

### 3.9 慶祝畫面

| | 融入在哪 | 連動的使用者動作 | 反應 | 圖 |
|---|---|---|---|---|
| B1 | 解鎖新徽章（沒有照片）：小鳳不再站在標題上，改從第一顆按鈕上緣探頭 | 解鎖那一刻 | 跳上來、揮翅（現有的 `cheer` done） | 第一版用現有 done；第二版可換抱徽章那張（新圖，備用格） |

完成任務有照片的那一種已經融入，不動。

### 3.10 空白與錯誤狀態

**共用做法**：`.empty` 區塊裡有主要按鈕的，按鈕上緣掛一張探頭圖。**沒有按鈕的不掛**，因為沒有元件可以結合。

| 狀態 | 程式 | 誰、哪一張 | 動 |
|---|---|---|---|
| 我的旅程：還沒有旅程 | `home.js:47-49` | 棉棉揮手探頭（取代現在站著那一隻） | 導覽進來時探上來、揮手 |
| 這個旅程還沒有景點（主頁、任務頁） | `trip.js:563`、`trip.js:124` | 阿灰望遠鏡 | 探上來 |
| 照片空白 | `people.js:160` | 鬍鬍相機（P1） | 探上來 |
| 分帳空白、沒有旅伴 | `expenses.js:38、52` | 棉棉（S1、S3） | 探上來 |
| 邀請連結無法解析 | `join.js:36` | 湯圓歪頭 | **不動** |
| 找不到這個旅程（待買、航班…） | `buy.js:14` 等 | 不掛（沒有按鈕） | — |
| 搜尋沒有結果（找景點、找附近） | `findspot.js`、`nearby.js` | 不掛（結果區一直在變） | — |
| 短連結讀不到（三種訊息） | `join.js:193-201` | 不掛（是預覽區的一行字，不擋加入） | — |

- **錯誤一律靜止。** 使用者正煩的時候，吉祥物動起來像在笑他。
- **toast 不加。** toast 是一行字，放一隻在旁邊就是「站在文字旁邊」。

### 3.11 維持現狀的

**載入中（阿灰左右看）不改：**

- 等待畫面中間本來就空，沒有元件可以結合；
- 而且這是唯一允許重複的動作。
- 建立行程的「產生中…」改用同一個動作（C1），不另外做。

**頁首鬍鬍的頭不動：**

- 每一頁都有頁首，動了就是每換一頁動一次，太搶眼。
- 另外，頁首在 `js/app.js`；改它會讓測試放大成全套 97 支，見第 8 節。

### 3.12 另案：底部分頁列

- 要換就五格一起換：每格一隻抱著那一格的東西。這是 2026-11-13 的決定。
- 切分頁時，新選中那一格的那隻跳一下。
- **成本**：
  - `renderTabs` 每次換頁都整列重畫（`js/app.js:117-148`），進子頁面也會重畫。要另外記「上一次選中哪一格」，才分得出真的切了分頁。
  - 改 `js/app.js` 會讓測試放大成全套。
  - 五格要五張新的小圖。
- **Yolin 2026-11-18：要做，另案排。** 要求：小尺寸、深淺兩個主題、選中與未選中都看得清楚。

**五格各用哪隻、什麼姿勢**（新圖的提示詞在 6.6）：

| 分頁 | 誰 | 姿勢（胸像，道具舉在胸前） | 為什麼是牠 |
|---|---|---|---|
| 主頁 | 湯圓 | 一隻翅膀在臉旁揮手 | 第二版主頁的倒數卡也是湯圓；第一版進度條的圓形頭像也是牠 |
| 任務 | 小鳳 | 雙翅捧一張空白小卡（一角折起） | 完成任務那一隻 |
| 行程 | 阿灰 | 雙翅把淺藍小望遠鏡舉到眼前 | 第一版「行程｜回顧」切換鈕的「行程」、載入中都是牠 |
| 照片 | 鬍鬍 | 雙手捧一台小相機（一個大圓鏡頭） | 照片空白頁、拍照圖示、相機那張探頭圖都是牠 |
| 分帳 | 棉棉 | 雙手把一枚黃色硬幣抱在胸前 | 第二版分帳卡也是棉棉 |

- **北北不上**：五格只有五個位置，北北已經有「回顧」那格的頭、最終回顧、夜市與自然的完成圖。
- 「我的旅程」「設定」那一層的分頁（`renderTabs` 的另一組）不在這次的範圍，維持表情符號。
- **畫法**（照 v1.95.0 進度條、切換鈕的圓形頭像，同一種寫法）：
  - 淺色圓底（`#fffcf6`）＋一圈線，兩個主題都是同一個淺色圓；
  - 未選中：26px、細線（`--line`）；
  - 選中：30px（現在的表情符號是 25px）、圈換主色（`--primary-text`）、後面一塊淡色底、往上 2px、字變主色；
  - 切到那一格時那隻跳一下，只動 transform，減少動態效果時不動；背景重畫不跳（要記上一次選中哪一格）；
  - 分頁列高度 76px 不變。
- **對比**（暫存區腳本算的，WCAG 相對亮度，含對照組；分頁列底色照 `--bg` 本身算，CSS 實際是 `--bg` 94%＋模糊）：

  | | 和紙 | 深色 |
  |---|---|---|
  | 字，未選中（`--muted`） | 7.14 | 11.43 |
  | 字，選中（`--primary-text`） | 6.80 | 7.26 |
  | 圓底對分頁列底 | 1.00（同色，靠那一圈線） | 17.80 |
  | 未選中的圈對分頁列底 | 13.54 | 2.03（圈本身淡，形狀靠圓底） |
  | 選中的圈對分頁列底 | 6.80 | 7.26 |

  - 和紙底上圓形靠墨色圈（13.54）分出來；深色底上靠淺色圓本身（17.80）。兩個都超過圖形 3:1。
  - 選中與未選中不只靠顏色：大一號、有淡色底、往上 2px，色弱也分得出來。
- **小樣**：`TripQuest_吉祥物融入_08_底部分頁小樣.png`，用現有的全身圖裁頭先代替（新姿勢還沒畫），只看大小、對比、選中與未選中分不分得出來。暫存區腳本用 sharp 轉的，沒開瀏覽器，不是 App 截圖。我看過：兩個主題、選中與未選中都分得出來。
- **為什麼不直接用現有的頭**：可以，而且最清楚（小樣就是）。但 2026-11-13 的決定是「每格一隻抱著那一格的東西」，只有頭就看不出是哪一格。所以先請 Yolin 生 07 的參考圖，照著畫成胸像＋大道具；畫出來在 26px 認不出道具的話，退回只用頭，照實回報。

---

## 4. Dispatch 點名的使用者動作，一個一個對

| 動作 | 做什麼 | 在哪一節 |
|---|---|---|
| 按下拍照 | **不加**：按下就同步切到系統相機，圖示上的反應看不到（推論）。看得到的反應是完成後的慶祝畫面（已有） | T2 |
| 完成任務 | 慶祝畫面（已有）；慶祝畫面關掉、回任務頁時湯圓沿進度條滑到新位置（只有自己完成的才滑）；主頁的下一站換了，阿灰轉望遠鏡 | T1、H3 |
| 下拉重新整理 | **不做**：App 沒有這個功能 | 1.4 |
| 切換分頁 | 底部分頁：另案；行程｜回顧分段：頭冒出來 | 3.12、I1 |
| 記一筆帳 | 硬幣丟進錢包 | S2 |
| 輸入時 | **不做**：理由在 3.7；改成「沒填就按、被擋下」搖頭一次 | C2 |
| 載入中 | 阿灰左右看（現有）；建立行程「產生中…」同一個動作 | 3.11、C1 |
| 出錯 | 湯圓歪頭，**靜止** | 3.10 |

---

## 5. 六隻的出場次數

| | 現在 | 提案後 | 加上底部分頁（另案，3.12） |
|---|---|---|---|
| 鬍鬍 | 5：頁首、拍照圖示、下雨、打卡完成、出發那一句 | 6：加照片空白 | 7：加「照片」那格 |
| 棉棉 | 2：相簿圖示、我的旅程空白 | 4：加分帳（空白與總覽同一張）、沒有旅伴 | 5：加「分帳」那格 |
| 北北 | 4：夜市完成、自然完成、最終回顧、結束那一句 | 4：結束那一句交給小鳳，加回顧那格的頭 | 4：不上 |
| 小鳳 | 4：預設完成、美食完成、主頁結束／完成卡、解鎖徽章 | 4：結束那一句併進卡上那一隻，不算新位置 | 5：加「任務」那格 |
| 阿灰 | 1：載入中 | 5：加下一站卡、建立行程、還沒有景點、行程那格的頭 | 6：加「行程」那格 |
| 湯圓 | 2：下雪、設定 | 5：加倒數卡、進度條、錯誤 | 6：加「主頁」那格 |

- 分頁列一直在畫面上，所以那五隻每個畫面都會出現一次；北北是唯一不在分頁列上的。Yolin 想讓北北上，最順的是跟棉棉換「分帳」（07 的第 7 格就是北北抱硬幣，不必重生）。

**要 Yolin 看的**：

- 阿灰從 1 變 5、湯圓從 2 變 5，是為了補平。
- 鬍鬍仍然最多。照片空白也可以改給棉棉，但要多畫一張棉棉拿相片的探頭圖。

---

## 6. 圖從哪來

### 6.1 現有的向量圖就夠的（第一版全部是這種）

- **探頭圖 7 張**（`js/peeks.js` 的 `PEEK`）：rain、snow、done、eat、grill、hat、cam。
  - H1、P1 用 cam；H2、B1 用 done。
- **全身圖 6 隻**（`js/glyphs.js` 的 `ART`）：T1 湯圓的圓形頭像、I1 阿灰與北北的頭，都從全身圖裁。
  - 頁首鬍鬍的頭就是這樣裁的（`HEAD_VB`）。
  - 另外三隻要各自訂一個裁切框。這是新的常數，不是新圖。示意圖裡湯圓用的是 `36 22 128 128`，裝進圓框。
- **拍照圖示 2 顆**（`photoIcon`）：維持現狀（T2 建議不做，理由在 3.2）。

### 6.2 需要新圖的（第二版）

**九宮格 9 格：7 格要用，2 格備用。**

| 格 | 誰 | 姿勢 | 用在 |
|---|---|---|---|
| 1 | 棉棉 | 從邊緣探頭，一手揮、一手扣在邊上 | 我的旅程空白、分帳沒有旅伴 |
| 2 | 阿灰 | 趴在邊緣，雙手拿望遠鏡往右前方看 | 主頁下一站卡、建立行程、還沒有景點 |
| 3 | 棉棉 | 抱著一個奶油黃的小錢包，另一手拿一枚硬幣 | 分帳空白與總覽卡 |
| 4 | 湯圓 | 坐在邊緣上，長尾巴垂在邊緣前面 | 主頁倒數卡、設定「關於」卡 |
| 5 | 北北 | 趴在邊緣，雙手舉一塊空白小牌子 | 最終回顧 |
| 6 | 湯圓 | 從邊緣探頭、歪頭，一隻翅膀搔頭（困惑） | 錯誤狀態 |
| 7 | 阿灰 | 趴在邊緣，一隻翅膀指向右前方 | H3「站換了」那一下的動作參考 |
| 8 | 鬍鬍 | 從邊緣探頭，一手揮、一手扣在邊上 | 備用：出發那一句不想用相機那張時 |
| 9 | 小鳳 | 從邊緣探頭，雙翅抱著一枚無字的星形徽章 | 備用：解鎖徽章（B1） |

### 6.3 GPT 點陣圖直接放進 App，還是照著畫成向量

**先講實測的數字：**

- App 裡已經有點陣圖：
  - 景點類型圖示 9 張 PNG，每張 5.1～8.7 KB、合計約 60 KB（`media/art/a/`，`ls -l` 量的）。
  - 海報頁首圖 1 張 JPG，69.8 KB（`media/art/d/poster-header.jpg`）。
  - 每一張都登記在 `sw.js` 的快取清單裡。
- 現有向量圖的檔案大小：
  - 7 張探頭圖都在 `js/peeks.js`，整支檔 94.4 KB（未壓縮的文字；GitHub Pages 傳送時會壓縮）。
  - 6 隻全身圖在 `js/glyphs.js`，79.4 KB。
- **測試的範圍**（`node scripts/run-affected.mjs --dry --files …` 乾跑實測，2026-11-18）：
  - 新圖畫進 `js/peeks.js`：這支檔本來就在快取清單裡，`sw.js` 只改版號。測試挑 **58/97 支、預估 2235 秒（約 37 分）**（前提見第 8 節）。
  - 新圖是點陣檔：要在 `sw.js` 的快取清單加一行，挑選器判「骨架改了」，放大成 **全套 97 支、預估 3427 秒（約 57 分）**。
  - 改到 `js/app.js`（頁首、底部分頁）也一樣是全套。
- **GPT 畫我們這六隻的紀錄**（`docs/ART_行程海報生圖流程.md` 3.2 節）：
  - 11-16 那兩張圖，六隻錯了四隻；
  - 鬍鬍一再被畫成灰毛（11-16 兩張、11-17 九宮格都是）；
  - 北北多出口袋、湯圓嘴變橘、阿灰的望遠鏡變大變黑。
  - 這些錯誤目前靠重生或改色處理。

**分姿勢講：**

| | 探頭圖（手扣在卡片邊上） | 整隻獨立的姿勢 |
|---|---|---|
| 畫成向量 | 可以：邊線、上下兩層、深色白邊、零件動畫，跟現有 7 張同一套做法，都已上線驗過 | 可以 |
| GPT 點陣直接用 | **做不到現在的品質**。邊線以下的手要蓋在卡片前面，身體要藏在卡片後面——要人工把一張圖切成兩層，GPT 圖沒有分層，邊緣要手描。深色白邊要另外做一張，或用 CSS 的 `drop-shadow`（動畫時較耗效能，推論）。零件不能動，只能整張跳 | 可以放，但只能整張動。而且「整隻站著」正是 Yolin 不要的那種 |

畫風一致的問題（推論，沒有在 App 裡並排實測過）：

- 同一個畫面會同時出現頁首的向量頭、拍照圖示、GPT 點陣圖。
- GPT 的線條粗細、白色的色調、腮紅的畫法每次都不一樣。
- 鬍鬍變灰這種錯，放進 App 就是同一隻在兩個地方長得不一樣。

### 6.4 建議

**GPT 圖只當參考，我照著畫成向量。**

- GPT 擅長的是姿勢與表情的構想，這部分 Yolin 可以參與挑選。
- 畫成向量後：
  - 線條、顏色跟現有六隻一致；
  - 深色白邊、探頭分層、零件動畫照現有做法；
  - 測試範圍不放大；
  - 透明檢查（`arttransparenttest`）用現有的登記制就管得到。
- GPT 畫錯的地方（鬍鬍變灰、多口袋），照著畫時直接用正確的樣子，不必重生到對為止。
- **原創性**：照我們自己六隻的參考圖畫，不碰別的角色。新姿勢照舊寫進 `docs/吉祥物原創性檢查.md`。

**Yolin 2026-11-18 選 A，補一句**：「先讓我看效果，我喜歡 GPT 產出的角色融入感。」所以照著畫的時候：

- 保留 GPT 圖的姿勢與互動：身體的傾斜、手扣在邊上的位置、跟道具的接觸點照參考圖，不要拉直成正面站好的貼紙。
- 改的只有顏色、線條、服裝這些跟參考圖不符的地方（鬍鬍變灰、多口袋這類）。
- **第二版的第一張向量圖畫好，先拍給 Yolin 看，他看過才畫其餘幾張。** 拍的時候並排放 GPT 那一格，讓他比融入感有沒有留住。

**替代方案：直接用點陣。**

- 只適合整隻、不探頭、不動零件的位置。
- 代價：
  - 每版測試多約 20 分（全套）；
  - 要新寫一條測試管點陣圖的透明與白邊；
  - 鬍鬍變灰這類錯要逐張修。
- 我不建議，但如果 Yolin 想看 GPT 的原圖直接放進去的樣子，可以先在一處試。

### 6.5 給 GPT 的提示詞（九宮格，第二版用）

**怎麼生**（照 `docs/ART_行程海報生圖流程.md` 步驟 3）：

1. 開一個新對話。
2. 先上傳兩張參考圖，都在 Dispatch outputs 的 `TripQuest_吉祥物參考圖/`：
   - `00_六隻總表.png`
   - `03_鬍鬍_白色迷你雪納瑞_正面全身.png`
3. 整段貼上下面的提示詞、送出。
4. 比例選正方形 1:1。
5. 用下載鈕存原檔，不要截圖。

**為什麼不能照抄 ART 第 2 節的風格句**：那一句寫了 `No people, no animals`，是給景點圖示用的；這裡要畫的就是動物，所以另寫。

**哪些照抄、哪些是新寫的**（第一版的提示詞沒有逐字對過，這一版對了）：

- 第一段：照抄 Dispatch outputs 的 `TripQuest_吉祥物動作九宮格_提示詞.md` 第 71 行（九宮格版的第一段）。暫存區腳本逐字比對過，相同。
  - 第一版把 `same clean sticker style …` 那一句放錯位置（放在冒號前面），已改回原文的位置。
- 六隻的描述：照抄 `docs/ART_行程海報生圖流程.md` 2.1 節，逐字比對過，相同。
- 九宮格的版面段（`Square image, 1:1 …`）：照抄 2.3 節，逐字相同。
- 「每格一隻」段（`Each cell shows exactly ONE character …`）：照 2.3 節，改了兩處，其餘逐字相同：
  - 舉例的道具 `oars, boats, steam` 換成這次的 `the grey bar`；
  - 句尾填空（2.3 節的〔換：這趟有紫色系的東西〕）寫成 `the lilac scarf and the lilac bow tie stay a soft pale lilac`。
- 灰條那一段、九格的動作、NOT ALLOWED 的填空：新寫的。
- 第一版寫的 `appears only in its own cell` 拿掉了：棉棉、阿灰、湯圓各佔兩格，跟這句矛盾。改用 2.3 節原有的 `Each cell shows exactly ONE character doing ONE action`。

```
Use the two uploaded reference images: a sheet of six original cute characters, and a large picture of one of them (the white dog). Draw the characters exactly as they look in the references: same body shape and proportions, same face, same colors, same outfits and accessories, same clean sticker style with thick, even, dark charcoal outlines and flat solid colors. Do not redesign them, do not change any color, do not add or remove clothes, pockets or accessories, and do not turn them into other characters or realistic animals. They may hold the small props listed below; their bodies, faces, colors and outfits stay exactly as in the reference. Do not copy the names or any other text from the reference sheet.

The six characters, as in the reference:
- 棉棉: a white bunny. Pure white body; two tall ears with pink insides, one standing straight and one bent over at the tip; a tiny pink nose; pink cheeks; a lilac scarf with white dots.
- 北北: a white bear. White body; light grey inner ears; a round beige muzzle with a black nose; pink cheeks; light blue overalls with two yellow buttons. No pockets and no other clothes.
- 鬍鬍: a white miniature schnauzer. His fur is pure white everywhere: head, face, body and paws are all white, never grey. Only his bushy eyebrows are grey. His floppy ears are a very pale warm grey. A big white beard and moustache, pink cheeks, and a coral triangle bandana around his neck.
- 湯圓: a round white long-tailed tit. A white egg-shaped body; a green knit beanie with a yellow pom-pom; a tiny black beak (black, not orange); black wings; a long black tail; pink cheeks; small black feet. No brown anywhere.
- 阿灰: a grey hawk. Grey head and body, a little darker on top of the head; a cream belly with small grey V-shaped marks; yellow feet. A small pair of light blue binoculars hangs on his chest: small and light blue, never big, never black.
- 小鳳: a cockatiel. A yellow head with a tall yellow crest; round orange cheeks; a grey body; a small lilac bow tie; a long grey tail; pink feet.

Square image, 1:1. Exactly 9 separate cells arranged in a 3×3 grid of equal square cells. The entire background is one flat, solid, pure magenta color #FF00FF: no gradient, no texture, no noise, no vignette, no floor, no ground shadow, no scenery. Leave wide, clearly empty magenta gaps between neighboring cells, and an empty magenta margin around the outside of the whole grid. Do not draw grid lines, borders, frames, boxes, labels, captions or any text.

Each cell shows exactly ONE character doing ONE action, centered in its cell, with empty magenta space on every side; nothing crosses into another cell or touches the edge of the picture. The whole drawing in each cell, including tails, ears, crests, the grey bar and every prop, fits inside the middle 75% of its cell, both in width and in height, so that the magenta gaps between neighboring cells stay completely empty from top to bottom and from left to right. Long tails may point sideways, but they also stay inside that middle area. The characters are all about the same size. In each cell the character and its props touch each other and form one connected shape. Do not draw motion lines, sparkles, hearts, music notes, sweat drops, speech bubbles or any other loose marks floating around the character. Do not use magenta, fuchsia or hot pink anywhere in the characters or props; the lilac scarf and the lilac bow tie stay a soft pale lilac.

These are 9 pose studies of the characters peeking over the top edge of an app card. In every cell, draw one plain light warm grey (#ECE6DE) horizontal rounded bar across the lower part of the drawing: this bar is the top edge of a card. The character is behind the bar and touches it: only the part of the body above the bar is visible, and the paws or wings that rest on the bar overlap the front of it. Nothing is drawn below the bar except the paws, wings or tail that hang over its front. Unless a cell says otherwise, the character faces the viewer with a happy, friendly face.

The nine cells, left to right, top row first:
1. 棉棉 peeking over the bar, waving with one paw raised, the other paw resting on the bar.
2. 阿灰 leaning on the bar with both wings, holding his small light blue binoculars up to his eyes and looking to the right.
3. 棉棉 peeking over the bar, hugging a small round butter-yellow coin purse with one arm, holding up one plain round yellow coin in the other paw. The coin and the purse are blank.
4. 湯圓 sitting on top of the bar, his long black tail hanging down in front of the bar.
5. 北北 leaning on the bar, holding up a small blank white board with both paws. The board is completely blank.
6. 湯圓 peeking over the bar, head tilted to one side, scratching his head with one wing, looking puzzled but still cute.
7. 阿灰 leaning on the bar with one wing, the other wing pointing forward to the right.
8. 鬍鬍 peeking over the bar, waving with one paw raised, the other paw resting on the bar.
9. 小鳳 peeking over the bar, holding a plain five-pointed star badge with both wings. The badge is blank, with no marks on it.

NOT ALLOWED ANYWHERE: no text of any kind (no letters, no words, no numbers, no Chinese or Japanese characters, no names, no labels, no signature, no watermark); every board, badge, coin, purse and bar is blank. No characters other than these six; no people, no other animals.
```

- NOT ALLOWED 照 2.3 節的句型，填空填這九格的道具；2.3 節句尾的季節禁止項（例：`No snow.`）拿掉，這張圖是介面用的，跟季節無關。

**看到這些就直接重生**（照 `ART_行程海報生圖流程.md` 3.2 的分法）：

- 有字。
- 多一隻、同一格兩隻、出現六隻以外的角色。
- 底色不是一整片洋紅，切圖程式會整張不能切。
- 某一格認不出是哪一隻。

**可以接受、不用重生**：

- 鬍鬍變灰、北北多口袋、湯圓嘴色不對、阿灰的望遠鏡變大。照著畫向量時用參考圖的正確樣子，這些錯不會進 App。
- 灰條位置歪、灰條太長或太短。
- 姿勢跟描述有一點出入，但看得出在做什麼。
- 尾巴或灰條伸進格子之間的縫：走路線 A（只當參考、我畫成向量）可以接受；走路線 B（點陣直接用）要重生，切圖程式會把那一整列標成壞格（`ART_行程海報生圖流程.md` 2.3 節）。

**收件**：從 Dispatch outputs 複製進 `art-inbox/`，核 sha256；原圖不進 repo。

### 6.6 給 GPT 的提示詞（底部分頁五格，另案用）

另寫一份，不併進 6.5 的九宮格：6.5 是「從卡片上緣探頭」，這張是「胸像＋大道具、縮到指尖大小還認得出來」，兩種構圖寫在同一張裡，GPT 容易混。九格＝五格正選（3.12 的表）＋四格備用。

**怎麼生**：同 6.5（新對話、上傳同樣兩張參考圖、整段貼上、1:1、下載鈕存原檔）。

**哪些照抄、哪些是新寫的**：

- 第一段、六隻的描述、版面段（`Square image, 1:1 …`）：跟 6.5 逐字相同（6.5 又是照九宮格原檔第一段與 `ART_行程海報生圖流程.md` 2.1、2.3 節抄的）。暫存區腳本逐字比對過。
- 「每格一隻」段：照 2.3 節，改兩處，其餘逐字相同：
  - 舉例的道具 `oars, boats, steam` 換成 `the beanie`（湯圓的毛帽，胸像最容易被切掉的就是它）；
  - 句尾填空同 6.5：`the lilac scarf and the lilac bow tie stay a soft pale lilac`。
- 「分頁圖示」那一段、九格的動作、NOT ALLOWED 的填空：新寫的。NOT ALLOWED 照 2.3 節的句型。

```
Use the two uploaded reference images: a sheet of six original cute characters, and a large picture of one of them (the white dog). Draw the characters exactly as they look in the references: same body shape and proportions, same face, same colors, same outfits and accessories, same clean sticker style with thick, even, dark charcoal outlines and flat solid colors. Do not redesign them, do not change any color, do not add or remove clothes, pockets or accessories, and do not turn them into other characters or realistic animals. They may hold the small props listed below; their bodies, faces, colors and outfits stay exactly as in the reference. Do not copy the names or any other text from the reference sheet.

The six characters, as in the reference:
- 棉棉: a white bunny. Pure white body; two tall ears with pink insides, one standing straight and one bent over at the tip; a tiny pink nose; pink cheeks; a lilac scarf with white dots.
- 北北: a white bear. White body; light grey inner ears; a round beige muzzle with a black nose; pink cheeks; light blue overalls with two yellow buttons. No pockets and no other clothes.
- 鬍鬍: a white miniature schnauzer. His fur is pure white everywhere: head, face, body and paws are all white, never grey. Only his bushy eyebrows are grey. His floppy ears are a very pale warm grey. A big white beard and moustache, pink cheeks, and a coral triangle bandana around his neck.
- 湯圓: a round white long-tailed tit. A white egg-shaped body; a green knit beanie with a yellow pom-pom; a tiny black beak (black, not orange); black wings; a long black tail; pink cheeks; small black feet. No brown anywhere.
- 阿灰: a grey hawk. Grey head and body, a little darker on top of the head; a cream belly with small grey V-shaped marks; yellow feet. A small pair of light blue binoculars hangs on his chest: small and light blue, never big, never black.
- 小鳳: a cockatiel. A yellow head with a tall yellow crest; round orange cheeks; a grey body; a small lilac bow tie; a long grey tail; pink feet.

Square image, 1:1. Exactly 9 separate cells arranged in a 3×3 grid of equal square cells. The entire background is one flat, solid, pure magenta color #FF00FF: no gradient, no texture, no noise, no vignette, no floor, no ground shadow, no scenery. Leave wide, clearly empty magenta gaps between neighboring cells, and an empty magenta margin around the outside of the whole grid. Do not draw grid lines, borders, frames, boxes, labels, captions or any text.

Each cell shows exactly ONE character doing ONE action, centered in its cell, with empty magenta space on every side; nothing crosses into another cell or touches the edge of the picture. The whole drawing in each cell, including tails, ears, crests, the beanie and every prop, fits inside the middle 75% of its cell, both in width and in height, so that the magenta gaps between neighboring cells stay completely empty from top to bottom and from left to right. Long tails may point sideways, but they also stay inside that middle area. The characters are all about the same size. In each cell the character and its props touch each other and form one connected shape. Do not draw motion lines, sparkles, hearts, music notes, sweat drops, speech bubbles or any other loose marks floating around the character. Do not use magenta, fuchsia or hot pink anywhere in the characters or props; the lilac scarf and the lilac bow tie stay a soft pale lilac.

These are 9 icon studies for the bottom tab bar of a phone app. Each icon will be shown very small, about the size of a fingertip, so in every cell draw only the character's head and the top of the chest (a bust), large and centered, facing the viewer with a happy, friendly face. When a cell lists a prop, the character holds it up in front of the chest, and the prop is big and simple: at least one third as wide as the head, with a clear outline and very few details, so that it is still easy to recognize when the whole icon is tiny. The head and the prop together fit inside an imaginary circle in the middle of the cell; only the tips of tall ears and crests may reach a little beyond it. Do not draw that circle, and do not draw any badge, frame, button or background shape behind the character.

The nine cells, left to right, top row first:
1. 湯圓 waving one wing beside the face, the other wing tucked in.
2. 小鳳 holding up a small plain white card with one folded corner, with both wings. The card is blank.
3. 阿灰 holding his small light blue binoculars up to his eyes with both wings.
4. 鬍鬍 holding a small simple camera with one big round lens in front of his chest with both paws. The camera is blank.
5. 棉棉 hugging one big plain round yellow coin against the chest with both paws. The coin is blank.
6. 北北 waving one paw beside the face, the other paw tucked in.
7. 北北 holding up one big plain round yellow coin with both paws. The coin is blank.
8. 棉棉 waving one paw beside the face, the other paw tucked in.
9. 小鳳 holding a plain five-pointed star badge with both wings. The badge is blank, with no marks on it.

NOT ALLOWED ANYWHERE: no text of any kind (no letters, no words, no numbers, no Chinese or Japanese characters, no names, no labels, no signature, no watermark); every card, badge, coin and camera is blank. No characters other than these six; no people, no other animals.
```

- 第 1～5 格是五格正選（主頁、任務、行程、照片、分帳）；第 6～9 格備用：北北揮手、北北抱硬幣（想讓北北上時換掉棉棉的「分帳」）、棉棉揮手、小鳳抱星形徽章。
- **看到這些就直接重生**：有字（卡片、硬幣、相機、徽章上出現字或數字也算）；多一隻、同一格兩隻、出現六隻以外的角色；畫成全身、道具小到看不出是什麼；某一格認不出是哪一隻。
- **可以接受、不用重生**：鬍鬍變灰這類顏色與服裝的錯（照著畫時改正）；姿勢跟描述有一點出入；底色不是一整片洋紅、尾巴伸進格子之間的縫（只當參考，不切圖）。
- **收件**：同 6.5。

---

## 7. 動畫規矩（照舊，每條怎麼驗）

| 規矩 | 怎麼做 | 怎麼驗（每版新增的斷言都要用突變證明會紅） |
|---|---|---|
| 只動 transform、opacity | keyframes 只寫這兩個屬性 | 讀每一段動畫用到的屬性，只准這兩個（`peektest` 現有的做法）；突變：加一段動 `top` 必須紅 |
| 尊重減少動態效果 | 跟現有一樣看 `html.reduce-motion`（系統設定或設定頁的開關），開了就不加會動的 class，CSS 的總開關兜底 | 開了之後圖上 0 段動畫；突變：拿掉判斷必須紅 |
| 不擋點擊 | 掛在按鈕或卡片上的：圖當它的子元素（點吉祥物＝點那顆按鈕，跟天氣頁提醒卡同一種做法）；蓋在別的東西上面的：`pointer-events: none` | 在吉祥物露出來的位置點下去，觸發的要是它底下那顆按鈕 |
| 觸控 ≥ 44px 不受影響 | 吉祥物不改按鈕大小、不縮內距 | `tagtest` 照舊守；分段鈕、拍照圖示的大小改前改後相同 |
| 對比不受影響 | 吉祥物不放在字的後面、不蓋到字 | 吉祥物的外框跟每一段字的外框不相交；`palettetest` 照舊 |
| 只在觸發時動、只動一次 | 導覽進來（`fresh`）或明確的使用者動作才加 class；背景重畫不加。只有載入中與「產生中…」會重複 | 同一頁重畫兩次，第二次 0 段動畫 |
| 不變高（任務頁） | 只用既有空間 | 進度那一行、拍照列，改前改後高度相同 |
| 透明 | 新圖不畫鋪滿畫布的底色 | `arttransparenttest` 的登記制，新圖登記進去 |
| 新加的探頭圖只在畫面上沒有別張時出現（如果 Yolin 同意） | H3、H4 出現前先看畫面上有沒有完成卡或對話框的探頭圖 | 造「完成卡＋下雨那一句＋下一站卡」同時成立：H3 不出現、既有兩張照舊；拿掉完成卡與下雨那一句：H3 出現 |
| 分段鈕不變高 | 頭放在原本的內距裡（要實測） | 改前改後高度相同。另外兩處會變高、照實量給 Yolin：主頁 H1 約 44px（推論）；照片空白頁按鈕上面多出探頭圖露出的那一段（頁面本來是空的，不擠到資訊） |

---

## 8. 分版計畫

### 第一版：全用現有的向量圖（不等新圖）

**範圍**：H1、H2（如果 Yolin 同意結束那一句換人講）、T1、I1、P1、B1。T2 建議不做（3.2）。「新加的只在沒有別張時出現」那條規矩只管第二版的 H3、H4，第一版不用寫。

**改到的檔**：

- `js/peeks.js`、`js/glyphs.js`：裁頭；
- `css/style.css`；
- `js/views/trip.js`、`js/views/people.js`；
- `js/ui.js`、`js/addphoto.js`、`js/says.js`；
- `sw.js`：只改版號。
- **不碰** `js/app.js`。

**重負載與時長**（測試挑選是乾跑實測，時長是推論）：

| 項目 | 時長 | 依據 |
|---|---|---|
| `test:affected` | 58～59/97 支，約 37 分（預測 2235～2244 秒） | 乾跑，前提見下面 |
| 突變 | 約 20 條，約 15～25 分 | 推論：每條約一支測試的單跑時間；`hometest` 72 秒、`peektest` 60 秒、`saytest` 45 秒、`mascottest` 23 秒、`photoicontest` 11 秒，取自 `tools/test-times.json` |
| 截圖給 Yolin | 3～5 場，每場約 40～70 秒 | 拍在真的按鈕和卡片上，和紙＋深色 |
| 錄影 | 1～2 場 | T1、I1 這種動作要錄才看得到 |

**「58～59 支」的前提**（`node scripts/run-affected.mjs --dry --files …` 乾跑，2026-11-18；紀錄在 `.logs/fix1118/` 的 `dryV1*`，不進 repo）：

- 只放上面那幾支 App 檔＋`sw.js#VERSION`（只改版號）：**58 支、2235 秒**（實測，`dryV1`）。
- 加上新斷言要寫進的既有測試檔：仍是 58 支（實測，`dryV1t`）。
- 加上 `package.json`：仍是 58 支（實測，`dryV1p`）。
- 加上 `scripts/peektest.mjs`＋新突變寫進既有清單（`tools/mutations/mut_peek1113.json`、`mut_mascot1113.json`）：**59 支、2244 秒**（實測，`dryV1e`）。
- **新開一個突變清單檔**：乾跑時檔還不存在，挑選器判「讀不到、解析不了或已刪除 → 全套」，放大成 97 支（實測，`dryV1m`）。這是因為檔不存在，不代表建好之後也是全套；建好之後只挑它點名的測試，是**推論**。所以第一版的新突變寫進既有清單，不新開檔。
- **改到 `sw.js` 的快取清單（不只版號）或 `js/app.js`**：97 支、3427 秒（實測，`dryB`、`dryD`）。乾跑輸出的理由是「放大器 C：sw.js（骨架／合併語意）」「放大器 C：js/app.js（骨架／合併語意）」。

- 截圖和錄影 Yolin 看過，才跑突變與 `test:affected`。11-13 那次就是這個順序：先看截圖再跑。
- 合計約 1～1.5 小時的機器時間，分三段，每段開跑前列清單、拿許可。

**實作時的更動**（2026-11-18 開工，v1.95.0；跟上面的規劃不一樣的地方，讀程式時發現的）：

- **T1 拿掉「到終點蹦一下」**：全部完成時慶祝畫面的兩顆按鈕都換頁、不呼叫 `onDone`，回到任務頁時沒有「自己剛完成」的那一刻可以接（`js/views/trip.js` 檔頭 T1 那段註解）。只剩「自己完成一個、回來時滑到新進度」。
- **P1 靜止、不跳**：照片分頁的路由沒有把「真的導覽進來」（`fresh`）傳給這一頁，分不出導覽與背景重畫；要分就得改 `js/app.js`，測試放大成全套。跟底部分頁那一案（也要改 `app.js`）一起做。
- **H1 深色看不到相機閃光**：閃光是 `.mc-extra`，跟揮動線、蒸氣一樣只在和紙畫；深色下只看得到相機那張探上來（現有規矩，不是新問題）。
- **H2 結束卡不寫 CSS 保底高度**：卡上要留的高度由 `js/says.js` 的 `roomOnCard` 量那一句的實際高度決定（390 寬時那一句排兩行，推論）。CSS 再寫一個保底高度，`roomOnCard` 壞了也看不出來，所以不寫，改由 `saytest` S11b 量「那一句的頂沒有超出頁面」守著。
- **B1 標題上那一隻整個拿掉**：小鳳改扣在「太棒了」按鈕上緣、跳上來揮翅膀；原本的「原地彈跳兩下」（`glyphs.js` 的 bounce）沒有別處用，一起拿掉。圖載不到時照舊在標題上放整隻（不動）。
- **裁頭沒動 `js/peeks.js`**：圓形頭像寫在 `js/glyphs.js` 的 `mascotBadge`（湯圓、阿灰、北北三個裁切框）。

### 第二版：新圖（Yolin 生九宮格 → 我畫成向量）

**範圍**：H3、H4、T3、S1～S3、G1、C1～C3、R1、我的旅程空白、錯誤狀態。

**改到的檔**：

- `js/peeks.js`：新圖畫進這裡；
- `css/style.css`；
- `js/views/` 底下的 home、trip、expenses、settings、create、recap、join；
- `js/ui.js`；
- `sw.js`：只改版號。

**重負載與時長：**

| 項目 | 時長 | 依據 |
|---|---|---|
| `test:affected` | 58/97 支，約 37 分 | 乾跑（`dryC`）；新突變也寫進既有清單時，照第一版的情形約多 1 支（推論，沒有另外乾跑） |
| 突變 | 約 30 條，約 25～40 分 | 推論 |
| 截圖 | 5～7 場 | |
| 原創性檢查 | 不吃機器 | 新姿勢寫進 `docs/吉祥物原創性檢查.md` |

**畫圖**：我照參考圖畫 7 張向量，不吃機器；每張先出單張的和紙＋深色給 Yolin 看。

### 另案：底部分頁列五格

Yolin 2026-11-18 決定要做、另案排。誰、什麼姿勢、怎麼畫、對比在 3.12；提示詞在 6.6。

- 順序：Yolin 生 07 的參考圖 → 我畫五張胸像（第一張先給他看，跟第二版同一個規矩）→ 改 `js/app.js` 的 `tabItem`／`renderTabs` 與 CSS → 截圖（和紙＋深色、每一格選中一次）給他看 → 才跑測試。
- 改 `js/app.js`，測試是全套 97 支，約 57 分（乾跑）。
- 要新寫的斷言（推論，實作時再定）：五格都是吉祥物、選中那格大一號且圈是主色；背景重畫不跳、真的切分頁才跳；減少動態效果時 0 段動畫；圖示不擋點擊（點圖＝點那一格）；分頁列高度不變。

### 跟測試整理（第二～四批）的關係

- **第四批要修的 `mascottest`、`hometest`（150ms 那個問題）這一案一定會動到。** 建議把 `mascottest` 那一條併進第一版一起修：白天、只有 23 秒一支。`hometest` 照原排程晚上做。
- 第二批（playertest、photosynctest）、第三批（挑選器設計）跟這一案無關，照 Dispatch 的指示往後排。

---

## 9. 要 Yolin 決定的事

**Yolin 2026-11-18 的答覆**（經 Dispatch）：

1. 選 **A**，補一句「先讓我看效果，我喜歡 GPT 產出的角色融入感」→ 寫進 6.4：保留姿勢與互動，第二版第一張先給他看。
2. ～4. 照建議：新加的探頭圖只在沒有別張時出現（已上線的組合不收）；H2 結束那一句改由卡上的小鳳講；六隻照第 5 節的表分。
5. 底部分頁五格：**要做，另案排** → 3.12、6.6。
6. ～8. 照建議：頁首鬍鬍不動；`mascottest` 150ms 併進第一版；先做第一版，截圖給他看過才跑完整檢查、上線。

以下是當時列給他的原文，保留：

1. **圖的路線**：
   - **A**：GPT 九宮格只當參考，我畫成向量。**建議 A**，理由在 6.3、6.4。
   - **B**：GPT 點陣直接放進 App。
2. **新加的探頭圖，只在畫面上沒有別張時出現**（第 2 節）。建議同意。這條只管第二版的 H3、H4；不同意的話，主頁最多可能同時三張（完成卡、下雨那一句、下一站卡）。
   - 附帶一題：**要不要連已上線的組合也收成一張？** 現在「任務全部完成了」卡跟下雨／下雪那一句可以同時出現、同時動。建議不收（已上線，收了要多改一處、多一組斷言）。要收的話再定：被擠掉的那一句退回「站在左邊」，還是整句不出現。
3. **H2 結束那一句改由卡片上的小鳳講**：說話的從北北換成小鳳。建議同意。不同意的話，北北照舊站在對話框左邊。
4. **六隻的分配**（第 5 節的表）：要不要調。例如照片空白給棉棉，要多畫一張。
5. **底部分頁五格**：要不要另案做。
6. **頁首鬍鬍的頭**：維持不動（建議），還是換頁時點頭。
7. **`mascottest` 150ms 併進第一版一起修**：建議同意。
8. **先做第一版**：建議先做，不必等九宮格。第一版的截圖給 Yolin 看過才跑測試、上線。

---

## 10. 示意圖

用現有的向量吉祥物（從 `js/glyphs.js`、`js/peeks.js` 直接取 SVG）拼在畫出來的卡片和按鈕上。

- 做法：暫存區腳本用 sharp 轉成 PNG，**沒有開瀏覽器**，不進 repo。
- 行程、站名都是造的；不是 App 截圖。
- 放在 Dispatch outputs（複製後核過 sha256，三個都相同；同名的不覆蓋，所以改版另存新檔名）。**有效的是 04～06，01～03 作廢**：
  - `TripQuest_吉祥物融入_04_第一版_和紙_v2.png`（397,461 bytes）
  - `TripQuest_吉祥物融入_05_第一版_深色_v2.png`（413,319 bytes）
  - `TripQuest_吉祥物融入_06_九宮格提示詞_v2.md`（8,387 bytes）：6.5 節的提示詞，加上怎麼生、重生清單、九格各是什麼，Yolin 可以直接照著用。跟規劃 6.5 節的區塊逐字相同（暫存區腳本比過）。
  - 01～03 作廢的原因：01、02 的任務頁畫了「按下拍照、相機閃一下」（T2，現在建議不做），說明寫「那一行不變高」像是已確定；03 的第一段沒有逐字照九宮格原文，還有一句跟「同一隻佔兩格」矛盾。
- 內容：第一版的主頁（出發當天那一句）、任務頁（進度條前端的湯圓圓形頭像；拍照圖示照舊）、照片空白頁（鬍鬍探頭在按鈕上）。
- 交之前放大看過交接處：深色的探頭圖白邊在按鈕、對話框上緣收掉，沒有白帶。
- 分頁列的圖示畫成灰色小圓點，因為轉圖程式畫不出彩色表情符號。示意圖裡的位置與大小是照 CSS 估的，不是量出來的。實作時的截圖才是準的。
- 第二版的新圖還沒有，所以不在示意圖裡。
- **底部分頁另案（2026-11-18 加）**：
  - `TripQuest_吉祥物融入_07_底部分頁提示詞.md`：6.6 節的提示詞，加上怎麼生、五格各是誰、重生清單。跟規劃 6.6 節的區塊逐字相同（暫存區腳本比過）。
  - `TripQuest_吉祥物融入_08_底部分頁小樣.png`：3.12 節的小樣，和紙、深色各兩列（選中「主頁」、選中「照片」）。用現有的全身圖裁頭先代替新姿勢；尺寸照 CSS 畫成 3 倍；不是 App 截圖。

---

## 11. 這份規劃裡，實測的與推論的

**實測**（讀程式、跑指令）：

- 第 1 節的盤點：每一處都讀了程式，行號照 `81b8c7a`。
- 「下拉重新整理」在列出的搜尋樣式範圍內沒有找到。
- 檔案大小：`ls -l` 量的。
- 每版要跑哪些測試、預估多久：`run-affected.mjs --dry --files` 乾跑。這是預測器的預估，它讀的是 `tools/test-times.json` 的單支耗時；不是實際跑出來的時間。
- 探頭圖露出高度：用 `peekGeom` 算的。
- sharp 能畫吉祥物的濾鏡和中文字：探路腳本畫了一張，看過。
- 完成卡的小鳳跟下雨／下雪那一句的探頭圖可以同時出現：讀 `trip.js` 確認（沒有在畫面上造出來看）。
- 出發那一句出現時天氣那一句不出現：讀 `trip.js:595-596`、`:642`。
- 拍照、相簿兩顆按鈕在 `onclick` 裡同步打開系統的相機／相簿：讀 `addphoto.js:112`、`:116`。
- 完成任務的慶祝畫面關掉之後才呼叫 `onDone`：讀 `addphoto.js`。
- 提示詞跟原文逐字比對：暫存區腳本，30 項符合、0 項不符，含兩向對照組（03 的舊寫法必須判不同、原文自己比自己必須判相同、06 改一個字必須判不同）。

**推論**（沒有實測）：

- **H1 那一句變高約 44px**：從 CSS 算的，沒有在畫面上量。H2 的高度變化未估。
- **T2 按下時的反應使用者看不到**：從「同步打開系統相機」推的，沒有在手機上試。
- 新圖的露出高度，約 40～50px。
- T1 湯圓的頭不會撐高那一行。
- T1 用旗標分辨「自己完成」與「旅伴同步」：是設計，還沒寫、沒驗。
- 新開的突變清單檔建好之後，挑選器只挑它點名的測試（乾跑時檔還不存在，判成全套）。
- S1 拿掉表情符號後不會變高。
- 點陣圖跟向量圖放在一起的畫風差異。
- `drop-shadow` 的效能。
- 突變條數與時長。
