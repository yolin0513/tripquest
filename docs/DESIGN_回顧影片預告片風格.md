# 回顧影片：電影預告片風格（規劃，2026-11-19）

**狀態**：2026-11-19 實作（v1.97.0）在本機分支 `trailer`、壓成一個 commit、沒推，等 Dispatch 放行。trailertest 16 項、新突變 25 條全部紅在預期、完整的鏈 101/101 全綠（不是全面檢測）；存成影片（`recordTrailer`）沒有測試走到。實作與規劃的對照、沒做到的地方，見 STATUS 交接「2026-11-19 11:3x 預告片實作」那一節；各場結果見「2026-11-19 13:4x」那一節。
（11:3x 那時的狀態行：實作寫好、開瀏覽器的測試一場都還沒跑。）
（原本這一行：只有規劃，沒動程式、沒跑測試。等 Yolin 看過、回覆第 10 節的決定之後才實作。）

> **v2（同日 10:5x）**：改了四處——
> - 內建曲目是 21 首，不是 18 首；
> - 3.3 字的來源補上路線段的景點名與配樂授權那一行；
> - 8.2 出品卡底圖從「山丘」改成平塗的暗帶，跟「不畫地景」一致；
> - 8 的限制補一句說明。
>
> Dispatch outputs 裡沒有 `_v2` 的那份作廢。

**交辦**：Dispatch 2026-11-19 上班時段轉 Yolin 的需求。現在的回顧影片像幻燈片，Yolin 希望做得像電影預告片、有氛圍感。原本的風格保留不動，預告片另外做成一個可選的新風格。先規劃再實作，規劃要先給 Yolin 看。

**標記**：
- **【讀程式】**：這次讀 `js/memory.js`、`js/music.js`、`js/tracks.js`、`js/views/album.js`、`js/merge.js` 得到的事實。
- **【推論】**：還沒量過、還沒在手機上試的判斷。

---

## 0. 一段話講完

- 新增「預告片」風格，長約 73 秒，固定長度。
- 段落：冷開場 → 出品卡 → 鋪陳 → 加速 → 高潮快剪 → 片名卡 → 彩蛋 → 片尾字卡。
- 畫面：上下黑邊、慢推鏡、假景深、暗角、調色、顆粒。轉場用切黑、硬切、少量白閃，不用溶接和滑動。
- 字只用行程資料和固定的幾個詞，不猜。
- 配樂：新增一首程式合成的預告片配樂，畫面照它的拍子剪。
- 原本的風格一行都不改，用「同一秒畫出來的畫面跟改之前一模一樣」的斷言守住。
- 第一版不需要任何 GPT 素材，GPT 底圖是可選的升級，提示詞在第 8 節。

---

## 1. 現況（【讀程式】）

| 項目 | 現在的做法 | 對預告片的影響 |
|---|---|---|
| 畫面 | 1080×1920 直式。`W`、`H` 是模組常數，全部版面都照直式寫 | 改成橫式要大改，見 3.6 |
| 結構 | 片頭 3.6 秒 → 每天一張日期字卡（2.4 秒）→ 照片每張 2.9～3.3 秒 → 路線地圖 6.5～13 秒 → 片尾 4.6 秒 | 預告片要另外一條時間軸 |
| 長度 | 精華版約 165 秒、完整版放全部照片 | 預告片固定約 73 秒，錄影等的時間也跟著變短 |
| 轉場 | 大多是溶接，每 4 張換一次重音（往左滑、往上滑、穿越縮放、往下擦） | 預告片不用這幾種 |
| 交界 | 照片交界刻意不准變暗；`videotest` 有一條「交界不可以閃」 | 預告片的切黑、白閃會撞到這條，所以要分開的程式路徑 |
| 推鏡 | cover 的照片放大 1.0→1.055 加一點平移；contain 的照片 1.0→1.035，背景用同一張縮小再放大的糊化圖 | 可以沿用，幅度另外調 |
| 載入照片 | 滑動視窗：先載 4 張（`AHEAD = 4`），每 300ms 補一次 | 0.6 秒一張的快剪會來不及，見 4.2 |
| 錄影 | canvas `captureStream(25)` 加 `MediaRecorder`，3.6 Mbps；用真實時間算第幾秒，畫得慢會掉格，不會變長 | 每一格的畫圖成本是上限，見 4.1 |
| 配樂 | 程序合成 4 種（溫柔 74、輕快 112、電影感 62、民謠 92 bpm），段落跟著影片進度換；內建曲目 21 首（`TRACKS` 數出來的），**曲目表裡沒有節拍資料**；也可以用手機裡的音樂 | 只有程序合成的配樂知道拍子在哪，見 3.4 |
| 減少動態效果 | `memory.js`、`album.js` 裡**完全沒有處理**（搜 `reducedMotion`、`prefers-reduced` 都是 0 筆） | 預告片要另外定，見第 5 節 |
| 選擇怎麼存 | 配樂選擇存在 `trip.musicStyle`，經 `js/merge.js` 跨裝置同步 | 預告片的選擇要不要同步，見第 7 節 |
| 字型 | 畫布用 `"Noto Sans TC", system-ui, "PingFang TC", "Microsoft JhengHei"`。App 只從 Google Fonts 載了英文的 Caveat，沒有載任何中文網路字型 | 不承諾特定字體，見 3.3 |

