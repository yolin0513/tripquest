// 行程海報（v1.88.0）：從 store 收資料 → 模型（model.js）→ 版面（layout.js）→ 畫（draw.js）→ PNG／PDF。
// 頁面（js/views/itinposter.js）與瀏覽器測試（scripts/itinpostertest.mjs）走同一條。全部在手機上做，不上傳任何伺服器；
// 唯一的網路是天氣預報（跟主頁天氣條同一支 forecast：送出去的只有目的地的座標，三小時內有查過就用快取、不再送）。
import * as store from '../store.js';
import { loadPlaceLookup } from '../quests/generate.js';
import { loadThemes } from '../theme.js';
import { posterModel } from './model.js';
import { posterPages } from './layout.js';
import { drawPoster, canvasMeasure } from './draw.js';
import { pdfFromJpegs } from '../pdf.js';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 模型：景點庫要先載好（必吃與「對不對得回景點庫」都要它）；載不到 → lookup 是 null、必吃一項都沒有（保守方向）
export async function gatherModel(tripId, { forecast = null, now = new Date() } = {}) {
  const trip = store.get(tripId);
  if (!trip) throw new Error('找不到這趟旅程');
  await loadThemes();
  const lookup = await loadPlaceLookup().catch(() => null);
  return posterModel({
    trip, spots: store.spotsOf(tripId), members: store.membersOf(trip.groupId),
    lookup, forecast, today: ymd(now),
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
