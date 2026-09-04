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

export function getConfig() {
  try { return { mode: 'local', url: '', ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; }
  catch { return { mode: 'local', url: '' }; }
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
        method: 'POST', headers: { ...H, 'content-type': 'application/json' },
        body: JSON.stringify({ records }),
      });
      if (!r.ok) throw new Error('push ' + r.status);
      return r.json();
    },
    async pull(since = 0) {
      const r = await fetch(b + '/pull' + q + '&since=' + since, { headers: H });
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
      const r = await fetch(b + '/blob/' + hash + q, {
        method: 'PUT', headers: { ...H, 'x-content-type': blob.type || 'image/jpeg' }, body: blob,
      });
      if (!r.ok) throw new Error('putBlob ' + r.status);
    },
    async getBlob(hash) {
      const r = await fetch(b + '/blob/' + hash + q, { headers: H });
      return r.ok ? r.blob() : null;
    },
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
