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

// 分批把整個群組的記錄推上去（v1.65）。
//
// 以前是「一個 POST 送全部」，你們那趟已經是 574 筆／271 KB，逾時 15 秒。
// 在漫遊或山區的慢連線上一次送不完 → 逾時 → 退避 → **又是整包** → 永遠推不上去，
// 畫面就一直停在「正在上傳」而且一直耗電。（share.js 早就有分批版本，
// 但只用在「按分享按鈕」那一次，日常同步沒用到。）
//
// 兩個必須做對的地方：
//  1) **全部批次成功才算完成**——送到一半失敗時 outbox 項目不能刪掉，不然剩下的
//     記錄就永遠不會再送了。
//  2) **斷線後只補沒送完的**——把進度（已送到第幾筆）記在 outbox 項目上；
//     只有在「記錄清單沒變」時才續傳（用筆數＋頭尾 id 當簽章），變了就從頭來，
//     免得中間插進新記錄導致位移、跳過某幾筆。
const CHUNK = 80;                 // D1 一次約 100 筆寫入，留餘裕
const CHUNK_TIMEOUT = 12000;

function chunkSig(recs) {
  return recs.length + ':' + (recs[0]?.id || '') + ':' + (recs[recs.length - 1]?.id || '');
}

async function pushChunks(adapter, store, groupId, entry, p) {
  const recs = store.exportGroup(groupId).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sig = chunkSig(recs);
  let start = (entry && entry.pushSig === sig && entry.pushed > 0) ? entry.pushed : 0;
  if (start >= recs.length) start = 0;
  const merged = [];
  for (let i = start; i < recs.length; i += CHUNK) {
    const chunk = recs.slice(i, i + CHUNK);
    if (recs.length > CHUNK) p(`上傳資料… ${Math.min(i + chunk.length, recs.length)}/${recs.length}`);
    let res;
    try {
      res = await Promise.race([
        adapter.push(chunk),
        new Promise((_, rej) => setTimeout(() => rej(new Error('push timeout')), CHUNK_TIMEOUT)),
      ]);
    } catch (e) {
      // 記下送到哪裡，下次從這裡接著送（不要刪 outbox 項目）
      await db.outboxPut({ ...(entry || { id: 'push:' + groupId, op: 'push', groupId }),
        pushed: i, pushSig: sig, tries: (entry?.tries || 0) + 1, nextAt: backoff(entry?.tries || 0),
        lastError: String(e.message || e) });
      throw e;
    }
    if (res && Array.isArray(res.merged) && res.merged.length) merged.push(...res.merged);
  }
  return merged;
}

// 這個錯誤再試也沒用嗎？（4xx，但 408 逾時與 429 限流要重試）
function permanent(e) {
  const m = String(e && e.message || e).match(/\b(4\d\d)\b/);
  if (!m) return false;
  const code = +m[1];
  // 429 是伺服器的限流（v1.65）：等一下就好，不是永久錯誤
  return code >= 400 && code < 500 && code !== 408 && code !== 429;
}

// 有多少東西是「再也送不出去」的？行程頁的進度列要照實講，不能一直顯示「正在上傳」
export async function deadCount(groupId) {
  const all = await db.outboxAll();
  const mine = all.filter((e) => (e.groupId === groupId || e.id === 'push:' + groupId) && e.dead);
  return { n: mine.length, why: mine[0]?.lastError || '' };
}

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

// 行程頁的同步進度列用：待上傳的照片數 ＋ 這趟還缺的縮圖數（別人的照片還沒抓到）
export async function syncStatus(tripId) {
  const store = await import('./store.js');
  const all = await db.outboxAll();
  const have = new Set(await db.allBlobKeys());
  const subs = store.submissionsOfTrip(tripId);
  const missing = subs.filter((s) => s.thumbHash && !have.has(s.thumbHash)).length;
  return { uploads: all.filter((e) => e.op === 'blob').length, missing, draining };
}

function soon() { clearTimeout(timer); timer = setTimeout(() => drain().catch(() => {}), 800); }

// 忙碌時不要直接回「busy」：呼叫端（剛加入、按了立即同步、拍完照）都是「我現在有東西
// 要同步」的意思 —— 排隊等這一輪跑完再跑一次（多個呼叫合併成一次），結果回給等的人。
let current = null, queued = null;
// 等目前這一輪 drain 跑完（移除旅程前要先讓同步靜下來，不然它會把記錄塞回來）
export function idle() { return current ? current.catch(() => {}) : Promise.resolve(); }

// 清掉某個群組的所有待送項目。孤兒項目不只是垃圾：drainOnce 的 finally 會依
// 剩餘項目排下一輪，永遠消化不掉的項目會讓它每 2 秒空轉一次（耗電），
// 而且 pendingCount/syncStatus 會一直顯示「還有 N 張待上傳」。
export async function forgetGroup(groupId) {
  for (const e of await db.outboxAll()) {
    if (e.groupId === groupId || e.id === 'push:' + groupId) await db.outboxDelete(e.id);
  }
  emit();
}

