// 行程海報（v1.88.0；行程分頁「行程」那一格；Yolin：「行程設定好之後，輸出一張 PNG 圖片或 PDF，內含這趟的景點和每天規劃」）
// ——模型：只放確定的事（設計原則：猜出來的東西不准變成使用者看得到的字）。
// 純函式：不碰 store、不碰 DOM、不打網路（scripts/itinposterlayouttest.mjs 直接餵合成行程與真的景點庫）。
// 回顧那邊的舊海報（js/poster/）不動，兩支互不相干，只借它的 dayDateLabel（第 N 天的「M/D（週X）」）。
//
// 放什麼、從哪來：
//   標題      trip.title（使用者取的）
//   N天M夜    出發日與結束日都有 → 照日期算；沒有 → 照排到第幾天；只有 1 天寫「一日遊」
//   日期      出發日～結束日（沒設就不寫，不猜）
//   旅伴      幾個人（membersOf 的人數；0 不寫）
//   每天      第幾天、那天的日期（有出發日才算）、第一站 → 最後一站、每一站的名字與時間（有填才寫）、
//             兩站之間怎麼去（使用者選過、而且前一站還是同一站才算：legs.js 的 legModeOf）
//   必吃      只從景點庫來：那一站要對得回景點庫——跟可信類別同一套檢查（js/theme.js 的 trustedTheme：
//             curated＋placeId、那一筆還在、拿名字再比一次是同一筆、建立時打的字再比一次也是同一筆），
//             通過的（recheck）才取景點庫那一筆人工整理的 must；對不上的那一站一個都不列，也不照名字猜
//   小提醒    只有天氣預報：日期**剛好落在旅程裡**的那幾天（天氣頁會退回「接下來 5 天」，那不是旅程的日子，這裡不退）；
//             下雨、下雪照天氣條同一個判斷（weather.js 的 isRainDay／isSnowDay）；寫明是哪一天查的預報。
//             預報是舊快取（查不到新的）就整段不放——說不出是哪天查的
// 不放：類別（名稱、插圖、每站 emoji）、景點介紹、AI 文案、住宿與航班（海報會傳出去：哪幾晚住哪裡、哪一班飛機不印）、
//       Check Point（App 裡沒有讓使用者標「重點」的地方，不替他挑）、食物插圖（沒有對得上的圖，不畫猜的）。
// 決定與替代方案見 docs/STATUS.md 的 v1.88.0。

import { trustedTheme } from '../theme.js';
import { spotTimes } from '../spottime.js';
import { legModeOf, LEG_ICON, LEG_LABEL } from '../legs.js';
import { weekdayLabel } from '../tripday.js';
import { isRainDay, isSnowDay, wxIcon } from '../weather.js';
import { dayDateLabel } from '../poster/layout.js';

