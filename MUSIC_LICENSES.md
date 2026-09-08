# 內建配樂授權記錄（MUSIC_LICENSES）

TripQuest 內建 **21 首**配樂。取用與散布方式：音檔經響度正規化與轉檔後存放在
專案自有的 Cloudflare R2（`music/v1/<id>.mp3`），由同步 Worker 的
`GET /music/<id>.mp3` 公開供裝（唯讀、檔名白名單、無列舉）；`playful` 一首
另保留於 repo `media/music/` 作為離線最終保底。

- 授權查證：**兩輪、各由 3 個獨立代理查證條款與出處原文後投票**
  - 第一輪（2026-09-08）：Kevin MacLeod 六首 CC BY 4.0，3:0 通過。
  - 第二輪（2026-09-08）：新增 15 首 CC0／公有領域錄音，3:0 條件式通過——
    三位代理獨立抓出同一問題：Clair de Lune（Laurens Goedhart 演奏）在
    Commons 的 PD 模板**只涵蓋樂曲**，錄音本身是 CC BY 3.0（「樂曲公有領域
    ≠ 錄音公有領域」）。已剔除，換成 Kimiko Ishizaka 的 WTC 前奏曲（CC0）。
- 下載日期：全部 **2026-09-08**。
- 修改說明（各授權下均允許，CC BY 已依規定註明）：
  1. 兩段式 EBU R128 響度正規化（I=-16 LUFS、TP=-1.5）——不同來源不忽大忽小；
  2. 轉檔為 mp3 VBR ~115kbps、44.1kHz；3. 去除尾端靜音；4. ID3 寫入作者/授權。
  音樂內容本身（旋律、編曲、長度）未剪輯。

## 標示義務與實作

| 授權 | 義務 | 片尾標示（只標實際用到的那一首） |
|---|---|---|
| CC BY 4.0（6 首） | 作者、曲名、授權連結、註明修改 | 兩行：曲名/作者 ＋「Creative Commons BY 4.0 · creativecommons.org/licenses/by/4.0 · 經轉檔」 |
| CC0 / 公有領域（15 首） | 無 | 禮貌標一行「音樂：曲名 — 作曲者 曲，演奏者 演奏」 |

App 內「🎼 音樂來源與授權」列出全部曲目、演奏者與授權種類。

## 曲目清單

### CC BY 4.0 — Kevin MacLeod（incompetech.com）×6（規模維持，不再擴大）

全站授權聲明：https://incompetech.com/music/royalty-free/faq.html ；條款：https://creativecommons.org/licenses/by/4.0/

| id | 曲名 | 分類 | ISRC | 來源 |
|---|---|---|---|---|
| `warm` | Wholesome | 溫暖懷舊 | USUAN1900022 | https://incompetech.com/wordpress/2019/07/wholesome/ |
| `porch` | Porch Swing Days - faster | 溫暖懷舊 | USUAN1100716 | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100716 |
| `travel` | Carefree | 輕快旅行 | USUAN1400037 | https://incompetech.com/wordpress/2014/08/carefree/ |
| `tender` | Heartwarming | 抒情 | USUAN1100207 | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100207 |
| `playful` | Fluffing a Duck | 活潑家庭 | USUAN1100768 | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100768 |
| `jaunty` | Wallpaper | 俏皮輕鬆 | — | https://incompetech.com/music/royalty-free/full_list.php |

### 古典 ×6 — 每一首都查證過「錄音本身」的授權

