# TripQuest 專案狀態（docs/STATUS.md）

> 最後更新：2026-09-09，commit `892b857`，線上版本 **v1.57.3**。
> 給下一個工作階段快速接手用；架構細節見 `ARCHITECTURE_DECISION.md`，第三方平台實測見 `PLATFORM_NOTES.md`，配樂授權見根目錄 `MUSIC_LICENSES.md`。

## 部署

| 項目 | 位置 |
|---|---|
| 前端（GitHub Pages） | https://yolin0513.github.io/tripquest/ （repo `yolin0513/tripquest`，push main 即部署；`sw.js` 的 VERSION 每版必 bump） |
| 同步 Worker | https://tripquest.yolin0513.workers.dev （`workers/`，`npx wrangler deploy`；綁 D1 `tripquest` 與 R2 `tripquest-photos`） |
| 配樂 | Worker `GET /music/<id>.mp3` → R2 `music/v1/`（唯讀、白名單檔名、無列舉） |
| LAN 自架模式 | `server/index.mjs`（synctest 預設走這個；與 Worker 共用 `js/merge.js`） |

## 主要功能與現況

- **任務**（行程頁）：景點×拍照任務、主題化文案（六情緒＋交通樞紐，時段感知：早上不出「夜裡點燈」）、「現在這一站」、改時間提示換不合時段的任務。穩定。
- **照片**：相簿格狀（依天分組、延遲載入）／動態流雙檢視；全螢幕檢視器（左右滑、雙指縮放、縮圖→全圖 150ms 交叉淡入、按讚留言同一套記錄；逐幀驗證空幀 0）。穩定。
- **旅伴**：頭像列「N/M 位已加入 ›」＋旅伴清單（依 memberClaim 判定加入、時間、活動）＋新加入橫幅。剛上（v1.57.3），實機回饋待收。
- **分帳**：多幣別、匯率 12h 快取（open.er-api.com）。穩定、久未動。
- **回顧**：回憶影片（Ken Burns＋轉場＋路線圖 camera-move＋片尾配樂標示）、分享網址相簿（R2 公開頁、CSP script-src 'none'）、行程海報（3/5/7 天分頁）、最終回顧、成就徽章、「大家的表現」。穩定。
- **行程規劃**：搜尋加入（Nominatim＋策展庫＋維基補候選、行程中心 viewbox 偏好）、時刻鏈／排順序（FOSSGIS OSRM /table＋NN+2-opt、跨區段不給開車數字）、匯入行程表文字（round-trip）。穩定。
- **同步**：Cloudflare（內建預設）／LAN／單機；**欄位級合併**（v1.56，見下）；**短邀請連結**（v1.58：~154 字，摘要由伺服器 GET /invite 現算、行程名仍在連結 n=，舊 j= 連結繼續相容）；加入第一分鐘骨架＋進度。穩定。
- 分享按鈕在「旅程設定 → 旅伴與電話」上方（v1.59.1 從行程頁移來；旅伴清單有人未加入時也有「分享邀請連結」動作）。
- **找附近**（v1.59）：行程頁入口，停車場／廁所／便利商店／加油站四分類（藥局在 SOS 頁不重複；v1.59.1 只顯示距離；v1.59.2 停車場連 parking_entrance 一起查〔市區地下場常只標入口——石牌國小案〕、濾 permit/employees/無名入口、同名入口去重、名稱後援鏈 name→brand→operator→街道·類型、Overpass 上限 120→300；v1.59.3 廁所連 toilets* 子鍵的「附設廁所」一起查〔台灣常只標 toilets:wheelchair；=no 也代表有廁所〕、附設的 ♿ 只看 toilets:wheelchair 不看店面 wheelchair、toilets=no 排除），中心＝目前位置或任一景點；欄位含總車位、無障礙格、收費、平面/地下/立體、廁所無障礙＋尿布台、超商 24 小時；導航一律用座標（無名設施多、分店多——「地名優先」的合理例外）。剛上，實機回饋待收。
- **AI（選配）**：每行程自帶金鑰（tripSecrets store，只存本機、永不同步/匯出）、直連 api.anthropic.com；Google TTS 旁白**已擱置**。
- **配樂**：21 首（CC BY×6 KM＋CC0/PD×15 含古典），R2 供裝、選了才下載、tq-music-v1 快取跨版本；串流播放（MediaElementSource）；EBU R128 -16 LUFS 統一響度。穩定。

## 測試

- `npm test` 一次跑 **30 支**（validate-places → … → albumtest → jointest，全綠才算過）。較大的：plannertest 62、jointest 22、albumtest 27、mergetest 27、musictest 30、routetest 43、v147shots 45。
- **手動跑**（不在 npm test，因為打真網路／真伺服器）：
  - `npm run sweep` — 對**線上正式站**巡檢 67 項（含 R2 配樂 21 首 HEAD）。每次上版後必跑。
  - `npm run livetest` — 線上端到端（會在正式 D1 建「線上驗證團」，跑完記得清）。
  - `node scripts/synctest.mjs --url https://tripquest.yolin0513.workers.dev` — 兩台裝置打真 Worker。
  - `scripts/v148shots.mjs` — 真 Nominatim 的地理編碼覆蓋率（宜蘭實測行程）。
