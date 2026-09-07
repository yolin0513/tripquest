// 把整趟的照片做成一個「傳給家人看」的網址。
//
// 為什麼需要這條路：使用者實測回報「匯出的 HTML 相簿頁在手機開啟後沒有內容，
// 存到電腦可以正常顯示」。量了才知道單檔 HTML 把照片 base64 內嵌之後，
// **40 張就 46.6MB**，一百多張會做出 60–200MB 的一個檔案。電腦打得開，
// 手機要把整份原始碼讀進記憶體、屬性字串又是 UTF-16 再翻一倍，常常撐不住。
//
// 所以真正要的不是「更小的單檔」，是**照片一張一張用 HTTP 載**。既有的
// Cloudflare Worker + R2 本來就存著全圖，只要多開一個公開的讀取端點就行：
//   · albumId 是 128-bit 亂數，網址本身就是憑證（跟邀請連結同一套想法）
//   · 只有清單裡的 hash 給讀，其他一律 404
//   · Worker 回相簿頁時送嚴格 CSP，完全不准腳本
//   · 隨時可以「收回」
//
// 這是**對外公開**的動作，所以一定要使用者自己按、而且畫面上要講清楚。

import * as store from './store.js';
import * as db from './db.js';
import { albumSlides, albumMeta, albumHTML } from './memory.js';
import { syncEnabled, adapterForGroup } from './sync.js';
import { ensureGroupSync } from './share.js';

function newAlbumId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function albumInfo(tripId) {
  const t = store.getRaw(tripId);
  return t?.albumId ? { albumId: t.albumId, url: t.albumUrl || '', at: t.albumAt || 0 } : null;
}

export function canPublish() { return syncEnabled(); }

// onProgress({ phase, done, total })
export async function publishAlbum(tripId, { onProgress = () => {} } = {}) {
  if (!syncEnabled()) throw new Error('還沒有設定多人同步，沒辦法產生分享網址。請先到「設定 → 多人同步」。');
  const trip = store.get(tripId);
  const group = await ensureGroupSync(trip.groupId);
  if (!group?.syncSecret) throw new Error('這個群組還沒有同步祕鑰');
  const adapter = adapterForGroup(group.id, group.syncSecret);

  const slides = albumSlides(tripId);
  if (!slides.length) throw new Error('這趟還沒有照片');

  // 只放本機真的有的照片；全圖沒有就退縮圖（縮圖是一定同步得到的那一層）
  const usable = [];
  for (const s of slides) {
    const full = s.hash && await db.getBlob(s.hash);
    const thumb = !full && s.thumbHash ? await db.getBlob(s.thumbHash) : null;
    const entry = full || thumb;
    if (!entry) continue;
    usable.push({ ...s, useHash: full ? s.hash : s.thumbHash, blob: entry.blob });
  }
  if (!usable.length) throw new Error('這台裝置上還沒有照片檔，請先同步一次再試');

  // 伺服器上沒有的先補上去（正常情況 outbox 早就傳完了，這裡只是保險）
  onProgress({ phase: 'upload', done: 0, total: usable.length });
  let done = 0;
  for (const u of usable) {
    try {
      if (!(await adapter.hasBlob(u.useHash))) await adapter.putBlob(u.useHash, u.blob);
    } catch { /* 這張傳不上去就算了，下面會從清單移掉 */ u.failed = true; }
    onProgress({ phase: 'upload', done: ++done, total: usable.length });
  }
  const ready = usable.filter((u) => !u.failed);
  if (!ready.length) throw new Error('照片上傳失敗，請檢查網路後再試一次');

  const albumId = store.getRaw(tripId)?.albumId || newAlbumId();
  const meta = albumMeta(tripId);
  const html = albumHTML(meta, ready.map((s) => ({ ...s, src: `/a/${albumId}/p/${s.useHash}` })), { offline: false });

  onProgress({ phase: 'page', done: ready.length, total: ready.length });
  await adapter.putAlbum(albumId, { html, hashes: ready.map((s) => s.useHash), title: meta.title });

  const url = adapter.albumURL(albumId);
  await store.patch(tripId, { albumId, albumUrl: url, albumAt: Date.now(), albumMade: true });
  return { url, albumId, photos: ready.length, skipped: slides.length - ready.length };
}

export async function unpublishAlbum(tripId) {
  const trip = store.get(tripId);
  const info = albumInfo(tripId);
  if (!info) return false;
  const group = store.getRaw(trip.groupId);
  if (group?.syncSecret && syncEnabled()) {
    try { await adapterForGroup(group.id, group.syncSecret).deleteAlbum(info.albumId); }
    catch { /* 伺服器上可能已經沒有了 —— 本機還是要清掉 */ }
  }
  await store.patch(tripId, { albumId: null, albumUrl: null, albumAt: null });
  return true;
}
