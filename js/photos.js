// 照片匯入流程：讀 EXIF → 壓縮 / 去中繼資料 → 內容雜湊 → 存 blob → 新增投稿記錄
// 隱私原則：照片永遠不上傳到任何地方；GPS 只有在該行程開啟地圖時才寫入。

import * as db from './db.js';
import { sha256Hex, uuid, deviceId, deviceName } from './ids.js';
import { readExif } from './exif.js';
import * as store from './store.js';

const MAX_EDGE = 1600;
const THUMB_EDGE = 320;
const QUALITY = 0.82;

// WebP 只在瀏覽器「確實」能編碼時才用（Safari 舊版 toBlob 會默默吐 PNG，1600px PNG ~3MB）
let _fmt = null;
async function pickFormat() {
  if (_fmt) return _fmt;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8));
    _fmt = blob && blob.type === 'image/webp' ? { mime: 'image/webp', q: 0.80, tq: 0.75 } : { mime: 'image/jpeg', q: QUALITY, tq: 0.72 };
  } catch {
    _fmt = { mime: 'image/jpeg', q: QUALITY, tq: 0.72 };
  }
  return _fmt;
}

let _worker = null;
let _workerBroken = false;
let _askedPersist = false;
const _pending = new Map();

function worker() {
  if (_workerBroken) return null;
  if (_worker) return _worker;
  try {
    _worker = new Worker(new URL('./worker-image.js', import.meta.url), { type: 'module' });
    _worker.onmessage = (e) => {
      const { id, ...rest } = e.data;
      const p = _pending.get(id);
      if (p) { _pending.delete(id); p(rest); }
    };
    _worker.onerror = () => { _workerBroken = true; _worker = null; };
    return _worker;
  } catch {
    _workerBroken = true;
    return null;
  }
}

function compressInWorker(blob, fmt) {
  const w = worker();
  if (!w) return Promise.reject(new Error('no worker'));
  const id = uuid();
  return new Promise((resolve, reject) => {
    _pending.set(id, (res) => (res.ok ? resolve(res) : reject(new Error(res.error))));
    w.postMessage({ id, blob, maxEdge: MAX_EDGE, thumbEdge: THUMB_EDGE, mime: fmt.mime, quality: fmt.q, thumbQuality: fmt.tq });
    setTimeout(() => { if (_pending.has(id)) { _pending.delete(id); reject(new Error('timeout')); } }, 20000);
  });
}

// 主執行緒退路（無 Worker / OffscreenCanvas 時）
async function compressOnMain(blob, fmt) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => loadViaImg(blob));
  const enc = async (maxEdge, q) => {
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const hh = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hh;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, hh);
    let out = await new Promise((res) => canvas.toBlob(res, fmt.mime, q));
    if (!out || (fmt.mime !== 'image/jpeg' && out.type !== fmt.mime)) {
      out = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY)); // 保險：不支援就退回 JPEG
    }
    return { blob: out, w, h: hh };
  };
  const photo = await enc(MAX_EDGE, fmt.q);
  const thumb = await enc(THUMB_EDGE, fmt.tq);
  return { ok: true, photo: photo.blob, thumb: thumb.blob, w: photo.w, h: photo.h };
}

function loadViaImg(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

async function storeBlob(blob, kind) {
  const ab = await blob.arrayBuffer();
  const hash = await sha256Hex(ab);
  const existing = await db.getBlob(hash);
  if (!existing) await db.putBlob({ hash, blob, bytes: blob.size, kind });
  return { hash, bytes: blob.size };
}

// file: File；opts: { tripId, questId, memberId, allowGeo, forMemberId, subjectIds }
export async function importPhoto(file, opts) {
  if (!file || !file.type.startsWith('image/')) throw new Error('不是圖片檔');
  const exif = await readExif(file);
  const fmt = await pickFormat();

  let comp;
  try {
    comp = await compressInWorker(file, fmt);
  } catch {
    comp = await compressOnMain(file, fmt);
  }

  // 有內容時才要求持久化許可（此時系統較願意給、使用者也有情境）
  if (!_askedPersist) {
    _askedPersist = true;
    db.requestPersist().catch(() => {});
  }

  const photo = await storeBlob(comp.photo, 'photo');
  const thumb = await storeBlob(comp.thumb, 'thumb');

  const sub = await store.addSubmission({
    tripId: opts.tripId,
    questId: opts.questId,
    memberId: opts.memberId || null,
    forMemberId: opts.forMemberId || null,          // 幫誰拍（代拍）→ 完成歸屬給他
    subjectIds: Array.isArray(opts.subjectIds) && opts.subjectIds.length ? opts.subjectIds : null, // 照片裡有誰
    photoHash: photo.hash,
    thumbHash: thumb.hash,
    w: comp.w, h: comp.h,
    bytes: photo.bytes,
    takenAt: exif.takenAt || file.lastModified || Date.now(),
    gps: opts.allowGeo && exif.gps ? exif.gps : null,
    hadGps: !!exif.gps,
    caption: '',
    byDevice: deviceName(),
    deviceId: deviceId(),
  });
  return sub;
}

// blob URL 快取（縮圖 / 大圖顯示用），避免重複 createObjectURL
const _urlCache = new Map();
const _fetching = new Map();

// 全圖延遲下載：本機沒有、但屬於已同步群組時，需要顯示才去伺服器抓
async function lazyFetch(hash) {
  if (_fetching.has(hash)) return _fetching.get(hash);
  const p = (async () => {
    try {
      const group = store.groupForHash(hash);
      if (!group) return null;
      const sync = await import('./sync.js');
      if (!sync.syncEnabled()) return null;
      const adapter = sync.adapterForGroup(group.id, group.syncSecret);
      const blob = await adapter.getBlob(hash);
      if (blob && blob.size) {
        await db.putBlob({ hash, blob, bytes: blob.size, kind: 'photo' });
        return blob;
      }
    } catch { /* ignore */ }
    return null;
  })();
  _fetching.set(hash, p);
  p.finally(() => _fetching.delete(hash));
  return p;
}

export async function blobURL(hash) {
  if (!hash) return '';
  if (_urlCache.has(hash)) return _urlCache.get(hash);
  let entry = await db.getBlob(hash);
  if (!entry) {
    const blob = await lazyFetch(hash);
    if (!blob) return '';
    entry = { blob };
  }
  const url = URL.createObjectURL(entry.blob);
  _urlCache.set(hash, url);
  return url;
}

export async function hasLocal(hash) {
  return !!(await db.getBlob(hash));
}
export function revokeAll() {
  for (const url of _urlCache.values()) URL.revokeObjectURL(url);
  _urlCache.clear();
}
