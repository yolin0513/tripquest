# 生圖素材：九宮格提示詞與收件流程（2026-11-16）

Yolin 想先手動用 ChatGPT 生圖、看效果，再決定要不要付費改用 API。分工如下：
1. Session 寫提示詞。
2. Yolin 自己貼進 ChatGPT，把圖丟進收件資料夾。
3. Session 切圖、去背、出總表。
4. Yolin 逐格確認過，才進正式素材目錄、進版控。

**吉祥物不交給生圖**，維持程式自己畫（`js/glyphs.js`、`js/peeks.js`）。

ChatGPT 是 Yolin 自己的帳號、他自己操作。Session 不建帳號、不登入、不呼叫任何生圖服務。

免費額度只夠生幾次，所以：
- 小東西一張圖排 3×3，一次出 9 個。
- 滿版的只留一張。

---

## 0. 先決定的事（決定之前，用不到的組先不要生）

海報現在的規定擋著三種用法。要用，得先改規定：

| 素材 | 擋住它的規定 | 不改規定時能用在哪 |
|---|---|---|
| 組 A 景點類型圖示 | **B11**：海報上每站不准放類別圖示（只准天氣圖示，交通是畫的） | App 畫面（行程列表、景點頁），海報不放 |
| 組 B 裝飾 | **B17**：路旁裝飾只准星星、圓點、短線三種，半徑不超過 12px | 回顧、主頁的空白處 |
| 單張 D 頁首插圖 | **B18**：每一個字都要在不透明的底上、或沒鋪點的地方 | 要另寫一條「字底下的插圖像素對比 ≥ 4.5」的新檢查才能墊在字後面 |

**建議的生圖順序：**
1. 試作先生組 A：它的資料規則最清楚——景點庫的類型剛好 9 種，一格一種。就算海報不放，App 畫面也用得到。
2. 再來是單張 D：它是當初「海報背景改用生圖」的原意。
3. 最後是組 B。

組 C 先不要生（理由見那一節）。

---

## 1. 給 Yolin：怎麼生、怎麼存

1. **先只生一張當試作（組 A）。**
   - 丟進收件資料夾後，Session 會量四件事：實際解析度、底色純不純、格子間隔夠不夠、有沒有偷加字。
   - 量過沒問題再生下一張；有問題就先改提示詞，不要連生。
2. 每一段提示詞整段複製、貼進 ChatGPT、送出。**不要另外加話**——加了常會讓它多畫東西或寫字。
3. **用 ChatGPT 的下載鈕存原檔，不要截圖。** 截圖會變小、邊緣會糊，切出來就不夠清楚。
4. 存進收件資料夾：repo 根目錄底下的 **`art-inbox/`**。
   - 這個資料夾被 `.gitignore` 擋掉，丟進去不會進 repo、不會公開。
   - 檔名隨意；方便的話開頭寫組別字母，例如 `A-第一次.png`。
   - 人在外面、不方便放進那台電腦的話，可以傳給 Dispatch，由 Session 複製進去。
5. 生出來有字、有格線、底色不是一整片同色、或格子擠在一起，都不用自己修：照樣丟進來，Session 會判斷要不要重生。

---

## 2. 通用風格句（下面每一段提示詞都已經放進去，不用另外貼）

只寫構造（線寬、平塗、色碼），不寫「像某某風格」。顏色取自 App 和紙主題與吉祥物實際用的色碼：
- 墨線 `#2F2C2A`
- 毛色白 `#FBF9F5`、淺灰 `#ECE6DE`
- 珊瑚粉 `#F2A497`、奶油黃 `#F6D27A`、抹茶綠 `#B9DAA5`、天空藍 `#AAD3E7`、薰衣草紫 `#D2C3E7`

