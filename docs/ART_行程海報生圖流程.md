# 行程海報生圖流程（人工流程正本＋將來接 GPT API 的規劃）

2026-11-17 立。Yolin 確認吉祥物動作丙版的方向之後，經 Dispatch 交辦。Yolin 原話：「請將這段產圖方式記下來，以後照著方式生圖，甚至未來如果有串接 gpt api key 的話就可以在 App 內生圖片了。」

**2026-11-19 改**：參考圖改用 GPT 生過的圖，不再用 App 向量匯出的（Yolin 的決定，Dispatch 轉達；第 3.3 節、步驟 3、2.1 新的第一段）。

**這份管什麼**：
- 每趟行程用人工做一張「這趟專屬的行程海報」：步驟、提示詞範本、檢查的比重、腳本放在哪。
- 將來在 App 內自動跑同一套流程需要什麼。這部分**只寫規劃，沒有投票、沒有實作**（第 4 節）。

**跟別的文件的關係**：
- 規則細節的正本在 `docs/ART_生圖素材.md`：版面百分比與寫法規則在第 7e 節，檢查比重在第 9 節第 0 條，切圖、去背、改色的用法在第 9 節。本檔只引用、不重抄，免得兩份對不上。
- 現況與待決在 `docs/STATUS.md`：工作慣例第 8 條，交接的「吉祥物動作丙版樣品」那一節。
- 北海道那幾份提示詞含地名，照第 7e 節不進 repo，原文在 Dispatch outputs（檔名見第 2.0 節）。本檔的範本是同一份骨架，地名都換成〔〕空格。

---

## 0. 一張圖看完

```
行程表（海報上所有文字的唯一來源）
  │
  ├─ Claude 照行程寫提示詞 ─┬─ ① 專屬背景（含吉祥物）    每趟都寫，直式 2:3
  │                         ├─ ② 吉祥物動作九宮格        每趟都寫，1:1、洋紅底
  │                         └─ ③ 4×4 美食或景色          需要時才寫，1:1、洋紅底
  │
  ├─ Yolin 在 GPT 生圖（先上傳 GPT 生過的參考圖，第 3.3 節）→ 用下載鈕存原檔
  │
  └─ Claude：收件 → 切圖／去背／改色 → 疊字（從行程表讀）
             → 補上背景沒畫到的動作 → 檢查 → 成品 PNG（2048×3072）
```

**為什麼字由我們疊，不讓 GPT 畫**：11-16 讓 GPT 直接畫整張含字的行程圖，應有 215 個中文字，確定錯 4 個（一個字寫錯 1 處、一個字畫成日文字形 3 處），另有 3 處太小看不清；路線的顏色順序也放錯一段（實測，見 STATUS「生圖兩張回來」那一節）。字就是資訊，所以背景一律無字，字全部由我們從行程表讀出來疊上去。

---

## 1. 現行手動流程（逐步）

北海道 8 天 7 夜那一輪（模擬行程，不是真資料）就是照這幾步做的，丙版成品是第 7 步的結果。

### 步驟 1：整理行程表（Claude）

- 從行程資料列出這幾項：
  - 地區、季節與月份、天數；
  - 每天的景點與大略方位；
  - 每天一道美食；
  - 起點與終點。
- 這張表是海報上**所有文字的唯一來源**，疊字時由程式從表裡讀，不手打。
- 方位只寫粗略的，並標「沒查證」（第 7e 節）。
- 真實行程帶著日期與家人的資料，照共用慣例附錄 A 屬於個資；模擬行程也含地名。所以行程表與提示詞都不進 repo，放在 Dispatch outputs。

### 步驟 2：寫三份提示詞（Claude；範本見第 2 節）

- **① 專屬背景含吉祥物**：無字的水彩地圖，加上美食區、留給框的空海、底部風景帶；六隻吉祥物各畫一次，放在對應的景色裡。**這張是主體**，丙版就是用它當底。
- **② 吉祥物動作九宮格**：一天一個動作，加一格起點・終點，共 9 格。用途是**補背景沒畫到的動作**：背景只畫得下六隻、每隻一次，所以第 7 個以後的動作從九宮格挑。
- **③ 4×4（需要時才寫）**：美食 8 格加景色 8 格，每一格都要對到行程表的一列。丙版成品沒有用到；下次要不要用，由 Dispatch／Yolin 定。
- 每份都附三樣給 Yolin：怎麼生（見步驟 3）、「看到這些就直接重生」清單、「可以接受、不用重生」清單。
- 寫好放 Dispatch outputs。

### 步驟 3：生圖（Yolin，在 ChatGPT）

1. 開一個**新對話**。
2. **先上傳參考圖：一律用 GPT 生過的圖**，在 Dispatch outputs 的 `TripQuest_生圖收件/`。挑哪幾張照第 3.3 節，寫提示詞的人在那份提示詞的「怎麼生」裡寫明檔名。
   - **2026-11-19 的決定**（Yolin，經 Dispatch 轉達）：以後都用 GPT 生過的圖當參考圖，不再用 App 向量匯出的 `TripQuest_吉祥物參考圖/`。**原因**：Yolin 喜歡的就是 GPT 的畫風；App 匯出的向量正要照 GPT 的圖改掉，不能再拿來當正本。
   - 11-19 以前這一步上傳的是 `TripQuest_吉祥物參考圖/` 的 `00_六隻總表.png` 和 `03_鬍鬍_白色迷你雪納瑞_正面全身.png`（鬍鬍屢次被畫成灰色，所以多給他一張大圖）。北海道那一輪就是這樣生的。
   - **還缺海報用的參考圖**：GPT 生過的圖裡，目前沒有一張畫出六隻的全身（第 3.3 節）。下一趟要生 ① 背景之前，先跟 Dispatch／Yolin 定要用哪幾張。
3. 把提示詞整段貼上、送出，不用另外加話。
4. 比例：背景選直式 2:3；九宮格與 4×4 選正方形 1:1。
5. 用**下載鈕**存原檔，不要截圖。
6. 先對照「重生」清單看一眼：有字、角色畫錯，就直接重生，不用傳。

### 步驟 4：收件（Claude）

- 從 Dispatch outputs 複製進 `art-inbox/`（被 `.gitignore` 擋掉），同時核 sha256、量尺寸，同名的檔不覆蓋。北海道那次用的是一次性的 `intake.mjs`（第 5 節）。
- 收件的原圖、中間產物、疊字成品**一律不進 repo**，只放 `art-inbox/` 與 `.logs/`。

### 步驟 5：切圖、去背、改色（Claude；用法見 ART 第 9 節第 1、2、6 條）

- **九宮格**：
  - 先切：`node scripts/art-slice.mjs <圖> <輸出資料夾> --grid 3 --names a,b,…`
  - 再去背：`node scripts/art-keyout.mjs <切好的資料夾> <輸出資料夾>`
  - 4×4 改用 `--grid 4`，名稱給 16 個。
- **背景圖**不切、不去背。
- **改色**：
  - 只在整隻毛色錯的時候用，例如鬍鬍又變灰：`node scripts/art-recolor.mjs <輸入> <輸出> <配方>`。
  - 配方裡的方塊、種子點要人看圖填，所以改完一定要出一張前後對照圖、人眼看一次。
  - 眉毛這種沒有外框的小地方改不好，耳朵也分不出來，會跟著毛一起變白（兩次實測都是這樣）。改不好就換那一格，或重生。

