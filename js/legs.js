// 每一段的交通方式（2026-11-05 投票：docs/VOTE_2026-11-05_同步欄位.md）。
//
// 資料放在**到達站**的 spot：`legMode`（代號）＋`legFrom`（選的時候的前一站 id）。
// 只有「現在的前一站＝記下的那一站」才算數——站被重排、前一站被刪、換了天，都退回
// 「沒有選」（通用圓點），不把舊選擇套到一段沒人選過的路上（三票都點名這是最大的錯法）。
// 認不得的代號（未來版本新增的）也當成沒有選：不顯示任何字、不猜。

export const LEG_MODES = ['walk', 'train', 'bus', 'car', 'boat', 'plane', 'other'];
// 名稱與圖示。圖示用系統的表情符號，不自己畫（js/glyphs.js 檔頭：原創圖形就那兩個，不加第三個）；
// 表情符號本來就是為小尺寸設計的，輪廓彼此分得開（走路＝人、電車＝長車廂側面、公車＝正面方盒、開車＝矮車身、船、飛機）。
// 「其他」沒有對應的圖示——不硬配一個（配了就是在猜他搭什麼），地圖上跟沒設定一樣用圓點，字寫「其他」。
export const LEG_LABEL = { walk: '走路', train: '電車・捷運', bus: '公車', car: '開車・計程車', boat: '船', plane: '飛機', other: '其他' };
// 電車原本是 🚃：縮到地圖上的實際大小（22px）跟公車 🚌 都是「方盒＋一排窗」分不開（2026-11-05 截圖），改側面長車頭。
// 判準是「七種填成單色、實際大小並排還分得開」，不是「換一個不一樣的」——scripts/_legsil.mjs 兩兩比輪廓。
export const LEG_ICON = { walk: '🚶', train: '🚄', bus: '🚌', car: '🚗', boat: '⛴️', plane: '✈️', other: '' };

// prev：當天排在前面的那一站（沒有就是 null，每天第一站沒有進站段）；spot：到達站。
// 回傳代號或 null。
export function legModeOf(prev, spot) {
  if (!prev || !spot || !prev.id) return null;
  if (spot.legFrom !== prev.id) return null;
  return LEG_MODES.includes(spot.legMode) ? spot.legMode : null;
}