> Flat sticker-style illustration. Thick, even, dark charcoal outlines (#2F2C2A) with rounded ends and rounded corners. Flat solid fills only — no gradients, no textures, no shading, no drop shadows. Pastel palette only: cream white #FBF9F5, light warm grey #ECE6DE, coral #F2A497, butter yellow #F6D27A, matcha green #B9DAA5, sky blue #AAD3E7, lilac #D2C3E7, plus the charcoal outline color. Chunky, rounded, simple shapes with very little detail, friendly and cute. Original design: not based on or resembling any existing character, mascot, brand, logo or franchise. No people, no animals, no faces on objects. No text, no letters, no numbers, no symbols that look like writing.

---

## 3. 九宮格的共同要求（已經放進組 A、B、C 的提示詞）

格子要能讓程式自動切。底色用**純洋紅 `#FF00FF`**，之後由程式去背。

**為什麼不用白或綠：**
- 白底：主體裡白色的部分（白毛色、白色反光）如果碰到外面，會被一起去掉，程式分不出來。
- 綠底：自然類圖示本來就要畫綠色。
- 洋紅跟上面每一個色碼都差很遠，主體也用不到它。
- 模型畫不畫得出一整片純洋紅，要等試作那張才知道（**待驗**）。
- 畫不好就換底色重生。換的是提示詞裡寫底色的那幾個字，程式從圖的邊框量底色、不寫死。

> Square image, 1:1. Exactly 9 separate items arranged in a 3×3 grid of equal square cells. The entire background is one flat, solid, pure magenta color #FF00FF — no gradient, no texture, no noise, no shadow, no vignette, no floor, no scenery. Leave wide, clearly empty magenta gaps between neighboring cells, and an empty magenta margin around the outside of the whole grid. Each item is centered in its own cell and fully inside it, with generous empty space on every side; no item crosses into another cell or touches the image edge. Each item is one single compact connected shape — not long and thin, not made of several separate small pieces. Do not draw grid lines, borders, frames, boxes, labels, captions or any text. Do not use magenta, purple-pink or hot pink anywhere in the items.

---

## 4. 組 A：景點類型圖示（9 格；建議先生這一組當試作）

**用途**：App 畫面上每個景點旁邊的小圖示，只給「對得上景點庫」的景點用。要上海報得先改 B11（見第 0 節）。

**九格對應景點庫的 9 種類型**（`data/places/schema.json` 的 `tags`／`primary`），由左到右、由上到下。

**只畫到資料的粒度**：景點庫只說「美食」，圖就不能畫成某一道菜，所以碗是蓋著的、袋子看不到內容。現在 App 對 food 用的表情符號 🍜（一碗麵）是一道特定的菜，這裡不照抄。也不畫任何真實地標或國家特有的東西。

| 格 | 類型 | 中文 | 畫什麼 |
|---|---|---|---|
| 1 | `sight` | 景點 | 三根柱子加三角屋頂的建築正面（泛用的博物館樣子，不是哪一棟真的建築） |
| 2 | `food` | 美食 | 蓋著蓋子的碗、看不到內容，上面放一雙筷子，三縷熱氣 |
| 3 | `nightmarket` | 夜市 | 條紋遮雨棚的小攤子，掛一串三顆圓燈籠（燈籠上沒有字，攤上看不到食物） |
| 4 | `snack` | 小吃 | 小紙杯插一根木籤，看不到裡面是什麼 |
| 5 | `checkin` | 打卡 | 手機，螢幕上只有一個閃光符號（沒有任何介面或字） |
| 6 | `culture` | 文化 | 一捲用緞帶綁起來的紙卷軸 |
| 7 | `nature` | 自然 | 兩座圓圓的綠色小山加一棵圓樹（沒有太陽） |
| 8 | `shopping` | 購物 | 有兩條提把的購物袋（素面，沒有標誌） |
| 9 | `view` | 景觀 | 一副望遠鏡 |

**切完的用途與尺寸**：透明背景的方形 PNG。
- App 畫面約 28 CSS px，高解析手機上約 84 個實際像素。
- 海報上約 44px（海報寬 1240）。

**提示詞全文（整段複製）：**

```
Flat sticker-style illustration. Thick, even, dark charcoal outlines (#2F2C2A) with rounded ends and rounded corners. Flat solid fills only — no gradients, no textures, no shading, no drop shadows. Pastel palette only: cream white #FBF9F5, light warm grey #ECE6DE, coral #F2A497, butter yellow #F6D27A, matcha green #B9DAA5, sky blue #AAD3E7, lilac #D2C3E7, plus the charcoal outline color. Chunky, rounded, simple shapes with very little detail, friendly and cute. Original design: not based on or resembling any existing character, mascot, brand, logo or franchise. No people, no animals, no faces on objects. No text, no letters, no numbers, no symbols that look like writing.

Square image, 1:1. Exactly 9 separate items arranged in a 3×3 grid of equal square cells. The entire background is one flat, solid, pure magenta color #FF00FF — no gradient, no texture, no noise, no shadow, no vignette, no floor, no scenery. Leave wide, clearly empty magenta gaps between neighboring cells, and an empty magenta margin around the outside of the whole grid. Each item is centered in its own cell and fully inside it, with generous empty space on every side; no item crosses into another cell or touches the image edge. Each item is one single compact connected shape — not long and thin, not made of several separate small pieces. Do not draw grid lines, borders, frames, boxes, labels, captions or any text. Do not use magenta, purple-pink or hot pink anywhere in the items.

These are 9 small category icons for a travel app. Items, left to right, top row first:
1. The front of a small generic building with a triangular roof and three columns (not any real building).
2. A round bowl with its lid on, contents hidden, a pair of chopsticks resting on the lid, three small steam curls.
3. A tiny street stall with a striped awning and a string of three round paper lanterns; no food visible, nothing written on the lanterns.
4. A small paper snack cup with one wooden pick sticking out; the contents are not visible.
5. A smartphone whose blank screen shows only one simple sparkle shape; no interface, no writing.
6. A rolled paper scroll tied with a ribbon.
7. Two rounded green hills with one round tree; no sun.
8. A plain shopping bag with two handles; no logo.
9. A pair of binoculars.
```

---

## 5. 組 B：裝飾（9 格；要用在海報得先改 B17）

**用途**：回顧、主頁的空白處，或改了 B17 之後放在海報路旁。

**只挑不會被讀成資訊的東西**。刻意不放的：
- 天氣：太陽、雲、雨、雪、傘——海報上有天氣預報，晴天圖案放在下雨那天就是錯的資訊。
- 食物：放在某站旁邊會被讀成「這裡吃這個」。
- 交通工具，包括紙飛機、紙船：海報上的交通圖示是使用者選的方式。
- 地標、國家或季節特有的東西：櫻花、楓葉、鳥居、某棟塔。
- 愛心：App 裡愛心是按讚數。
- 相機：App 裡相機是拍照任務。

**也避開長條形與好幾個分開小塊組成的東西**（紙膠帶、彩旗串、星星群）：它們最容易跨格，內部的空隙也會被當成間隔。

| 格 | 畫什麼 |
|---|---|
| 1 | 空白信封（沒有地址、沒有字） |
| 2 | 緞帶蝴蝶結 |
| 3 | 一顆派對氣球（綁著一小段繩子，連在一起） |
| 4 | 素面行李箱（兩塊圓形色塊，沒有貼紙字） |
| 5 | 一顆大的四角閃光星 |
| 6 | 空白郵票框（波浪邊、中間空白） |
| 7 | 圓形徽章，中間一顆星 |
| 8 | 五片花瓣的小花（不是櫻花） |
| 9 | 素面背包 |

**切完的用途與尺寸**：透明背景的方形 PNG。
- 海報上預計 60～200px，回顧、主頁約 40～80 CSS px。
- **放大到約 230px 以上會糊**（見第 8 節）。

**提示詞全文（整段複製）：**

```
Flat sticker-style illustration. Thick, even, dark charcoal outlines (#2F2C2A) with rounded ends and rounded corners. Flat solid fills only — no gradients, no textures, no shading, no drop shadows. Pastel palette only: cream white #FBF9F5, light warm grey #ECE6DE, coral #F2A497, butter yellow #F6D27A, matcha green #B9DAA5, sky blue #AAD3E7, lilac #D2C3E7, plus the charcoal outline color. Chunky, rounded, simple shapes with very little detail, friendly and cute. Original design: not based on or resembling any existing character, mascot, brand, logo or franchise. No people, no animals, no faces on objects. No text, no letters, no numbers, no symbols that look like writing.

Square image, 1:1. Exactly 9 separate items arranged in a 3×3 grid of equal square cells. The entire background is one flat, solid, pure magenta color #FF00FF — no gradient, no texture, no noise, no shadow, no vignette, no floor, no scenery. Leave wide, clearly empty magenta gaps between neighboring cells, and an empty magenta margin around the outside of the whole grid. Each item is centered in its own cell and fully inside it, with generous empty space on every side; no item crosses into another cell or touches the image edge. Each item is one single compact connected shape — not long and thin, not made of several separate small pieces. Do not draw grid lines, borders, frames, boxes, labels, captions or any text. Do not use magenta, purple-pink or hot pink anywhere in the items.

These are 9 small decorative stickers for a travel poster. Items, left to right, top row first:
1. A blank envelope; no address, no writing.
2. A ribbon bow.
3. One party balloon with a short string attached.
4. A plain suitcase with two round colored patches; no stickers with writing.
5. One large four-pointed sparkle star.
6. A blank postage-stamp frame with a scalloped edge and an empty center.
7. A round pin badge with one star in the middle.
8. A simple five-petal flower (not a cherry blossom).
9. A plain backpack.
```

---

## 6. 組 C：食物種類（9 格；**先不要生**）

**為什麼先不要生**：景點庫的「必吃」（`must`，40 個地點、共 153 項）是自由文字，例如一串菜名。要把一道菜配上「麵」「飯」「飲料」這種圖示，只能照名字猜——那正是設計原則禁止的。

要用這一組，得先有人逐項替 153 項必吃標上類別，寫進景點庫，再經人看過。那是資料工作，要不要做由 Yolin 決定。

在那之前，食物相關的圖示只用組 A 的「美食」「小吃」「夜市」三格，而且只看景點的類型、不看菜名。

| 格 | 畫什麼 |
|---|---|
| 1 | 一碗麵 |
| 2 | 一碗白飯 |
| 3 | 兩顆包子 |
| 4 | 插吸管的飲料杯 |
| 5 | 一碗剉冰 |
| 6 | 一串烤串 |
| 7 | 一隻蝦 |
| 8 | 紙袋裝的炸物 |
| 9 | 一個麵包 |

提示詞全文（真的要生時再用；格式跟組 A、B 相同）：

```
Flat sticker-style illustration. Thick, even, dark charcoal outlines (#2F2C2A) with rounded ends and rounded corners. Flat solid fills only — no gradients, no textures, no shading, no drop shadows. Pastel palette only: cream white #FBF9F5, light warm grey #ECE6DE, coral #F2A497, butter yellow #F6D27A, matcha green #B9DAA5, sky blue #AAD3E7, lilac #D2C3E7, plus the charcoal outline color. Chunky, rounded, simple shapes with very little detail, friendly and cute. Original design: not based on or resembling any existing character, mascot, brand, logo or franchise. No people, no animals, no faces on objects. No text, no letters, no numbers, no symbols that look like writing.

Square image, 1:1. Exactly 9 separate items arranged in a 3×3 grid of equal square cells. The entire background is one flat, solid, pure magenta color #FF00FF — no gradient, no texture, no noise, no shadow, no vignette, no floor, no scenery. Leave wide, clearly empty magenta gaps between neighboring cells, and an empty magenta margin around the outside of the whole grid. Each item is centered in its own cell and fully inside it, with generous empty space on every side; no item crosses into another cell or touches the image edge. Each item is one single compact connected shape — not long and thin, not made of several separate small pieces. Do not draw grid lines, borders, frames, boxes, labels, captions or any text. Do not use magenta, purple-pink or hot pink anywhere in the items.

These are 9 small food-type icons for a travel app. Items, left to right, top row first:
1. A bowl of noodles.
2. A bowl of plain white rice.
3. Two steamed buns.
4. A drink cup with a straw; no logo.
5. A bowl of shaved ice.
6. One grilled skewer.
7. One shrimp.
8. Fried snacks in a small paper bag; no logo.
9. One bread roll.
```

---

## 7. 單張 D：海報頁首插圖（滿版，1 張；不去背）

**用途**：海報最上面標題那一塊的底圖；回顧頁、主頁的頁首也可以裁一段用。

**限制：**
- 標題是墨色字壓在上面，所以整張要很淡。
- 上半部幾乎是空的淺米色天空，留給標題。
- 要墊在字後面，得先加「字底下插圖像素的對比 ≥ 4.5」的新檢查（見第 0 節的 B18）。

**不畫會被讀成資訊的東西**：
- 太陽、月亮、雨、雪：天氣有預報。
- 建築、地標：會被讀成目的地。
- 人、動物、交通工具、食物、字。

**比例**：要橫的（寬比高長）。ChatGPT 給得出橫圖就選橫的；給不出來就照方的生，Session 量過再說。

```
Wide landscape image (wider than tall). A very light, calm, simple landscape illustration to sit behind the title at the top of a travel poster: gentle rolling hills, one winding dotted path, a few simple round trees, a few small soft clouds. Flat solid fills, no gradients, no textures, no shading. Thick dark charcoal outlines (#2F2C2A) only on the nearest hills and trees; farther shapes have thin light outlines or none. Every fill color is very pale — pale cream #FBF6EC, pale beige #EFE4D2, very light matcha green, very light sky blue, very light coral — nothing darker than #EFE4D2 except the outlines. The upper half of the image is mostly empty pale cream sky so a dark title can sit on it. No sun, no moon, no rain, no snow, no umbrella. No buildings, no landmarks, no people, no animals, no vehicles, no food. No text, no letters, no numbers, no signature, no border, no frame. Original design, not resembling any existing artwork, brand or franchise.
```

---

## 8. 尺寸：每格大概多少像素、在 App 裡夠不夠

**實際解析度待量**。這一節的數字是推論，假設九宮格是 1024×1024、橫圖是 1536×1024；試作那張丟進來後，切圖腳本會印出每一格實際幾像素，再回來改這一節。

推算方式：
- 1024 寬分三格，每格約 340。
- 扣掉間隔與外圍留白，每格約 290。
- 主體四周再留白，主體本身約 200～240。

| 用在哪 | 需要多大 | 估計有多大 | 夠不夠 |
|---|---|---|---|
| 組 A：App 畫面 | 約 84 實際像素（28 CSS px × 3） | 約 200～240 | 夠 |
| 組 A：海報站牌 | 約 44 | 約 200～240 | 夠 |
| 組 B：回顧、主頁 | 約 240 實際像素（80 CSS px × 3） | 約 200～240 | **剛好**；再大就糊 |
| 組 B：海報裝飾 | 60～200 | 約 200～240 | 夠；**放到約 230 以上會糊** |
| 單張 D：海報頁首 | 寬 1240 | 橫圖約 1536 寬 | 夠（縮小用） |
| 單張 D：給不出橫圖、只有方圖時 | 寬 1240 | 1024 | **不夠**：要放大約 1.2 倍，會稍微糊 |

---

## 9. 收到圖之後（Session 做的）

1. **切圖** `node scripts/art-slice.mjs <圖> <輸出資料夾> --names a,b,…`：
   - 從圖的邊框量底色。
   - 先找「整列都是底色」的橫向間隔切成 3 列，再在每一列裡各自找直向間隔切成 3 格——模型常把各列排歪，所以不要求直向間隔整張上下貫通。
   - 每格檢查主體有沒有碰到格子邊（碰到就可能被切掉）、是不是空的。
   - 有任何一格不對就整張停、一個檔都不寫。
2. **去背** `node scripts/art-keyout.mjs <圖或資料夾> <輸出資料夾> [--holes auto|keep|clear]`：
   - 從四邊往內，把連著的底色去掉。
   - **被圍住的底色**（購物袋提把中間、蝴蝶結的圈）：底色是洋紅時自動當成洞去掉——提示詞規定物件不准用洋紅，所以被圍住的洋紅一定是洞；底色是別的顏色（例如白底）時留著、只報不擋，因為那可能是主體白色的部分。`--holes keep／clear` 可以強制指定。
   - 邊緣 2px 估半透明並扣掉底色成分（去色邊），放到淺色底上不會有一圈洋紅。
   - 檢查：主體沒被吃掉、四角透明、外圈幾乎全透明（碰到邊多半是切圖時被切到）、不是空的。
   - 輸入本來就透明的不去背，只做檢查。
3. **總表**：切圖腳本另出一張總表，每一格標位置編號與暫定名，交給 Dispatch 轉 Yolin 逐格看；去背腳本也出一張（透明處畫棋盤格，一眼看得出有沒有去乾淨）。
   - **格子是哪一類不能照位置認定**——模型會換順序或畫錯。位置給的只是暫定名，逐格看過才算數。
4. 確認要用的才複製進正式素材目錄 `media/art/<組>/`（進版控），同時在 `media/art/manifest.json` 登記：檔名、類別、准用在哪、來源（ChatGPT、日期、第幾組提示詞）。
5. 兩支腳本每次執行都會先跑自己的合成對照組（切圖 13 個、去背 9 個；該放行的要放行，該擋的要擋在對的那一關）。對照組沒有全部判對，就不處理真的圖。

---

## 10. 「猜的東西不准變成資訊」怎麼守

設計原則（v1.74 起）：只有對得上景點庫的才自動出現，猜出來的東西不准變成使用者看得到的字或圖。換到圖示：

1. **景點類型圖示只看景點庫的 `primary`**：
   - 只給景點庫裡的景點（`source: 'curated'`，靠 `placeId` 回查景點庫）。
   - 使用者自己打字新增的景點一律不放圖示（留白），不照名字猜。
   - 注意：存下來的景點沒有 `primary`（`js/quests/generate.js` 第 303 行產生完就刪掉、不落地），所以要從 `placeId` 回查景點庫。
   - **不要沿用** `generate.js` 第 370 行 `nameEmoji(名稱)` 那條「照名字配表情符號」的路。
2. **圖只畫到資料的粒度**：資料只說「美食」，圖就不畫某一道菜；資料沒有菜的類別，就不出食物種類的圖示（組 C 先不生）。
3. **裝飾與插圖只用不帶意思的東西**：不畫天氣、食物、交通工具、地標、國家或季節特有的東西，也不畫愛心與相機（在 App 裡各有意思）。
4. **每一個素材先登記才准用**：`manifest.json` 寫明它是哪一類、准用在哪。整合時加一條機器檢查：
   - 畫出來的每一個類型圖示，都要對到一個景點庫景點、而且類型相同。
   - 使用者自己打字的景點旁邊沒有圖示。
   - 突變「改成照名字配」必須紅。
   - 圖上不准有字：生圖偶爾會偷加字，進正式目錄前逐格看。
5. **整合時要先改的規定**：B11（每站不准放類別圖示）、B17（裝飾只准三種小形狀）、B18（字底下的對比）——改之前先問 Yolin。

---

## 11. 已知限制與待驗

- **待驗**（要等試作那張才知道）：
  - ChatGPT 免費版給的實際解析度與比例。
  - 畫不畫得出純洋紅底。
  - 會不會排成等大的九格。
  - 會不會偷加字或格線。
  - 切圖、去背的門檻在真的圖上誤不誤擋——現在的門檻是照合成樣本訂的（底色雜訊 ±12、零星雜點、反鋸齒邊），真圖的雜訊、陰影、壓縮痕跡可能更大。
- 白色主體碰到外面時會被一起去掉，機器分不出來——所以用洋紅底，而且主體不准用洋紅。
- 洋紅底的圖如果物件偷用了洋紅（違反提示詞），被圍住的那一塊會被當成洞去掉；逐格看總表時要留意。
- 外框有缺口時，去背會從缺口流進主體裡，把跟底色同色的部分一起去掉；這個抓不到。
- sharp（切圖與去背用的影像程式庫，0.35.2）已經寫進 `package.json` 的 devDependencies（2026-11-16）；原本是 wrangler 間接帶進來的。找不到時兩支腳本會直接報「找不到 sharp」，不會默默出錯。
- 生出來的圖的使用條件照 ChatGPT（OpenAI）的服務條款。素材進 repo 時在 manifest 記來源，公開前再確認一次條款。
