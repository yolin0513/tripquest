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
| 單張 D 頁首插圖 | **B18**：每一個字都要在不透明的底上、或沒鋪點的地方 | 要另寫一條「字底下的插圖像素對比 ≥ 4.5」的新檢查才能墊在字後面（**v1.93.0 做了**：B18 的像素分支，只用在全部一張） |

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

### 7b. 單張 D 第二版：豐富版＋吉祥物入景（2026-11-16，Yolin 經 Dispatch）

Yolin 看了第一版樣品：「要更豐富，最好把我們的吉祥物融進去」，他願意把吉祥物圖交給 ChatGPT 當參考。給 Yolin 的完整版（怎麼生、看到什麼要重生、只放三隻的備案）在 Dispatch 的 outputs `TripQuest_D頁首插圖_豐富版提示詞.md`；**本節是正本**，那份是副本。

**跟第一版的差別：**
- **上半部 45% 什麼都不畫，連雲都不畫**：第一版的雲飄進字的位置，日期那一行的灰字（`SUB`）壓到雲的外框只剩約 3.4（見第 11 節）。海報頁首的字在 1240×620 的 y 45～245，也就是上面 40%；留 45% 多一點餘裕。
- **下半部要豐富、色彩多**：層層山丘（三種綠）、沙色小路、小溪、花田、圓樹、石頭；不准很深的填色（外框除外）。
- **吉祥物可以出現，但只准我們的六隻**，照參考圖（`TripQuest_吉祥物參考圖/00_六隻總表.png`，App 的 `glyphs.js` 匯出、1400 方圖）畫：不改造型與配色、不加帽子背包、不變成別的角色。第一版「不畫人、動物」的那條仍然擋其他的人和動物。
- **吉祥物手上不拿會被讀成資訊的東西**（雨傘、食物、相機、雪板）；只照參考圖原本的樣子（阿灰本來就拿望遠鏡）。
- 第 10 節「不畫會被讀成資訊的東西」照守：天氣、建築與地標（含雪頂山）、交通工具、食物、招牌與地圖、季節特有的東西（櫻花、楓葉）、字。

```
Use the uploaded reference image of six original cute characters. Draw them exactly as they look in the reference: same body shape and proportions, same face, same colors, same outfits and accessories. Do not redesign them, do not change any color, do not add or remove anything (no new hats, bags, backpacks, clothes or props), and do not turn them into other characters or realistic animals. Do not add any other characters, people or animals.

The six characters (as in the reference): 棉棉 = white bunny with pink inner ears and a lilac scarf with white dots; 北北 = white bear with a beige muzzle and light blue overalls with yellow buttons; 鬍鬍 = white miniature schnauzer with grey eyebrows, white beard and a coral bandana; 湯圓 = round white long-tailed tit with a green knit beanie with a yellow pom-pom, black wings and a long black tail; 阿灰 = grey hawk with a cream belly and light blue binoculars; 小鳳 = cockatiel with a yellow head and crest, orange cheeks, grey body, lilac bow tie and long grey tail.

Wide landscape image, about 2:1 (much wider than tall). A rich, colorful, cheerful countryside illustration to sit behind the title at the top of a travel poster.

TOP HALF — keep it empty for the title: the upper 45% of the image is one single flat, plain, very pale cream sky color (#FBF6EC). Nothing at all in the upper 45%: no clouds, no birds, no hilltops, no trees, no character ears or crests, no shapes, no texture.

BOTTOM HALF — rich and colorful: below that, layered rolling hills in several fresh greens (#CFE6B8, #A9D18E, #8CC084), with a soft blue-green line of far hills at the horizon; one winding sandy path (#EBD3A8) curving from the front toward the hills; a small stream with light blue water (#9FD0E8); patches of small round generic flowers in coral, butter yellow, lilac and white; round simple trees and bushes; a few smooth rocks. Bright, warm, friendly colors, but no very dark fills.

The characters in the scene (all of them fully inside the bottom half, small, about one sixth of the image height): 棉棉 and 北北 walking side by side on the path; 鬍鬍 trotting a little ahead of them on the path; 湯圓 and 小鳳 sitting together on top of a small hill; 阿灰 standing on a rock, looking through his binoculars. Their hands hold nothing except what the reference already shows.

Style: flat sticker-style illustration that matches the characters: thick, even, dark charcoal outlines (#2F2C2A) with rounded ends on the characters and on the nearest hills, trees and rocks; farther shapes have thinner outlines. Flat solid fills only — no gradients, no textures, no shading, no drop shadows.

Do not draw anything that could be read as information: no sun, no moon, no rain, no snow, no rainbow, no umbrella; no buildings, houses, towers, temples, bridges, landmarks or snow-capped peaks; no vehicles; no food; no signs, no maps; nothing season-specific (no cherry blossoms, no autumn leaves). No text, no letters, no numbers, no signature, no border, no frame. Original artwork, not resembling any existing artwork, brand or franchise.
```

收到圖之後：量上半部（標題、日期那一行壓上去 ≥ 4.5）、逐隻對參考圖、看有沒有偷畫字或天氣建築食物；正式墊進海報仍要先做 B18 的新檢查並另排一版。（2026-11-17 起「逐隻對參考圖」只看明顯的錯，細節不再追，見第 9 節第 0 條。）