---

## 2. 段落結構（約 73 秒）

配樂固定 100 bpm，一拍 0.6 秒。所有切點都落在拍子上。下面的秒數是照拍數算的。

| # | 段落 | 長度 | 畫面 | 字 | 聲音 |
|---|---|---|---|---|---|
| 1 | 冷開場 | 8 拍，4.8 秒 | 全黑，黑邊從畫面外滑進來（減少動態效果時直接出現） | 「〔年〕年〔月〕月」淡入淡出，接著「〔地區〕」 | 低音長音，最後一記輕的重拍 |
| 2 | 出品卡 | 4 拍，2.4 秒 | 六隻吉祥物剪影站成一排，背後逆光 | 「〔群組名〕 出品」；群組沒有名字就寫「TripQuest 出品」 | 一聲呼嘯 |
| 3 | 鋪陳 | 32 拍，19.2 秒 | 6 張照片，每張 4 拍，慢推鏡；兩張之間切黑 0.3 秒。中間穿插 2 張字卡 | 字卡：「〔N〕個人」「〔M〕天」。照片有使用者寫的說明就當字幕，放下面的黑邊裡 | 長音加規律的脈動 |
| 4 | 加速 | 32 拍，19.2 秒 | 10 張照片，每張從 3 拍縮到 2 拍；中間插一段 6 拍的路線快速畫過（沿用現有路線地圖的版面，不推近特寫） | 字幕同上；路線上的景點名照現有地圖的規則 | 節奏加密，結尾一段往上升的聲音 |
| 5 | 高潮快剪 | 16 拍＋2 拍，10.8 秒 | 16 張照片，每張 1 拍，硬切；每 2 拍最多一次白閃；最後一記重拍後全黑 2 拍、無聲 | 沒有字 | 重拍、鼓點，最後留白 |
| 6 | 片名卡 | 10 拍，6 秒 | 片名卡底圖上寫行程名稱，字距慢慢收緊 | 「〔行程名稱〕」，下面一行「〔年〕年〔月〕月」 | 一記很重的低音 |
| 7 | 彩蛋 | 7 拍，4.2 秒 | 一張照片停住：有說明而且讚最多的那一張 | 那張照片的說明 | 配樂收掉、只剩一點尾音 |
| 8 | 片尾字卡 | 10 拍，6 秒 | 黑底，電影海報底部那種排法 | 「主演 〔旅伴名字……〕」「〔開始日〕 – 〔結束日〕」「TripQuest」；配樂授權那一行照現在的規則一定要有 | 收尾 |

**照片怎麼挑**（不判斷照片內容，App 也沒有能力判斷）：
- 用現有的 `pickHighlights` 挑 33 張（6＋10＋16＋彩蛋 1）：每個景點、每個人至少一張，其餘照讚數、有沒有說明、是不是必去排。
- 鋪陳、加速、快剪照時間順序排。彩蛋那張從序列裡拿出來，不重複出現。
- **照片不夠時**：先縮短快剪、再縮短加速，**不重複用同一張**。少於 8 張就不提供預告片，畫面上照實寫「照片少於 8 張，做不出預告片」（共用慣例第 4 節）。8 這個數字是推論，實作時用合成資料試過再定。