### 步驟 6：疊字（Claude）

- 文字**一律從行程表讀**：
  - 標題、天數；
  - 每天的框：第幾天、景點；
  - 美食標籤：「DAY 幾＋菜名」，放在每道菜下面留的空白；
  - 起點・終點的名牌。
- 框與便利貼是不透明的，放在背景留下的空海上。
- 站點、路線、編號圈照這張圖的景色用眼睛估著放。這些是示意，不照經緯度。
- 寫圖之前先檢查字，北海道那次是 A、B、G 三道，每一道都帶對照組，沒過就不寫圖：
  - 抽出所有要畫的中文字，字數要等於從行程表數出來的數；
  - 每道菜名剛好出現一次；
  - 字對推送前自查的名單掃一次，要 0 命中。
- 用 1024×1536 的座標排版，輸出放大 2 倍（2048×3072）。

### 步驟 7：補上背景沒畫到的動作（Claude；丙版做法）

- **挑哪幾格**：拿背景裡已經畫好的動作去對九宮格，挑背景沒畫到的那幾格。北海道那次挑了 3 格：湯圓吃烤玉米、北北吃霜淇淋、小鳳拖行李。
- **多大**：跟背景裡的吉祥物差不多大。先量背景裡每一隻的外框高度，取中間那一段。
  - 北海道那次（以 1024×1536 算）：背景六隻是 86～190，中段 95～133，補上去的動作高 100～105。
  - 比 A 版疊上去的小。Yolin 選丙的理由之一是「疊上去的有些吉祥物太大了」。
- **放哪**：放在空白處、靠近對應的景色或那一天，例如底部風景帶、起點・終點旁。
  - 不壓字、不壓框、不跟背景裡的角色重疊；
  - 同一隻做同一個動作不出現兩次。
- **陰影**：腳下加一圈淡淡的模糊橢圓當落地陰影，看起來才像畫在地上。北海道那次的不透明度是 0.22。
- **檢查**（北海道那次的 C0～C4）：
  - 字跟上一版一字不差；
  - 補上去的動作不壓字、不壓框、不出界、彼此不重疊；
  - 大小落在背景吉祥物的中段。
  - 除了第一條（字），其餘是排版用的輔助，**不當交不交的門檻**（ART 第 9 節第 0 條；Dispatch 2026-11-17 確認）。

### 步驟 8：檢查（Claude）

- 比重照 ART 第 9 節第 0 條與 STATUS 工作慣例第 8 條：**字逐一核對，圖只看有沒有明顯的錯**（第 3.1 節）。
- 交付前三步，用 `&&` 串起來：
  1. 檔名、加上圖上所有我們畫的字，對名單掃一次，帶對照組；
  2. 掃描過了才複製；
  3. 複製完用 node 核 sha256。
- 交付前把交接處（深色的白邊、圖層的接縫）裁出來放大看。整張看會漏掉。

### 步驟 9：成品

- 2048×3072 的 PNG，需要時再附一張並排比較圖，交 Dispatch outputs。
- 這是人工流程的樣品：不進 App、不進 repo。

---

## 2. 提示詞範本

**記號**：`〔換：…〕` 是每趟要換的地方，其餘照抄。提示詞用英文寫，角色名字用中文。原本是為了跟參考圖底下印的名字一致；11-19 改用 GPT 生過的參考圖，圖上沒有字，名字照舊用中文，跟 2.1 的描述一致。

**照抄的部分核對過**（2026-11-17，實測）：本節各程式碼區塊裡〔〕之間的英文固定片段，用一次性的程式逐段比對北海道兩份原文（含吉祥物的背景 v3、九宮格），44 段全部對得上。對照組 3 個都判對：改一個字判不符、原文的一句判符合、全新的一句判不符。另有 15 段太短或以中文為主，沒有比。這項核對針對的是 2.1 的「11-19 以前」那一塊；11-19 另加的新第一段不在這 44 段裡（新第一段的出處見 2.1）。

**不要沿用原檔裡的建議**：北海道那兩份原檔寫著「先用九宮格（A），含吉祥物的背景（B）當備案」，那是丙版定案以前寫的。現在的做法是**以含吉祥物的背景為主，九宮格只補背景沒畫到的動作**。

### 2.0 北海道那幾份的原文（Dispatch outputs，含地名，不進 repo）

| 用途 | 檔名 |
|---|---|
| ① 專屬背景含吉祥物 | `TripQuest_北海道8天7夜_專屬背景圖提示詞_v3_含吉祥物.md` |
| ② 吉祥物動作九宮格 | `TripQuest_吉祥物動作九宮格_提示詞.md`（最後附冬季版的九格） |
| ③ 4×4 美食與景色 | `TripQuest_北海道4x4插圖_測試提示詞.md`（正本在 ART 第 7d 節，不含地名，所以在 repo 裡） |
| 不含吉祥物的背景（前一版） | `TripQuest_北海道8天7夜_專屬背景圖提示詞_v2.md` |
| 模擬行程表 | `TripQuest_北海道8天7夜_模擬行程表.md` |

### 2.1 ①②共用：兩段參考圖描述（照抄）

這兩段描述的是吉祥物本身，跟行程無關。

- **第二段（六隻的描述，`The six characters, as in the reference:` 起）每趟一字不改**，在下面「11-19 以前」那一塊。裡面一個一個寫死了 11-16 畫錯過的四處：鬍鬍灰毛白眉、北北多口袋、湯圓橘嘴與棕色、阿灰的大黑望遠鏡。
- **第一段 11-19 換了新版**，因為參考圖改成 GPT 生過的圖（第 3.3 節），舊的第一段描述的是 App 匯出的總表。寫新提示詞用下面「11-19 起」那一塊；舊的第一段留著當紀錄。

**11-19 起的第一段（參考圖是 GPT 生過的圖；🟡 待驗）**

- **出處**：九姿勢那份提示詞（Dispatch outputs 的 `TripQuest_吉祥物九姿勢_九宮格提示詞_v2.md`）的第一段。〔〕以外照抄，〔〕裡是那份綁著它那兩張參考圖的地方。v1 把第二張參考圖寫成「整張都是白狗」，其實有 3 格是湯圓，v2 改正了。
- **跟舊版的差別**：
  - 開頭改成描述 GPT 的參考圖；
  - 結尾加一句「只參考長相」，並點名參考圖裡有、這張不要出現的東西：GPT 的參考圖帶著自己的構圖和道具，不寫就可能被照畫；
  - 拿掉「不要抄總表上的名字」：GPT 的參考圖上沒有字。
- **待驗**：11-19 寫進範本時，還沒有任何一張用它生的圖回來。九姿勢那份是第一次用。
- 參考圖不是兩張時，把 `two` 改掉。
- 背景版（①）不寫 `same clean sticker style …` 那一句，因為背景的 STYLE 段另外寫了吉祥物的畫法。舊版的背景版寫 `mentioned below`，新版兩種都寫 `listed below`。