**2026-11-16 晚第一張回來之後**：
- 鬍鬍被畫成淺灰毛、白眉毛。Yolin 選乙案，由程式改色：`scripts/art-recolor.mjs` 的內建配方 `d2-huhu`，見第 9 節第 6 點。
- 改好的圖在 `art-inbox/D-豐富版-鬍鬍改色.png`（不進版控）。正式進海報那一版才複製進 `media/art/` 並登記。
- 阿灰的比例與望遠鏡、北北多的口袋改不了色，還在。

### 7c. 北海道無字底圖（樣品 B；2026-11-16 晚，Dispatch 轉 Yolin）

**是什麼**：
- 整張含字的北海道海報實測錯 6 個字，而且人工逐字核對會漏。所以改成生圖只畫「沒有字的手繪水彩北海道地圖」。
- 標題、日期、路線、每天的框、吉祥物由 App 疊。
- 這張是樣品：給 Yolin 看效果、實測對位用。**不是正式功能**。
- 3 代理投票（`docs/VOTE_2026-11-16_生圖只畫底圖.md`）一致說地理底圖不在這次範圍，要先實測對位再另外決定。

**給 Yolin**：
- 新對話、不附舊圖（附了容易把字、框、角色照抄），直式 2:3。
- 存進 `art-inbox`，檔名例如 `北海道無字底圖-第一次.png`。
- 看得到字、數字、框、角色、路線、箭頭、道路、建築、食物的，直接重生。（2026-11-17 第 9 節第 0 條：字、數字照樣直接重生；其餘只看明顯的、會被讀成資訊的。）

```
A soft hand-drawn watercolor illustrated map of the island of Hokkaido, Japan, seen from directly above, with north at the top. Portrait orientation, 2:3.

Layout: the island sits in the middle of the picture and fills only about 60% of the width. Leave wide, calm, empty sea all around it, at least one fifth of the picture on every side (left, right, top and bottom), because labels and boxes will be placed on top of the sea later.

Style: gentle pastel watercolor on warm cream paper, soft edges, light colors, low contrast, a cozy picture-book feeling. Sea: a pale blue-green watercolor wash with very faint soft waves, almost flat. Land: soft light-green lowlands, pale yellow-green fields, light grey-green shading for the inland mountains, and a few small rounded watercolor tree clusters. Draw the coastline with a thin, soft brown line.

Absolutely no text of any kind: no letters, no words, no numbers, no Chinese or Japanese characters, no place names, no labels, no title, no legend, no compass rose, no scale bar, no signature, no watermark. No boxes, frames, banners, ribbons, sticky notes, flags, pins, markers or icons. No route lines, no dotted paths, no arrows, no roads, no railways. No buildings, no landmarks, no towers, no bridges, no food, no weather symbols, no animals, no people, no characters. No land other than Hokkaido. Keep the whole picture light and uncluttered.
```

**為什麼這樣寫**：
- 島只佔中間六成、四周留海：框放在海上，用線指到島上。
- 不畫道路：模型畫的路位置不準，會被看成「我們的路線」。
- 不畫地標、建築、食物：畫錯的東西會被當成資訊。

**收到之後（推論，還沒實測）**：
- 模型畫的海岸線不會完全準。在圖上找幾個海岬當對位點，把 App 的路線、框對上去，量能對多準。
- 對不準就退回「地圖只當背景、路線用示意畫法」。

**先用舊圖做粗略示意：跳過**。
- 舊圖的字散在 8 個框、標題、美食清單、便利貼、旗子裡。我們的框蓋得住它的框，蓋不掉美食清單和便利貼。
- 它畫錯位置的那段路線和矛盾的箭頭也會留在底下，跟我們的路線疊成兩條。做不乾淨。

### 7d. 北海道測試用 4×4 插圖（美食 8＋景色 8；2026-11-16 晚，Dispatch 交辦；**2026-11-17 第一張回來、處理完**，結果見本節最後）

**是什麼**：一次性測試。Yolin 生一張，Session 切成 16 格、去背，疊進樣品 B 看效果：美食圖放在美食清單那一行旁邊，景色圖放在那一天的框旁邊並標「示意」。**不進 App**——必吃分類 Yolin 選了先不做、景點插圖先不做（見 `docs/VOTE_2026-11-16_美食景點插圖.md`）。這 16 格也不是將來 App 的類別清單。

給 Yolin 的副本（怎麼生、看到什麼要重生）在 Dispatch 的 outputs `TripQuest_北海道4x4插圖_測試提示詞.md`；**本節是正本**。Yolin 的 GPT 額度用完了，之後才生。

**每一格都要有依據**（模擬行程表＝交 Dispatch 的那份，不在 repo）：

| 格 | 畫什麼 | 依據 |
|---|---|---|
| 1 | 拉麵 | 美食欄第 1、4 天（兩天共用） |
| 2 | 海鮮丼 | 美食欄第 2 天 |
| 3 | 哈密瓜 | 美食欄第 3 天 |
| 4 | 炸雞 | 美食欄第 5 天 |
| 5 | 烤玉米 | 美食欄第 6 天 |
| 6 | 豬肉丼 | 美食欄第 7 天 |
| 7 | 霜淇淋 | 美食欄第 8 天 |
| 8 | 起司蛋糕 | 景點庫 `jp-sapporo.json` 的必吃；只放總表、不疊進樣品 B |
| 9～15 | 山、湖、溫泉、瀑布、峽谷、公園、農場 | 景點欄原字裡有「峠」「湖／池」「溫泉」「瀑布」「峽」「公園」「農場」 |
| 16 | 城市 | Dispatch 點名的通用類型；依據較弱（第 1 天的起訖是城市，是地名知識） |