---

## 3. 運鏡、轉場、字卡、配樂、調色、黑邊

### 3.1 運鏡

- **推拉**：鋪陳每張放大 1.00→1.08、慢慢平移；加速每張 1.04→1.12、快一點；快剪不動或很短的推近；片名卡 1.00→1.03。contain 的照片照現在的規則推得比較輕，不會再裁到人。
- **景深感**（假的）：把同一張照片糊化，疊在上面，中間挖一個漸層的洞，所以四周糊、中間清楚。糊化沿用現有的做法：先縮成 48×85 再放大，不用 `ctx.filter`。
  - 那張疊層每換一張照片才做一次，不是每一格重做。
  - 【推論】iPhone 的 Safari 對 canvas 的 `ctx.filter` 支援到什麼程度沒查證，所以整個設計不依賴它。
- **不做的**：真正的視差，也就是前景和背景分開移動。要有深度圖才做得到，手機上做不到。

### 3.2 轉場

- 鋪陳：切黑。前一張淡到黑 0.15 秒、黑 0.15 秒、下一張淡入。
- 加速：照拍子硬切；換天的地方切黑一拍。
- 快剪：硬切，下拍時可以加白閃。**白閃一律每秒最多 2 次**（減少動態效果時 0 次）。WCAG 2.3.1 的上限是每秒 3 次，這裡留了餘裕。這條寫成斷言，見第 9 節。
- 片名卡、片尾：切黑。
- 現有的四種重音轉場與溶接，預告片都不用。

### 3.3 字卡

- **字只有兩種來源**，實作時登記成清單，測試逐一核：
  - **行程資料**：年月（開始日期）、地區、天數、人數、行程名稱、群組名稱、旅伴名字、照片說明、開始與結束日期，以及路線那一段的景點名（照現有路線地圖的規則，對得回景點庫的才放符號）。有開 AI 的話，也用 AI 已經寫好的片頭與片尾文案（現在的影片本來就用）。
  - **配樂授權那一行**：從曲目表的出處來，照現在片尾的規則。
  - **固定的詞**：「出品」「主演」「TripQuest」「個人」「天」「年」「月」，以及照片不夠時的那句說明。
- **不寫季節**：南半球的 8 月是冬天，從月份推季節會寫錯，所以只寫年月。
- **不寫猜出來的標語**，像「一場說走就走的冒險」。這種話跟設計原則衝突：猜出來的東西不准變成使用者看得到的字。
- **字型**：用現有的系統字（iPhone 是蘋方、Android 是思源黑體），加粗、加大字距，白字。
  - 預告片常用的明體要另外下載中文網路字型。Google Fonts 可以只下載用到的字（`text=` 參數），但沒試過，離線時也會退回系統字。
  - 所以**第一版不承諾特定字體**。

### 3.4 配樂節奏

- **新增一首程式合成的「預告片」配樂**，放在 `music.js` 現有的合成器旁邊。
  - 跟畫面共用同一張拍點表：長音、脈動、往上升的聲音、重拍、無聲、低音重擊。
  - 全部用 Web Audio 合成，沒有授權問題、不佔檔案、離線也能用。
- **對拍**：用程式合成的配樂時，畫面的時間改看音訊時鐘（`AudioContext.currentTime`），不看 `performance.now()`。
  - 【推論】錄影時主執行緒在畫圖，兩個時鐘會差開幾十毫秒，快剪時看得出來。
  - 只有預告片這條路徑這樣做，原本的風格照舊。
- **選內建曲目或自己的音樂**：曲目表裡沒有節拍資料，自己的音樂更不知道。
  - 這兩種照固定的秒數剪，**不會對拍**，畫面上照實寫「這首不會對拍」。
  - 要對拍，得先替每首內建曲目量好節拍、寫進曲目表，那是第二版的事。
- 原本的四種程序合成配樂與 21 首曲目不改。

### 3.5 調色

