// 離線同步佇列（outbox）—— 與後端無關。
//
// 為什麼：長輩旅行中網路常常不穩。拍的照片先進本機佇列，網路一好就自動、有退避地
//        重送；失敗不卡 UI、不漏。內容雜湊定址 → 重送冪等。
//
// 同步分層（3 代理一致）：縮圖全部立即同步；全圖只在點開 / 連 Wi-Fi / 做影片時才傳。
//   → drain 只「主動下載」缺的縮圖；全圖由 photos.blobURL() 需要時才抓。
//   → 上傳則兩種都送（本機空間有限，全圖之後可清、需要時從伺服器補）。
//
// 佇列項目：
//   { id:'push:<g>',        op:'push', groupId, tries, nextAt }
//   { id:'blob:<g>:<hash>', op:'blob', groupId, hash, tries, nextAt }

import * as db from './db.js';

const MAX_BACKOFF = 5 * 60 * 1000;
const BASE_BACKOFF = 8 * 1000;
const CONCURRENCY = 2;

let draining = false;
let timer = null;
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }

function backoff(tries) {
  const b = Math.min(BASE_BACKOFF * 2 ** tries, MAX_BACKOFF);
  return Date.now() + b + Math.random() * b * 0.3;
}

async function enabled() {
  const { syncEnabled } = await import('./sync.js');
  return syncEnabled();
}

export async function enqueuePush(groupId) {
  if (!groupId || !(await enabled())) return;
  const id = 'push:' + groupId;
  if (await db.outboxGet(id)) return;
  await db.outboxPut({ id, op: 'push', groupId, tries: 0, nextAt: 0 });
  emit(); soon();
}

export async function enqueueBlob(groupId, hash) {
  if (!groupId || !hash || !(await enabled())) return;
  const id = `blob:${groupId}:${hash}`;
  if (await db.outboxGet(id)) return;
  await db.outboxPut({ id, op: 'blob', groupId, hash, tries: 0, nextAt: 0 });
  emit(); soon();
}

// store.addSubmission 之後
export async function onSubmission(sub) {
  if (!(await enabled())) return;
  const store = await import('./store.js');
  const trip = store.getRaw(sub.tripId);
  const group = trip && store.getRaw(trip.groupId);
  if (!group || !group.syncSecret) return;
  await enqueueBlob(group.id, sub.thumbHash);
  await enqueueBlob(group.id, sub.photoHash);
  await enqueuePush(group.id);
}

export async function pendingCount() {
  const all = await db.outboxAll();
  return { total: all.length, blobs: all.filter((e) => e.op === 'blob').length };
}

function soon() { clearTimeout(timer); timer = setTimeout(() => drain().catch(() => {}), 800); }

export async function drain({ onProgress, force = false } = {}) {
  if (draining) return { skipped: 'busy' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { skipped: 'offline' };
  if (!(await enabled())) return { skipped: 'local' };

  draining = true;
  const p = (m) => onProgress && onProgress(m);
  const store = await import('./store.js');
  const sync = await import('./sync.js');
  const totals = { pulled: 0, pushed: 0, uploaded: 0, downloaded: 0, failed: 0 };

  try {
    const groups = store.syncedGroups();
    const now = Date.now();
    const outbox = await db.outboxAll();

    for (const group of groups) {
      const adapter = sync.adapterForGroup(group.id, group.syncSecret);

      // 1. 拉他人的更新
      p('接收更新…');
      try {
        let since = await sync.getCursor(group.id);
        for (let guard = 0; guard < 20; guard++) {
          const res = await adapter.pull(since);
          if (res.records && res.records.length) {
            await store.importRecords(res.records, { merge: true });
            totals.pulled += res.records.length;
          }
          if (typeof res.seq === 'number') { since = res.seq; await sync.setCursor(group.id, res.seq); }
          if (!res.more) break;
        }
      } catch (e) { console.warn('pull', group.id, e); }

      // 2. 推中繼資料（只送這個群組的記錄）
      const pushEntry = outbox.find((x) => x.id === 'push:' + group.id && (x.nextAt || 0) <= now);
      if (pushEntry || force) {
        p('上傳資料…');
        try {
          await adapter.push(store.exportGroup(group.id));
          await db.outboxDelete('push:' + group.id);
          totals.pushed++;
        } catch (e) {
          const t = (pushEntry?.tries || 0) + 1;
          await db.outboxPut({ id: 'push:' + group.id, op: 'push', groupId: group.id, tries: t, nextAt: backoff(t - 1), lastError: String(e.message || e) });
          totals.failed++;
        }
      }

      // 3. 上傳待送照片（縮圖 + 全圖都送；HEAD 先問，避免重傳）
      const blobEntries = outbox.filter((x) => x.op === 'blob' && x.groupId === group.id && (x.nextAt || 0) <= now);
      for (let i = 0; i < blobEntries.length; i += CONCURRENCY) {
        const batch = blobEntries.slice(i, i + CONCURRENCY);
        p(`上傳照片 ${Math.min(i + batch.length, blobEntries.length)}/${blobEntries.length}…`);
        await Promise.all(batch.map(async (e) => {
          const rec = await db.getBlob(e.hash);
          if (!rec) { await db.outboxDelete(e.id); return; }
          try {
            if (!(await adapter.hasBlob(e.hash))) await adapter.putBlob(e.hash, rec.blob);
            await db.outboxDelete(e.id);
            totals.uploaded++;
          } catch (err) {
            const t = (e.tries || 0) + 1;
            await db.outboxPut({ ...e, tries: t, nextAt: backoff(t - 1), lastError: String(err.message || err) });
            totals.failed++;
          }
        }));
      }

      // 4. 主動下載缺的「縮圖」（全圖延遲抓）
      const wantThumbs = new Set();
      for (const r of store.exportGroup(group.id)) if (r.type === 'submission' && r.thumbHash) wantThumbs.add(r.thumbHash);
      const have = new Set(await db.allBlobKeys());
      const missing = [...wantThumbs].filter((h) => !have.has(h));
      for (let i = 0; i < missing.length; i += CONCURRENCY) {
        const batch = missing.slice(i, i + CONCURRENCY);
        p(`下載縮圖 ${Math.min(i + batch.length, missing.length)}/${missing.length}…`);
        await Promise.all(batch.map(async (h) => {
          try {
            const blob = await adapter.getBlob(h);
            if (blob && blob.size) { await db.putBlob({ hash: h, blob, bytes: blob.size, kind: 'thumb' }); totals.downloaded++; }
          } catch { /* 下次再試 */ }
        }));
      }
    }

    if (totals.downloaded || totals.pulled) store.notifyExternalChange();
    emit();
    return totals;
  } finally {
    draining = false;
    const rest = await db.outboxAll();
    if (rest.length) {
      const wait = Math.max(2000, Math.min(...rest.map((e) => (e.nextAt || 0) - Date.now()), MAX_BACKOFF));
      clearTimeout(timer);
      timer = setTimeout(() => drain().catch(() => {}), Math.min(wait, MAX_BACKOFF));
    }
  }
}

export function startAutoDrain() {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => drain().catch(() => {}));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) drain().catch(() => {}); });
  setInterval(() => drain().catch(() => {}), 90 * 1000);
  setTimeout(() => drain().catch(() => {}), 2500);
}
