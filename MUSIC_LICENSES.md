# 內建配樂授權記錄（MUSIC_LICENSES）

TripQuest 的內建配樂（`media/music/`）全部來自 **Kevin MacLeod（incompetech.com）**，
採 **Creative Commons Attribution 4.0 International（CC BY 4.0）** 授權。

- 授權條款：https://creativecommons.org/licenses/by/4.0/
- 站方授權說明：https://incompetech.com/music/royalty-free/licenses/
- 站方 FAQ（標示格式、允許修改與商用的原文）：https://incompetech.com/music/royalty-free/faq.html
- 取得日期：**2026-09-08**，自 incompetech.com 官方 mp3 目錄下載
  （`https://incompetech.com/music/royalty-free/mp3-royaltyfree/<曲名>.mp3`）
- 授權查證：由三個獨立代理各自核對條款原文與曲目出處，3:0 通過（2026-09-08）。
  註：部分較早期曲目在第三方鏡像（Wikimedia Commons、FMA）標示 CC BY 3.0
  （發行年代較早）；incompetech 現行官網統一標示 4.0，3.0/4.0 皆允許本專案的
  全部用途（商用、再散布、修改），本記錄依站方現行標示記 4.0。

## 修改說明（CC BY 4.0 要求註明）

所有檔案相對原始 mp3 有以下技術性修改：

1. 重新轉檔壓縮：320kbps CBR → LAME VBR `-q:a 6`（約 115kbps），縮小 App 下載量。
2. 移除曲尾靜音（ffmpeg `silenceremove`，-45dB 門檻）。
3. ID3 標籤寫入作者（Kevin MacLeod (incompetech.com)）與授權（CC BY 4.0 + 連結）。

音樂內容本身（旋律、編曲、長度）未做剪輯。

## 曲目清單

| App 檔名 | 曲名 | 作者 | 授權 | ISRC | 曲目頁 / 出處 |
|---|---|---|---|---|---|
| `warm.mp3` | Wholesome | Kevin MacLeod (incompetech.com) | CC BY 4.0 | USUAN1900022 | https://incompetech.com/wordpress/2019/07/wholesome/ |
| `travel.mp3` | Carefree | Kevin MacLeod (incompetech.com) | CC BY 4.0 | USUAN1400037 | https://incompetech.com/wordpress/2014/08/carefree/ |
| `porch.mp3` | Porch Swing Days - faster | Kevin MacLeod (incompetech.com) | CC BY 4.0 | USUAN1100716 | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100716 |
| `tender.mp3` | Heartwarming | Kevin MacLeod (incompetech.com) | CC BY 4.0 | USUAN1100207 | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100207 |
| `playful.mp3` | Fluffing a Duck | Kevin MacLeod (incompetech.com) | CC BY 4.0 | USUAN1100768 | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100768 |
| `jaunty.mp3` | Wallpaper | Kevin MacLeod (incompetech.com) | CC BY 4.0 | —（見全曲目表） | https://incompetech.com/music/royalty-free/full_list.php |

站方建議的標示句（每首套用）：

> "<Title>" Kevin MacLeod (incompetech.com)
> Licensed under Creative Commons: By Attribution 4.0
> https://creativecommons.org/licenses/by/4.0/

## App 內的標示位置

1. **影片片尾**（跟著影片走的標示）：`js/memory.js drawOutro` 畫出
   「音樂：<曲名> — Kevin MacLeod (incompetech.com)」與
   「Creative Commons BY 4.0 · creativecommons.org/licenses/by/4.0 · 經轉檔」。
2. **回憶頁「🎼 音樂來源與授權」**：完整清單、授權連結、修改說明、
   YouTube Content ID 誤判申訴提醒。
3. 本檔案（repo 內完整記錄）。

## 曾評估並排除的來源（不要加回來）

- **Pixabay Music** — Pixabay Content License 禁止以獨立檔案形式再散布
  （"You cannot sell or distribute Content … on a Standalone basis"）；
  mp3 放進公開 repo 即屬獨立散布。https://pixabay.com/service/license-summary/
- **Bensound** — 自有授權，免費層限線上影音用途、不允許隨 App 再散布音檔。
- **YouTube 連結匯入** — 違反 YouTube 服務條款（禁止站外下載），且下載不等於取得音樂授權。