- 只用 canvas 的混合模式疊幾層全畫面的顏色，不逐像素運算：
  - 暗部偏青、亮部偏暖：用 `soft-light` 疊一層漸層。
  - 降一點飽和：用 `saturation` 疊灰。
  - 暗角：放射漸層。
  - 顆粒：一塊 256×256 的雜訊圖，每一格換位置平鋪，用 `overlay` 疊。
- **不做逐像素的色彩查表**：1080×1920 每一格要讀寫約 8 MB，在即時錄影裡太慢（【推論】）。
- 第二版可以考慮 WebGL 加 3D 查表，調色最準，代價是多一條繪圖路徑和每一格一次貼圖上傳。第一版不做。

### 3.6 黑邊

- **建議**：維持直式 9:16，上下各約 232px（12%）黑邊，中間的畫面約 1080×1456。
  - 這個比例接近 3:4，手機直拍的照片剛好放滿、幾乎不用裁。
  - 橫拍的照片照現在的規則：整張放進來，背景糊化填滿。
  - 照片說明放在下面的黑邊裡，像電影字幕，不壓在照片上。
- **另一個選項：另出 16:9 橫式**。電影感最強，但 `W`、`H` 是整支程式共用的常數，片頭、地圖、字幕的版面都要重排。
  - 手機上看要轉橫，傳到 LINE 也多半是直著看。
  - 成本大概是第一版的一半以上（【推論】），建議不做。

---

## 4. 手機與 PWA 做得到的範圍、效能代價

### 4.1 每一格的畫圖成本

- 錄影是即時的：25 fps，每一格有 40ms。畫不完就掉格，影片會頓，但長度不變（【讀程式】）。
- 現在每一格畫約 2～5 次全畫面的圖：底色，加上這一張與轉場中的下一張，contain 的照片各多一張糊化背景（【讀程式】`drawPhotoSeg`、`drawFrame`）。
- 預告片每一格要再多約 4～6 次全畫面的疊圖：景深疊層、兩層調色、暗角、顆粒。
- 桌機上的 Chrome 一定夠快。中階 Android 和舊 iPhone 夠不夠，**沒量過**（【推論】）。
- **做法**：
  - 實作時先在桌機 Chrome 開 CPU 降速 4 倍與 6 倍量每一格的毫秒數，當成手機的代替指標。
  - 再加**自動降級**：最近 1 秒平均一格超過 30ms，就依序關掉顆粒 → 景深 → 調色，然後照實告訴使用者，例如「這支手機比較慢，已關掉顆粒與景深」。
  - 降級這條路平常走不到，要有一種常設情境：把畫圖故意放慢，它必須真的關掉（共用慣例第 5.13 節）。
- **好處**：片子短。預告片約 73 秒，精華版約 165 秒，錄影等的時間不到一半。

### 4.2 快剪時照片來不及解碼

- 現在先載 4 張、每 300ms 補一次。快剪一張 0.6 秒，4 張只撐 2.4 秒。手機解一張大照片要幾十毫秒（【推論】），會趕不上。
- **做法**：
  - 預告片改成照時間預載（接下來 5 秒內會用到的都先解碼）。
  - 快剪那 16 張用縮小過的版本，寬約 720，0.6 秒內看不出差別。
  - 快剪開始前先全部解碼好，播完就釋放。
- **記憶體**（照長寬算）：720×1050×4 ≈ 3 MB 一張，16 張約 48 MB。現在滑動視窗本來就留幾張全尺寸的，合計峰值估多約 50 MB。
  - 舊手機會不會被記憶體壓垮，要實機試（【推論】）。現有檔頭第 2 點寫過：被壓垮時片尾會被截掉。
- 縮小用 `createImageBitmap` 的縮放參數。iPhone 的 Safari 支不支援這個參數**沒查證**；不支援就退回用 canvas 自己縮。

### 4.3 其他

- **錄影格式**：照現在的（先試 mp4、不行再用 webm），iPhone 照舊。
- **檔案大小**：3.6 Mbps × 73 秒 ≈ 33 MB（照碼率算）。
- **離線**：第一版全部用程式畫、程式合成，離線能做。GPT 底圖（第 8 節）如果用了，不放進預先快取，第一次做預告片時才下載；離線又沒下載過，就退回程式畫的底圖。
- **鎖螢幕**：錄影時不能鎖，跟現在一樣照實提醒。