- 景點欄裡的塔、動物園、車站、村落不畫：分別是地標、動物、交通工具，村落畫錯就是錯的資訊。港口、花田沒有一行寫到，不畫。
- 提示詞不寫地名（寫了容易招來真實地標）；品牌品項只寫泛稱、不畫包裝。
- 第 11 節的教訓照用：寫肯定句（否定句模型常不照做）；白色的部分要有墨線；顏色只用調色盤的名字。
- 景色格最容易被切圖腳本整列標壞（零件之間露出洋紅、看起來像直向間隔），所以要求每一格站在一塊實心的圓地面上、零件互相碰到。

```
Flat sticker-style illustration. Thick, even, dark charcoal outlines (#2F2C2A) with rounded ends and rounded corners. Flat solid fills only — no gradients, no textures, no shading, no drop shadows. Pastel palette only: cream white #FBF9F5, light warm grey #ECE6DE, coral #F2A497, butter yellow #F6D27A, matcha green #B9DAA5, sky blue #AAD3E7, lilac #D2C3E7, plus the charcoal outline color. Chunky, rounded, simple shapes with very little detail, friendly and cute. Original design: not based on or resembling any existing character, mascot, brand, logo or franchise. No people, no animals, no faces on objects or food. No text, no letters, no numbers, no symbols that look like writing.

Square image, 1:1. Exactly 16 separate items arranged in a 4×4 grid of equal square cells: 4 rows, 4 items in each row. The entire background is one flat, solid, pure magenta color #FF00FF — no gradient, no texture, no noise, no shadow, no vignette, no floor, no scenery behind the items. Leave wide, clearly empty magenta gaps between neighboring cells (each gap at least 3% of the image width), and an empty magenta margin around the outside of the whole grid. Each item is centered in its own cell and fully inside it, with generous empty space on every side; no item crosses into another cell or touches the image edge. Each item is one single compact connected shape — not long and thin, not made of several separate small pieces. Every white or very light part of an item has a charcoal outline. Do not draw grid lines, borders, frames, boxes, labels, captions or any text. Do not use magenta, purple-pink or hot pink anywhere in the items.

These are 16 small illustrations for a travel poster: 8 dishes, then 8 kinds of scenery. Each scenery item is a small, compact, rounded sticker-like vignette that sits on one single solid rounded ground patch; all of its parts touch each other and the ground patch, and no magenta shows anywhere inside it. Items, left to right, top row first:
1. A round bowl of ramen noodle soup: wavy butter-yellow noodles, one slice of pork, half a boiled egg and a few green onion pieces on top; two small steam curls with charcoal outlines touching the bowl.
2. A round bowl of rice topped with simple slices of raw fish and a few round coral fish eggs.
3. One wedge-shaped slice of melon with coral flesh and a matcha-green rind.
4. Three pieces of crispy butter-yellow fried chicken in a small plain paper tray; the pieces touch each other and the tray, so the whole item is one connected shape.
5. One short, chunky grilled corn cob in butter yellow, drawn diagonally, with a few short charcoal grill marks and its matcha-green husk leaves folded back at one end.
6. A round bowl of rice topped with overlapping slices of grilled pork in coral, with short charcoal grill lines.
7. A soft-serve ice cream cone with a tall cream-white swirl and a butter-yellow waffle cone.
8. One triangular slice of plain baked cheesecake with a butter-yellow top, standing on its own.
9. A mountain: one large rounded mountain with a smaller one overlapping it, matcha green and light warm grey all the way to the top, and a little winding path.
10. A lake: a small oval of calm sky-blue water with a grassy matcha-green shore and two round trees.
11. A hot spring: a small round pool of sky-blue water edged with rounded light grey stones, with three soft steam curls with charcoal outlines rising from it and touching the pool.
12. A waterfall: a short waterfall pouring down one rounded green rocky cliff into a small sky-blue pool, with the falling water drawn as sky-blue stripes with charcoal outlines.
13. A gorge: two steep rounded green cliffs close together with a narrow sky-blue river running between them.
14. A park: a small round lawn with a curved path, one plain wooden bench and two round trees.
15. A farm: one small plain barn in coral with a short wooden fence and one round hay bale.
16. A city: a tight cluster of four simple low buildings of different heights with plain square windows.

For all items: no packaging, boxes with logos, shop signs or brand shapes; no real or famous buildings, towers, bridges, warehouses or landmarks; no boats, no vehicles; no snow-capped peaks, no sun, no moon, no clouds, no rain; no hot-spring symbol; no people, no animals, no faces.
```

**收到之後**：
1. `art-slice.mjs --grid 4`（16 個名稱）——**第一張真的 4×4**，切圖腳本只在合成樣本驗過。
2. 去背、出總表給 Yolin 逐格看：格子順序不可信、逐格認；看有沒有偷畫字、臉、真實地標、品牌包裝。
3. 量每格主體大小，算縮到海報上 40～60px 時拉麵與兩種丼分不分得出來。
4. 疊進樣品 B（一次性腳本、不進 repo）：美食圖在美食清單那一行旁邊；景色圖在那一天的框旁邊、標題列寫「景色圖是示意」。景點庫的北海道只有札幌一檔，大多數站 App 對不到——照實寫。

