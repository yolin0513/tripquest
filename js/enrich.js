// 景點示意圖 —— 向 zh.wikipedia.org 查一張代表圖與座標，抓回來存成 blob（之後離線也看得到）。
// 只送出景點名稱，不送任何個人資料。預設開啟；可在行程設定關閉。
// 對長輩很重要：任務卡有「要拍的東西長怎樣」的照片，比純文字好懂太多。

import * as db from './db.js';
import * as store from './store.js';
import { sha256Hex } from './ids.js';

const API = 'https://zh.wikipedia.org/w/api.php';
const inFlight = new Map();

export async function enrichSpot(spot) {
  if (!spot || spot._enriched) return spot;
  if (inFlight.has(spot.id)) return inFlight.get(spot.id);
  const p = _enrich(spot).finally(() => inFlight.delete(spot.id));
  inFlight.set(spot.id, p);
  return p;
}

async function _enrich(spot) {
  const title = spot.wikiRef?.title || spot.name;
  try {
    const url = `${API}?action=query&format=json&origin=*&prop=pageimages%7Ccoordinates&piprop=thumbnail&pithumbsize=800&redirects=1&titles=${encodeURIComponent(title)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    const pages = data?.query?.pages || {};
    const page = Object.values(pages)[0];
    const patch = { _enriched: true };
    if (page?.coordinates?.[0] && spot.lat == null) {
      patch.lat = page.coordinates[0].lat;
      patch.lng = page.coordinates[0].lon;
    }
    const thumb = page?.thumbnail?.source;
    if (thumb && !thumb.endsWith('.svg') && !/logo|\.svg/i.test(thumb)) {
      const imgRes = await fetch(thumb, { mode: 'cors' });
      if (imgRes.ok) {
        const blob = await imgRes.blob();
        if (blob.type.startsWith('image/') && blob.size > 1200) {
          const hash = await sha256Hex(await blob.arrayBuffer());
          if (!(await db.getBlob(hash))) await db.putBlob({ hash, blob, bytes: blob.size, kind: 'hero' });
          patch.heroHash = hash;
        }
      }
    }
    await store.patch(spot.id, patch);
    return store.getRaw(spot.id);
  } catch {
    await store.patch(spot.id, { _enriched: true }).catch(() => {});
    return spot;
  }
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
