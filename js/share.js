// 分享與備份
//  - 任務代碼 / 連結：只含行程 + 景點 + 任務（小，~數 KB），gzip + base64url 塞進網址。
//    朋友開連結就得到同一份任務清單，各自獨立解任務。這是出遊當下「多人一起玩」的關鍵。
//  - 完整備份（.tripquest）：含照片，單一 JSON 檔，透過 LINE / AirDrop 傳，事後匯入合併。
//    v2 會接雲端同步，屆時這層改為背景自動化。

import * as store from './store.js';
import * as db from './db.js';
import { uuid } from './ids.js';
import { getConfig, setConfig, syncEnabled } from './sync.js';

// 128-bit 群組祕鑰（放在邀請連結的 #fragment，永不進伺服器紀錄）
function newSecret() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function ensureGroupSync(groupId) {
  const g = store.getRaw(groupId);
  if (!g) return null;
  const cfg = getConfig();
  const patch = {};
  if (!g.syncSecret) patch.syncSecret = newSecret();
  if (cfg.url && g.syncUrl !== cfg.url) patch.syncUrl = cfg.url;
  if (Object.keys(patch).length) await store.patch(groupId, patch);
  return store.getRaw(groupId);
}

// ---------- 壓縮工具 ----------
async function gzip(str) {
  if (typeof CompressionStream === 'undefined') return btoa(unescape(encodeURIComponent(str)));
  const cs = new CompressionStream('gzip');
  const stream = new Blob([str]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return base64urlFromBytes(new Uint8Array(buf));
}
async function gunzip(b64) {
  const bytes = bytesFromBase64url(b64);
  if (typeof DecompressionStream === 'undefined') return decodeURIComponent(escape(atob(b64)));
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Response(stream).text();
}
function base64urlFromBytes(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function bytesFromBase64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- 任務代碼（無照片）----------
export async function makeShareCode(tripId) {
  const trip = store.get(tripId);
  const grp = store.get(trip.groupId);
  const spots = store.spotsOf(tripId);
  const quests = store.questsOfTrip(tripId);
  const payload = {
    v: 1, kind: 'questset',
    trip: { title: trip.title, startDate: trip.startDate, endDate: trip.endDate, region: trip.region || '' },
    group: { name: grp?.name || '旅伴' },
    spots: spots.map((s) => ({ id: s.id, name: s.name, region: s.region, day: s.day, order: s.order, lat: s.lat, lng: s.lng })),
    quests: quests.filter((q) => !q.deleted).map((q) => ({ id: q.id, spotId: q.spotId, title: q.title, hint: q.hint, kind: q.kind, order: q.order })),
  };
  return gzip(JSON.stringify(payload));
}

export async function shareURL(tripId) {
  const base = location.href.split('#')[0];
  // 有設定同步 → 產生「加入同一個群組」的邀請；否則退回「複製一份任務清單」
  if (syncEnabled()) {
    const trip = store.get(tripId);
    const group = await ensureGroupSync(trip.groupId);
    const spots = store.spotsOf(tripId);
    const quests = store.questsOfTrip(tripId);
    const members = store.membersOf(trip.groupId);
    // 連結只帶「群組識別碼」，不帶整包資料——不然景點/任務一多，網址長到
    // LINE 等 App 傳不過去、貼上也常斷行漏字，變成「無法解析」。
    // 朋友點連結加入時，直接從伺服器把這個群組的資料整包拉下來（見 joinInvite）。
    // 所以這裡要先確保伺服器上真的有最新資料：即時推一次（等不到也不擋，outbox 背景會補）。
    try {
      const { adapterForGroup } = await import('./sync.js');
      const adapter = adapterForGroup(group.id, group.syncSecret);
      const pushTimeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000));
      await Promise.race([adapter.push(store.exportGroup(group.id)), pushTimeout]);
    } catch { /* 推不上去也繼續給連結；outbox 背景會重試，加入時也會再拉一次 */ }
    const payload = {
      v: 3, kind: 'sync',
      url: getConfig().url,
      groupId: group.id, secret: group.syncSecret, tripId,
      title: trip.title, groupName: group.name || '旅伴',
      spots: spots.length, quests: quests.length, members: members.length,
    };
    return `${base}#/join?j=${await gzip(JSON.stringify(payload))}`;
  }
  const code = await makeShareCode(tripId);
  return `${base}#/join?d=${code}`;
}

// ---------- 同步邀請 ----------
export async function peekInvite(code) {
  const p = JSON.parse(await gunzip(code));
  if (p.kind !== 'sync') throw new Error('邀請格式不符');
  if (Array.isArray(p.records)) {
    // 舊版連結相容（v2，整包資料直接帶在連結裡）
    const spots = p.records.filter((r) => r.type === 'spot').length;
    const quests = p.records.filter((r) => r.type === 'quest').length;
    const grp = p.records.find((r) => r.type === 'group');
    return { sync: true, group: grp?.name || '旅伴', title: p.title || '行程', spots, quests, url: p.url };
  }
  return { sync: true, group: p.groupName || '旅伴', title: p.title || '行程', spots: p.spots || 0, quests: p.quests || 0, url: p.url };
}

