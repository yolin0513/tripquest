// 景點示意圖 + 一句介紹 —— 抓回來存成 blob / 欄位（之後離線也看得到）。
// 只送出景點名稱，不送任何個人資料。預設開啟；可在行程設定關閉。
// 對長輩很重要：任務卡有「要拍的東西長怎樣」的照片，比純文字好懂太多。

import * as db from './db.js';
import * as store from './store.js';
import { sha256Hex } from './ids.js';

const REST = (lang) => `https://${lang}.wikipedia.org/api/rest_v1/page/summary/`;
const COMMONS_FILE = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
const inFlight = new Map();

export async function enrichSpot(spot) {
  if (!spot || spot._enriched) return spot;
  if (inFlight.has(spot.id)) return inFlight.get(spot.id);
  const p = _enrich(spot).finally(() => inFlight.delete(spot.id));
  inFlight.set(spot.id, p);
  return p;
}

async function storeImage(url) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.size < 1500) return null;
    const hash = await sha256Hex(await blob.arrayBuffer());
    if (!(await db.getBlob(hash))) await db.putBlob({ hash, blob, bytes: blob.size, kind: 'hero' });
    return hash;
  } catch { return null; }
}

async function _enrich(spot) {
  const patch = { _enriched: true };
  try {
    // 1. 策展資料指定的 Commons 圖優先
    if (spot.commonsImg && !spot.heroHash) {
      const h = await storeImage(COMMONS_FILE + encodeURIComponent(spot.commonsImg.replace(/^File:/i, '')) + '?width=800');
      if (h) patch.heroHash = h;
    }

    // 2. Wikipedia REST summary：一次拿到縮圖 + 摘要 + 座標
    const title = spot.wikiRef?.title || spot.name;
    const lang = spot.wikiRef?.lang || 'zh';
    const res = await fetch(REST(lang) + encodeURIComponent(title), { headers: { accept: 'application/json' } });
    if (res.ok) {
      const d = await res.json();
      if (d.coordinates && spot.lat == null) { patch.lat = d.coordinates.lat; patch.lng = d.coordinates.lon; }
      if (d.extract && !spot.blurb) patch.blurb = trimExtract(d.extract);
      if (d.extract) patch.wikiExtract = trimExtract(d.extract, 120);
      const thumb = d.thumbnail?.source;
      if (!patch.heroHash && thumb && !/\.svg|logo/i.test(thumb)) {
        const h = await storeImage(thumb.replace(/\/\d+px-/, '/800px-'));
        if (h) patch.heroHash = h;
      }
    }

    // AI 介紹句由 aicontent.js 的 ensureSpotBlurbs 統一處理（有開 AI 時一次產全部景點、
    // 避免同一趟句型重複、會快取並同步給旅伴），這裡只負責維基資料。
  } catch { /* 靜默 */ }
  await store.patch(spot.id, patch).catch(() => {});
  return store.getRaw(spot.id);
}

function trimExtract(s, max = 40) {
  const first = String(s).split(/。|\n/)[0].trim();
  return (first.length > max ? first.slice(0, max) + '…' : first) || '';
}

// 一次補齊整個行程（背景執行，逐一以免打爆對方）
export async function enrichTrip(tripId, { force = false } = {}) {
  const trip = store.get(tripId);
  if (!trip || (trip.allowWiki === false && !force)) return;
  for (const s of store.spotsOf(tripId)) {
    if (!s._enriched || force) {
      if (force) await store.patch(s.id, { _enriched: false });
      await enrichSpot(store.getRaw(s.id));
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