- 慣例：每版 bump `sw.js` VERSION → `npm test` → commit/push → curl 確認線上 VERSION → `npm run sweep` → 截圖放 `screenshots/features/`＋鏡像資料夾。
- 注意：**localhost 沒存過同步設定時一律單機**（v1.56.3）——測試不會再打正式 Worker；要測真伺服器的腳本都用 `setConfig` 明確指定。

## 重要架構決策（含理由）

1. **欄位級合併（v1.56，三代理 3:0）**：`js/merge.js` 純函式，客戶端／Worker／LAN server 三處同一份。spot/trip/quest 帶 `_f`（欄位組→時間戳），組＝一起寫的欄位（slot=day+order、time、pos=座標+來源、name、pinned…）；pos 手動優先；刪除/新增整筆語意；舊記錄退路＝updatedAt＋首次觸碰播種齊全；伺服器 no-op 不佔 seq、樂觀鎖重試、/push 回 merged；時間戳單調 max(now, prev+1)。理由：家庭規模下版本向量/op log 過重，per-field LWW 最小夠用。
2. **AI 金鑰只存本機**（tripSecrets 獨立 store，不進 exportGroup/exportRecords/同步）：金鑰洩漏面最小化；瀏覽器直連供應商，Worker 不經手。
3. **音樂放 R2 不放 repo**（v1.55）：曲庫再大不肥 repo/預快取；Worker 唯讀端點＋獨立 tq-music-v1 快取（升版不清）；repo 只留 playful.mp3 當離線保底；R2 取不到→退回合成音樂並明講。授權兩輪三代理查證（3:0），CC BY 維持 6 首不擴大，古典逐首查「錄音本身」授權（Clair de Lune 因錄音是 CC BY 3.0 被剔除換 WTC）。
4. **免金鑰資料源**：Nominatim（1.1s 節流＋30 天快取＋viewbox 偏好＋站點降權＋維基別名補候選）、FOSSGIS OSRM（1rps、一天一矩陣、canonical 快取）、Overpass（SOS 附近設施）、Open-Meteo、zh.wikipedia。取捨：無評分/營業時間/人氣——誠實標示，付費升級路＝使用者自帶 Google Places 金鑰（已擱置）。
5.6 **SW 換版一致性（v1.59.1）**：SHELL 檔案改「本版快取釘死的 cache-first」——先前的 stale-while-revalidate 會把網路新版寫回正在跑的版本快取，造成舊 app.js 配新 trip.js（畫面有新入口、路由表沒有那條路→被踢回首頁，v1.59 實機踩到）。換版只走 install addAll(cache:'reload')＋SKIP_WAITING 整組換；另加保險絲：notFound 時 /trip/<id>/* 退回該行程頁。nearbytest 有路由完整性稽核（view import ⊆ SW SHELL、navigate 目標 ⊆ 路由表）。
5. **原生 PWA、無框架無打包**；IndexedDB＋版本化 SW；h() 全 textNode＋URL 白名單（無 XSS 面）；CSP script-src 'self'。
6. **iOS 教訓**：原生 time input 空值畫成當下時間＋寬度不可控 → 全 App 改時/分下拉；主畫面 App 與 Safari 儲存分離 → 邀請流程 iPhone 先裝後加入。
7. 外部請求全部有逾時（AbortSignal.timeout 守門），失敗走各自降級（v1.55.1 健檢）。
8.5 **找附近（v1.59）**：放獨立頁不進 SOS——SOS 是走失/急救的緊急畫面，生活設施會稀釋緊急性（藥局兩邊都有，語境不同）。與 SOS 共用 Overpass 機制（免金鑰雙鏡像、12 秒逾時、離線回快取），分開快取（tripquest.nearlife，1 天）；濾掉 access=private 停車場。**誠實標示**：capacity＝總車位非即時剩餘（實測填寫率：羅東夜市 1/67、清水寺 25/206——有就顯示、不當賣點）；即時剩餘車位查證結論＝台北市舊免金鑰 JSON（tcgbusfs）已 404、主管道 TDX 要註冊金鑰、台中等縣市有零散自建端點但格式不一、日本無可靠免費來源 → 不接，介面講明，未來列 TDX 自帶金鑰選配。
8. **短邀請連結（v1.58，三代理 3:0 採 P1）**：連結 `#/join?g=<groupId b64url 22>&k=<祕鑰>&t=<tripId 前8>&n=<行程名 b64url>[&u=<自架網址>]`，728→~154 字。摘要改由 `GET /invite` 用群組記錄現算（js/invite.js，Worker 與 LAN server 共用；只收 Bearer、回應 no-store）——伺服器本來就存明文記錄，這不多給它任何東西；反而 v4 連結可被任何撿到連結的人離線解碼出成員名，新格式要過祕鑰驗證，是隱私改善。**祕鑰維持在 # fragment**（不進伺服器網址記錄）；新群組祕鑰改 base64url 22 字（頭尾避開 -/_），既有 hex 祕鑰不輪替、兩伺服器 regex 同版放寬。摘要拿不到（push 競態 404／離線）**不擋加入**；403 講「連結不完整請重傳」。分享訊息文字帶行程名＋日期＋邀請人（0 秒訊號搬進聊天室文字）。否決項：P2 祕鑰雜湊查找（省 25 字買三個新失效面）、workers.dev 入口（40 字比 Pages 前綴 38 字還長）、第三方短網址（祕鑰會進別人伺服器）；自訂網域要花錢，列給使用者決定未採。

## 已知限制與未解事項

- 免費地圖資料：餐廳覆蓋 OK 但**無評分、營業時間僅一~兩成、日本店名無中文**；「值得去嗎」答不了。
- 回憶影片／分享相簿以 photoHash 去重（同一張圖只放一次）——照片牆數投稿、影片數不重複照片，兩數字可能差開；v1.59.3 起介面會講明重複張數。影片管線無任何快取（每次重新蒐集，實測驗證）。
- 石牌國小地下停車場的廁所在 OSM 沒有任何標記（資料源缺漏）——OSM 是開放地圖，任何人可用 OpenStreetMap 網頁/App 在該停車場補 toilets=yes 或畫 amenity=toilets 節點，隔天查詢就會出現。
- 找附近的車位數（OSM capacity）填寫率低（台灣尤其低），且為靜態總車位；即時剩餘車位在免金鑰前提下無來源（介面已講明）。
- 跨區交通：>150km/4h 不給開車數字改提示；門檻可能誤標長途拉車（花蓮→墾丁），實測回饋再調。
- 同步為欄位組級 LWW：同一天兩台同時重排順序仍可能交錯（可解釋但非誰的原意）；時鐘偏移影響同現況。
- 長輩實機待確認：iOS 滑桿手感、相簿檢視器手勢、吉諾佩第音質（使用者已說 OK）、旅伴清單新版。
- **git 作者 email**：歷史檔案內容已洗（filter-repo，力推 `b8107c1`）；commit 作者欄仍是帳號 email（公開資訊），要藏需改 GitHub noreply（未做）。
- 記錄膨脹：spot 的 heroPool/_f 讓記錄變胖，尚無清理 UI。
- 邀請連結**永久有效、無輪替機制**（連結＝完整憑證，外洩＝永久入群）：家庭規模可接受；未來可加「重設邀請連結」（祕鑰輪替）。
- 短連結上線前寄出的裝置若 SW 快取還是舊版，開新格式連結會靜默回首頁（點邀請的多半是全新使用者，實務風險低；開一次 App 就更新）。
- `docs/SETUP_TODO.md` 歷史版本含 email（HEAD 已無、歷史已洗）。

## 待辦／已擱置（含擱置理由）

- **照片自動配對**（快拍入口＋GPS/時間建議）：使用者說現有「先選任務再拍」夠好用，暫不做。
- **附近探索（規劃第 3 批：Overpass 類別＋維基卡）**：實用設施版已由 v1.59「找附近」實作；「規劃行程用的景點/餐廳探索」因免費資料無評分仍擱置。
- **Google Places 自帶金鑰選配（第 4 批）**：付費路，等有需求。
- **影片旁白（Google TTS）**：自帶金鑰路徑已在，未接影片；擱置。
- **邀請第一分鐘其餘構想**（離線瓦片、家人位置分享、AI 推薦景點、資料大小面板）：C2 清單提過、未選。
- **Worker rate limiting**：健檢判非必要，擱置。

## 環境與帳號注意事項

- Cloudflare（wrangler 已登入）：D1 `tripquest`（**651KB，只剩 2 個真實群組**：`a3cf5587` 宜蘭家族旅行〔189 照片，家人在用，絕不動〕、`13f038d9` 宜蘭遊〔早期真實試用〕）；R2 `tripquest-photos`（照片 `<groupId>/<hash>`＋音樂 `music/v1/`，~182MB）。全部遠低於免費額度。
- 備份：`D:\Claude\App\backups\`——`tripquest-20260909-0008.bundle`（filter-repo 前完整歷史）、`d1-tripquest-20260909-0011.sql`（清理前整庫）、清理計畫 json 數份。
- 測試 fixture `scripts/fixtures/yilan.txt` 已去識別化（民宿→山風民宿hillstay、溫泉會館→雲居溫泉會館），全歷史一致。
- 截圖：`screenshots/features/` ＋ 鏡像 `C:\Users\阿倫\AppData\Roaming\Claude\local-agent-mode-sessions\96633e0f-...\outputs\tripquest\`（扁平、版本化檔名 v15xx-*）。
- 慣例：架構/資料結構/部署/付費/授權級決策先開 **3 個 Fable 5.1 代理**獨立評估投票；Windows 下 python heredoc 帶中文會 cp950 走樣——**含中文的 patch 腳本一律寫進 scratchpad 檔案再執行**。