---

## 5. 減少動態效果

**現況**：回顧影片完全沒處理（第 1 節【讀程式】）。

**這次預告片的做法**：

| | 一般 | 系統開了減少動態效果 |
|---|---|---|
| App 裡預覽 | 照第 2、3 節 | **平穩版**：照片不推不移；字只淡入淡出，不縮放、不收字距；沒有白閃；黑邊直接出現；快剪改成每張至少 1.5 秒的淡入淡出，張數變少；配樂照舊 |
| 存成影片檔 | 照第 2、3 節 | **建議預設做平穩版**，畫面上寫「已照你的減少動態效果設定做成平穩版」，旁邊一顆「改做完整版」讓使用者自己選 |

- **白閃上限不看設定**：一般版每秒最多 2 次，平穩版 0 次。
- **為什麼影片檔也預設平穩**：影片檔會傳給別人在別的手機上看，那邊的設定管不到它。但做影片的人開了這個設定，最可能是自己看了不舒服，所以預設照他的設定，讓他自己決定要不要改。這是建議，第 10 節列成要 Yolin 決定的事。
- 原本的風格要不要也補減少動態效果：**Yolin 2026-11-19 決定不做**（原本的不動），不列待辦。

---

## 6. 原本的風格怎麼保證不動

- **程式路徑分開**：`buildTimeline` 照舊。預告片用新的時間軸建構函式和新的段落種類，共用的只有讀照片、排字、路線版面這幾支純函式，這幾支不改。
- **斷言**：
  - 用同一份合成資料，在原本風格的時間軸上取 12 個時間點各畫一格。
  - 跟改動前的版本（用明確的 commit 雜湊做暫存複本）畫出來的逐位元組比對，必須完全相同。
  - 對照組：故意把原本風格的推鏡幅度改一點點，必須判不同。
- 現有的 `videotest`（含「交界不可以閃」）一條都不改，照樣要綠。

---

## 7. 選擇存在哪裡

- 配樂的選擇存在 `trip.musicStyle`，經 `js/merge.js` 跨裝置同步（【讀程式】）。
- 預告片的選擇如果也要同步，就是改資料結構：要開 3 代理投票，Worker 先部署、客戶端後推（CLAUDE.md 第 5 條）。
- **建議第一版只存在這支手機**：不動 `merge.js`、不動 Worker。代價是換一支手機要重選一次。

---

## 8. 需要 GPT 生的素材（都是可選的；第一版不需要）

**先講結論**：
- **吉祥物剪影不用 GPT**。App 自己有六隻的向量（`js/glyphs.js` 的 `mascot()`），塗黑、加一圈逆光，就是剪影。形狀一定對、不花錢，也沒有 GPT 把鬍鬍畫灰的問題。
- GPT 適合畫的是「沒有資訊的氣氛」：光、天空、光斑。
- 第一版先用程式畫的版本：放射漸層的光暈、程式畫的天色。GPT 的圖可以先生，第一版樣片兩種都拍給 Yolin 比，他喜歡 GPT 的再換上。

**三條限制**：
- **通用、不跟行程**：這些圖每一趟都用，所以不能畫地景（海邊行程配到雪山就是錯的資訊），只畫抽象的光和天空。8.2 底下那條暗帶是平塗的一條暗色，像舞台邊緣，讓剪影站在上面，不畫山、海、樹這些看得出是哪裡的東西。
- **無字**。
- 進 App 的照 `docs/ART_生圖素材.md` 第 9 節第 4 條：放 `media/art/`、登記 `manifest.json`。

**怎麼生**（照 `docs/ART_行程海報生圖流程.md` 步驟 3）：
1. 一張一個新對話。
2. 這三張都**不用上傳參考圖**（沒有角色）。
3. 整段貼上提示詞、送出。
4. 比例選直式 2:3。我們會從中間裁成 9:16：左右各切掉約 8%，所以重要的光不要在最左右兩邊。
5. 用下載鈕存原檔。

### 8.1 片名卡底圖（暖、冷各一張）

兩張只差第三句（底色與光的顏色），各給一段完整的，整段貼就好。

**暖**：