**2026-11-17 第一張（實測；細節與數字見 STATUS 交接「北海道 4×4 測試插圖」那一節）**：
- 1265×1243、底色 `#fa05fa`。`--grid 4` 切 16 格全切、0 格壞；去背 16 張都過。**「壞的格點名」這張沒走到**，仍只有合成樣本驗過。最窄的是第 1、2 列之間的橫向間隔 30px（提示詞要 ≥ 3%），離下限 12 還有餘裕。
- 景色格沒有整列被標壞：「站在一塊實心圓地面上、零件互相碰到」這句有用。
- 跟提示詞不符：拉麵配料是青豆不是蔥；熱氣沒碰到碗／池。
- 山頂看起來像雪頂：那塊顏色量起來最接近調色盤的淺暖灰 `#ECE6DE`，正是第 9 格寫的「淺暖灰一直到頂」——是提示詞招來的，不是模型不照做；像雪頂的是鋸齒狀的分界線。下次第 9 格寫「整座山都是抹茶綠」，不要在山頂要淺色。
- 疊進樣品 B 的配法：景色圖照景點名稱裡的關鍵字配，一個名稱含兩個關鍵字取最後出現的那個，所以「峽」那一筆配成溫泉，峽谷沒疊——跟上面依據表把「峽」算成峽谷的依據不同。起司蛋糕、峽谷、城市只放總表。
- 縮到 App 海報上 40～60px：拉麵都認得出來；兩種丼並排分得出，40px 單獨一張不容易分（目測）。

### 7e. 這趟旅程專屬的整張無字背景（北海道 8 天 7 夜樣品；2026-11-17，Yolin 經 Dispatch）

**整套流程（逐步、三份提示詞範本、將來接 GPT API 的規劃、腳本位置）寫在 `docs/ART_行程海報生圖流程.md`**（2026-11-17 立）。本節保留版面與寫法規則的正本。丙版定案後，現行的提示詞是 `TripQuest_北海道8天7夜_專屬背景圖提示詞_v3_含吉祥物.md`（吉祥物直接畫進背景，九宮格只補背景沒畫到的動作），步驟見那份新檔的第 1 節。本節下面的三步流程與「正本是 `_v2`」是丙版以前的紀錄；版面與寫法規則照用。

**流程**：每趟行程人工跑一次。
1. Claude 照行程表寫一份這趟專屬的提示詞。
2. Yolin 用 GPT 生整張無字背景。
3. Claude 疊字、路線、框、吉祥物。

**跟第 7c 節的差別**：
- 7c 不畫地標、建築、食物：那張底圖要通用，畫錯就會變成錯的資訊。
- 這個流程照行程表明寫的景點與季節畫。Yolin 裁定這不算 App 在猜。
- 這個裁定只限人工流程；App 自動產生的東西照舊守設計原則。

**正本在 Dispatch outputs**：
- 檔名 `TripQuest_北海道8天7夜_專屬背景圖提示詞_v2.md`（不帶 `_v2` 的是 v1，作廢）。
- 它含地名，所以不進 repo（模擬行程表也不在 repo）。
- 這裡只記版面與寫法規則。

**版面**（百分比，從左上角量）：

| 區塊 | 寬 | 高 | 用途 |
|---|---|---|---|
| 標題區 | 全寬 | 最上面 14%，中間全空 | 標題 |
| 美食區 | 52～98% | 15～32% | 8 道菜，2 排×4；每道下面空一條，放我們疊的字 |
| 島 | 6～78% | 33～72% | 路線、站點 |
| 左邊空海 | 0～24% | 15～50% | 框 |
| 右邊空海 | 78～100% | 34～72% | 框 |
| 島下方空海 | 0～80% | 72～80% | 框 |
| 底部風景帶 | 全寬 | 最下面 20%，從左到右都要有東西 | 便利貼、吉祥物站在上面 |

- 框和便利貼不透明，所以放框的地方要畫成平靜的海面，地標才不會被蓋住。
- 每個景點離空著的區塊要留距離。v1 的左邊空海到 55%，港町那一景就貼在它的角落；v2 縮到 50%。
- 重生清單提到的每一張表都要真的在檔案裡，而且是中文。v1 寫了「順序跟下面的表不一樣」，下面卻沒有中文菜序表。
- 版面示意圖只給 Yolin 看、不上傳 GPT：上傳了會被照畫。

**寫法規則**：
- **依據**：
  - 每一樣要畫的東西都對到行程表的一列；行程表沒寫的不加。
  - 方位只寫粗略，並標「沒查證」。
- **會招來字的不畫**：
  - 鐘面、商店街、建築類景點的招牌。
  - 留下來的建築寫「牆面與招牌都是空白的」（肯定句，見第 11 節）。
- **整張不畫路**：
  - 底部風景帶也不畫小路：路會被看成我們的路線。
  - 景點彼此不相連。
- **溫泉**：只畫幾縷蒸氣，不畫溫泉符號。
- **山**：寫「整座綠或灰藍到頂」。7d 實測過，淺色山頂會變成雪頂。
- **動物**：
  - 只畫行程表有的。
  - 不像六隻吉祥物：熊、兔、狗、圓滾滾的小鳥、鷹、鸚鵡都不畫。
  - 季節不對的畫法不寫（例：冬天才有的活動）。
- **美食**：
  - 畫在指定的美食區，每道菜下面留一條空白給我們疊字。
  - 不散在框會用到的海面上。
- **地名**：
  - 括號裡的地名只用來定位，並寫明「不要寫出來」。
  - 連兩次有字，就刪掉括號再試。