```
Use the two uploaded reference images. Both were drawn earlier for this same project and show the characters exactly as I want them: 〔換：每張參考圖是什麼。九姿勢那份（v2）是 the first is a 3×3 sheet of six original cute characters, each peeking over a light bar; the second is a 3×3 sheet of app icon designs, where six cells show the white dog drawn large and three show the round white bird〕. Draw the characters exactly as they look in the references: same body shape and proportions, same face, same colors, same outfits and accessories〔九宮格版才有：, same clean sticker style with thick, even, dark charcoal outlines and flat solid colors〕. Do not redesign them, do not change any color, do not add or remove clothes, pockets or accessories, and do not turn them into other characters or realistic animals. They may hold the small props listed below; their bodies, faces, colors and outfits stay exactly as in the reference. Use the references only for how the characters look: the poses, props, 〔換：有橫條才寫 bars and 〕background of this picture are the new ones described below, and 〔換：參考圖裡有、這張不要出現的東西。九姿勢那份是 the colored squares, maps, map pins and suitcase of the second reference〕 stay out of this picture.
```

**11-19 以前（參考圖是 App 匯出的總表＋鬍鬍大圖；北海道那一輪用的）**：第一段只留作紀錄；第二段（六隻的描述）照舊每趟照抄。九宮格版的第一段多一句 `same clean sticker style with thick, even, dark charcoal outlines and flat solid colors`，並把 `mentioned below` 寫成 `listed below`。其餘相同。

```
Use the two uploaded reference images: a sheet of six original cute characters, and a large picture of one of them (the white dog). Draw the characters exactly as they look in the references: same body shape and proportions, same face, same colors, same outfits and accessories. Do not redesign them, do not change any color, do not add or remove clothes, pockets or accessories, and do not turn them into other characters or realistic animals. They may hold the small props mentioned below; their bodies, faces, colors and outfits stay exactly as in the reference. Do not copy the names or any other text from the reference sheet.

The six characters, as in the reference:
- 棉棉: a white bunny. Pure white body; two tall ears with pink insides, one standing straight and one bent over at the tip; a tiny pink nose; pink cheeks; a lilac scarf with white dots.
- 北北: a white bear. White body; light grey inner ears; a round beige muzzle with a black nose; pink cheeks; light blue overalls with two yellow buttons. No pockets and no other clothes.
- 鬍鬍: a white miniature schnauzer. His fur is pure white everywhere: head, face, body and paws are all white, never grey. Only his bushy eyebrows are grey. His floppy ears are a very pale warm grey. A big white beard and moustache, pink cheeks, and a coral triangle bandana around his neck.
- 湯圓: a round white long-tailed tit. A white egg-shaped body; a green knit beanie with a yellow pom-pom; a tiny black beak (black, not orange); black wings; a long black tail; pink cheeks; small black feet. No brown anywhere.
- 阿灰: a grey hawk. Grey head and body, a little darker on top of the head; a cream belly with small grey V-shaped marks; yellow feet. A small pair of light blue binoculars hangs on his chest: small and light blue, never big, never black.
- 小鳳: a cockatiel. A yellow head with a tall yellow crest; round orange cheeks; a grey body; a small lilac bow tie; a long grey tail; pink feet.
```

### 2.2 ① 專屬背景含吉祥物

```
〔2.1 的兩段照抄（第一段用 11-19 起的版本）〕

A cozy hand-painted watercolor illustrated map of 〔換：地區，北海道那份是 Hokkaido, Japan〕, made as the background of a travel poster for an 〔換：天數，例 8-day〕 〔換：季節，例 summer〕 road trip in 〔換：月份，例 July〕. Portrait orientation, 2:3 (taller than wide). This picture is the background of the poster: the title, labels, route lines and boxes will be added on top of it later. So it has no text at all, and it keeps the empty areas described below. The six characters above are painted into the scenes on the map, as listed below.

STYLE: soft watercolor washes on warm cream paper, loose thin ink outlines, gentle pastel colors, 〔換：季節的光線，例 fresh bright summer light〕, a cheerful picture-book feeling. Sea and lakes in pale blue-green; land in 〔換：季節的地面顏色，例 soft light greens and pale yellow-greens〕. The six characters keep their own clean sticker style with thick dark outlines and flat colors, exactly as in the reference.

LAYOUT (positions are percentages of the picture, measured from the top-left corner):
1. TOP BAND, the top 14% of the picture, full width: plain pale sky. Only a few faint small clouds at the far left and far right edges. The middle of this band is completely empty.
2. MAP: 〔換：地圖主體，例 the island of Hokkaido seen from directly above, north at the top, with its real overall shape〕. The 〔換：island／peninsula …〕 spans from about 6% to 78% of the width and from about 33% to 72% of the height. All the sea around it is calm, flat water with only very faint soft waves.
3. FOOD AREA, upper right, from 52% to 98% of the width and from 15% to 32% of the height: a plain, very light cream paper area with no border. It holds eight dishes in two rows of four, evenly spaced, all about the same size. Directly under each dish, leave a strip of empty plain paper about half as tall as the dish. The eight dishes, left to right, top row first:
   1. 〔換：第 1 道。照行程表美食欄的順序；寫看得到的樣子（湯色、麵、配料），不寫店名或品牌〕
   2. 〔換：第 2 道〕
   …
   8. 〔換：第 8 道〕
4. EMPTY SEA AREAS, kept as plain calm water with nothing in it (no islands, no boats, no fish, no pictures, no characters): the sea on the left, from 0% to 24% of the width and from 15% to 50% of the height; the sea on the right, from 78% to 100% of the width and from 34% to 72% of the height; and the sea below the island, from 0% to 80% of the width and from 72% to 80% of the height.
5. BOTTOM BAND, the bottom 20% of the picture (from 80% to 100% of the height), full width: a rich, wide 〔換：季節〕 landscape seen from the side. From back to front: 〔換：這趟行程有的景色，由遠到近〕. The band is full of scenery from the left edge to the right edge. Its top edge fades softly into the sea above it. No characters in this band.

SCENES ON THE MAP: small watercolor vignettes painted directly on the land. Each one is a separate little scene in its own place; nothing connects them. The place names in brackets only tell you where each scene goes; never write them. Each character is small but clearly drawn, about 6% to 8% of the picture's height, and appears only once.
- 〔換：粗略方位〕 (〔換：地名，只用來定位〕): 〔換：景色，照行程表那一列〕. 〔換：角色〕 〔換：動作〕.
- …（行程表一列一景；六隻各配一景、各一次；其餘的景只畫景色）
- The rest of the 〔換：island〕 stays simple: plain light-green land with a few small round tree clusters. There are no cities and no towns other than 〔換：唯一保留的城鎮景；沒有就寫 none〕.
- Next to the food area: 小鳳 sits on the plain paper just to the left of the first dish of the top row (〔換：第 1 道〕), at about 44% to 51% of the width and 15% to 26% of the height, 〔換：吃那道菜的動作〕. 小鳳 stays outside the food area and does not cover the empty strip under the dish.

NOT ALLOWED ANYWHERE: Absolutely no text of any kind: no letters, no words, no numbers, no Chinese or Japanese characters, no place names, no labels, no title, no legend, no compass rose, no scale bar, no signature, no watermark; every sign, wall, bowl, plate and cone is blank. Do not copy the names or any text from the reference sheet. No boxes, frames, borders, banners, ribbons, sticky notes, flags, pins or markers. No roads, paths, trails, railways, route lines, dotted lines or arrows anywhere, including in the bottom band. No people. The only characters are the six reference characters, each appearing exactly once and only in the places listed above; the only other animals are 〔換：行程表有的動物；沒有就寫 there are no other animals〕. No other characters or animals. 〔換：季節的禁止項，夏天是 No snow anywhere and no white mountain tops.〕 No towers, no clock faces, no vehicles other than 〔換：景色裡少不了的交通工具，例 the two small boats；沒有就寫 No vehicles.〕. No land other than 〔換：地區〕.
```

