# TripQuest App 圖示：生圖提示詞（v3 合併版，2026-11-19）

> **v3（同日 11:0x，Yolin 經 Dispatch）**：三個方向合成**一張 3×3**，一次生完再切，省 GPT 用量。
> - 每一列是一個方向，每一欄是同一個方向的一種變體，一共 9 個選項。
> - 每一格的底色畫滿那一格的正方形，格子之間是洋紅間隔。
> - v2 的三段單張提示詞留在本檔最後的附錄，只有「挑定之後想直接用 GPT 原圖」時才用（理由見「解析度夠不夠」）。
> - Dispatch outputs 裡的 v2 以前的版本作廢。

給 Yolin 用 GPT 生 App 圖示的參考圖。挑好方向之後，我照著畫成向量，再輸出各種尺寸。

## 先看這段：為什麼要換、規格限制

**現在的圖示**（v1.0 到現在沒換過）：藍色圓角方塊裡一個白色圓圈加一顆橘點。

- 跟 App 現在的樣子（和紙配色、六隻吉祥物）沒有關係。
- 圖檔本身就是「深藍底，裡面再畫一個圓角方塊」。手機會再幫圖示切一次圓角，所以桌面上看到的是兩層框、圖案偏小。這一點讀 `icons/` 裡四張圖看過。

**規格限制**：

| 限制 | 要求 | 由誰守 |
|---|---|---|
| maskable 安全區 | 最小安全區：中央一個圓，半徑是圖示寬的 40%（直徑 80%）；最外圈約 10% 在某些平台會被切掉。出處：web.dev〈Maskable icons〉，2026-11-19 讀過原文。web.dev 說這是標準定的，連到 W3C Web App Manifest 的 icon masks 那一節；那一節這次**沒有讀到原文**，節號與錨點未核 | 提示詞要 GPT 把每一格重要的東西收在那一格中央直徑約 2/3 的圓裡，比規格保守，因為 GPT 不會畫得剛好。最後的尺寸與位置由我畫向量時照規格放 |
| 一格就是一張圖示 | 每一格的底色畫滿那一格的正方形，不在格子裡再畫圓角方塊或徽章 | 提示詞寫明；畫了就算那一格壞 |
| 小尺寸認得出來 | 桌面上大約一個指尖寬，設定頁、分頁標籤上還更小（32、16 px） | 一隻、只畫頭和胸口、大道具、粗外框、平塗、少細節。**不放一群** |
| 不放字 | 連 App 名稱都不放 | 提示詞寫明；有字就重生 |
| 白底、黑底的桌面都要有邊 | 底色選中間亮度的顏色 | 三種底色對白、對黑的對比都在 3:1 以上（照 WCAG 相對亮度公式算的，見下表） |

**做出來怎麼用**：GPT 的圖只當參考（跟底部分頁那次同一條路線 A），挑定之後我畫成向量。理由：
- 16 px 到 1024 px 都清楚；
- 顏色照 App 的配色；
- 安全區照規格精準放；
- iPhone 的圖示不能有透明，向量輸出時直接處理。

## 格子配置（3×3）

每一列一個方向，同一列同一個底色；每一欄是一種變體。

| | 第 1 欄：原設計 | 第 2 欄：最簡單（縮到 16 px 最不糊） | 第 3 欄：換個姿勢 |
|---|---|---|---|
| **第 1 列：鬍鬍拿相機**（磚珊瑚 #C8553D） | 1. 胸像，雙手把淺藍相機捧在胸前 | 2. 只有大頭，笑著，沒有道具 | 3. 一手在臉旁揮，相機用短帶子掛在胸前 |
| **第 2 列：湯圓與地圖針**（亮藍 #4F8DFF，沿用舊圖示的藍） | 4. 橘色地圖針的圓頭裡有個奶油色圓，湯圓的胸像在圓裡 | 5. 只有湯圓的頭和上半身，沒有地圖針 | 6. 湯圓整隻坐在地圖針的圓頭上面 |
| **第 3 列：鬍鬍探頭**（森林綠 #3E7D5A） | 7. 從摺地圖上緣探頭，地圖上一條珊瑚色虛線＋小地圖針 | 8. 從摺地圖上緣探頭，地圖上什麼都沒有 | 9. 從淺藍小行李箱上緣探頭 |