**收到之後**（2026-11-17 起照第 9 節第 0 條的比重：字逐一核對，圖只看明顯的錯）：
1. 看重生清單。
2. 量各區塊實際在哪裡。
3. 在新圖上重新目測站點。
4. 疊一次，字從模擬行程表讀。

---

## 8. 尺寸：每格大概多少像素、在 App 裡夠不夠

**2026-11-16 組 A 第一次試作量到的（實測）**：九宮格 **1254×1254**（PNG、RGB、帶 ChatGPT 的內容來源憑證區塊）；每格主體 **199～335 像素**（最小的是手機 199×315），切出來的方形 362～396。所以：
- 組 A：App 84、海報 44 → **夠**，有 2.4 倍以上餘裕。
- 組 B（假設主體大小跟組 A 差不多）：回顧、主頁要 240 → 大部分夠，最小的幾格剛好；**推論**，要等組 B 那張量。
- 單張 D：就算只給方圖，寬 1254 也 ≥ 海報寬 1240 → **夠**（下表最後一列原本寫「不夠」，是照 1024 推的）。

下面這張表是試作前照 1024×1024、橫圖 1536×1024 推的，留著對照。

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

**0. 檢查與回報的比重（Yolin 2026-11-17，經 Dispatch；先讀這條）**

Yolin 原話（選吉祥物動作丙版時）：「丙方案，我覺得吉祥物整合進去比較自然好看，疊上去的有些吉祥物太大了，路線及動作等等算是參考配圖而已，不用達到 100% 正確，文字等等資訊正確就好。」

Dispatch 轉成三條：
- 插圖、路線、吉祥物動作屬於「參考配圖」，不必 100% 精確（例如地標位置、動作細節）。
- 文字資訊（地名、日期、天數、菜名）必須正確，這條照守。
- 以後檢查與回報照這個比重：字逐一核對，圖只看有沒有明顯錯，不再逐像素追求精確。

**範圍（Session 寫明，可推翻）**：只管生圖的插圖與人工流程的海報樣品——本檔第 7 節各張、九宮格動作圖、北海道疊字樣品這一類。**這些都不變**：App 的版面與畫面測試、文字對比 ≥ 4.5、觸控 ≥ 44px、B18（插圖上的字逐點量對比）、第 10 節「猜出來的東西不准變成使用者看得到的字或圖」。

**怎麼套（Session 的讀法，可推翻）**：
- **照守、會擋**：我們疊的字從行程表讀，程式核字數、每道菜名、名單掃描；字不准被蓋住、要看得清楚；生圖自己畫出字來仍算錯（字就是資訊，見第 7c 節）。
- **只看明顯的錯、照報**：角色認不出是哪一隻、整隻顏色不對、少了一隻；圖跟旁邊的字明顯對不上（例如標籤寫哈密瓜、圖是拉麵）；去背留下色塊或色邊。
- **不再追、不列成缺點**：地標或站點位置偏一點、路線沒貼著景色、動作細節（腳的顏色、眉毛深淺、白煙有沒有碰到木桶）、提示詞「看到就直接重生」清單裡不帶字的小項（例如遠處一座白頂的山）。
- 疊字腳本裡管插圖位置的檢查（路線壓到別天的景色、編號圈與引線放哪）可以留著幫忙排版，但不再當成交不交的門檻，回報也不逐項列。

1. **切圖** `node scripts/art-slice.mjs <圖> <輸出資料夾> [--grid 3] --names a,b,…`：
   - `--grid` 是每邊幾格（2～6，預設 3）；4×4 就寫 `--grid 4`，`--names` 要剛好 16 個。（2026-11-16 加，Dispatch 同意小圖示改 4×4、先試一張。）
   - 從圖的邊框量底色。
   - 先找「整列都是底色」的橫向間隔切成 N 列，再在每一列裡各自找直向間隔切成 N 格——模型常把各列排歪，所以不要求直向間隔整張上下貫通。
   - 每格檢查主體有沒有碰到格子邊（碰到就可能被切掉）、是不是空的。
   - **好的格照切、壞的格點名**（2026-11-16 改，Dispatch 同意；原本是有一格不對就整張停）：
     - 整張停、一個檔都不寫（回 3）：底色不純、橫向間隔數目不對（列數不對）、橫向間隔太窄——這幾種連「哪一列在哪」都定不出來。
     - 只標那一整列（同一個理由）：那一列的直向間隔數目不對或太窄；其他列照切。
     - 只標那一格：空格、主體碰到格子邊；其他格照切。
     - 有壞格時回 4：好的格照常寫出，另寫 `_missing.txt`（每一行「第幾格. 名稱（第幾列第幾格）：理由：細節」），總表上那一格畫叉、名稱後面標 BAD。
     - 全部格都壞：當成整張不能切，回 3、一個檔都不寫。
   - 回傳值：0 全部切好；4 有壞格（好的照切）；3 這張圖不能切；2 用法錯；9 自帶對照組沒全對（不處理真的圖）；1 其他錯誤。
2. **去背** `node scripts/art-keyout.mjs <圖或資料夾> <輸出資料夾> [--holes auto|keep|clear]`：
   - 從四邊往內，把連著的底色去掉。
   - **被圍住的底色**（購物袋提把中間、蝴蝶結的圈）：底色是洋紅時自動當成洞去掉——提示詞規定物件不准用洋紅，所以被圍住的洋紅一定是洞；底色是別的顏色（例如白底）時留著、只報不擋，因為那可能是主體白色的部分。`--holes keep／clear` 可以強制指定。
   - 邊緣 2px 估半透明並扣掉底色成分（去色邊），放到淺色底上不會有一圈洋紅。
   - 檢查：主體沒被吃掉、四角透明、外圈幾乎全透明（碰到邊多半是切圖時被切到）、不是空的。
   - 輸入本來就透明的不去背，只做檢查。