| id | 樂曲（作曲者） | 演奏／錄音者 | 錄音授權 | 出處（檔案頁） |
|---|---|---|---|---|
| `cl-aria` | 郭德堡變奏曲：詠嘆調（J.S. Bach） | Kimiko Ishizaka（Open Goldberg 計畫） | CC0 1.0 | https://commons.wikimedia.org/wiki/File:Kimiko_Ishizaka_-_01_-_Aria.ogg ；佐證 https://opengoldbergvariations.org/ |
| `cl-prelude` | 平均律第一冊：C 大調前奏曲 BWV 846（J.S. Bach） | Kimiko Ishizaka（Open WTC 計畫） | CC0 1.0 | https://commons.wikimedia.org/wiki/File:Kimiko_Ishizaka_-_Bach_-_Well-Tempered_Clavier,_Book_1_-_01_Prelude_No._1_in_C_major,_BWV_846.ogg |
| `cl-morning` | 皮爾金組曲：晨歌（Grieg） | Musopen Symphony（2012 集資錄音，明示釋入公有領域、worldwide） | 公有領域 | https://commons.wikimedia.org/wiki/File:Grieg_-_Peer_Gynt_Suite_No._1,_Op._46_-_I._Morning_Mood_(Musopen_Symphony).flac |
| `cl-anitra` | 皮爾金組曲：安妮特拉之舞（Grieg） | Musopen Symphony（同上） | 公有領域 | https://commons.wikimedia.org/wiki/File:Grieg_-_Peer_Gynt_Suite_No._1,_Op._46_-_III._Anitra%27s_Dance_(Musopen_Symphony).flac |
| `cl-flowers` | 胡桃鉗：花之圓舞曲（Tchaikovsky；Lawrence Odom 編曲） | US Air Force Band（美國聯邦政府職務作品，17 U.S.C. §105） | 公有領域（PD-USGov） | https://commons.wikimedia.org/wiki/File:Waltz_of_the_Flowers_-_Concert_Band_-_United_States_Air_Force_Band.mp3 ；官方 PD 專頁 https://www.music.af.mil/Multimedia/Music/Public-Domain-Music/ |
| `cl-gymno` | 第一號吉諾佩第（Satie） | Teknopazzo（Commons own work，2010 年上傳至今無爭議） | CC0 1.0 | https://commons.wikimedia.org/wiki/File:Gymnopedie_No._1..ogg |

> 使用美軍樂隊錄音不代表美國空軍為本 App 背書；App 僅標示演奏團體名稱。

### 現代 CC0 ×9 — Free Music Archive 創作者（FMA 頁 × archive.org 鏡像雙重驗證）

| id | 曲名 | 作者 | 分類 | 授權出處 |
|---|---|---|---|---|
| `ko-horizon` | Fouler l'horizon | Komiku | 輕快旅行 | FMA：https://freemusicarchive.org/music/Komiku/Its_time_for_adventure_ （CC0 1.0）；鏡像 https://archive.org/details/Komikuitstimeforadventure |
| `ko-village` | Le Grand Village | Komiku | 溫暖懷舊 | 同上 |
| `ko-tournesol` | Champ de tournesol | Komiku | 活潑家庭 | 同上 |
| `ko-barque` | Barque sur le lac | Komiku | 抒情 | 同上 |
| `ko-montagne` | La montagne | Komiku | 輕快旅行 | 同上 |
| `ko-bleu` | Bleu | Komiku | 抒情 | 同上 |
| `lf-picnic` | Go to the Picnic | Loyalty Freak Music | 活潑家庭 | FMA：https://freemusicarchive.org/music/Loyalty_Freak_Music/POSITIVE_ATTITUDE_ （CC0 1.0）；鏡像 https://archive.org/details/LoyaltyFreakMusicPOSITIVEATTITUDE20170920175908839 |
| `lf-sweetsun` | Sweet Sun | Loyalty Freak Music | 俏皮輕鬆 | 同上 |
| `lf-yippee` | Yippee ! | Loyalty Freak Music | 俏皮輕鬆 | 同上 |

## 曾評估並排除的來源（不要加回來）

- **Clair de Lune（Laurens Goedhart 演奏，Commons）** — 錄音層授權是 CC BY 3.0，
  非公有領域（PD 模板只涵蓋 Debussy 的樂曲）。依「CC BY 不再擴大」原則剔除。
- **Pixabay Music** — 授權禁止以獨立檔案形式再散布。
- **Bensound** — 自有授權，不允許隨 App 再散布音檔。
- **YouTube 連結匯入** — 違反 YouTube 服務條款，且下載不等於取得授權。
- **John Harrison 版四季（Commons）** — CC BY-SA，copyleft 條款對混入影片的
  情境過於糾纏，不採用。
