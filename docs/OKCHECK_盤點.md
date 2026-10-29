# 「回傳失敗值、呼叫端卻沒接」盤點（2026-10-29，只列、不修）

Dispatch 2026-10-29：先列清單與分類，看規模與比例，再決定修哪些。

## 怎麼搜的（一次性，在搜的樣式範圍內）

- 母體：`scripts/*.mjs` 115 支。
- helper：任何縮排層級的 `function X` 或 `const X = (async) (...) =>`，本體裡有 `return false`、`return null`、`return !!` 或 `ok:` 的，共 57 個。
- 呼叫 154 處；「沒接」＝那一行以 `(await )X(` 開頭（陳述式，回傳值直接丟掉）：**36 處**。
- 對照組（同一次執行、同一段程式）：合成檔裡頂層 helper、單行箭頭 helper、巢狀在函式裡的 helper 各一個，三處沒接、三處有接、一個不回失敗值的函式——必須正好抓到那三處沒接、共 6 處呼叫，才往下掃。
  第一版只認頂層定義，漏掉 membergonetest 的 `pressModal`（巢狀在函式裡），補了巢狀那一種樣本才抓到。
- **跟 2026-10-28 的「33 處」對不上**：那次的搜法沒留下來，無法複核；以這份為準（搜法已入庫 `tools/okscan.mjs`）。
- **盲點**：失敗時什麼都不回（回 undefined）的 helper 這個搜法看不到，呼叫端接不接都一樣看不出點沒點到。

## 結果：36 處 ＝ 誤報 12 ＋ 真的沒接 24

### 誤報 12（不是這種寫法，不必動）

| 檔 | 處數 | 為什麼不算 |
|---|---|---|
| moneytest.mjs 411–431 | 5 | `resp()` 是換掉 `fetch` 的假回應，`ok:` 是假 Response 的欄位；本身不回東西 |
| settletest.mjs 221、262、438、452 | 4 | `openForm()` 打不開就丟例外（附畫面狀態），沒有「失敗值」可接 |
| imgtest.mjs 191–193 | 3 | `shotCard()` 找不到卡片時自己 `fail()` 記紅，不靠呼叫端 |

### 真的沒接 24

**A. 該用而沒用：可能假綠（1 處）＋留下殘局（3 處）**——membergonetest `pressModal('取消')`

| 行 | 後果（讀程式推論，沒跑） |
|---|---|
| 170 | 找不到「取消」→ 回 false、對話框還開著；下一行斷言「X1 按取消 → 小美還在」**照樣綠**——沒按取消，小美本來就在。這是假綠。 |
| 182、188、265 | 對話框還開著就往下走；下一步多半會撞上被蓋住的畫面而紅，但紅的理由不會是「取消沒按到」。 |

建議修：改用丟例外的寫法（或 `yes(await pressModal('取消'), …)`），並用突變證明 170 那條會紅。

**B. 下一步的等待會擋住、只是報錯看不出是哪個按鈕（20 處）**

每一處後面都緊接一個 `waitForSelector`／`waitForFunction`，等的是「按了才會出現」的東西，所以沒點到測試照樣紅、不會假綠；
丟掉的是理由——紀錄只剩「Waiting failed: …ms exceeded」。2026-10-28 importtest 就是這樣查了很久（`scripts/userclick.mjs` 的註解）。

| 檔 | 處數 | 在測試鏈裡？ |
|---|---|---|
| importtest.mjs 287、289、296、322、328 | 5 | 是 |
| installtest.mjs 221、224、248 | 3 | 是 |
| importshots.mjs 84、88、97、118、125 | 5 | 否（截圖工具） |
| livecheck-import.mjs 61、82、89、129、134 | 5 | 否（打真網路的手動檢查） |
| installshots.mjs 121、125 | 2 | 否（截圖工具） |

「等的東西按之前就不存在」逐處看過：`.imp-src`、`textarea.mono`、`.imp-row`、`.modal-card`、`#/trip/` 都是按了才出現；`.imp-bar` 在 `js/views/create.js:196` 建立時就是 `hidden`。
installtest 248 等的 `.modal-card textarea, .modal-card input`——前一步是加入頁，那時沒有對話框（讀程式推論）。

兩種處理（等 Dispatch 決定）：
1. 改用 `scripts/userclick.mjs` 的 `clickText`（點不到就丟例外、說出是哪顆按鈕）——跟 10-28 修 importtest 那一處同一招。
2. 保留，每處旁邊寫一行「下一步的等待會擋住，回傳值不用接」。

我的建議是 1：寫說明擋不住下一個人照抄這個寫法到一個後面沒有等待的地方（membergonetest 170 就是那種）。

## 2026-10-29 處理（Dispatch 決定：照建議修，20 處不加說明、改 helper）

- A：membergonetest 加 `mustPress`（找不到就丟例外），4 處改用它。
- B：20 處改用 `scripts/userclick.mjs` 的 `clickText`（import 成 `mustClickText`）；importshots、installshots 的舊 helper 已沒人用、刪掉。
  **行為也變了**：舊的是 `el.click()`，新的是真的滑鼠點擊、會先確認沒被蓋住——被蓋住的按鈕以前照點、現在會丟例外。
- 重掃（`node tools/okscan.mjs`，對照組先過）：沒接 36 → **12，剩下的正好是上面 12 處誤報**。
- 突變 `tools/mutations/mut_measuretarget.json` 第 3 條（X1 的取消按到不存在的按鈕）；**改過的 5 支與突變都還沒跑**（瀏覽器，等機器空出來，`docs/VERIFY_第1批.md` C5～C7）。

## 紀律：產生數字的方法跟數字一起入庫

「33」那個數字的搜法沒留下來，隔天無法複核、重搜得到 36。**一個數字沒有留下產生它的方法，就不是結果、只是傳聞。**
這次的搜法入庫成 `tools/okscan.mjs`（含對照組、盲點寫在檔頭）。以後報任何盤點數字：產生它的腳本或搜尋式先入庫，報告裡寫它的路徑。

## 比例

- 36 處命中裡誤報 12（33%）。
- 真的 24 處：會假綠 1、留殘局 3、只丟報錯理由 20。
- 在測試鏈裡的 12 處（membergonetest 4、importtest 5、installtest 3），工具 12 處。
