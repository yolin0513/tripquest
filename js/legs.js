// 每一段的交通方式（2026-11-05 投票：docs/VOTE_2026-11-05_同步欄位.md）。
//
// 資料放在**到達站**的 spot：`legMode`（代號）＋`legFrom`（選的時候的前一站 id）。
// 只有「現在的前一站＝記下的那一站」才算數——站被重排、前一站被刪、換了天，都退回
// 「沒有選」（通用圓點），不把舊選擇套到一段沒人選過的路上（三票都點名這是最大的錯法）。
// 認不得的代號（未來版本新增的）也當成沒有選：不顯示任何字、不猜。

export const LEG_MODES = ['walk', 'train', 'bus', 'car', 'boat', 'plane', 'other'];

// prev：當天排在前面的那一站（沒有就是 null，每天第一站沒有進站段）；spot：到達站。
// 回傳代號或 null。
export function legModeOf(prev, spot) {
  if (!prev || !spot || !prev.id) return null;
  if (spot.legFrom !== prev.id) return null;
  return LEG_MODES.includes(spot.legMode) ? spot.legMode : null;
}
