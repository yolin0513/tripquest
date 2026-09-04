// IndexedDB 底層封裝
// 兩個資料面（three opus 代理一致建議把兩者分開）：
//   records — 中繼資料（Group / Trip / Spot / Quest / PhotoSubmission / Member），小、可合併、未來可同步
//   blobs   — 照片二進位，以 SHA-256 內容雜湊定址，永遠不進同步 payload

const DB_NAME = 'tripquest';
const DB_VERSION = 3;

let _db = null;
let _opening = null;

function openOnce() {
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
      // v3：每個行程的 AI 金鑰與用量。獨立 store —— 絕不進 records / meta / 任何匯出。
      if (!db.objectStoreNames.contains('tripSecrets')) {
        db.createObjectStore('tripSecrets', { keyPath: 'tripId' });
      }
      void e;
    };
    req.onsuccess = () => {
      const db = req.result;
      // 連線被瀏覽器關掉的情況不只「有人要求升級」——手機把 App 切到背景、
      // 分頁凍結、記憶體不足時，瀏覽器也可能主動關閉閒置的 IndexedDB 連線
      // （例如分享出去切到 LINE 再切回來）。兩種情況都要讓下一次 tx() 知道
      // 要重開一條新的連線，而不是拿著一條已經在關閉中的連線去開交易
      // （那會丟 InvalidStateError: connection is closing）。
      const invalidate = () => { if (_db === db) _db = null; };
      db.onversionchange = () => { try { db.close(); } catch { /* noop */ } invalidate(); };
      db.onclose = invalidate;
      _db = db;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => { /* 有其他分頁卡著升級（理論上不會，版本沒變），交給呼叫端重試 */ };
  });
}

// 多個呼叫幾乎同時發生時，只真的開一條連線（等它） —— 不然每個呼叫都各自
// indexedDB.open() 一次，也是常見的連線亂象來源。
export function openDB() {
  if (_db) return Promise.resolve(_db);
  if (!_opening) _opening = openOnce().finally(() => { _opening = null; });
  return _opening;
}

async function tx(store, mode = 'readonly') {
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = await openDB();
    try {
      return db.transaction(store, mode).objectStore(store);
    } catch (e) {
      // 連線正在關閉中：丟掉舊連線、重開一條，重試一次就好（不要無限重試）
      const closing = e && (e.name === 'InvalidStateError' || /closing|closed/i.test(e.message || ''));
      if (attempt === 0 && closing) { _db = null; continue; }
      throw e;
    }
  }
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

// ---- tripSecrets（每個行程的 AI 金鑰 + 用量；本機專屬，絕不同步 / 匯出）----
export async function tripSecretGet(tripId) {
  return wrap((await tx('tripSecrets')).get(tripId));
}
export async function tripSecretSet(entry) {
  // entry: { tripId, provider, key, capUsd, usedMicroUsd, at }
  return wrap((await tx('tripSecrets', 'readwrite')).put(entry));
}
export async function tripSecretDelete(tripId) {
  return wrap((await tx('tripSecrets', 'readwrite')).delete(tripId));
}
export async function tripSecretClearAll() {
  return wrap((await tx('tripSecrets', 'readwrite')).clear());
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
  await Promise.all(['records', 'blobs', 'outbox', 'meta', 'tripSecrets'].map((name) =>
    wrap(db.transaction(name, 'readwrite').objectStore(name).clear())
  ));
}