**對比**（算的）：磚珊瑚對白 4.4、對黑 4.8；亮藍 3.2／6.6；森林綠 4.9／4.3。

**我的看法**：
- 第 1 列最能代表 App（鬍鬍是頁首那隻），首選。
- 第 2 列最不怕縮小。
- 第 3 列最有 App 自己「探頭」的味道，但細節最多。
- 每一列的第 2 欄是「最簡單」的版本：16、32 px 的時候通常是它最清楚，可以拿來跟第 1 欄比。

## 解析度夠不夠

- **實測**：之前收到的 3×3 九宮格 4 張都是 **1254×1254**（底部分頁、吉祥物融入、吉祥物動作、組 A）。
- **推算**：每一格的色塊約 350 px 見方。外圍留白與格子間隔各約 4%：1254 ×（1 − 4 × 4%）÷ 3 ≈ 351。主體收在中央 2/3，約 230 px。
- **當參考畫向量：夠**。底部分頁那張參考圖，每格主體 199～335 px，照著畫成向量的頭像已經上線（v1.96.0）。這次主體差不多大。（推論，照前例。）
- **給 Yolin 看的小樣：夠**。從 350 px 縮成 192、48、32、16 px 都是縮小。
- **直接拿 GPT 原圖當圖示：不夠**。圖示要 512 px（maskable 與一般那兩張），350 px 要放大約 1.5 倍，會糊。
  - 真的要用原圖，就挑定方向之後，用附錄那個方向的單張提示詞再生一張（單張約 1024～1254 px）。
  - 我還是建議畫向量，就不需要這一張。
- **2×2 可以多一點細節、但選項少一半**：每格約 550 px，只放得下 4 個選項。這次是參考圖，選項多比較有用，所以選 3×3。

## 怎麼生（照 `docs/ART_行程海報生圖流程.md` 步驟 3）

> 2026-11-19 起，參考圖改用 GPT 生過的圖，見 `docs/ART_行程海報生圖流程.md` 第 3.3 節。本節是當時的做法。

1. 開一個**新對話**。
2. 先上傳兩張參考圖，都在 Dispatch outputs 的 `TripQuest_吉祥物參考圖/`：
   - `00_六隻總表.png`
   - `03_鬍鬍_白色迷你雪納瑞_正面全身.png`（鬍鬍佔 6 格，而且屢次被畫成灰色）
3. 把下面的提示詞**整段**貼上、送出。
4. 比例選**正方形 1:1**。
5. 用**下載鈕**存原檔，不要截圖。

## 合併提示詞