export async function joinInvite(code) {
  const p = JSON.parse(await gunzip(code));
  if (p.kind !== 'sync') throw new Error('邀請格式不符');
  // 設定同步後端（若本機還沒設）
  if (p.url && getConfig().mode === 'local') {
    setConfig({ mode: p.url.includes('workers.dev') ? 'cloud' : 'lan', url: p.url });
  }
  if (Array.isArray(p.records) && p.records.length) {
    // 舊版連結相容：資料本來就帶在連結裡
    await store.importRecords(p.records, { merge: true });
  } else {
    // 新版連結：只帶群組識別碼，資料整包從伺服器拉下來（這台是新裝置，since=0）
    const { adapterForGroup, setCursor } = await import('./sync.js');
    const adapter = adapterForGroup(p.groupId, p.secret);
    let since = 0, total = 0;
    for (let guard = 0; guard < 30; guard++) {
      const res = await adapter.pull(since);
      if (res.records && res.records.length) {
        await store.importRecords(res.records, { merge: true });
        total += res.records.length;
      }
      if (typeof res.seq === 'number') since = res.seq;
      if (!res.more) break;
    }
    await setCursor(p.groupId, since);
    if (!total) throw new Error('伺服器上還沒有這趟旅程的資料，請邀請人確認網路正常後再分享一次連結');
  }
  // 立刻同步一輪，把成員 / 投稿 / 照片補回來
  try { const { drain } = await import('./outbox.js'); await drain(); } catch { /* 稍後自動重試 */ }
  return p.tripId;
}

export async function peekShareCode(code) {
  const p = JSON.parse(await gunzip(code));
  if (p.kind !== 'questset') throw new Error('代碼格式不符');
  return {
    group: p.group?.name || '旅伴',
    title: p.trip?.title || '行程',
    spots: (p.spots || []).length,
    quests: (p.quests || []).length,
  };
}

export async function importShareCode(code) {
  const json = await gunzip(code);
  const p = JSON.parse(json);
  if (p.kind !== 'questset') throw new Error('代碼格式不符');
  const groupId = uuid();
  const tripId = uuid();
  await store.put({ id: groupId, type: 'group', name: p.group?.name || '旅伴', joinCode: '' });
  await store.put({
    id: tripId, type: 'trip', groupId,
    title: p.trip.title, startDate: p.trip.startDate, endDate: p.trip.endDate,
    region: p.trip.region || '', allowGeo: false, joinedFromShare: true,
  });
  const idMap = new Map();
  for (const s of p.spots) {
    const nid = uuid();
    idMap.set(s.id, nid);
    await store.put({
      id: nid, type: 'spot', tripId, name: s.name, nameLocal: s.name,
      region: s.region, day: s.day, order: s.order, lat: s.lat ?? null, lng: s.lng ?? null, source: 'shared',
    });
  }
  for (const q of p.quests) {
    await store.put({
      id: uuid(), type: 'quest', tripId, spotId: idMap.get(q.spotId),
      title: q.title, hint: q.hint, kind: q.kind, order: q.order, source: 'shared', refImage: null,
    });
  }
  return tripId;
}

// ---------- 完整備份（含照片）----------
export async function exportBundle(tripId) {
  const trip = store.get(tripId);
  const ids = new Set([tripId, trip.groupId]);
  for (const r of store.exportRecords()) {
    if (r.tripId === tripId || (r.type === 'member' && r.groupId === trip.groupId)) ids.add(r.id);
  }
  const records = store.exportRecords().filter((r) => ids.has(r.id));
  const hashes = new Set();
  for (const r of records) {
    if (r.type === 'submission') { hashes.add(r.photoHash); hashes.add(r.thumbHash); }
  }
  const blobs = {};
  for (const hHash of hashes) {
    if (!hHash) continue;
    const entry = await db.getBlob(hHash);
    if (entry) blobs[hHash] = { b64: await blobToB64(entry.blob), kind: entry.kind, type: entry.blob.type };
  }
  const bundle = { app: 'tripquest', v: 1, exportedAt: Date.now(), records, blobs };
  return new Blob([JSON.stringify(bundle)], { type: 'application/json' });
}

export async function importBundle(file) {
  const text = await file.text();
  const bundle = JSON.parse(text);
  if (bundle.app !== 'tripquest') throw new Error('不是 TripQuest 備份檔');
  for (const [hHash, b] of Object.entries(bundle.blobs || {})) {
    const existing = await db.getBlob(hHash);
    if (!existing) {
      const blob = b64ToBlob(b.b64, b.type || 'image/jpeg');
      await db.putBlob({ hash: hHash, blob, bytes: blob.size, kind: b.kind || 'photo' });
    }
  }
  await store.importRecords(bundle.records || [], { merge: true });
  const trip = (bundle.records || []).find((r) => r.type === 'trip');
  return trip?.id || null;
}

function blobToB64(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.readAsDataURL(blob);
  });
}
function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

// ---------- 觸發下載 / 分享 ----------
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function nativeShare({ title, text, url, files }) {
  if (navigator.share) {
    try {
      const data = { title, text };
      if (url) data.url = url;
      if (files && navigator.canShare && navigator.canShare({ files })) data.files = files;
      await navigator.share(data);
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  return false;
}
