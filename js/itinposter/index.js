// 行程海報（v1.88.0）：從 store 收資料 → 模型（model.js）→ 版面（layout.js）→ 畫（draw.js）→ PNG／PDF。
// 頁面（js/views/itinposter.js）與瀏覽器測試（scripts/itinpostertest.mjs）走同一條。全部在手機上做，不上傳任何伺服器；
// 唯一的網路是天氣預報（跟主頁天氣條同一支 forecast：送出去的只有目的地的座標，三小時內有查過就用快取、不再送）。
// 車程（v1.89）只讀路線服務的快取（route.js 的 cachedMatrix），不連網。
import * as store from '../store.js';
import { loadPlaceLookup } from '../quests/generate.js';
import { loadThemes } from '../theme.js';
import { posterModel } from './model.js';
import { posterPages } from './layout.js';
import { drawPoster, canvasMeasure } from './draw.js';
import { pdfFromJpegs } from '../pdf.js';
import { cachedMatrix, LEG_ROUTE_MODE, legUsable, legMinutes, fmtDur } from '../route.js';
import { legModeOf } from '../legs.js';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 兩站之間的車程：「甲 id>乙 id」→ { min, text }。跟行程分頁「約 N 分」同一份（js/views/trip.js 的 fillLegMinutes）：
// 同一天有座標的景點一次一個矩陣、規則是 route.js 的 LEG_ROUTE_MODE／legUsable／legMinutes。差別只在這裡只讀快取——
// 使用者在行程分頁看過那一天、路線服務算出來的矩陣進了快取，這裡才拿得到；沒有就不寫，不在存檔時另外去查。
async function legTimesOf(spots) {
  const out = new Map();
  const byDay = new Map();
  for (const s of spots) { const d = s.day || 1; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(s); }
  for (const list of byDay.values()) {
    const placed = list.filter((s) => s.lat != null && s.lng != null);
    const at = new Map(placed.map((s, i) => [s.id, i]));
    const legs = list.slice(1).map((b, i) => ({ a: list[i], b, mode: LEG_ROUTE_MODE[legModeOf(list[i], b)] }))
      .filter((x) => x.mode && at.has(x.a.id) && at.has(x.b.id));
    for (const mode of new Set(legs.map((x) => x.mode))) {
      let m = null;
      try { m = await cachedMatrix(placed.map((s) => ({ lat: s.lat, lng: s.lng })), mode); } catch { m = null; }
      if (!m || m.src !== 'osrm') continue;
      for (const { a, b } of legs.filter((x) => x.mode === mode)) {
        const sec = m.sec[at.get(a.id)][at.get(b.id)];
        if (legUsable(a, b, sec)) out.set(`${a.id}>${b.id}`, { min: legMinutes(sec), text: `約 ${fmtDur(sec)}` });
      }
    }
  }
  return out;
}

// 模型：景點庫要先載好（必吃與「對不對得回景點庫」都要它）；載不到 → lookup 是 null、必吃一項都沒有（保守方向）
export async function gatherModel(tripId, { forecast = null, now = new Date() } = {}) {
  const trip = store.get(tripId);
  if (!trip) throw new Error('找不到這趟旅程');
  await loadThemes();
  const lookup = await loadPlaceLookup().catch(() => null);
  const spots = store.spotsOf(tripId);
  return posterModel({
    trip, spots, members: store.membersOf(trip.groupId),
    lookup, forecast, today: ymd(now), legTimes: await legTimesOf(spots),
  });
}

// 天氣預報：有出發日、景點有座標才查（目的地座標＝有座標的景點平均，跟天氣頁同一支 destCoords）。查不到 → null
export async function tripForecast(tripId) {
  const trip = store.get(tripId);
  if (!trip || !trip.startDate) return null;
  try {
    const [{ destCoords }, { forecast }] = await Promise.all([import('../views/weather.js'), import('../weather.js')]);
    const dc = destCoords(tripId);
    return dc ? await forecast(dc.lat, dc.lng) : null;
  } catch { return null; }
}

// 版面：用畫的時候那一種字量寬
let _measure = null;
export function renderPages(model, opts) {
  if (!_measure) _measure = canvasMeasure();
  return posterPages(model, opts, _measure);
}
export { drawPoster };

function canvasBlob(canvas, type, quality) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('圖存不出來'))), type, quality));
}
async function pageBlob(page, type, quality) {
  const cv = document.createElement('canvas');
  await drawPoster(cv, page);
  return canvasBlob(cv, type, quality);
}

// 檔名不能有的字換掉
export const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 60) || '行程';

// 存成圖片：每一張一個 PNG
export async function pngFiles(pages, base, onProgress) {
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress && onProgress(`畫第 ${i + 1}/${pages.length} 張…`);
    const blob = await pageBlob(pages[i], 'image/png');
    const name = pages.length > 1 ? `${base}-行程海報-${pages[i].label}.png` : `${base}-行程海報.png`;
    out.push(new File([blob], name, { type: 'image/png' }));
  }
  return out;
}

// 存成 PDF：每一張一頁（JPEG 放進去；PDF 不能直接放 PNG 而不另外解碼）
export async function pdfFile(pages, base, onProgress) {
  const imgs = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress && onProgress(`畫第 ${i + 1}/${pages.length} 頁…`);
    const blob = await pageBlob(pages[i], 'image/jpeg', 0.92);
    imgs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: pages[i].w, h: pages[i].h });
  }
  return new File([pdfFromJpegs(imgs)], `${base}-行程海報.pdf`, { type: 'application/pdf' });
}