// 這個群組還有沒有東西沒送出去？有的話不能讓使用者移除——那些照片只有這台有。
export async function pendingOf(groupId) {
  const all = await db.outboxAll();
  const mine = all.filter((e) => (e.groupId === groupId || e.id === 'push:' + groupId) && !e.dead);
  return { total: mine.length, blobs: mine.filter((e) => e.op === 'blob').length };
}

export function drain(opts = {}) {
  if (current) {
    if (!queued) queued = current.catch(() => {}).then(() => { queued = null; return drain(opts); });
    return queued;
  }
  current = drainOnce(opts).finally(() => { current = null; });
  return current;
}

async function drainOnce({ onProgress, force = false } = {}) {
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
      // 群組清單是迴圈開始前抓的快照；使用者可能在這中間把旅程從這台移除了。
      // 每一輪都重新確認，不然 pull 回來的記錄會把剛移除的東西塞回去。
      if (!store.getRaw(group.id) || store.isForgotten(group.id)) continue;
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
          if (store.isForgotten(group.id)) break;     // 移除發生在 pull 的途中 → 這批不要進來
          if (typeof res.seq === 'number') { since = res.seq; await sync.setCursor(group.id, res.seq); }
          if (!res.more) break;
        }
      } catch (e) { console.warn('pull', group.id, e); }

      // 2. 推中繼資料（只送這個群組的記錄）——分批送，見 pushChunks 的說明
      const pushEntry = outbox.find((x) => x.id === 'push:' + group.id && (x.nextAt || 0) <= now);
      if (pushEntry || force) {
        p('上傳資料…');
        try {
          if (store.isForgotten(group.id)) throw new Error('forgotten');
          const merged = await pushChunks(adapter, store, group.id, pushEntry, p);
          await db.outboxDelete('push:' + group.id);
          totals.pushed++;
          // 伺服器合併後跟送出的不同（別台改了其他欄位）→ 立刻套用，不用等下一輪 pull
          if (merged.length) await store.importRecords(merged, { merge: true });
        } catch (e) {
          const t = (pushEntry?.tries || 0) + 1;
          // 4xx（除了 408/429）是「再試一百次也一樣」的錯：祕鑰不符、東西太大、格式不對。
          // 以前一律退避重排 → 每 5 分鐘重打一次、而且使用者永遠只看到「正在上傳」（v1.64 健檢）。
          const dead = permanent(e);
          // pushChunks 已經把「送到第幾筆」寫進 outbox 了，這裡不能整筆覆蓋掉，
          // 不然下一次又要從頭送 —— 分塊就白做了（v1.65）
          const cur = (await db.outboxGet('push:' + group.id)) || {};
          await db.outboxPut({ ...cur, id: 'push:' + group.id, op: 'push', groupId: group.id, tries: t,
            nextAt: dead ? Number.MAX_SAFE_INTEGER : backoff(t - 1), dead, lastError: String(e.message || e) });
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
            const dead = permanent(err);
            await db.outboxPut({ ...e, tries: t, nextAt: dead ? Number.MAX_SAFE_INTEGER : backoff(t - 1), dead, lastError: String(err.message || err) });
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
    const rest = (await db.outboxAll()).filter((e) => !e.dead);
    if (rest.length) {
      const wait = Math.max(2000, Math.min(...rest.map((e) => (e.nextAt || 0) - Date.now()), MAX_BACKOFF));
      clearTimeout(timer);
      timer = setTimeout(() => drain().catch(() => {}), Math.min(wait, MAX_BACKOFF));
    }
  }
}

// 背景同步的節奏。原本固定 90 秒——實機回報「B 加入了，A 停在任務頁一直沒看到」，
// 因為 PWA 沒有推播，對方的動作只能靠我們自己去拉，而 90 秒對「人正看著螢幕等」
// 來說太久了。改成：畫面在前景 20 秒一次、切到背景 90 秒一次（省電；而且手機把
// 背景分頁的計時器降頻本來就會拉長，不用再自己加碼）。
const FG_MS = 20 * 1000, BG_MS = 90 * 1000;
let cycle = null, cycleMs = 0;
function schedule() {
  const want = (typeof document !== 'undefined' && document.hidden) ? BG_MS : FG_MS;
  if (cycle && cycleMs === want) return;
  cycleMs = want;
  clearInterval(cycle);
  cycle = setInterval(() => drain().catch(() => {}), want);
}

export function startAutoDrain() {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => drain().catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    schedule();
    if (!document.hidden) drain().catch(() => {});     // 切回前景先拉一次，不用等下一輪
  });
  schedule();
  setTimeout(() => drain().catch(() => {}), 2500);
}

// 開啟某一頁時「立刻拉一次」。人剛打開行程頁／SOS 頁就是最想看到最新狀態的時候，
// 不該讓他等下一次排程。多個頁面同時呼叫會被 drain 自己合併成一次。
// **不要帶 force**：pull 本來就無條件執行，force 的唯一作用是「就算沒有待送項也把
// 整個群組推上去」——189 張照片的群組是幾百筆、數百 KB，每次開頁推一次太貴（v1.64 健檢）。
export function refreshNow() { return drain().catch(() => {}); }