export const MUST_PER_SPOT = 3;   // 一站最多列幾項必吃（景點庫一筆有 3～5 項；海報放不下全部，取前面的）

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayIndex = (iso) => {
  if (!ISO.test(String(iso || ''))) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86400000);
};
const md = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${m}/${d}`; };

// 出發日～結束日：「2026/5/10（六）– 5/12（一）」；跨年第二段也寫年；沒設出發日 → ''
export function dateRangeLabel(startDate, endDate) {
  const a = dayIndex(startDate);
  if (a == null) return '';
  const [ys] = startDate.split('-');
  const first = `${ys}/${md(startDate)}（${weekdayLabel(startDate, 1)}）`;
  const b = dayIndex(endDate);
  if (b == null || b <= a) return first;
  const [ye] = endDate.split('-');
  const second = `${ye !== ys ? ye + '/' : ''}${md(endDate)}（${weekdayLabel(startDate, b - a + 1)}）`;
  return `${first} – ${second}`;
}

// 幾天幾夜：日期都有照日期；不然照排到第幾天
export function spanOf(trip, maxDay) {
  const a = dayIndex(trip && trip.startDate), b = dayIndex(trip && trip.endDate);
  const days = a != null && b != null && b >= a ? b - a + 1 : maxDay;
  if (!(days >= 1)) return null;
  return { days, nights: days - 1, label: days === 1 ? '一日遊' : `${days}天${days - 1}夜` };
}

// 一站對得回景點庫的那一筆（跟可信類別同一套檢查；recheck＝第 1～3 步都過了，不管類別換不換得出來）。對不上 → null
export function verifiedPlace(spot, lookup) {
  if (!lookup) return null;
  const v = trustedTheme(spot, lookup);
  return v.recheck ? lookup.placeById(v.placeId) : null;
}

// 旅程裡的那幾天的預報（日期剛好落在出發日～結束日；沒設出發日 → 沒有）
export function tripWeather(trip, forecastDays) {
  const a = dayIndex(trip && trip.startDate);
  if (a == null || !Array.isArray(forecastDays)) return [];
  const b = dayIndex(trip.endDate);
  const end = b != null && b >= a ? b : a;
  return forecastDays
    .map((d) => ({ d, i: dayIndex(d && d.date) }))
    .filter(({ i }) => i != null && i >= a && i <= end)
    .sort((x, y) => x.i - y.i)
    .map(({ d, i }) => ({ ...d, day: i - a + 1 }));
}

function tipOf(w) {
  const temp = Number.isFinite(w.tmin) && Number.isFinite(w.tmax) ? `${w.tmin}～${w.tmax}°C` : '';
  let warn = '';
  if (isSnowDay(w)) warn = `可能下雪${w.snowCm > 0.2 ? `（預估積雪 ${w.snowCm} 公分）` : ''}`;
  else if (isRainDay(w)) warn = `可能下雨（${w.rainProb >= 55 ? `降雨機率 ${w.rainProb}%` : `預估雨量 ${w.rainMm} 毫米`}）`;
  return { day: w.day, date: md(w.date), icon: wxIcon(w.code), text: [temp, warn].filter(Boolean).join('，'), warn: !!warn };
}

// trip、spots（store.spotsOf 的順序：第幾天、order）、members、lookup（generate.js 的 loadPlaceLookup；沒載好給 null → 必吃一項都沒有）、
// forecast：{ days, stale }（weather.js 的 forecast 的結果；null 或 stale → 小提醒整段不放）、today：手機的日期 'YYYY-MM-DD'
export function posterModel({ trip, spots, members = [], lookup = null, forecast = null, today = '' }) {
  const byDay = new Map();
  for (const s of spots || []) {
    const d = s.day || 1;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }
  const dayNums = [...byDay.keys()].sort((x, y) => x - y);
  const foods = [];
  const days = dayNums.map((day) => {
    const list = byDay.get(day);
    const stops = list.map((s, i) => {
      const mode = legModeOf(i > 0 ? list[i - 1] : null, s);
      return {
        name: String(s.name || '').trim() || '（沒有名字）',
        time: spotTimes(s).startTime || '',
        leg: mode ? { mode, icon: LEG_ICON[mode] || '', label: LEG_LABEL[mode] } : null,
      };
    });
    // 那一天的必吃只在那一天裡去重（第 6 天又去同一個夜市，第 6 天那一張照樣列）；整趟的清單（foods）跨天去重，列在第一次去的那天
    const dayFoods = [];
    for (const s of list) {
      const place = verifiedPlace(s, lookup);
      if (!place || !Array.isArray(place.must)) continue;
      for (const f of place.must.slice(0, MUST_PER_SPOT)) {
        const name = String(f || '').trim();
        if (!name || dayFoods.some((x) => x.name === name)) continue;
        dayFoods.push({ day, name, at: stops[list.indexOf(s)].name });
      }
    }
    for (const f of dayFoods) if (!foods.some((x) => x.name === f.name)) foods.push(f);
    return {
      day, date: dayDateLabel(trip && trip.startDate, day),
      from: stops[0].name, to: stops[stops.length - 1].name,
      stops, foods: dayFoods,
      placeCount: new Set(stops.map((x) => x.name)).size,
    };
  });
  const fresh = forecast && !forecast.stale && ISO.test(String(today || '')) ? forecast.days : null;
  const tips = fresh ? tripWeather(trip, fresh).map(tipOf) : [];
  return {
    title: String((trip && trip.title) || '').trim() || '我們的旅程',
    span: spanOf(trip, dayNums.length ? dayNums[dayNums.length - 1] : 0),
    dateRange: dateRangeLabel(trip && trip.startDate, trip && trip.endDate),
    people: (members || []).length,
    // 幾個地方：照名字數不重複的（同一個夜市去兩次算一個）；吉祥物那一句用
    placeCount: new Set(days.flatMap((d) => d.stops.map((x) => x.name))).size,
    days, foods, tips,
    tipsAsOf: tips.length ? md(today) : '',
  };
}
