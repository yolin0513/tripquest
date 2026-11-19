# TripQuest App 圖示：三個方向的生圖提示詞（2026-11-19）

> **v2（同日 10:5x）**：只改安全區那一格的出處寫法，提示詞一個字都沒動。Dispatch outputs 裡沒有 `_v2` 的那份作廢。

給 Yolin 用 GPT 生 App 圖示的參考圖。三個方向各一份提示詞，**一個方向生一張**，不要做成一張多格。挑好方向之後，我照著畫成向量，再輸出各種尺寸。

## 先看這段：為什麼要換、規格限制

**現在的圖示**（v1.0 到現在沒換過）：藍色圓角方塊裡一個白色圓圈加一顆橘點。

- 跟 App 現在的樣子（和紙配色、六隻吉祥物）沒有關係。
- 圖檔本身就是「深藍底，裡面再畫一個圓角方塊」。手機會再幫圖示切一次圓角，所以桌面上看到的是兩層框、圖案偏小。這一點讀 `icons/` 裡四張圖看過。

**規格限制**（這次要守的）：

| 限制 | 要求 | 由誰守 |
|---|---|---|
| maskable 安全區 | 最小安全區：中央一個圓，半徑是圖示寬的 40%（直徑 80%）；最外圈約 10% 在某些平台會被切掉。出處：web.dev〈Maskable icons〉，2026-11-19 讀過原文。web.dev 說這是標準定的，連到 W3C Web App Manifest 的 icon masks 那一節；那一節這次**沒有讀到原文**，節號與錨點未核 | 提示詞先要 GPT 把重要的東西收在中央直徑約 2/3 的圓裡，比規格保守，因為 GPT 不會畫得剛好。最後的尺寸與位置由我畫向量時照規格放 |
| 整張就是圖示 | 底色滿版、不透明，不自己畫圓角方塊或外框 | 提示詞寫明；畫了就重生 |
| 小尺寸認得出來 | 桌面上大約一個指尖寬，設定頁、分頁標籤上還更小（32、16 px） | 一隻、只畫頭和胸口、大道具、粗外框、平塗、少細節。**不放一群**，六隻擠在一起縮小就糊了 |
| 不放字 | 連 App 名稱都不放 | 提示詞寫明；有字一律重生 |
| 白底、黑底的桌面都要有邊 | 底色選中間亮度的顏色 | 三個方向的底色對白、對黑的對比都在 3:1 以上（照 WCAG 相對亮度公式算的，見下表） |

**做出來怎麼用（建議）**：GPT 的圖只當參考（跟底部分頁那次同一條路線 A）。挑定方向後，我照著畫成向量，理由：
- 16 px 到 1024 px 都清楚；
- 顏色照 App 的配色；
- 安全區照規格精準放；
- iPhone 的圖示不能有透明，向量輸出時直接處理。

Yolin 如果更喜歡 GPT 那種筆觸，也可以直接用 GPT 的原圖縮小，代價是小尺寸會糊一點、安全區要人工核。到時候再選。

## 三個方向

| | 方向一：鬍鬍拿相機 | 方向二：湯圓坐在地圖針裡 | 方向三：鬍鬍從地圖後面探頭 |
|---|---|---|---|
| 想法 | 拍照任務；鬍鬍是頁首那隻，最像 App 的門面 | 旅行、地點；圓滾滾的湯圓放在圓形裡，被切成圓形也好看 | App 裡吉祥物都是「探頭」，這個最有 App 自己的味道 |
| 底色 | 磚珊瑚 #C8553D | 亮藍 #4F8DFF（沿用舊圖示的藍，舊使用者認得） | 森林綠 #3E7D5A |
| 對白／對黑的對比（算的） | 4.4／4.8 | 3.2／6.6 | 4.9／4.3 |
| 小尺寸的風險 | 鬍鬍是白狗，臉的細節（眼睛、鬍子）縮小會糊；靠粗外框撐 | 地圖針加一隻鳥，形狀最簡單，最不怕縮小 | 地圖上的虛線與小針最怕縮小，細節最多 |
| 建議 | **首選**：最能代表 App | 次選：最不怕縮小 | 喜歡探頭的感覺再選，要接受小尺寸較糊 |

## 怎麼生（照 `docs/ART_行程海報生圖流程.md` 步驟 3）

1. 一個方向開一個**新對話**。
2. 先上傳兩張參考圖，都在 Dispatch outputs 的 `TripQuest_吉祥物參考圖/`：
   - 方向一、三：`00_六隻總表.png`、`03_鬍鬍_白色迷你雪納瑞_正面全身.png`
   - 方向二：`00_六隻總表.png`、`04_湯圓_長尾山雀_正面全身.png`
3. 把那個方向的提示詞**整段**貼上、送出。
4. 比例選**正方形 1:1**。
5. 用**下載鈕**存原檔，不要截圖。
6. 想多看幾種，同一個對話按重生就好，不用改提示詞。

## 方向一：鬍鬍拿相機