3. **總表**：切圖腳本另出一張總表，每一格標位置編號與暫定名，交給 Dispatch 轉 Yolin 逐格看；去背腳本也出一張（透明處畫棋盤格，一眼看得出有沒有去乾淨）。
   - **格子是哪一類不能照位置認定**——模型會換順序或畫錯。位置給的只是暫定名，逐格看過才算數。
4. 確認要用的才複製進正式素材目錄 `media/art/<組>/`（進版控），同時在 `media/art/manifest.json` 登記：檔名、類別、准用在哪、來源（ChatGPT、日期、第幾組提示詞）。
   - **組 A 已進（v1.92.0，2026-11-16）**：去背後每張修掉四周全透明的邊 → 等比放進 128×128（四周留 6px；畫面上最大 32 CSS px，4 倍密度剛好）→ 調色盤 PNG。9 張合計 62150 位元組（每張 5～9 KB），只有影像區塊。碗那張的熱氣補了 5px 墨線（原本白色、沒墨線，淺色底上看不見；只描熱氣，碗一個像素都沒動）。登記與處理步驟寫在 manifest 裡，`scripts/placeicontest.mjs` 驗登記跟檔案、程式的表、離線清單、git 的大小寫一致。
5. 兩支腳本每次執行都會先跑自己的合成對照組（切圖 16 個——其中 3 個是 4×4——去背 9 個；該放行的要放行，該擋的要擋在對的那一關，只標壞格的要標對是哪幾格；放行的格逐格核對顏色，確認切出來的位置沒有錯開）。對照組沒有全部判對，就不處理真的圖。
6. **角色改色** `node scripts/art-recolor.mjs <輸入圖> <輸出圖（要不存在）> <配方>`（2026-11-16 晚加；第一個用途是 D 豐富版的鬍鬍）：
   - 配方寫：圖的尺寸與 sha256（拿錯圖就停）、角色所在的方塊、毛的種子點、眉毛方塊、目標色（從 App 匯出的參考圖量）。內建 `d2-huhu`，也可以給 `.json`。
   - 做法：
     - 從方塊四邊往內填色找出角色的範圍，所以外框要閉合；有缺口就停。
     - 只改「像毛」的點：低彩度、不是墨線、不是本來就白的。領巾、臉頰、鬍子、墨線不動。
     - 眉毛方塊裡越白越接近眉毛色。
     - 角色外面逐點比對，有一點不同就停、不寫檔。
     - 改完驗收毛與眉毛在目標色附近；寫出去再讀回來比一次。
   - 自帶合成對照組 10 個，每次先跑；artselftest 的 AS8、AS9 從命令列入口驗。
   - **d2-huhu 的實測（2026-11-16）**：
     - 毛 rgb(228,223,218) → rgb(251,249,245)，眉毛 → rgb(195,189,183)。
     - 改到的點 14963 個，都在鬍鬍身上。另寫一支不 import 改色腳本的比對程式，逐點核對方塊外 0 點（另外五隻都在方塊外，不另算一項），附對照組。
     - 方塊裡面也查了：被改的點逐點看改之前的顏色，全部是灰白（彩度 ≤ 26），沒有一點是背景的綠或黃（頭頂那塊綠背景的彩度 67）；頭頂、肚子下面兩處放大 7 倍前後對看，背景沒變。對照組：在綠背景改一個點，數得到。
   - **做不到的**：
     - 參考圖的耳朵是很淡的米灰。這張耳朵內側那條線是開口的，耳朵跟頭連成一塊，程式分不出來，所以耳朵跟毛一起改白。
     - 參考圖的鬍子有墨線圍著；這張的鬍子沒有墨線，毛改白之後，鬍子跟臉的分界變淡。
     - 方塊、種子點、眉毛方塊是人看圖填的，填錯程式分不出來，所以改完一定要出前後對照圖、人眼看一次。

---

## 10. 「猜的東西不准變成資訊」怎麼守

設計原則（v1.74 起）：只有對得上景點庫的才自動出現，猜出來的東西不准變成使用者看得到的字或圖。（第 9 節第 0 條「參考配圖不必 100% 精確」只管人工流程的生圖插圖與海報樣品，不放寬這一節。）換到圖示：

1. **景點類型圖示只看景點庫的 `primary`**：
   - 只給景點庫裡的景點（`source: 'curated'`，靠 `placeId` 回查景點庫）。
   - 使用者自己打字新增的景點一律不放圖示（留白），不照名字猜。
   - 注意：存下來的景點沒有 `primary`（`js/quests/generate.js` 第 303 行產生完就刪掉、不落地），所以要從 `placeId` 回查景點庫。
   - **不要沿用**「照名字配表情符號」那條路（`generate.js` 的 `nameEmoji`）。v1.92.0 已經把它整個拿掉（Yolin 2026-11-16）：景點庫的景點存進行程的表情符號只照 `primary`，沒有類型就是 📍；舊版在景點庫 135 筆裡有 60 筆給的是照名字配的。已經存在舊行程裡的那些值還沒處理（見 STATUS「v1.92.0」那一節）。