```
Use the two uploaded reference images: a sheet of six original cute characters, and a large picture of one of them (the white dog). Draw the characters exactly as they look in the references: same body shape and proportions, same face, same colors, same outfits and accessories, same clean sticker style with thick, even, dark charcoal outlines and flat solid colors. Do not redesign them, do not change any color, do not add or remove clothes, pockets or accessories, and do not turn them into other characters or realistic animals. They may hold the small props listed below; their bodies, faces, colors and outfits stay exactly as in the reference. Do not copy the names or any other text from the reference sheet.

Draw only these two characters, as in the reference:
- 鬍鬍: a white miniature schnauzer. His fur is pure white everywhere: head, face, body and paws are all white, never grey. Only his bushy eyebrows are grey. His floppy ears are a very pale warm grey. A big white beard and moustache, pink cheeks, and a coral triangle bandana around his neck.
- 湯圓: a round white long-tailed tit. A white egg-shaped body; a green knit beanie with a yellow pom-pom; a tiny black beak (black, not orange); black wings; a long black tail; pink cheeks; small black feet. No brown anywhere.

These are 9 design studies for the home-screen icon of a phone app, drawn as one sheet. Square image, 1:1. Exactly 9 separate solid colored squares arranged in a 3×3 grid, all the same size, with sharp square corners. Each colored square is one complete app icon: its background color fills the whole square, edge to edge and corner to corner, with no white or magenta showing inside the square. Behind and between the squares, the picture is one flat, solid, pure magenta color #FF00FF: no gradient, no texture, no noise, no vignette, no shadow. Leave a clearly empty magenta gap about 4% of the picture's width between neighboring squares, and an empty magenta margin of the same width around the outside of the whole grid. Do not draw grid lines, borders, frames, labels, captions, numbers or any text.

Inside each square, draw one big subject in the middle. Everything important, including ears, the beard, the beanie, the pom-pom and every prop, fits inside an imaginary circle in the center of that square whose diameter is two thirds of the square's width; outside that circle there is only the square's flat background color. Do not draw this circle. Do not draw a second rounded square, a circle badge, a frame or a drop shadow inside a square. Each icon will be seen very small, about the size of a fingertip, so use simple bold shapes, thick even dark charcoal outlines, flat solid colors, very few details and strong contrast against the background. No thin lines, no small decorations, no texture, no gradients. The characters face the viewer with a happy, friendly smile. Do not use magenta, fuchsia or hot pink anywhere in the characters, props or square backgrounds; the coral bandana stays coral and the cheeks stay a soft pink.

Background colors: the three squares of the top row are warm brick coral #C8553D; the three squares of the middle row are bright medium blue #4F8DFF; the three squares of the bottom row are medium forest green #3E7D5A.

The nine squares, left to right, top row first:
1. 鬍鬍 as a bust (head and the top of the chest). He holds a small simple light blue camera with one big round lens and a dark charcoal lens ring in front of his chest with both paws, below his beard; his whole face stays visible.
2. Only 鬍鬍's head, big, filling most of the circle. No prop.
3. 鬍鬍 as a bust, waving one paw beside his face. The same small light blue camera hangs on a short strap in front of his chest; his whole face stays visible.
4. One big simple map pin (a location marker with a round head and a pointed tip at the bottom), standing upright, warm orange #FFB454 with a thick dark charcoal outline. The round head of the pin has a big pale cream circle in its middle, and 湯圓 is inside that cream circle as a bust, filling most of it; his green beanie with the yellow pom-pom may stick out a little above the top of the pin. His tail is not shown.
5. Only 湯圓's head and the top of his round body, big, filling most of the circle. No pin, no prop. His tail is not shown.
6. The same orange map pin, standing upright, with a plain cream circle in its round head. 湯圓, whole and small, sits on top of the round head of the pin like a bird perched on a ball; his long black tail hangs down behind the pin.
7. A big simple folded paper map seen from the front, standing upright and filling the lower half of the circle: three tall panels with zigzag folds, pale cream, with a thick dark charcoal outline. On the map there are only two big simple marks: one thick coral dashed line made of four short, fat dashes, and one small coral map pin at its end. 鬍鬍 peeks over the top edge of the map: we see his head and his two front paws gripping the top edge. His whole face is above the map.
8. The same folded pale cream map, but with nothing on it at all. 鬍鬍 peeks over its top edge the same way, his head and two front paws above the map.
9. A small simple light blue suitcase standing upright, seen from the front, filling the lower half of the circle, with a thick dark charcoal outline and no stickers. 鬍鬍 peeks over the top edge of the suitcase: we see his head and his two front paws resting on top of it. His whole face is above the suitcase.

NOT ALLOWED ANYWHERE: no text of any kind (no letters, no words, no numbers, no Chinese or Japanese characters, no app name, no logo lettering, no labels, no signature, no watermark); every camera, pin, map and suitcase is blank apart from what is described. No characters other than 鬍鬍 and 湯圓; no people, no other animals. No sparkles, stars, hearts, motion lines, speech bubbles or any other loose marks floating around. No scenery and no floor inside the squares.
```

## 哪些照抄、哪些是新寫的

- **照抄**：
  - 第一段：照 `docs/ART_行程海報生圖流程.md` 第 2.1 節的九宮格版逐字照抄，跟底部分頁 07 v2 那份一樣。
  - 兩行角色描述：從第 2.1 節六隻的描述裡，逐字抄鬍鬍和湯圓那兩行。
  - 「Do not use magenta…」那一句：照第 2.3 節的句型，填空寫成珊瑚色領巾、粉色臉頰。
