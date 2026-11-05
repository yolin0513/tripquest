// 住宿清單（2026-11-05 投票：docs/VOTE_2026-11-05_航班待買住宿.md；Yolin 同日四題都 OK）。
//
// 型別 `stay`，一間一筆，掛 tripId。進 merge.js 的 TRACKED（2:1）：name／dates／addr／note 四組——
// 一人改名稱、一人改日期，兩邊都留下；入住與退房同一組，不合出半套日期。
//
// 規矩（三票一致）：
//   · 存**實際日期**（YYYY-MM-DD），不存「第幾晚」：行程整段往後挪，飯店不會跟著偷偷搬到沒訂過的晚上。
//   · 行程日期改了不平移、不刪；落在行程外照實寫「不在行程日期內」。
//   · 不連 spot；**不准**從站名（飯店、民宿）、花費類別「住宿」、geocode 的 hotel、maps.js 的 GENERIC 推「這是住宿」。
//   · 晚數＝使用者填的退房日減入住日（算術、不是推測）；缺一個日期就不寫晚數，不寫「0 晚」。

import * as store from './store.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const normDate = (v) => (typeof v === 'string' && ISO.test(v) && !Number.isNaN(new Date(v + 'T00:00:00').getTime()) ? v : null);
const dayNum = (iso) => Math.round(new Date(iso + 'T00:00:00').getTime() / 86400000);

export function staysOf(tripId) {
  return store.exportRecords()
    .filter((r) => r.type === 'stay' && r.tripId === tripId && !r.deleted)
    .sort((a, b) => (a.checkIn ? 0 : 1) - (b.checkIn ? 0 : 1)
      || String(a.checkIn || '').localeCompare(String(b.checkIn || ''))
      || ((a.createdAt || 0) - (b.createdAt || 0))
      || String(a.id).localeCompare(String(b.id)));
}

// 兩個日期都有、退房晚於入住才回晚數；其餘 null（畫面就不寫晚數）
export function nightsOf(s) {
  const a = normDate(s.checkIn), b = normDate(s.checkOut);
  if (!a || !b) return null;
  const n = dayNum(b) - dayNum(a);
  return n >= 1 ? n : null;
}

// 相對行程：{ inTrip: true, from, to }（第 from～to 晚）／{ inTrip: false }／null（算不出：缺日期或行程沒日期）
export function tripNights(s, trip) {
  const n = nightsOf(s);
  const st = normDate(trip && trip.startDate), en = normDate(trip && trip.endDate);
  if (n == null || !st) return null;
  const from = dayNum(s.checkIn) - dayNum(st) + 1;
  const to = from + n - 1;
  const lastNight = en ? dayNum(en) - dayNum(st) : null;        // 最後一晚＝回程前一天
  if (from < 1 || (lastNight != null && to > lastNight)) return { inTrip: false };
  return { inTrip: true, from, to };
}

export function checkStay(v) {
  const name = String(v.name || '').trim();
  if (!name) return '要寫住哪裡';
  const a = normDate(v.checkIn), b = normDate(v.checkOut);
  if (a && b && dayNum(b) <= dayNum(a)) return '退房要比入住晚';
  return '';
}

export async function saveStay(tripId, v, existing = null) {
  const rec = {
    name: String(v.name || '').trim(),
    checkIn: normDate(v.checkIn), checkOut: normDate(v.checkOut),
    address: String(v.address || '').trim(), note: String(v.note || '').trim(),
  };
  if (existing) return store.patch(existing.id, rec);
  return store.put({ type: 'stay', tripId, ...rec });
}

export async function removeStay(id) { return store.remove(id); }
