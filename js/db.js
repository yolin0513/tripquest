// IndexedDB 底層封裝
// 兩個資料面（three opus 代理一致建議把兩者分開）：
//   records — 中繼資料（Group / Trip / Spot / Quest / PhotoSubmission / Member），小、可合併、未來可同步
//   blobs   — 照片二進位，以 SHA-256 內容雜湊定址，永遠不進同步 payload

const DB_NAME = 'tripquest';
const DB_VERSION = 2;

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) {
        const s = db.createObjectStore('records', { keyPath: 'id' });
        s.createIndex('byType', 'type', { unique: false });
        s.createIndex('byTrip', 'tripId', { unique: false });
        s.createIndex('bySpot', 'spotId', { unique: false });
        s.createIndex('byQuest', 'questId', { unique: false });
        s.createIndex('byGroup', 'groupId', { unique: false });
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'hash' });
      }
      // v2：離線同步佇列（outbox）+ 本機專屬 meta（身分、游標；永不同步）
      if (!db.objectStoreNames.contains('outbox')) {
        const o = db.createObjectStore('outbox', { keyPath: 'id' });
        o.createIndex('byNextAt', 'nextAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      void e;
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---- records ----
export async function allRecords() {
  return wrap((await tx('records')).getAll());
}
export async function putRecord(rec) {
  return wrap((await tx('records', 'readwrite')).put(rec));
}
export async function putRecords(list) {
  const store = await tx('records', 'readwrite');
  await Promise.all(list.map((r) => wrap(store.put(r))));
}
export async function deleteRecordHard(id) {
  return wrap((await tx('records', 'readwrite')).delete(id));
}

// ---- blobs ----
export async function putBlob(entry) {
  // entry: { hash, blob, w, h, bytes, kind }
  return wrap((await tx('blobs', 'readwrite')).put(entry));
}
export async function getBlob(hash) {
  if (!hash) return null;
  return wrap((await tx('blobs')).get(hash));
}
export async function hasBlob(hash) {
  const keys = await wrap((await tx('blobs')).getAllKeys());
  return keys.includes(hash);
}
export async function allBlobKeys() {
  return wrap((await tx('blobs')).getAllKeys());
}
export async function deleteBlob(hash) {
  return wrap((await tx('blobs', 'readwrite')).delete(hash));
}

// ---- meta（本機專屬鍵值，例如身分、同步游標；不會進同步）----
export async function metaGet(key) {
  const r = await wrap((await tx('meta')).get(key));
  return r ? r.value : null;
}
export async function metaSet(key, value) {
  return wrap((await tx('meta', 'readwrite')).put({ key, value }));
}

// ---- outbox（離線同步佇列）----
export async function outboxAll() {
  return wrap((await tx('outbox')).getAll());
}
export async function outboxPut(entry) {
  return wrap((await tx('outbox', 'readwrite')).put(entry));
}
export async function outboxDelete(id) {
  return wrap((await tx('outbox', 'readwrite')).delete(id));
}
export async function outboxGet(id) {
  return wrap((await tx('outbox')).get(id));
}

// ---- 維運 ----
export async function estimate() {
  if (navigator.storage && navigator.storage.estimate) {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  }
  return { usage: 0, quota: 0 };
}

export async function requestPersist() {
  if (navigator.storage && navigator.storage.persist) {
    try { return await navigator.storage.persist(); } catch { return false; }
  }
  return false;
}

export async function isPersisted() {
  if (navigator.storage && navigator.storage.persisted) {
    try { return await navigator.storage.persisted(); } catch { return false; }
  }
  return false;
}

export async function wipeAll() {
  const db = await openDB();
  await Promise.all(['records', 'blobs', 'outbox', 'meta'].map((name) =>
    wrap(db.transaction(name, 'readwrite').objectStore(name).clear())
  ));
}