- **照第 2.3 節改寫的**：版面那一段。
  - 原本整張是洋紅底、格子裡是角色；這次每一格是一塊畫滿的色塊，洋紅只在色塊之間。
  - 所以拿掉了 2.3 那句「Do not draw … boxes」，改成「每一塊色塊就是一張圖示」。
- **新寫的**：
  - 「Draw only these two characters」；
  - 圖示的安全圓與小尺寸那一段；
  - 三列的底色；
  - 九格的內容；
  - NOT ALLOWED 的填空。
- 每一格的主體寫法跟 v2 三個方向的單張提示詞一致：第 1、4、7 格就是 v2 的方向一、二、三。

## 看到這些就直接重生

- **有字**：含格子編號、標籤、浮水印；相機、地圖、地圖針、行李箱上出現字也算。
- **格子底色沒畫滿**：色塊只是一個圓、或角色背後一小塊顏色，其餘是洋紅或白色。這樣看不出整張圖示的樣子。
- **底色不是一整片洋紅**，或格子之間沒有間隔（黏在一起）：切不開。
- 格數不是 9、不是 3×3。
- 一大半的格子認不出是鬍鬍／湯圓，或多出別的角色。

## 可以接受、不用重生

- **個別幾格壞了**：主體碰到色塊邊緣、格子裡又畫了圓角方塊、姿勢不對。那幾格不用，其餘照用——這張是給 Yolin 挑方向的。
- 色塊的角是圓的。
- 鬍鬍有點灰、湯圓嘴色偏、底色跟色碼差一點：畫向量時用參考圖與色碼的正確樣子。
- 道具的樣子跟描述有點出入，但看得出是相機、地圖針、地圖或行李箱。

## 收件之後我做的

1. 從 Dispatch outputs 複製進 `art-inbox/`，核 sha256；原圖不進 repo。
2. **切圖**：用 `scripts/art-slice.mjs --grid 3` 照洋紅間隔切成 9 格，再把每格的色塊裁出來。
   - 原本是【推論】：art-slice 的對照組是「洋紅底上的角色」，這次每一格是整塊色塊，照它的做法應該切得開。**2026-11-19 實測切得開**：第一張 3×3 切成 9 格、rc 0、對照組全符合；每格色塊約 347～354 px，去掉洋紅之後九格的洋紅毛邊都是 0 點。
3. **小樣**：
   - 每一格縮成 192、48、32、16 px，各放在白色與深色桌面底上；
   - 疊一個規格安全圓，直徑是圖示寬的 80%；
   - 九格排成一張，交 Dispatch 給 Yolin 挑。
   - 這一步用 sharp 畫，不開瀏覽器。
4. **挑定之後**畫向量，輸出：
   - `icon-192.png`、`icon-512.png`；
   - `icon-maskable-512.png`：滿版，主體在安全圓內；
   - `apple-touch-icon.png`：180 px，不透明。
5. **加一支檢查**：
   - 尺寸對；
   - apple 那張沒有透明；
   - 主體的像素都在安全圓內；
   - 配對照組：故意把主體放大到出圈，必須紅。
6. 照每版流程升版號、跑受影響的測試，等放行再推。

**v1.98.0 照這幾步做完（2026-11-19）**：Yolin 選第 1 格（鬍鬍捧相機），第 3 版直接描第 1 格原圖、不加外框。
- 第 4 步：向量原稿在 `icons/src/icon.svg`（一般）與 `icons/src/icon-maskable.svg`；`npm run icons`（`scripts/make-icons.mjs`）從原稿畫出四張 PNG。改原稿就重跑它。
- 第 5 步：`scripts/icontest.mjs`（測試鏈最後一支）：尺寸、沒有透明、maskable 主體在安全圓內、PNG 跟原稿重畫的一樣、manifest 與 index.html 宣告的尺寸與連結；每一道各一個對照組（放大 1.25 倍出圈那個就是這裡寫的「故意把主體放大到出圈」）。突變 `tools/mutations/mut_icon1119.json`。
- 描圖的方法與當時的檢查記在 `docs/STATUS.md` v1.98.0 那一節；一次性腳本與 GPT 原圖不進 repo。