**北海道那份的 SCENES 有一列長這樣**（括號裡的地名換成了說明）：

```
- On the west coast, at the small bay in the middle of the west coast (〔港町的地名〕): a tiny harbor-town scene: a calm canal lined with old stone warehouses, a few old-fashioned street lamps and two small boats. Every wall and sign is blank. 北北 sits in one of the two boats, rowing with an oar.
```

**換什麼**：

| 項目 | 在提示詞的哪裡 | 北海道那份 | 每趟怎麼換 |
|---|---|---|---|
| 地區 | 第一段、MAP、NOT ALLOWED 最後一句 | Hokkaido | 行程的地區。地形不是一座島（半島、一段海岸、好幾個城市）時，MAP 那一句與空海的百分比要重寫；**沒試過**，第一次換地形要當成新提示詞看 |
| 季節／月份 | 第一段、STYLE、底部風景帶、NOT ALLOWED | 夏天、7 月 | 照出發的月份寫。冬天會有雪：NOT ALLOWED 拿掉雪與白頂那一句，九宮格改用冬季版的九格 |
| 天數 | 第一段 | 8-day | 行程的天數 |
| 景點 | SCENES | 一天一景，只寫行程表有的 | 一列一景。括號裡放地名，只用來定位，並寫明不要寫出來。方位只寫粗略的。連兩次有字，就把括號連同地名刪掉再試 |
| 吉祥物 | SCENES、小鳳那一列 | 六隻各一次，配六個景 | 照當天的景色配動作。六隻各一次；第 7 個以後的動作不畫在背景裡，交給九宮格 |
| 美食 | FOOD AREA | 8 道，兩排各 4 | 照美食欄的順序寫。不是 8 道時，排法要重算（**沒試過**）。兩天是同一類菜時可以畫成不同的樣子（北海道那份畫了兩種拉麵） |
| 動物 | NOT ALLOWED | 只有企鵝 | 行程表有的才畫；不畫像六隻的動物（熊、兔、狗、圓滾滾的小鳥、鷹、鸚鵡） |
| 交通工具、城鎮 | SCENES、NOT ALLOWED | 只有兩艘小船、一個港町 | 只留景色裡少不了的；城鎮會招來招牌上的字，越少越好 |

**給 Yolin 的「直接重生」清單**也要照這趟換：字（包括抄參考圖底下的名字）、道路與路線、框與旗子、角色畫錯或重複、季節不對的東西、標題區中間畫了東西、美食區道數或順序不對、底部風景帶太細、多了別的陸地。重生清單提到的每一張表都要真的附在檔案裡，而且是中文（第 7e 節的教訓）。

### 2.3 ② 吉祥物動作九宮格

```
〔2.1 的兩段照抄（第一段用 11-19 起的版本、九宮格版）〕

Square image, 1:1. Exactly 9 separate cells arranged in a 3×3 grid of equal square cells. The entire background is one flat, solid, pure magenta color #FF00FF: no gradient, no texture, no noise, no vignette, no floor, no ground shadow, no scenery. Leave wide, clearly empty magenta gaps between neighboring cells, and an empty magenta margin around the outside of the whole grid. Do not draw grid lines, borders, frames, boxes, labels, captions or any text.

Each cell shows exactly ONE character doing ONE action, centered in its cell, with empty magenta space on every side; nothing crosses into another cell or touches the edge of the picture. The whole drawing in each cell, including tails, ears, crests, oars, boats, steam and every prop, fits inside the middle 75% of its cell, both in width and in height, so that the magenta gaps between neighboring cells stay completely empty from top to bottom and from left to right. Long tails may point sideways, but they also stay inside that middle area. The characters are all about the same size. In each cell the character and its props touch each other and form one connected shape. Do not draw motion lines, sparkles, hearts, music notes, sweat drops, speech bubbles or any other loose marks floating around the character. Do not use magenta, fuchsia or hot pink anywhere in the characters or props; 〔換：這趟有紫色系的東西就寫它的顏色，北海道那份是 lavender flowers are a soft blue-violet〕.

The nine cells, left to right, top row first:
1. 〔換：角色〕 〔換：動作與道具；吃的東西寫那道菜看得到的樣子〕.
…
8. 〔換：第 8 天〕
9. 〔換：角色〕 〔換：起點・終點的動作〕.

NOT ALLOWED ANYWHERE: no text of any kind (no letters, no words, no numbers, no Chinese or Japanese characters, no names, no labels, no signature, no watermark); every 〔換：這九格出現的道具，例 bowl, boat, camera and suitcase〕 is blank. No characters other than these six; no people, no 〔換：背景裡的動物〕, no other animals. 〔換：季節的禁止項，夏天是 No snow.〕
```

**北海道那份的三格**（不含地名，照抄可以當寫法的樣本）：

```
2. 北北 sitting in a small wooden rowboat, holding one oar, rowing. Under the boat, a small rounded patch of calm blue water that touches the boat.
7. 湯圓 sitting in a small round wooden tub of hot spring water, relaxed, eyes closed, water up to his chest, still wearing his green beanie. A few short wisps of white steam rise from the water and touch the tub.
9. 小鳳 walking forward pulling a small light blue suitcase on wheels with one wing and waving with the other wing.
```

**換什麼、怎麼寫**：
- 一天一格，第 9 格放起點・終點。
  - 少於 8 天：空下來的格子放備用動作。
  - 多於 8 天：再生第二張 3×3，**不要塞成 4×4**。4×4 每格只剩約 256 像素，眉毛、扣子更容易畫錯。
- 吃的東西就是背景美食區裡已經有的那道菜，同一道菜會出現兩次（圖上一次、吉祥物手上一次），這是刻意的。
- 動物（例如企鵝）留在背景裡，格子裡只有吉祥物（「每格一隻」）。
- 道具要跟角色連成一塊：水面碰到船、白煙碰到木桶。切圖程式靠「兩格之間有一整條從上到下都是洋紅的縫」來分格，尾巴、船槳、白煙伸進縫裡，那一整列都會被標成壞格。
- 鬍鬍拿相機要寫「拿在胸前、整張臉露出來」：11-17 那張還是把相機舉在臉前，臉被擋住，就查不到毛色。
- 冬季版的九格（滑雪、雪板、雪球、熱可可……）在 `TripQuest_吉祥物動作九宮格_提示詞.md` 最後的附錄，不含地名。

### 2.4 ③ 4×4 美食與景色（需要時才寫）

- 全文在 `docs/ART_生圖素材.md` 第 7d 節（不含地名，在 repo 裡）。
- 換什麼：
  - 第 1～8 格換成這趟美食欄的菜；
  - 第 9～16 格換成這趟景點欄原字裡出現的景色類型（山、湖、溫泉、瀑布……）；
  - 每一格都在依據表寫明對到行程表的哪一列，沒有依據的格子不畫。
