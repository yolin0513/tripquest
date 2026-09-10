// 多人同步層 —— 可插拔，與後端無關
//
// 三種模式（設定頁一鍵切換）：
//   local  不連線；靠「邀請連結（任務清單）」與「匯出 / 匯入備份（照片）」
//   lan    自架 server/index.mjs（＋ Cloudflare Tunnel 打外網）
//   cloud  Cloudflare Worker（workers/worker.mjs）
// lan 與 cloud 的協定完全一樣，只差網址。
//
// 每個群組帶自己的 128-bit 祕鑰（group.syncSecret），放在邀請連結的 #fragment。
// 同步游標由「伺服器指派的序號」決定（不是客戶端時鐘），存在 IndexedDB meta。
//
// SyncAdapter（每個群組一個）：
//   health()                     -> bool
//   push(records)                -> { seq, wrote }
//   pull(sinceSeq)               -> { records, seq, more }
//   hasBlob(hash)                -> bool          （PUT 前先問，避免重傳）
//   putBlob(hash, blob)          -> void
//   getBlob(hash)                -> Blob | null

import * as db from './db.js';

const CFG_KEY = 'tripquest.sync';

// 部署後把 Worker 網址填在這裡 → 家人開網址就自動連同步，連「設定同步伺服器」都不用點。
// 留空 = 預設單機，使用者可自行在設定頁填。
const BUILT_IN = { mode: 'cloud', url: 'https://tripquest.yolin0513.workers.dev' };
// 邀請連結用：目前設定＝這個預設時，連結就不用帶 u=（省 40 幾個字）
export const DEFAULT_CLOUD_URL = BUILT_IN.url;

export function getConfig() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { /* noop */ }
  // 使用者存過設定 → 以他的為準；沒存過 → 用內建預設（若有）
  if (stored && (stored.mode || stored.url)) return { mode: 'local', url: '', ...stored };
  // 本機開發/測試（localhost）沒存過設定 → 絕不連正式 Worker：之前每跑一次測試就在正式 D1
  // 留下一個「台北匯入測試」「流程驗證」群組（健檢清掉 200 多個）。要測真伺服器的腳本
  // （synctest --url、livetest）都是用 setConfig 明確指定，不受影響。
  if (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return { mode: 'local', url: '' };
  if (BUILT_IN.url) return { mode: BUILT_IN.mode || (BUILT_IN.url.includes('workers.dev') ? 'cloud' : 'lan'), url: BUILT_IN.url };
  return { mode: 'local', url: '' };
}
export function setConfig(cfg) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify({ mode: 'local', url: '', ...cfg })); } catch { /* noop */ }
}
export function syncEnabled() {
  const c = getConfig();
  return (c.mode === 'lan' || c.mode === 'cloud') && !!c.url;
}
export function modeLabel() {
  return { local: '單機（用邀請連結 / 備份檔）', lan: '自架伺服器', cloud: 'Cloudflare' }[getConfig().mode] || '單機';
}

function base() { return getConfig().url.replace(/\/$/, ''); }

// 每個群組一個 adapter
export function adapterForGroup(groupId, secret) {
  const q = `?g=${encodeURIComponent(groupId)}`;
  const H = { authorization: 'Bearer ' + secret };
  const b = base();
  const timeout = (ms) => (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
  return {
    async health() {
      try { const r = await fetch(b + '/health', { signal: timeout(5000) }); return r.ok; }
      catch { return false; }
    },
    async push(records) {
      const r = await fetch(b + '/push' + q, {
        signal: timeout(15000),
        method: 'POST', headers: { ...H, 'content-type': 'application/json' },
        body: JSON.stringify({ records }),
      });
      if (!r.ok) throw new Error('push ' + r.status);
      return r.json();
    },
    async pull(since = 0) {
      const r = await fetch(b + '/pull' + q + '&since=' + since, { headers: H, signal: timeout(15000) });
      if (!r.ok) throw new Error('pull ' + r.status);
      return r.json();
    },
    async hasBlob(hash) {
      try {
        const r = await fetch(b + '/blob/' + hash + q, { method: 'HEAD', headers: H, signal: timeout(8000) });
        return r.status === 200;
      } catch { return false; }
    },
    async putBlob(hash, blob) {
      // 依大小給逾時（15MB 的照片在慢網路上要久一點）。沒有逾時的話，一個停住的上傳會讓
      // drain 的 Promise.all 永遠不 resolve —— 從那一刻起連 pull 都停了，旅伴的新照片、
      // 位置、加入通知全部收不到，直到使用者自己重開 App（v1.64 健檢找到）。
      const r = await fetch(b + '/blob/' + hash + q, {
        method: 'PUT', headers: { ...H, 'x-content-type': blob.type || 'image/jpeg' }, body: blob,
        signal: timeout(Math.min(180000, 30000 + Math.round((blob.size || 0) / 1e6) * 10000)),
      });
      if (!r.ok) throw new Error('putBlob ' + r.status);
    },
    async getBlob(hash) {
      const r = await fetch(b + '/blob/' + hash + q, { headers: H, signal: timeout(30000) });
      return r.ok ? r.blob() : null;
    },
    // 公開相簿：發布 / 收回。發布後任何人拿到網址都看得到，所以只由使用者主動觸發。
    async putAlbum(albumId, { html, hashes, title }) {
      // v1.73.1：這兩支以前沒有 signal。putAlbum 送的是整份相簿 HTML
      // （照片越多越大），正是最容易在慢網路上停住的請求 ——
      // 停住就是「發布分享相簿」永遠轉圈、沒有出口。
      const r = await fetch(b + '/album/' + albumId + q, {
        signal: timeout(60000),
        method: 'PUT', headers: { ...H, 'content-type': 'application/json' },
        body: JSON.stringify({ html, hashes, title }),
      });
      if (!r.ok) throw new Error('putAlbum ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120));
      return r.json();
    },
    async deleteAlbum(albumId) {
      const r = await fetch(b + '/album/' + albumId + q, { method: 'DELETE', headers: H, signal: timeout(20000) });
      if (!r.ok) throw new Error('deleteAlbum ' + r.status);
      return r.json();
    },
    albumURL(albumId) { return b + '/a/' + albumId; },
  };
}

// 測試一個網址通不通（設定頁用）
export async function testConnection(url) {
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout?.(6000) });
    if (!r.ok) return { ok: false, detail: 'HTTP ' + r.status };
    return { ok: true };
  } catch (e) { return { ok: false, detail: e.message || String(e) }; }
}

// 同步游標（每個群組一個伺服器序號）
export async function getCursor(groupId) {
  return Number(await db.metaGet('seq:' + groupId) || 0);
}
export async function setCursor(groupId, seq) {
  await db.metaSet('seq:' + groupId, seq);
}

// 手動觸發一輪完整同步（設定頁「立即同步」用）
export async function syncNow({ onProgress } = {}) {
  const { drain } = await import('./outbox.js');
  return drain({ onProgress, force: true });
}