2. **圖只畫到資料的粒度**：資料只說「美食」，圖就不畫某一道菜；資料沒有菜的類別，就不出食物種類的圖示（組 C 先不生）。
3. **裝飾與插圖只用不帶意思的東西**：不畫天氣、食物、交通工具、地標、國家或季節特有的東西，也不畫愛心與相機（在 App 裡各有意思）。
4. **每一個素材先登記才准用**：`manifest.json` 寫明它是哪一類、准用在哪。整合時加一條機器檢查：
   - 畫出來的每一個類型圖示，都要對到一個景點庫景點、而且類型相同。
   - 使用者自己打字的景點旁邊沒有圖示。
   - 突變「改成照名字配」必須紅。
   - 圖上不准有字：生圖偶爾會偷加字，進正式目錄前逐格看。
   - **v1.92.0 做到的**（`js/placeicon.js`＋`scripts/placeicontest.mjs`）：行程裡的一站要通過可信類別那一套複核（`trustedTheme` 的 `recheck`——「景點」sight 換出來是中性、`key` 是 null，但景點庫那一筆的 `primary` 一樣是人工整理的，照樣給圖；打卡 checkin 換成的是都市，不是中性），圖示照景點庫那一筆的 `primary` 挑，不看存著的 `emoji`／`theme`；打字新增的、改過名字的、景點庫那筆不見的、建立時打的字比不回同一筆的，都沒有圖示。誰用到圖示都要登記，而且只准 App 畫面三處（任務頁、行程分頁站卡、選景點卡片），海報沒有可登記的類別。突變「對不回景點庫時照名字補」「看 key 不看 recheck」「先看存著的 primary」都紅在預期（`tools/mutations/mut_v192.json`）。
5. **整合時要先改的規定**：B11（每站不准放類別圖示）、B17（裝飾只准三種小形狀）、B18（字底下的對比）——改之前先問 Yolin。
   **v1.93.0（2026-11-16，Yolin 要 D 進頁首、Dispatch 轉達照規劃改）**：只改 B18——插圖範圍上的字逐點量插圖像素對字色 ≥ 4.5（另加 B20 管插圖放哪）；B17 沒改（D 不是路旁裝飾）；B11 管每站的類別圖示，跟 D 無關。D 只放「全部一張」、每天一張不放（Dispatch 定、可推翻）。細節見 STATUS「v1.93.0」那一節。

---

## 11. 已知限制與待驗

- **組 A 第一次試作驗過的（2026-11-16，一張圖、實測）**：
  - 解析度 1254×1254、方圖（見第 8 節）。
  - 底色：不是剛好 `#FF00FF`，是很接近的 `#FA05FA` 左右，但整片一致——底色點有 98.4% 跟邊框中位數差在 5 以內（0～255 的色階）、四角相同（沒有漸層）；切圖、去背都用邊框量到的顏色，不受影響。
  - 九格大小不完全相等、位置略歪，但間隔都夠寬（橫向 66～73、直向 89～195、外圍 47～114 像素），切圖照常切出 9 格。
  - 沒有偷加字或格線：九格以外沒有任何多出來的色塊（連通塊剛好 9 大塊＋第 2 格的 3 縷熱氣、小點 0 個），燈籠、手機螢幕、袋子放大看也沒字。
  - 門檻在這張上沒有誤擋；去背後每張殘留的洋紅點 0～4 個；白色熱氣完整保留。
  - **跟提示詞不符的**：第 4 格（小吃）杯子露出內容物——提示詞只寫「看不到內容」（否定句），模型沒照做；第 2 格碗有「蓋子」（肯定句）就照做了。第 2 格熱氣是白色、沒有墨線、分成 3 塊（提示詞要一整塊），切圖、去背都沒問題，但在淺色紙底上幾乎看不見。