- 第 7d 節實測過的教訓：山要寫「整座抹茶綠」，不要在山頂要淺色（淺色山頂會變成雪頂）；景色格要「站在一塊實心的圓地面上、零件互相碰到」，切圖時才不會整列被標壞。

### 2.5 寫提示詞時照守的規則

- 第 7e 節的寫法規則照守：依據、會招來字的不畫、整張不畫路、溫泉只畫蒸氣、山整座綠到頂、動物只畫行程表有的、美食只畫在美食區、括號地名只定位。
- 寫肯定句。否定句模型常不照做（ART 第 11 節）。
- 參考圖上有字，提示詞就要叫它別抄。11-19 以前的參考圖（App 匯出的總表）底下印了名字與物種，所以舊的第一段和 2.2 的 NOT ALLOWED 都寫了 `Do not copy the names …`。11-19 起改用 GPT 生過的圖，圖上沒有字，新的第一段拿掉了這句。2.2 NOT ALLOWED 那句留著，推論無害。
- 參考圖帶著自己的構圖和道具（GPT 的圖都是），第一段結尾要點名哪些不要出現（2.1 新的第一段）。

---

## 3. 原則

### 3.1 文字必須正確；插圖、路線、動作是參考配圖

正本在 ART 第 9 節第 0 條與 STATUS 工作慣例第 8 條，這裡只摘要，細節以那兩處為準：

- **字逐一核對、會擋**：地名、日期、天數、菜名。我們疊的字從行程表讀，由程式核字數、每道菜名、名單掃描。字不准被蓋住、要看得清楚。生圖自己畫出字來，一律算錯。
- **圖只看明顯的錯**：認不出是哪一隻、整隻顏色不對、少一隻、圖跟旁邊的字對不上（例如標籤寫哈密瓜、圖是拉麵）、去背留下色塊。（「多一隻」是本檔第 3.2 節加的判斷，ART 第 9 節第 0 條原本沒寫；Dispatch 2026-11-17 確認。）
- **不再追**：位置偏一點、路線沒貼著景色、動作細節。
- 哪些算明顯、哪些不再追：Session 的四項讀法（範圍、明顯與不追的分界、取消「要正式用再重生」、排版檢查不當門檻）**Dispatch 2026-11-17 都確認了**，理由是跟 Yolin「圖是參考配圖」的原則一致。

### 3.2 GPT 常畫錯的地方與怎麼處理

「見過幾次」一欄是實測紀錄（出處在 STATUS 各節）。「畫錯了怎麼辦」一欄原本是 Session 的讀法，**Dispatch 2026-11-17 確認了**。其中有三項是 ART 第 9 節第 0 條原本沒寫的新判斷，一起確認：
- 多一隻、同一隻兩次 → 背景重生；
- 吉祥物畫得小 → 不重生；
- 北北多口袋、湯圓嘴色這類 → 認得出是哪一隻就不追。

| 畫錯的地方 | 見過幾次（實測） | 提示詞已經怎麼防 | 畫錯了怎麼辦 |
|---|---|---|---|
| **畫出字**（含抄參考圖底下的名字） | 11-16 整張含字的行程圖，215 字錯 4、看不清 3；11-17 不含吉祥物的背景與九宮格都沒有字 | 多處明寫不准有字；括號裡的地名寫明不要寫出來 | **一律重生**（字就是資訊）。連兩次有字，就刪掉括號地名再試 |
| **鬍鬍變灰**（毛淺灰、眉毛白） | 11-16 兩張都是；11-17 九宮格又是 | 寫死「全身純白、只有眉毛灰」；多上傳一張他的大圖（11-19 起是 GPT 生的 `App圖示_3x3_2026-11-19.png`，第 3.3 節） | 整隻顏色不對算明顯的錯。九宮格用 `art-recolor` 改回白毛灰眉（兩次實測可行，耳朵會跟著變白），或重生那一格；背景裡的話，改色或重生由 Dispatch 定 |
| 北北多口袋、湯圓嘴變橘或帶棕色、阿灰的望遠鏡變大變黑 | 11-16 那兩張（連鬍鬍在內，六隻錯了四隻） | 每一處都一個一個寫死 | 認得出是哪一隻，就照新比重不追；認不出就重生或換格 |
| **多一隻、同一隻兩次、六隻以外的角色** | — | 「各一次、只在列出的地方」 | 背景：明顯的錯，重生。九宮格：那一格不用 |
| 相機擋住臉 | 11-17 九宮格 | 寫「拿在胸前、整張臉露出來」 | 查不到毛色時，以能不能認出是鬍鬍為準 |
| 吉祥物畫得很小 | 11-17 含吉祥物的背景（六隻都小） | 寫了占整張高度 6～8% | 不重生。補上去的動作跟著背景的大小走（步驟 7） |
| 尾巴、船槳、白煙伸進格縫 | — | 「每格的東西縮在中間 75%」 | `art-slice` 把那一整列標壞、回 4，好的格照切。壞的格重生，或用 App 的向量動作圖頂替（11-19 決定之前寫的：App 的向量正要照 GPT 的圖重描，重描前的舊向量畫風不同，要重看） |
| 底色不是一整片洋紅 | — | 寫死 `#FF00FF`、不准漸層與地板 | `art-slice` 回 3、整張不能切，只能重生。顏色有點偏但整片一樣沒關係（實測是 `#FA05FA` 左右） |
| 美食區道數不對或順序不對 | — | 「8 道、照順序」 | 標籤一定要貼著它說的那道菜：圖跟字對不上就是明顯的錯 |
| 白煙沒碰到木桶或碗、地標位置偏、島比要求大 | 11-17 的 4×4（熱氣沒碰到碗）、11-17 不含吉祥物的背景（島比要求大） | 寫了 | 不追；只要框放得下 |
| 淺色的山頂看起來像雪頂 | 11-17 不含吉祥物的背景、11-17 的 4×4 | 「整座綠或灰藍到頂」 | 不帶字的小項，照新比重不追。原本「要正式用再重生」的那張背景，這項也取消了（Dispatch 2026-11-17 確認） |

### 3.3 參考圖只用自己的：GPT 生過的圖

- **2026-11-19 起，參考圖一律用 GPT 生過的圖**（Yolin 的決定，Dispatch 11-19 轉達：「以後都改成用 GPT 生過的圖當參考圖」）。
  - **原因**：Yolin 喜歡的就是 GPT 的畫風（圓嘟嘟、毛茸茸）。App 匯出的向量正要照 GPT 的圖改掉，不能再拿來當正本。
  - **11-19 以前的寫法**（留作紀錄）：「只上傳 App 自己的六隻吉祥物：從 App 的向量（`js/glyphs.js` 的 `mascot()`、`js/peeks.js` 的 `peekFlat()`）直接畫大匯出」。那 13 張在 Dispatch outputs 的 `TripQuest_吉祥物參考圖/`（第 5 節）。不刪，但不再上傳；要比「App 舊的樣子」時才拿出來看。