```
A cinematic, atmospheric background for the title card of a short movie trailer. Portrait orientation, 2:3 (taller than wide). Abstract light only: soft, out-of-focus round bokeh lights and a few gentle rays of light coming down from the upper left through faint haze. The background is a very dark warm brown-black, and the lights are warm golden and amber. The middle band of the picture, from 38% to 62% of the height and across the full width, stays darker and calm, with only a few very faint bokeh lights, because a title will be written there later. Keep the brightest lights away from the far left and far right edges. Film photograph look with subtle, fine film grain.

NOT ALLOWED ANYWHERE: no text of any kind (no letters, no words, no numbers, no Chinese or Japanese characters, no logo, no signature, no watermark). No objects, no landscape, no ground, no buildings, no horizon, no moon, no people, no animals, no characters. No frames, no borders, no black bars. No star-shaped or cross-shaped lens flares.
```

**冷**：

```
A cinematic, atmospheric background for the title card of a short movie trailer. Portrait orientation, 2:3 (taller than wide). Abstract light only: soft, out-of-focus round bokeh lights and a few gentle rays of light coming down from the upper left through faint haze. The background is a very dark blue-black, and the lights are cool silver-blue with a few tiny warm golden specks. The middle band of the picture, from 38% to 62% of the height and across the full width, stays darker and calm, with only a few very faint bokeh lights, because a title will be written there later. Keep the brightest lights away from the far left and far right edges. Film photograph look with subtle, fine film grain.

NOT ALLOWED ANYWHERE: no text of any kind (no letters, no words, no numbers, no Chinese or Japanese characters, no logo, no signature, no watermark). No objects, no landscape, no ground, no buildings, no horizon, no moon, no people, no animals, no characters. No frames, no borders, no black bars. No star-shaped or cross-shaped lens flares.
```

### 8.2 出品卡的天空（剪影由 App 疊上去）

```
A wide glowing sunset sky for the opening card of a short movie trailer. Portrait orientation, 2:3 (taller than wide). The bottom 28% of the picture is one plain, flat, very dark band, the same dark color everywhere, with a soft, straight, level top edge at about 72% of the height, like the edge of a stage seen against the light; the band has no texture and no details. The sky is brightest and warmest just above the middle of that edge (golden and peach), as if the sun has just gone down behind it, and fades upward to soft pink and then to a deep dusky blue at the top. The sky from 40% to 70% of the height is open and calm with nothing in it, because small figures will be added standing on the dark band later. Film photograph look with subtle, fine film grain.

NOT ALLOWED ANYWHERE: no text of any kind (no letters, no words, no numbers, no Chinese or Japanese characters, no logo, no signature, no watermark). No hills, no mountains, no sea, no trees, no rocks, no buildings, no fences, no paths, no people, no animals, no birds, no characters, no sun disc. No frames, no borders, no black bars. Nothing that looks like the logo of a film studio: no searchlights, no beams sweeping the sky, no monuments.
```

### 8.3 光斑疊層（轉場與片名卡用，`screen` 疊上去）

```
Abstract analog film light leak on a pure black background. Portrait orientation, 2:3 (taller than wide). Soft, blurry glows of warm orange, amber and a little red bleed in from the right edge and the top right corner, and fade smoothly into pure black; the whole left half of the picture is pure black. The glows are smooth and cloudy, with no hard edges and no shapes.

NOT ALLOWED ANYWHERE: no text of any kind (no letters, no words, no numbers, no logo, no signature, no watermark). No objects, no landscape, no people, no animals, no characters. No frames, no borders, no film perforations, no scratches. Nothing in the left half except pure black.
```

**看到這些就直接重生**：
- 有字，包括角落的浮水印。
- 8.1、8.3 畫出地景、物體、人或動物。
- 8.2 下面那條暗帶畫成山、海或地面，上面有樹、人、動物；或天空畫了太陽本身。
- 留給字的那一帶被亮光佔滿。
- 畫了框、黑邊、底片孔。

**可以接受、不用重生**：
- 顏色深淺跟描述不完全一樣。
- 光的位置偏一點。
- 暗帶的高度差幾個百分點，或上緣有一點點起伏（剪影是 App 照實際的上緣放的）。