**【推論】已經裝在手機桌面上的圖示不一定會跟著換**：
- iPhone 加到主畫面的圖示，多半要移除再加一次才會換；
- Android 由 Chrome 自己找時間更新，時間不一定。

上線時要照實告訴 Yolin 和家人。

---

## 附錄：單張提示詞（v2；只有「直接用 GPT 原圖」時才用）

一個方向一張、正方形 1:1。上傳：
- 方向一、三：`00` 加 `03_鬍鬍`；
- 方向二：`00` 加 `04_湯圓_長尾山雀_正面全身.png`。

這三段跟 v2 逐字相同。

### 方向一：鬍鬍拿相機

```
Use the two uploaded reference images: a sheet of six original cute characters, and a large picture of one of them (the white dog). Draw the characters exactly as they look in the references: same body shape and proportions, same face, same colors, same outfits and accessories, same clean sticker style with thick, even, dark charcoal outlines and flat solid colors. Do not redesign them, do not change any color, do not add or remove clothes, pockets or accessories, and do not turn them into other characters or realistic animals. They may hold the small props listed below; their bodies, faces, colors and outfits stay exactly as in the reference. Do not copy the names or any other text from the reference sheet.

Draw only this one character, as in the reference:
- 鬍鬍: a white miniature schnauzer. His fur is pure white everywhere: head, face, body and paws are all white, never grey. Only his bushy eyebrows are grey. His floppy ears are a very pale warm grey. A big white beard and moustache, pink cheeks, and a coral triangle bandana around his neck.

This picture is the home-screen icon of a phone app. Square image, 1:1. The whole picture is the icon itself: fill the entire square, edge to edge and corner to corner, with one flat, solid, opaque background color #C8553D (a warm brick coral). Do not draw an app icon tile, a rounded square, a circle badge, a phone, a frame, a border, a drop shadow or a second background around the drawing; the phone will round the corners by itself.

Draw one big subject in the middle. Everything important, including the ears, the beard and the prop, fits inside an imaginary circle in the center of the picture whose diameter is two thirds of the picture's width; outside that circle there is only the flat background color. Do not draw this circle. The icon will be seen very small, about the size of a fingertip, so use simple bold shapes, thick even dark charcoal outlines, flat solid colors, very few details and strong contrast against the background. No thin lines, no small decorations, no texture, no gradients.

The subject: 鬍鬍 as a bust (his head and the top of his chest), large and centered, facing the viewer with a happy, friendly smile. His head is the biggest shape in the picture. He holds a small simple camera with one big round lens in front of his chest with both paws, below his beard; his whole face stays visible. The camera is light blue with a dark charcoal lens ring and is blank.

NOT ALLOWED ANYWHERE: no text of any kind (no letters, no words, no numbers, no Chinese or Japanese characters, no app name, no logo lettering, no signature, no watermark); the camera is blank. No characters other than 鬍鬍; no people, no other animals. No sparkles, stars, hearts, motion lines, speech bubbles or any other loose marks floating around him. No scenery and no floor.
```

### 方向二：湯圓坐在地圖針裡

