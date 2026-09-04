// 裝置身分 —— 不做帳號（3 代理一致）。
// 身分 = 這台裝置的穩定 ID + 使用者取的顯示名稱。
// 存在 IndexedDB（跟照片同命運；iOS 會單獨清 localStorage 卻留著 IndexedDB）。
// localStorage 只當快取，讓 deviceId() 可以同步取用。

import * as db from './db.js';
import { deviceId as lsDeviceId, deviceName as lsDeviceName, setDeviceName as lsSetDeviceName, uuid } from './ids.js';

const KEY = 'identity';

// 開機時呼叫：讓 IndexedDB 與 localStorage 一致，缺的一邊補上。
export async function initIdentity() {
  const stored = await db.metaGet(KEY);
  const lsId = lsDeviceId();          // 這會在 localStorage 沒有時自動生成一個
  if (stored && stored.deviceId) {
    // IndexedDB 是權威來源（localStorage 可能被清過）
    if (stored.deviceId !== lsId) {
      try { localStorage.setItem('tripquest.deviceId', stored.deviceId); } catch { /* noop */ }
    }
    if (stored.name && stored.name !== lsDeviceName()) lsSetDeviceName(stored.name);
  } else {
    await db.metaSet(KEY, { deviceId: lsId, name: lsDeviceName(), createdAt: Date.now() });
  }
}

export function myDeviceId() { return lsDeviceId(); }
export function myName() { return lsDeviceName(); }

export async function setMyName(name) {
  lsSetDeviceName(name);
  const cur = (await db.metaGet(KEY)) || { deviceId: lsDeviceId(), createdAt: Date.now() };
  await db.metaSet(KEY, { ...cur, name: lsDeviceName() });
}

// ---- 身分備份卡 ----
// 內含：裝置 ID、名稱、已加入的群組（id + 祕鑰 + 名稱）→ 換手機掃一下完整還原。
export async function exportCard() {
  const store = await import('./store.js');
  const groups = store.exportRecords()
    .filter((r) => r.type === 'group' && r.syncSecret && !r.deleted)
    .map((g) => ({ id: g.id, secret: g.syncSecret, name: g.name, url: g.syncUrl || '' }));
  const card = { v: 1, deviceId: myDeviceId(), name: myName(), groups, at: Date.now() };
  return card;
}

export function encodeCard(card) {
  const json = JSON.stringify(card);
  return 'TQID1.' + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeCard(text) {
  const body = String(text).trim().replace(/^TQID1\./, '');
  const s = body.replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(escape(atob(s + '='.repeat((4 - s.length % 4) % 4))));
  const card = JSON.parse(json);
  if (!card.deviceId) throw new Error('卡片格式不符');
  return card;
}

// 還原：沿用卡片上的 deviceId（過去所有照片就會認回來），重新掛上群組同步設定。
export async function importCard(card) {
  try { localStorage.setItem('tripquest.deviceId', card.deviceId); } catch { /* noop */ }
  if (card.name) lsSetDeviceName(card.name);
  await db.metaSet(KEY, { deviceId: card.deviceId, name: card.name || myName(), createdAt: Date.now(), restoredAt: Date.now() });

  const store = await import('./store.js');
  const sync = await import('./sync.js');
  let firstUrl = '';
  for (const g of card.groups || []) {
    if (g.url && !firstUrl) firstUrl = g.url;
    const existing = store.getRaw(g.id);
    if (existing) {
      await store.patch(g.id, { syncSecret: g.secret, syncUrl: g.url || existing.syncUrl });
    }
    // 群組本體若本機沒有，先建一個「殼」（updatedAt=1，之後 pull 回真正的記錄一定蓋過它）
    else {
      await store.importRecords([{
        id: g.id, type: 'group', name: g.name || '旅伴',
        syncSecret: g.secret, syncUrl: g.url || '', shell: true,
        updatedAt: 1, deviceId: '',
      }], { merge: true });
    }
  }
  if (firstUrl && sync.getConfig().mode === 'local') {
    sync.setConfig({ mode: firstUrl.includes('workers.dev') ? 'cloud' : 'lan', url: firstUrl });
  }
  return { groups: (card.groups || []).length };
}

export { uuid };