- **挑哪幾張**（這四條是 Session 11-19 的讀法，Dispatch 還沒確認）：
  - 只用 GPT 生過、**造型驗過是對的**圖：那一隻的臉完整露出，顏色、衣服跟 2.1 的描述一致（鬍鬍白毛灰眉、阿灰小的淺藍望遠鏡……）。畫錯的圖拿去當參考，會把錯傳下去。
  - 用 `art-recolor` 改過色的圖不當參考：改色只救得了毛色，眉毛、耳朵改不好（步驟 5），等於帶著另一種錯。
  - 張數越少越好：每多一張，就多一份可能被照畫的構圖。
  - 參考圖都帶著自己的構圖和道具，提示詞第一段要寫「只參考長相」，並點名哪些不要出現（2.1 新的第一段）。
- **目前有哪幾張**（11-19 盤點；檔案在 Dispatch outputs 的 `TripQuest_生圖收件/`，`art-inbox/` 有同一份，sha256 對過）：

  | 檔 | 有誰 | 能不能當參考 |
  |---|---|---|
  | `吉祥物融入九宮格-第一次.png` | 六隻都在，每隻都從橫條後面探頭 | **能**，九姿勢那份用了。看不到腳和尾巴 |
  | `App圖示_3x3_2026-11-19.png` | 第 1、2、3、7、8、9 格是鬍鬍（畫得大），第 4、5、6 格是湯圓 | **能**，九姿勢那份用了。鬍鬍的毛團最清楚，v1.98.0 的圖示就是描第 1 格。有色塊、地圖、圖釘、行李箱，要在第一段點名不要出現 |
  | `吉祥物動作九宮格-第一次.png` | 六隻都在，做行程裡的動作（阿灰那格是全身） | **不能**：鬍鬍是灰的、相機擋臉，正是要防的錯 |
  | `底部分頁九宮格-第一次.png` | 六隻都在，各抱著分頁的東西 | 能，但九姿勢那份沒用：內容跟融入九宮格重疊 |

- **🟡 缺口：還沒有海報用的參考圖**。行程海報的背景（①）要畫整隻（坐船、泡湯、滑雪），可是上面能用的兩張，一張只露上半身，一張只有鬍鬍和湯圓、大多只畫到胸口。腳、尾巴、下半身目前只能靠 2.1 的文字描述。九姿勢那張生回來後，第 7 格（鬍鬍正面全身）可以補上鬍鬍；其餘五隻的全身，要不要讓 GPT 另生一張「六隻正面全身」，由 Dispatch／Yolin 定（要多生一次圖）。**下一趟生 ① 背景之前要先定。**
- **不上傳別人的作品當參考**，例如喜歡的海報、別的角色。可能被照抄、被拒，也有著作權的問題。版面一律用文字描述。當初海報參考 1、2 裡的角色屬於特定作品，提示詞裡絕不提。
- 版面示意圖也不上傳，只給 Yolin／Dispatch 看。上傳了會被照畫。

### 3.4 什麼不進 repo

- 提示詞原文（含地名）、行程表（真實的屬於個資；模擬的也含地名）→ 放 Dispatch outputs。
- 收件的原圖、切好的圖、疊字成品 → 放 `art-inbox/`、`.logs/`（都被 `.gitignore` 擋掉）。
- 進 repo 的只有三種：本檔（範本，不含地名）、腳本、要進 App 的素材。要進 App 的素材放 `media/art/`，同時登記 `manifest.json`（ART 第 9 節第 4 條）。
- 寫回報、STATUS、commit 訊息時，地名一律用泛稱；每個 commit 之後都跑 `node scripts/prepush-scan.mjs`（不給參數）。

### 3.5 範圍

- 「照行程表明寫的景點與季節畫，不算 App 在猜」是 Yolin 對人工流程的裁定（ART 第 7e 節），**只限人工流程**。
- App 自動產生的東西照舊守設計原則：猜出來的東西不准變成使用者看得到的字或圖。要不要延伸到 App 內生圖，見第 4.1 節。

---

## 4. 將來接 GPT API（只寫規劃；沒有投票、沒有實作）

**狀態**：只是規劃。這件事要付費、要註冊帳號，也會推翻兩個已經投過票的決議，所以動手之前要先開 3 代理投票，再由 Yolin 決定（CLAUDE.md 常設規則第 3 條、授權邊界）。本節只列需要什麼、有哪些待決，**不替任何一件做決定**。

### 4.1 要先決定的三件（每一件都會推翻現行的決議）

| # | 要決定的事 | 現行的決議 | 這次的提議 | 誰決定 |
|---|---|---|---|---|
| 1 | **金鑰放哪、怎麼呼叫** | `docs/AI_INTEGRATION.md` 第二輪（3:0）：每個行程的建立者用自己的金鑰，瀏覽器直接呼叫供應商，Worker 退出 AI 路徑（`workers/ai.mjs` 已刪除） | Dispatch 轉達：金鑰放 Worker、不放前端 | 3 代理投票＋Yolin。**2026-11-19 Dispatch 轉來決定（功能研究轉的）：GPT 生圖的金鑰可以放在 Worker、不放瀏覽器**；範圍、沒定下來的事（誰付費、要不要補投票）見 STATUS「等 Yolin 回覆」 |
| 2 | **每趟生成** | 同一份文件第一輪第 6 題（3:0）：海報走「混合快取、不是每張都生成」——裝飾元素每種風格生成一次，commit 成靜態資產重複用 | 每趟行程各生一張背景、一張九宮格 | 3 代理投票＋Yolin |
| 3 | **Yolin 的裁定要不要延伸到 App** | ART 第 7e 節：「照行程表畫不算猜」只限人工流程；App 自動產生的照設計原則 | App 照行程資料自動組提示詞、自動生圖 | Yolin |

**第 1 件的選項**（各自的代價；Session 不替投票下結論）：

| 選項 | 做法 | 好處 | 代價 |
|---|---|---|---|
| 甲 | Worker 代為呼叫，用維護者（Yolin）的 OpenAI 金鑰 | 金鑰不在任何前端；使用者不用註冊 | 所有人的費用都由 Yolin 付，要防濫用（只准群組成員呼叫、每群組每月額度、速率限制）；行程內容會經過 Worker，多一個經手的伺服器；要新增 Worker 端點（照每版流程，Worker 先部署、客戶端後推）；推翻第二輪「Worker 退出 AI 路徑」 |
| 乙 | 建立者用自己的金鑰，瀏覽器直接呼叫（跟現有的 Claude、TTS 一樣） | 跟現行架構一致；Yolin 不付別人的費用；不經我們的伺服器 | **OpenAI 的 API 允不允許瀏覽器跨網域呼叫（CORS）沒查證**；金鑰多半綁不了網域（推論），只能靠帳單擋，而 OpenAI 的預付餘額不是即時煞車（第 4.4 節）；建立者要自己註冊、綁卡、預付 |
| 丙 | 建立者用自己的金鑰，經 Worker 轉送（Worker 不存金鑰） | 就算 OpenAI 不開放 CORS 也能用 | 金鑰與行程內容都經過 Worker；推翻第二輪「Worker 退出 AI 路徑」 |

- 現有 `index.html` 的 CSP 是 `connect-src 'self' https: http:`（實測讀過），乙要連 `api.openai.com` 不用改 CSP。
- Yolin 2026-09 的原始需求是「讓每個行程建立者自行決定是否使用 AI，要用才輸入自己的 key，不會有我的用量被別人使用的疑慮」（AI_INTEGRATION 安全模型那一節）。這次那句「如果有串接 gpt api key」沒有說是誰的金鑰，要先問清楚（第 4.8 節第 5 項）。