```
Use the two uploaded reference images: a sheet of six original cute characters, and a large picture of one of them (the round white bird). Draw the characters exactly as they look in the references: same body shape and proportions, same face, same colors, same outfits and accessories, same clean sticker style with thick, even, dark charcoal outlines and flat solid colors. Do not redesign them, do not change any color, do not add or remove clothes, pockets or accessories, and do not turn them into other characters or realistic animals. They may hold the small props listed below; their bodies, faces, colors and outfits stay exactly as in the reference. Do not copy the names or any other text from the reference sheet.

Draw only this one character, as in the reference:
- 湯圓: a round white long-tailed tit. A white egg-shaped body; a green knit beanie with a yellow pom-pom; a tiny black beak (black, not orange); black wings; a long black tail; pink cheeks; small black feet. No brown anywhere.

This picture is the home-screen icon of a phone app. Square image, 1:1. The whole picture is the icon itself: fill the entire square, edge to edge and corner to corner, with one flat, solid, opaque background color #4F8DFF (a bright medium blue). Do not draw an app icon tile, a rounded square, a circle badge, a phone, a frame, a border, a drop shadow or a second background around the drawing; the phone will round the corners by itself.

Draw one big subject in the middle. Everything important, including the beanie, the pom-pom and the whole pin, fits inside an imaginary circle in the center of the picture whose diameter is two thirds of the picture's width; outside that circle there is only the flat background color. Do not draw this circle. The icon will be seen very small, about the size of a fingertip, so use simple bold shapes, thick even dark charcoal outlines, flat solid colors, very few details and strong contrast against the background. No thin lines, no small decorations, no texture, no gradients.

The subject: one big simple map pin (a location marker with a round head and a pointed tip at the bottom), standing upright in the middle. The pin is warm orange #FFB454 with a thick dark charcoal outline. The round head of the pin has a big pale cream circle in its middle, and 湯圓 is inside that cream circle as a bust (his head and the top of his round body), facing the viewer with a happy, friendly smile and filling most of the circle. His green beanie with the yellow pom-pom may stick out a little above the top of the pin. His long tail is not shown.

NOT ALLOWED ANYWHERE: no text of any kind (no letters, no words, no numbers, no Chinese or Japanese characters, no app name, no logo lettering, no signature, no watermark); the pin is blank. No characters other than 湯圓; no people, no other animals. No sparkles, stars, hearts, motion lines, speech bubbles or any other loose marks floating around. No map, no roads, no scenery and no floor.
```

### 方向三：鬍鬍從地圖後面探頭

```
Use the two uploaded reference images: a sheet of six original cute characters, and a large picture of one of them (the white dog). Draw the characters exactly as they look in the references: same body shape and proportions, same face, same colors, same outfits and accessories, same clean sticker style with thick, even, dark charcoal outlines and flat solid colors. Do not redesign them, do not change any color, do not add or remove clothes, pockets or accessories, and do not turn them into other characters or realistic animals. They may hold the small props listed below; their bodies, faces, colors and outfits stay exactly as in the reference. Do not copy the names or any other text from the reference sheet.

Draw only this one character, as in the reference:
- 鬍鬍: a white miniature schnauzer. His fur is pure white everywhere: head, face, body and paws are all white, never grey. Only his bushy eyebrows are grey. His floppy ears are a very pale warm grey. A big white beard and moustache, pink cheeks, and a coral triangle bandana around his neck.

This picture is the home-screen icon of a phone app. Square image, 1:1. The whole picture is the icon itself: fill the entire square, edge to edge and corner to corner, with one flat, solid, opaque background color #3E7D5A (a medium forest green). Do not draw an app icon tile, a rounded square, a circle badge, a phone, a frame, a border, a drop shadow or a second background around the drawing; the phone will round the corners by itself.

Draw one big subject in the middle. Everything important, including the ears, the paws and the whole map, fits inside an imaginary circle in the center of the picture whose diameter is two thirds of the picture's width; outside that circle there is only the flat background color. Do not draw this circle. The icon will be seen very small, about the size of a fingertip, so use simple bold shapes, thick even dark charcoal outlines, flat solid colors, very few details and strong contrast against the background. No thin lines, no small decorations, no texture, no gradients.

The subject: a big simple folded paper map seen from the front, standing upright and filling the lower half of that circle: three tall panels with zigzag folds, pale cream, with a thick dark charcoal outline. On the map there are only two big simple marks: one thick coral dashed line made of four short, fat dashes, and one small coral map pin at its end. 鬍鬍 peeks over the top edge of the map: we see his head and his two front paws gripping the top edge of the map. He looks at the viewer with a happy, friendly smile, and his whole face is above the map.

NOT ALLOWED ANYWHERE: no text of any kind (no letters, no words, no numbers, no Chinese or Japanese characters, no app name, no logo lettering, no signature, no watermark); the map has no words, no place names and no other marks. No characters other than 鬍鬍; no people, no other animals. No sparkles, stars, hearts, motion lines, speech bubbles or any other loose marks floating around. No scenery and no floor.
```