- **單張 D 第一次（2026-11-16，一張圖、實測）**：1774×887 的 RGB 橫圖（約 2:1），沒有字。縮到海報寬 1240 是 1240×620（縮小 0.699 倍，不用放大）。上方天空色約 `#fef9ef`；y 0～95 與 312～365 是完全空白的天空，95～312、365～428 有雲（雲有一圈外框；**更正（同日樣品放大後實量）**：外框是淺棕色 rgb(213,192,167) 左右，不是先前寫的「深色墨線」），428 以下是丘陵。拿海報頁首現在的位置量（`bigHeader`：標題墨色 64px 在 y 45～117；日期旅伴 `SUB` 30px 在 y 211～245）：標題墨色整條寬度最小對比 7.87、只看中間 600px 是 13.10——夠；日期旅伴中間 400px 是 5.62，但整條寬度碰到右邊那朵雲的邊緣只有 **3.36（不到 4.5）**。~~整片天空裡只要字壓到雲的墨線就是 1.0~~（**這句是推論、而且錯了**：外框是淺棕色，墨色字壓上去 7.80～7.97、`SUB` 灰字壓上去 3.36～3.44——三朵雲的外框各量一次）。所以要墊進海報，灰色那一行要避開雲的外框（或把那一行縮在中間），墨色標題壓到雲也還有 7.8；這要等 B18 的檢查。
- **單張 D 樣品（2026-11-16，實畫）**：用 App 自己的行程海報程式（`gatherModel`→`renderPages`→`drawPoster`）畫一趟合成行程（台中三天、標題故意很長到被截斷），D 墊在最上面 1240×620，頁首的字照原位疊在天空上，頁首以下整段往下移 388px（成品 1240×1922）；不改 repo 的檔，畫法是一支暫存腳本。看得到的：標題最下緣壓到左邊那朵雲的上緣、日期旅伴那一行的「2026」碰到中間那朵小雲的上緣（灰字對雲的外框約 3.4，不到 4.5）；右邊那朵雲這次沒碰到（這一行沒那麼長）。檔名 `TripQuest_v192_04_D海報頁首樣品.png`，給 Yolin 看；正式要放進海報等他看過再排一版。
- **單張 D 第二版（豐富版）第一次（2026-11-16 17:0x，一張圖、實測）**：1774×887，縮到 1240×620。y 0～272 完全空白（43.9%；提示詞要 45%，272 開始是山丘頂、阿灰的頭、小鳳的冠羽）。用跟第一版同一支量法：標題（INK 64px）整條寬度最小對比 **12.94**、日期旅伴（`SUB` 30px）整條寬度 **5.56**——都過 4.5，照現在的頁首位置不用改版面（同一支量法在第一版上照樣量出 7.87／3.36，當對照）。沒有字、天氣、建築、食物；六隻都在、沒多出別的。**跟參考圖不符**：鬍鬍是淺灰毛、白眉毛（參考圖白毛、灰眉毛；身體主色亮度約 0.71、參考圖約 0.94，同一張圖裡鬍子約 0.94）；阿灰比例像真的鳥、望遠鏡變大變深；北北多一個胸前口袋。**教訓**：提示詞寫了「white miniature schnauzer」，模型照樣畫成雪納瑞常見的灰色——物種常見的樣子會蓋過提示詞，下次要寫「毛跟兔子、熊一樣是純白，只有眉毛淡灰」這種跟別隻比的說法，或背景乾脆不畫角色、由 App 疊向量圖。
- **北海道 8 天 7 夜整張行程圖第一次（2026-11-16 17:0x，測試用、不進 App）**：1024×1536。應有 215 個中文字，確定錯 6（一個字寫錯 1 處、一個字畫成日文字形 3 處、兩個「園」外框對但框裡不是「袁」——這兩個 17:0x 第一次核對時漏掉，Yolin 指出）；分辨不出 18（三處「溫」等繁日字形只差一兩筆的字、三個中段糊掉的「富」，字約 24 像素高）；其餘 191 個逐字跟字型並排比過、沒看出錯，但盲測顯示人工核會漏（外框對裡面錯 6 漏 2、多一筆 7 漏 6），不能說保證；沒有漏字、多字。8 個框的顏色照順序，但沿路的順序第 2 天那段被放到第 7、8 天之間；箭頭方向互相矛盾。結論：模型畫整張含字的圖，錯的地方每次不同、App 驗不出來，不能當資訊用；字、框、路線要由 App 畫。
- **還沒驗**：只有一張圖，換一次生成會不會一樣穩定不知道；組 B 還沒生。~~4×4 還沒有真的圖（只有合成樣本驗過），4×4 的提示詞也還沒寫~~ **→ 2026-11-17 北海道 4×4 第一張（第 7d 節）16 格全切；但沒有壞格，切圖「壞的格點名」那條路在真的圖上還沒走過。** 第 4 節的組 A 提示詞仍是九宮格。
- **提示詞自己會招來「看起來像資訊」的東西**：北海道 4×4 的山，第 9 格寫「抹茶綠與淺暖灰一直到頂」，模型就在山頂畫一塊淺暖灰、下緣鋸齒狀——看起來像雪頂（「不畫雪頂」那一句管不到，因為它畫的是我們要的顏色）。要避開的東西，連它常見的顏色配置也不要寫進提示詞。
- **`--grid` 設得比實際少可能擋不下**：例如 4×4 的圖用預設 3 切，如果剛好有幾段間隔比較寬，可能被挑成 3×3 的切法，每格裡會有不只一個主體。總表一看就知道（每格裡擠了好幾個），所以切之前確認 `--grid` 跟圖一樣。設得比實際多時會擋下（列數不對）。
- **總表上的打叉灰格**只驗了「總表有寫出來」，畫面上有沒有畫對叉沒有自動檢查；這一次是看過示範圖的總表（把試作圖寬裁成 1200、右邊三格碰到圖邊 → 那三格畫叉、標 BAD，其他六格照切）確認的。
- **去背的小瑕疵**：邊緣半透明的點有三到四成稍微偏綠（去色邊把洋紅扣過頭，平均偏 22～26），放大 3 倍放到深色底上才看得出、App 實際大小看不出。要修得改 `art-keyout.mjs` 的去色邊。
- 白色主體碰到外面時會被一起去掉，機器分不出來——所以用洋紅底，而且主體不准用洋紅。
- 洋紅底的圖如果物件偷用了洋紅（違反提示詞），被圍住的那一塊會被當成洞去掉；逐格看總表時要留意。
- 外框有缺口時，去背會從缺口流進主體裡，把跟底色同色的部分一起去掉；這個抓不到。
- sharp（切圖與去背用的影像程式庫，0.35.2）已經寫進 `package.json` 的 devDependencies（2026-11-16）；原本是 wrangler 間接帶進來的。找不到時兩支腳本會直接報「找不到 sharp」，不會默默出錯。
- 生出來的圖的使用條件照 ChatGPT（OpenAI）的服務條款。素材進 repo 時在 manifest 記來源，公開前再確認一次條款。