### 4.2 App 內要跑的流程（對照第 1 節）

| 人工的步驟 | App 內怎麼做 | 現在有沒有 |
|---|---|---|
| 1 整理行程表 | 從 store 讀標題、天數、每天的景點，`js/itinposter/model.js` 已經在收這些。方位：人工時是 Claude 憑地理知識寫粗略方位，App 沒有這種知識，可以改用景點座標算相對位置（推論、沒做）。美食：App 只有景點庫的必吃，使用者自己打的美食沒有類別 | 部分有 |
| 2 寫提示詞 | 第 2 節的範本加一支填空函式。**只填對得上景點庫的景點**：使用者自己打字的景點可能是住家、親戚家，不送出去，也符合設計原則 | 沒有 |
| 3 生圖 | 呼叫影像 API：背景 1024×1536、九宮格 1024×1024。參考圖要一起送，可以在手機上用 `mascot()`／`peekFlat()` 當場畫出來，不用另存檔（推論）。**11-19 決定之前寫的，要重看**：參考圖改成 GPT 生過的圖（第 3.3 節）之後，App 要把那幾張點陣圖帶著；等向量照 GPT 重描完，當場畫的向量能不能當參考，到時再評估。API 收不收參考圖、參考圖怎麼計費：**沒查證** | 沒有 |
| 4 收件 | 存在手機上（IndexedDB）。要不要同步給旅伴另外決定（圖很大） | 沒有 |
| 5 切圖、去背 | `art-slice`／`art-keyout` 現在是 node＋sharp，要改寫成瀏覽器 canvas 版，自帶的對照組一起搬 | 只有 node 版 |
| 6 疊字 | 重用 `js/itinposter` 的版面與繪製（字本來就照行程資料畫，見第 4.6 節） | 部分有 |
| 7 補動作 | 用九宮格切出來的動作；或乾脆用 App 自己的向量動作圖（`peekFlat`）——不花錢，造型一定對（11-19 決定之前寫的，要重看：向量正要照 GPT 的圖重描，重描完造型才會跟 GPT 的一致） | 向量版有 |
| 8 檢查 | 字：我們自己畫，正確性由結構保證，再加現有的海報測試。圖：App 判斷不了，只能給使用者看預覽（第 4.3 節） | 沒有 |
| 9 成品 | 跟現有的行程海報一樣存 PNG／PDF | 有 |

### 4.3 還沒解決的（人工流程靠人眼做的四件，App 沒有對應的做法）

北海道那一輪，下面四件都是每換一張新圖就用眼睛重做一次。它們**還沒有解法**，不是排好的待辦：

1. **看重生清單**：偷畫的字、角色畫錯。App 沒有文字辨識，也沒有角色比對，判斷不了，只能交給使用者看預覽。
2. **量各區塊實際落在哪**：提示詞給了百分比，模型不一定照做（北海道那幾張的島都比要求大）。可能的方向：框與文字放在位置固定的不透明卡片上，不依賴模型留下的空海；代價是可能蓋到景色。
3. **站點與路線放哪**：人工時看景色估著放；App 不知道模型把景色畫在哪。可能的方向：App 版不在生成的地圖上畫站點與路線，每天的資訊只放在框裡。
4. **改色的方塊與種子點**：人工填的。App 不做自動改色，畫錯就重生。

### 4.4 費用（推論）

- **單價的出處：功能研究報告（repo 外，2026-11-16）**。數字讀自 OpenAI 官方生圖指南的計算器：
  - OpenAI API，模型 GPT-Image-2.6，**1024×1024 方圖**一張依品質約 US$0.025～0.21：low 0.025、medium 0.043、high 0.053、xhigh 0.094、max 0.211。
  - **不含輸入費**：提示詞的文字輸入、參考圖的圖片輸入都另外算。報告列了每百萬 token 的輸入價，但一張參考圖要幾個 token 沒有算。
  - 同一份報告寫明 gpt-image-1 已在 2026-10-23 停用（本檔第一版引的第三方網頁數字是 gpt-image-1 的，已拿掉）。
- **帳號與付款**（同一份報告，讀自 OpenAI 說明頁）：
  - 新帳號是預付制，要先綁付款方式，最低儲值 US$5；儲值一年後過期，不退款。
  - 自動儲值在設定時預設是開的，報告建議關掉。
  - 預付餘額**不能當即時煞車**：用完之後可能變成負餘額，從下次儲值扣。
- **`docs/AI_INTEGRATION.md` 第 6 節的數字留著、但來源不明**：那裡寫單張 US$0.02～0.17、混合方案一次性 US$5～25（2026-09）。沒寫是哪一家、哪種尺寸，引用連結也不在 repo 裡。
- **沒查證**：直式 1024×1536（背景要用的尺寸）一張多少；批次呼叫的折扣能不能用在這裡。
- **一趟的估算**：
  - 最少 2 張（背景＋九宮格）。每張平均重生一次就是 4 張；再加 4×4 與重生，最多約 6 張。
  - 照功能研究報告的方圖單價：一趟約 US$0.05～1.3，全用 medium 約 US$0.09～0.26；一年 10 趟約 US$0.5～13，全用 medium 約 US$0.9～2.6。
  - 沒算輸入費，也沒算直式的加價。
- **上限**：
  - 照現有 AI 的做法做裝置端計量：現有預設每月 US$2，`aiOn()` 到上限就改用免金鑰的做法。
  - 因為 OpenAI 的預付餘額不是即時煞車，**真正擋得住的是我們自己的計量**。選甲（Worker）的話，計量要做在 Worker 上，而且要擋住所有人的用量。

### 4.5 隱私：送出去的是什麼

- **只送**：地區、季節或月份、天數、對得上景點庫的景點名（或大略方位）、菜名、六隻吉祥物的參考圖。
- **不送**：旅伴的名字、具體日期（只送月份）、群組與行程的 ID、邀請碼、照片、使用者自己打字的景點、位置紀錄。
- 送出前讓建立者看一次「要送出去的文字」全文，同意了才送。
- OpenAI 怎麼處理經 API 送進去的資料（保留多久、會不會拿去訓練）：**沒查證**。實作前要查官方條款，寫進 App 裡的說明。
- 走 Worker 的方案（甲、丙）多一個經手的伺服器。「Worker 不記內容」要寫成驗得到的規則，不能只靠口頭說明。

### 4.6 疊字在手機端做

- 生圖只出無字的背景；所有字由 App 在 canvas 上畫，文字從行程資料來。這樣字一定對（結構保證），而且文字不用送給生圖模型去畫——11-16 那張含字的圖錯了 4 個字。
- 重用 `js/itinposter` 的 `layout.js`／`draw.js`，這兩支本來就在手機上畫、不上傳。
- 插圖上的字逐點量對比 ≥ 4.5，照現行的 B18 守。放在不透明卡片上最穩。
- 記憶體：2048×3072 的 RGBA 約 25 MB（照長寬算的），舊手機要實測（推論）。

### 4.7 生圖失敗與畫錯的退路

