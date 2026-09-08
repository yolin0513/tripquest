// 把行程輸出成純文字 —— 給 LINE 分享、備份、或貼回任何裝置的 TripQuest 匯入。
//
// 三代理 3:0 決議：純文字是「輸出/分享」功能，不是內部資料通道（內部走結構化
// 資料、座標隨行）。格式刻意寫成 itinerary.js 一定解析得回來的樣子，並由
// plannertest 的 round-trip 測試釘住：export → parseItinerary → 天/名稱/時間/停留
// 逐筆相等。改這裡的格式，先去看那條測試。

import * as store from './store.js';
import { spotTimes } from './spottime.js';

const pad = (n) => String(n).padStart(2, '0');

export function exportItineraryText(tripId) {
  const t = store.get(tripId);
  if (!t) return '';
  const spots = store.spotsOf(tripId);
  const days = [...new Set(spots.map((s) => s.day || 1))].sort((a, b) => a - b);
  const lines = [];
  if (t.title) { lines.push(`行程名稱：${t.title}`); lines.push(''); }

  for (const d of days) {
    let head = `第${d}天`;
    if (t.startDate) {
      const dt = new Date(new Date(t.startDate).getTime() + (d - 1) * 86400000);
      head += ` (${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())})`;
    }
    lines.push(head);
    const inDay = spots.filter((s) => (s.day || 1) === d)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    for (const s of inDay) {
      const tm = spotTimes(s);
      let line = '';
      if (tm.startTime) line += tm.startTime + ' ';
      line += s.name;
      if (Number.isFinite(tm.stayMin) && tm.stayMin > 0) {
        line += ` (停留 ${pad(Math.floor(tm.stayMin / 60))}時${pad(tm.stayMin % 60)}分)`;
      }
      lines.push(line);
    }
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}