```
Use the two uploaded reference images: a sheet of six original cute characters, and a large picture of one of them (the white dog). Draw the characters exactly as they look in the references: same body shape and proportions, same face, same colors, same outfits and accessories, same clean sticker style with thick, even, dark charcoal outlines and flat solid colors. Do not redesign them, do not change any color, do not add or remove clothes, pockets or accessories, and do not turn them into other characters or realistic animals. They may hold the small props listed below; their bodies, faces, colors and outfits stay exactly as in the reference. Do not copy the names or any other text from the reference sheet.

Draw only this one character, as in the reference:
- 鬍鬍: a white miniature schnauzer. His fur is pure white everywhere: head, face, body and paws are all white, never grey. Only his bushy eyebrows are grey. His floppy ears are a very pale warm grey. A big white beard and moustache, pink cheeks, and a coral triangle bandana around his neck.

This picture is the home-screen icon of a phone app. Square image, 1:1. The whole picture is the icon itself: fill the entire square, edge to edge and corner to corner, with one flat, solid, opaque background color #C8553D (a warm brick coral). Do not draw an app icon tile, a rounded square, a circle badge, a phone, a frame, a border, a drop shadow or a second background around the drawing; the phone will round the corners by itself.

Draw one big subject in the middle. Everything important, including the ears, the beard and the prop, fits inside an imaginary circle in the center of the picture whose diameter is two thirds of the picture's width; outside that circle there is only the flat background color. Do not draw this circle. The icon will be seen very small, about the size of a fingertip, so use simple bold shapes, thick even dark charcoal outlines, flat solid colors, very few details and strong contrast against the background. No thin lines, no small decorations, no texture, no gradients.

The subject: 鬍鬍 as a bust (his head and the top of his chest), large and centered, facing the viewer with a happy, friendly smile. His head is the biggest shape in the picture. He holds a small simple camera with one big round lens in front of his chest with both paws, below his beard; his whole face stays visible. The camera is light blue with a dark charcoal lens ring and is blank.

NOT ALLOWED ANYWHERE: no text of any kind (no letters, no words, no numbers, no Chinese or Japanese characters, no app name, no logo lettering, no signature, no watermark); the camera is blank. No characters other than 鬍鬍; no people, no other animals. No sparkles, stars, hearts, motion lines, speech bubbles or any other loose marks floating around him. No scenery and no floor.
```

## 方向二：湯圓坐在地圖針裡

```
Use the two uploaded reference images: a sheet of six original cute characters, and a large picture of one of them (the round white bird). Draw the characters exactly as they look in the references: same body shape and proportions, same face, same colors, same outfits and accessories, same clean sticker style with thick, even, dark charcoal outlines and flat solid colors. Do not redesign them, do not change any color, do not add or remove clothes, pockets or accessories, and do not turn them into other characters or realistic animals. They may hold the small props listed below; their bodies, faces, colors and outfits stay exactly as in the reference. Do not copy the names or any other text from the reference sheet.

Draw only this one character, as in the reference:
- 湯圓: a round white long-tailed tit. A white egg-shaped body; a green knit beanie with a yellow pom-pom; a tiny black beak (black, not orange); black wings; a long black tail; pink cheeks; small black feet. No brown anywhere.

This picture is the home-screen icon of a phone app. Square image, 1:1. The whole picture is the icon itself: fill the entire square, edge to edge and corner to corner, with one flat, solid, opaque background color #4F8DFF (a bright medium blue). Do not draw an app icon tile, a rounded square, a circle badge, a phone, a frame, a border, a drop shadow or a second background around the drawing; the phone will round the corners by itself.

Draw one big subject in the middle. Everything important, including the beanie, the pom-pom and the whole pin, fits inside an imaginary circle in the center of the picture whose diameter is two thirds of the picture's width; outside that circle there is only the flat background color. Do not draw this circle. The icon will be seen very small, about the size of a fingertip, so use simple bold shapes, thick even dark charcoal outlines, flat solid colors, very few details and strong contrast against the background. No thin lines, no small decorations, no texture, no gradients.

The subject: one big simple map pin (a location marker with a round head and a pointed tip at the bottom), standing upright in the middle. The pin is warm orange #FFB454 with a thick dark charcoal outline. The round head of the pin has a big pale cream circle in its middle, and 湯圓 is inside that cream circle as a bust (his head and the top of his round body), facing the viewer with a happy, friendly smile and filling most of the circle. His green beanie with the yellow pom-pom may stick out a little above the top of the pin. His long tail is not shown.

NOT ALLOWED ANYWHERE: no text of any kind (no letters, no words, no numbers, no Chinese or Japanese characters, no app name, no logo lettering, no signature, no watermark); the pin is blank. No characters other than 湯圓; no people, no other animals. No sparkles, stars, hearts, motion lines, speech bubbles or any other loose marks floating around. No map, no roads, no scenery and no floor.
```

## 方向三：鬍鬍從地圖後面探頭