- 打不通、逾時、額度用完、被安全規則拒絕、離線 → 改用現有的程式海報（`js/itinposter`，v1.88 起就有），不顯示半成品。
- 背景畫出字、角色畫錯 → 使用者在預覽上按「重生」（算進上限），或按「用原本的海報」。
- 九宮格有壞格 → 那一格不用，改用 App 的向量動作圖，或少放一隻。
- 不做自動改色（配方要人填）。
- 文案照實寫，例如「生圖失敗，已改用原本的海報」，不要假裝成功（共用慣例第 4 節）。
- 退路平常走不到，所以要有一種常設情境專門驗它：模擬 API 失敗，必須畫出原本的海報（共用慣例第 5.13 節）。

### 4.8 動手之前要先問 Yolin 的

1. **付費**：誰付（甲是 Yolin 付所有人的；乙、丙是建立者自己付）、每月上限多少。
2. **帳號**：OpenAI 平台的帳號誰註冊、誰綁卡。新帳號是預付制：最低儲值 US$5、一年過期、自動儲值預設開啟（第 4.4 節）。
3. **投票**：第 4.1 節的第 1、2 件開 3 代理投票，結果送 Yolin；第 3 件由 Yolin 直接決定。
4. **隱私**：同不同意把景點名、菜名送到 OpenAI。
5. **先問清楚**：Yolin 說的「串接 gpt api key」是誰的金鑰——維護者的，還是每個建立者自己的。（2026-11-17：Dispatch 之後會問 Yolin，不急。）

### 4.9 決定之後才排的工作（現在不做）

- 提示詞填空模組與測試：只填對得上景點庫的景點；突變「改成也填使用者自己打的景點」必須紅。
- 呼叫端（Worker 端點或瀏覽器直連），並擴充金鑰外洩測試 `scripts/secret-leak-test.mjs`。
- 切圖、去背改成瀏覽器版，自帶的對照組一起搬。
- 預覽、重生、退回原本海報的畫面，加上用量計量。
- 第 4.3 節的四件要先有解法，才談得上整條自動化。

---

## 5. 腳本與檔案位置

### 5.1 在 repo 裡（進版控）

| 檔 | 做什麼 | 怎麼驗 |
|---|---|---|
| `scripts/art-slice.mjs` | 把九宮格或 4×4 切開（`--grid 2～6`）；好的格照切、壞的格點名 | 每次執行先跑自帶的合成對照組；`scripts/artselftest.mjs` 從命令列入口驗 |
| `scripts/art-keyout.mjs` | 去背：從四邊往內去掉連著的底色，邊緣去色邊 | 同上 |
| `scripts/art-recolor.mjs` | 把整隻角色的毛色改回目標色（例如鬍鬍），角色外面一點都不准動 | 自帶 10 個對照組；artselftest 的 AS8、AS9 |
| `scripts/art-lib.mjs` | 上面三支共用的函式 | 跟著上面三支驗 |
| `scripts/artselftest.mjs` | 從命令列入口驗上面三支 | 常設測試 |
| `scripts/arttransparenttest.mjs` | 吉祥物的圖不准有鋪滿畫布的底色（會開瀏覽器） | 常設測試 |
| `js/itinposter/`（`model.js`、`layout.js`、`draw.js`、`index.js`、`legicons.js`） | App 現行的行程海報：程式畫、字從行程資料來、全在手機上做。將來 API 版的疊字與退路都靠它 | `scripts/itinposterlayouttest.mjs`、`scripts/itinpostertest.mjs` |
| `js/glyphs.js` 的 `mascot()`、`js/peeks.js` 的 `peekFlat()` | 11-19 以前是參考圖的來源（向量），11-19 起不是了（第 3.3 節）；`peekFlat` 也是現成的動作圖 | App 既有的測試 |
| `docs/ART_生圖素材.md`、本檔 | 規則細節、流程與範本 | — |

### 5.2 在 `.logs/` 裡（一次性、不進版控）

**這些只對北海道那幾張圖有效**：座標是對著那一張圖用眼睛量出來寫死的，字數 215 也是那份行程表數的，換一張圖不能直接拿來用。要不要整理進 repo，見本節最後。

| 資料夾 | 檔 | 做什麼 |
|---|---|---|
| `.logs/hkbg-20261117/` | `overlay.mjs` | 不含吉祥物的專屬背景加上我們疊的東西：字、路線、框、美食標籤、吉祥物。寫圖前有一串檢查（字數、菜名、重疊……），每一道都帶對照組 |
| | `scan.mjs` | 交付前把檔名與圖上的字對名單掃一次（命中回 1、名單讀不到回 4、對照組沒抓到回 9） |
| | `deliver.mjs`、`intake.mjs` | 交付（複製後核 sha256）；收件 |
| | `crop.mjs`、`zoom.mjs`、`grid.mjs`、`probe.mjs` | 裁圖放大、加格線量座標、量顏色 |
| `.logs/mascot-grid-20261117/` | `overlay-a.mjs` | A 版：不含吉祥物的背景，加上九宮格切出來的 9 個動作 |
| | `overlay-b.mjs` | B 版：含吉祥物的背景直接疊字，框與路線避開它畫好的角色 |
| | `overlay-c.mjs` | 丙版：B 版的字原樣保留，加上補的 3 個動作；檢查 C0～C4 |
| | `preview-c.mjs`、`sbs-ab.mjs`、`sbs-bc.mjs` | 預覽補動作的位置；A／B、B／丙並排圖 |
| | `intake.mjs`、`deliver-ab.mjs`、`deliver-md.mjs` | 收件；交付 |
| | `c4diff.mjs` | 鬍鬍改色前後逐點比對、出前後並排圖 |
| | `montage.mjs`、`pair.mjs`、`px.mjs`、`magenta.mjs`、`compmap.mjs`、`diffprompt.mjs` | 排圖看細節、量像素與底色、逐行比對兩版提示詞 |
| `.logs/hk-bg-20261117/` | `layout.mjs` | 專屬背景的版面示意圖：只給 Yolin／Dispatch 看，不給 GPT |
| `.logs/hk4x4-20261117/` | `sample-b2.mjs`、`crop2.mjs`、`zoom.mjs`、`deliver.mjs` | 4×4 測試插圖疊進樣品 B；裁圖；交付 |

**其他位置**：
- **收件的原圖**：`art-inbox/`（`.gitignore` 第 33 行）。`.logs/` 是第 9 行。
- **參考圖成品**：Dispatch outputs 的 `TripQuest_吉祥物參考圖/`，共 13 張：總表、六隻正面全身、六張動作圖。不在 repo。**11-19 起不再上傳**，參考圖改用 GPT 生過的圖（第 3.3 節）；這 13 張留著，要比「App 舊的樣子」時才看。
- **參考圖的匯出腳本**：當時是暫存腳本，已經不在了。做法記在 STATUS 的「吉祥物參考圖、D 第二版、北海道整張行程圖提示詞」那一節：在 node 裡塞一個最小的 `document` 替身，呼叫 `mascot()`／`peekFlat()` 產 SVG，sharp 用 density 直接畫大。要再匯出就照那段重寫。

**要不要整理進 repo（待決，現在不做）**：疊字（overlay）與補動作的腳本如果要每趟重用，要先做四件事：寫死的座標改成讀設定檔；字數改成從行程表數；補自帶的對照組；登記進測試鏈。在那之前，每趟照第 1 節，從最近一支複製來改。