**收件**：從 Dispatch outputs 複製進 `art-inbox/`，核 sha256；原圖不進 repo。要用的那幾張裁成 9:16、壓成 JPEG（每張估 150～300 KB，【推論】），才進 `media/art/`。

---

## 9. 測試、突變、重負載（實作時才做；數字是估的）

**新測試 `trailertest`**（開瀏覽器）。每一條都要配一條只讓它紅的突變，expect 事前寫：

1. 段落順序與每段的拍數照第 2 節；全片長度 ±1 格。
2. 每一個切點都落在拍點上（±1 格）。
3. 畫面上每一個字都來自登記的來源（行程資料或固定的詞）；母體是畫布上實際畫過的字串，先證明母體不是空的。合成資料放一個「沒登記的字」必須紅。
4. 白閃：從畫面逐格取亮度數翻轉次數，每秒 ≤ 2；平穩版 0。
5. 平穩版：照片的縮放與位置在一張之內不變，字的大小不變。
6. 黑邊那兩條橫帶整片是黑的（字幕除外）。
7. 照片少於 8 張不提供，而且文案照實寫。
8. 自動降級：把畫圖故意放慢，必須依序關掉，而且畫面上有說明。
9. 原本的風格逐格相同（第 6 節）。

**重負載**（都要先拿許可，開跑前列清單與時長）：
- 這版會 bump `sw.js`，放大成全套：上次量過的 99 支合計約 3075 秒，約 52 分。
- 新突變約 10 條，每條約 40～60 秒，約 10 分（新測試還沒量過，量的那一次也算重負載）。
- 既有受影響的突變：改到 `memory.js`、`music.js`、`album.js` 的清單，到時用 `run4-plan.mjs` 那種算法算出條數與時長再列。
- **時段**：今晚 22:00 之後是第 4 場，這批的重負載不排在那段，白天另外排。

---

## 10. 要 Yolin 決定的事（每項附建議）

> **✅ Yolin 2026-11-19 11:0x 回覆（經 Dispatch）**：
> - 1～7 全照建議（甲）。
> - 第 8 項不要：原本的風格不補減少動態效果，**Yolin 決定不做**，不列待辦。
> - 可以開始實作，上班模式白天做。
> - 重負載（全套約 52 分＋突變）避開今晚 22:00 之後的第 4 場：22:00 前跑不完就排到第 4 場之後，或先做到可以 commit 的段落停下來回報。
> - 上線前照慣例：五行摘要給 Dispatch，等放行。
>
> 下面原文留著當紀錄。

1. **黑邊與比例**：
   - 甲（建議）：直式，上下各約 12% 黑邊，畫面接近 3:4，手機直拍的照片剛好放滿。
   - 乙：直式全畫面、不加黑邊，電影感弱一點。
   - 丙：另出 16:9 橫式，電影感最強，成本大、手機要轉著看。
2. **長度**：
   - 甲（建議）：固定約 73 秒。
   - 乙：給「60 秒／90 秒」兩個選項，測試與調整多一倍。
3. **配樂**：
   - 甲（建議）：新增程式合成的預告片配樂當預設，對拍；也可以選內建曲目或自己的音樂，但照實寫「不會對拍」。
   - 乙：第一版只准用預告片配樂。
4. **減少動態效果時存的影片檔**：
   - 甲（建議）：預設做平穩版，旁邊一顆「改做完整版」。
   - 乙：影片檔一律做完整版，只有 App 裡的預覽是平穩版。
   - 丙：跟系統設定無關，讓使用者每次自己選。
5. **出品卡寫什麼**：
   - 甲（建議）：「〔群組名〕 出品」，沒有群組名才寫「TripQuest 出品」。
   - 乙：一律「TripQuest 出品」。
6. **GPT 素材**：
   - 甲（建議）：第一版用程式畫的。GPT 的三張可以先生，第一版樣片兩種都拍給你比。
   - 乙：等第一版做好再決定要不要生。
7. **選擇要不要跨裝置同步**：
   - 甲（建議）：第一版不同步，不動資料結構、不動 Worker。
   - 乙：同步，要改資料結構，先開 3 代理投票、Worker 先部署。
8. **原本的風格要不要也補減少動態效果**：這次照「原本的不動」不碰，列成待辦。要不要另外排，請 Yolin 說。
