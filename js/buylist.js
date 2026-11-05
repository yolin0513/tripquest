// 待買清單（2026-11-05 投票：docs/VOTE_2026-11-05_航班待買住宿.md；Yolin 同日四題都 OK）。
//
// 型別 `buy`，一項一筆，掛 tripId（群組由 store 的 groupIdOfRecord 從 trip 對回去）。
// 進 merge.js 的 TRACKED（2:1）：`text`、`done` 兩組——一人改字、一人打勾，兩邊都留下。
// 這個決定只能在第一版做：以後再把它改成追蹤型別，這一版的手機會帶著舊 _f 上傳、每組都輸。
//
// 規矩：
//   · 沒有手動排序（Yolin 同意）：沒買的在前、再依建立時間、最後用 id 決勝——每台手機排出來一樣。
//   · doneBy 只記「這支手機選過的我是誰」；沒選過就 null，畫面不寫是誰勾的（不猜）。
//   · 刪除是墓碑。A 刪了、B 在那之後改了同一項 → 那一項會回來：這是設計（Yolin 同意，見投票紀錄）。
//   · 不自動帶任何建議品項、不從字推分類或圖示。

import * as store from './store.js';

export function buysOf(tripId) {
  return store.exportRecords()
    .filter((r) => r.type === 'buy' && r.tripId === tripId && !r.deleted)
    .sort((a, b) => (Number(!!a.done) - Number(!!b.done))
      || ((a.createdAt || 0) - (b.createdAt || 0))
      || String(a.id).localeCompare(String(b.id)));
}

export function buyCounts(tripId) {
  const all = buysOf(tripId);
  return { total: all.length, left: all.filter((x) => !x.done).length };
}

export async function addBuy(tripId, text) {
  const t = String(text || '').trim();
  if (!t) return null;
  return store.put({ type: 'buy', tripId, text: t, done: false, doneBy: null });
}

// memberId：這支手機選過的「我是誰」；沒有就傳 null
export async function setBuyDone(id, done, memberId) {
  return store.patch(id, { done: !!done, doneBy: done ? (memberId || null) : null });
}

export async function setBuyText(id, text) {
  const t = String(text || '').trim();
  if (!t) return null;
  return store.patch(id, { text: t });
}

export async function removeBuy(id) { return store.remove(id); }
