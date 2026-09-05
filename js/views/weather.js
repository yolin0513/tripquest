// 目的地天氣 —— 每天預報 + 「跟出發地差多少、要帶什麼」的提醒。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, spinnerBox } from '../ui.js';
import { navigate } from '../router.js';
import { forecast, buildAdvice, wxIcon, wxText, hereTempNow, getHome } from '../weather.js';
import { currentPosition } from '../geo.js';

// 目的地代表座標：有座標的景點取平均
export function destCoords(tripId) {
  const spots = store.spotsOf(tripId).filter((s) => s.lat != null && s.lng != null);
  if (!spots.length) return null;
  const lat = spots.reduce((a, s) => a + s.lat, 0) / spots.length;
  const lng = spots.reduce((a, s) => a + s.lng, 0) / spots.length;
  return { lat: +lat.toFixed(3), lng: +lng.toFixed(3), maxElev: 0 };
}

// 行程日期 → 對應到預報的哪幾天（帶 _tripDay）
export function tripForecastDays(trip, allDays) {
  if (!allDays || !allDays.length) return [];
  if (trip && trip.startDate) {
    const s = trip.startDate, e = trip.endDate || trip.startDate;
    const start = new Date(s + 'T00:00:00');
    const picked = allDays.filter((d) => d.date >= s && d.date <= e);
    // _tripDay = 該日期相對出發日的第幾天（不是陣列序號，行程從過去開始也對）
    if (picked.length) return picked.map((d) => ({
      ...d,
      _tripDay: Math.round((new Date(d.date + 'T00:00:00') - start) / 86400000) + 1,
    }));
  }
  // 沒日期或超出預報範圍：給接下來 5 天
  return allDays.slice(0, 5).map((d, i) => ({ ...d, _tripDay: i + 1 }));
}

export default async function weather(tripId) {
  const trip = store.get(tripId);
  if (!trip) { navigate('/', { replace: true }); return; }
  setTop({ title: '天氣提醒' });

  const dc = destCoords(tripId);
  const page = h('div', { class: 'page' });
  render(page);

  if (!dc) {
    page.append(h('div', { class: 'empty' }, h('p', {}, '這個行程的景點沒有座標，無法查天氣。'),
      h('p', { class: 'muted sm' }, '從內建清單選的景點才有座標；自己打字的景點可在景點頁補。')));
    return;
  }

  page.append(spinnerBox('正在查天氣…', '第一次要跟氣象網站要資料，大概 3～10 秒'));

  const f = await forecast(dc.lat, dc.lng);
  if (!f) {
    page.replaceChildren(h('div', { class: 'empty' }, h('p', {}, '查不到天氣（可能離線）。'),
      h('button', { class: 'btn btn-soft', onclick: () => weather(tripId) }, '重試')));
    return;
  }

  const days = tripForecastDays(trip, f.days);

  // 出發地當前氣溫（居住地 → GPS）
  let hereTemp = null, hereName = '出發地';
  const home = getHome();
  if (home && home.lat != null) {
    hereTemp = await hereTempNow(home.lat, home.lng);
    hereName = home.name || '居住地';
  } else {
    const pos = await currentPosition({ timeout: 6000, maxAgeMs: 600000 }).catch(() => null);
    if (pos) { hereTemp = await hereTempNow(pos.lat, pos.lng); hereName = '你的位置'; }
  }

  const tips = buildAdvice({ dest: { elevation: f.elevation }, destDays: days, hereTemp, hereName });

  const out = h('div', {});

  // ---- 提醒卡 ----
  if (tips.length) {
    out.append(h('div', { class: 'wx-advice' },
      h('div', { class: 'wx-advice-head' }, '🧳 出門提醒'),
      h('ul', { class: 'wx-advice-list' }, ...tips.map((t) =>
        h('li', { class: 'wx-tip wx-' + t.level }, t.text))),
      hereTemp != null
        ? h('p', { class: 'form-hint' }, `對照基準：${hereName}目前約 ${hereTemp} 度。可在「設定 → 居住地」調整。`)
        : h('p', { class: 'form-hint' }, '打開定位或設定居住地，就能算出「比家裡冷幾度」。'),
    ));
  } else {
    out.append(h('div', { class: 'wx-advice wx-ok' },
      h('div', { class: 'wx-advice-head' }, '🙂 天氣還算舒服'),
      h('p', { class: 'sm' }, '這幾天沒有特別要注意的，帶件薄外套備用就好。')));
  }

  // ---- 每天預報 ----
  out.append(h('div', { class: 'section-label' }, `${trip.region || '目的地'}　未來天氣`));
  out.append(h('div', { class: 'wx-days' }, ...days.map((d) => {
    const p = d.date.split('-');
    return h('div', { class: 'wx-day' },
      h('div', { class: 'wx-day-date' }, d._tripDay ? `第 ${d._tripDay} 天` : `${+p[1]}/${+p[2]}`),
      h('div', { class: 'wx-day-sub' }, `${+p[1]}/${+p[2]}`),
      h('div', { class: 'wx-day-icon' }, wxIcon(d.code)),
      h('div', { class: 'wx-day-txt' }, wxText(d.code)),
      h('div', { class: 'wx-day-temp' },
        h('b', {}, `${d.tmax}°`), h('span', { class: 'muted' }, ` / ${d.tmin}°`)),
      d.rainProb >= 30 ? h('div', { class: 'wx-day-rain' }, `☔ ${d.rainProb}%`) : null,
      d.snowCm > 0.2 ? h('div', { class: 'wx-day-rain' }, `❄️ ${d.snowCm}cm`) : null,
    );
  })));

  out.append(h('p', { class: 'form-hint' },
    `海拔約 ${f.elevation} 公尺。資料：Open-Meteo（每 3 小時更新）${f.stale ? '・目前顯示快取' : ''}。`));

  if (trip.startDate && f.days.length && trip.startDate > f.days[f.days.length - 1].date) {
    out.insertBefore(h('p', { class: 'form-hint', style: 'margin-bottom:10px' },
      '出發日還早（超過 16 天），先看接下來幾天的天氣參考，接近出發再回來看。'), out.firstChild);
  }

  page.replaceChildren(out);
}
