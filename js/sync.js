// 多人同步層 —— 可插拔
// v1 只有 LocalAdapter（不連任何伺服器；靠「任務代碼」與「完整備份」在裝置間傳）。
// 之後補雲端 / 自架伺服器時，實作同一組介面即可，不動 store.js / 畫面。
//
// SyncAdapter 介面：
//   id                                 唯一識別
//   label                              顯示名稱
//   async status()   -> { ok, detail } 目前是否可用
//   async push(records)                把本機中繼資料送出（不含照片 blob）
//   async pull(sinceMs) -> records[]   取回他人的更新
//   async putBlob(hash, blob)          （選配）上傳一張照片
//   async getBlob(hash) -> Blob|null   （選配）下載一張照片

import * as store from './store.js';
import * as db from './db.js';

const CFG_KEY = 'tripquest.sync';

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { return {}; }
}
export function setConfig(cfg) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg || {})); } catch { /* noop */ }
}

// ---- 本機（預設，不連線）----
const LocalAdapter = {
  id: 'local',
  label: '單機（用代碼 / 備份檔分享）',
  async status() { return { ok: true, detail: '照片與資料只存在這台裝置' }; },
  async push() { /* no-op */ },
  async pull() { return []; },
};

// ---- 自架 LAN 伺服器（server/ 目錄，node server/index.mjs）----
// 不需要註冊任何服務；填入電腦在區網的網址即可（例：http://192.168.0.10:8787）。
function LanAdapter(baseUrl) {
  const base = baseUrl.replace(/\/$/, '');
  return {
    id: 'lan',
    label: '自架伺服器',
    async status() {
      try {
        const r = await fetch(base + '/health', { signal: AbortSignal.timeout(4000) });
        return r.ok ? { ok: true, detail: base } : { ok: false, detail: '連不上（HTTP ' + r.status + '）' };
      } catch (e) { return { ok: false, detail: '連不上：' + (e.message || e) }; }
    },
    async push(records) {
      await fetch(base + '/push', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ records }),
      });
    },
    async pull(sinceMs = 0) {
      const r = await fetch(base + '/pull?since=' + sinceMs);
      if (!r.ok) return [];
      const j = await r.json();
      return j.records || [];
    },
    async putBlob(hash, blob) {
      await fetch(base + '/blob/' + hash, { method: 'PUT', body: blob });
    },
    async getBlob(hash) {
      const r = await fetch(base + '/blob/' + hash);
      return r.ok ? await r.blob() : null;
    },
  };
}

export function activeAdapter() {
  const cfg = getConfig();
  if (cfg.mode === 'lan' && cfg.url) return LanAdapter(cfg.url);
  return LocalAdapter;
}

// 一輪同步：推本機中繼資料 → 拉他人的 → 合併 → 補缺的照片
export async function syncNow({ onProgress } = {}) {
  const a = activeAdapter();
  if (a.id === 'local') return { skipped: true };
  const p = (m) => onProgress && onProgress(m);

  p('上傳資料…');
  const mine = store.exportRecords().filter((r) => r.type !== 'blobmeta');
  await a.push(mine);

  p('下載更新…');
  const since = Number(localStorage.getItem('tripquest.sync.since') || 0);
  const incoming = await a.pull(since);
  if (incoming.length) await store.importRecords(incoming, { merge: true });

  if (a.getBlob) {
    p('同步照片…');
    const needed = new Set();
    for (const r of store.exportRecords()) {
      if (r.type === 'submission') { needed.add(r.photoHash); needed.add(r.thumbHash); }
    }
    const have = new Set(await db.allBlobKeys());
    let n = 0;
    for (const hash of needed) {
      if (!hash) continue;
      if (!have.has(hash)) {
        const blob = await a.getBlob(hash).catch(() => null);
        if (blob) { await db.putBlob({ hash, blob, bytes: blob.size, kind: 'photo' }); n++; }
      } else if (a.putBlob) {
        const entry = await db.getBlob(hash);
        if (entry) await a.putBlob(hash, entry.blob).catch(() => {});
      }
    }
    p(`同步了 ${n} 張照片`);
  }

  localStorage.setItem('tripquest.sync.since', String(Date.now()));
  return { ok: true, pulled: incoming.length };
}