```
Use the two uploaded reference images: a sheet of six original cute characters, and a large picture of one of them (the white dog). Draw the characters exactly as they look in the references: same body shape and proportions, same face, same colors, same outfits and accessories, same clean sticker style with thick, even, dark charcoal outlines and flat solid colors. Do not redesign them, do not change any color, do not add or remove clothes, pockets or accessories, and do not turn them into other characters or realistic animals. They may hold the small props listed below; their bodies, faces, colors and outfits stay exactly as in the reference. Do not copy the names or any other text from the reference sheet.

Draw only this one character, as in the reference:
- 鬍鬍: a white miniature schnauzer. His fur is pure white everywhere: head, face, body and paws are all white, never grey. Only his bushy eyebrows are grey. His floppy ears are a very pale warm grey. A big white beard and moustache, pink cheeks, and a coral triangle bandana around his neck.

This picture is the home-screen icon of a phone app. Square image, 1:1. The whole picture is the icon itself: fill the entire square, edge to edge and corner to corner, with one flat, solid, opaque background color #3E7D5A (a medium forest green). Do not draw an app icon tile, a rounded square, a circle badge, a phone, a frame, a border, a drop shadow or a second background around the drawing; the phone will round the corners by itself.

Draw one big subject in the middle. Everything important, including the ears, the paws and the whole map, fits inside an imaginary circle in the center of the picture whose diameter is two thirds of the picture's width; outside that circle there is only the flat background color. Do not draw this circle. The icon will be seen very small, about the size of a fingertip, so use simple bold shapes, thick even dark charcoal outlines, flat solid colors, very few details and strong contrast against the background. No thin lines, no small decorations, no texture, no gradients.

The subject: a big simple folded paper map seen from the front, standing upright and filling the lower half of that circle: three tall panels with zigzag folds, pale cream, with a thick dark charcoal outline. On the map there are only two big simple marks: one thick coral dashed line made of four short, fat dashes, and one small coral map pin at its end. 鬍鬍 peeks over the top edge of the map: we see his head and his two front paws gripping the top edge of the map. He looks at the viewer with a happy, friendly smile, and his whole face is above the map.

NOT ALLOWED ANYWHERE: no text of any kind (no letters, no words, no numbers, no Chinese or Japanese characters, no app name, no logo lettering, no signature, no watermark); the map has no words, no place names and no other marks. No characters other than 鬍鬍; no people, no other animals. No sparkles, stars, hearts, motion lines, speech bubbles or any other loose marks floating around. No scenery and no floor.
```

## 哪些照抄、哪些是新寫的

- 第一段：照 `docs/ART_行程海報生圖流程.md` 第 2.1 節的九宮格版（跟底部分頁 07 v2 那份一樣）逐字照抄。
  - 方向二改一處：`(the white dog)` 改成 `(the round white bird)`，因為方向二上傳的大圖是湯圓。
- 角色描述那一行：從第 2.1 節六隻的描述裡，逐字抄用到的那一隻。
- 新寫的：
  - 「Draw only this one character」那一句；
  - 圖示那兩段（滿版底色、安全圓、小尺寸）；
  - 每個方向的主體；
  - NOT ALLOWED。NOT ALLOWED 照 2.3 節的句型寫。

## 看到這些就直接重生

- **有字**：含 App 名稱、浮水印，相機、地圖、地圖針上出現字也算。
- **畫成「一張圖示的照片」**：底色裡又畫一個圓角方塊、圓形徽章、外框、陰影或手機。整張就要是圖示，這正是現在舊圖示的毛病。
- 主體太小，不到整張寬的一半；或耳朵、毛帽、地圖碰到畫面邊緣。
- 多一隻、換成別的角色，或認不出是鬍鬍／湯圓。
- 畫成全身、加了風景或地面。

## 可以接受、不用重生

- 鬍鬍有點灰、毛帽顏色偏、底色跟色碼差一點：照路線 A 畫向量時，用參考圖與色碼的正確樣子。
- 道具的樣子跟描述有點出入，但看得出是相機、地圖針或地圖。
- 主體超出「中央 2/3 的圓」一點點：最後的位置由我照規格放。

## 收件之後我做的

1. 從 Dispatch outputs 複製進 `art-inbox/`，核 sha256；原圖不進 repo。
2. **小樣**：
   - 每一張縮成 192、48、32、16 px，各放在白色與深色桌面底上；
   - 疊一個規格安全圓，直徑是圖示寬的 80%；
   - 三個方向並排，交 Dispatch 給 Yolin 挑。
   - 這一步用 sharp 畫，不開瀏覽器。
3. 挑定之後畫向量，輸出：
   - `icon-192.png`、`icon-512.png`；
   - `icon-maskable-512.png`：滿版，主體在安全圓內；
   - `apple-touch-icon.png`：180 px，不透明。
4. 加一支檢查：
   - 尺寸對；
   - apple 那張沒有透明；
   - 主體的像素都在安全圓內；
   - 配對照組：故意把主體放大到出圈，必須紅。
5. 照每版流程升版號、跑受影響的測試、等放行再推。

**【推論】已經裝在手機桌面上的圖示不一定會跟著換**：
- iPhone 加到主畫面的圖示，多半要移除再加一次才會換；
- Android 由 Chrome 自己找時間更新，時間不一定。

上線時要照實告訴 Yolin 和家人。
