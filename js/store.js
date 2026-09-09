// 狀態層 —— 所有寫入都經過這裡
// 三位架構代理一致要求的關鍵設計：
//   1. 每筆記錄帶 updatedAt + deviceId，中繼資料用「後寫入者勝 + 墓碑」合併
//   2. PhotoSubmission 只新增、不修改、不刪除 → 合併時就是集合聯集，永不衝突
//   3. 任務是否完成是「即時推導」出來的，不落地、不同步

import * as db from './db.js';
import { uuid, deviceId } from './ids.js';
import { mergeRecord, groupsOf, seedF, groupChanged, stable, APPEND_ONLY } from './merge.js';

const state = {
  ready: false,
  byId: new Map(),      // id -> record（含墓碑）
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }
// 供 outbox 在背景下載 / 合併後通知畫面重繪
export function notifyExternalChange() { emit(); }

function groupIdOfRecord(rec) {
  if (!rec) return null;
  if (rec.type === 'group') return rec.id;
  if (rec.groupId) return rec.groupId;
  if (rec.tripId) { const t = state.byId.get(rec.tripId); return t && t.groupId; }
  if (rec.submissionId) { const s = state.byId.get(rec.submissionId); return s ? groupIdOfRecord(s) : null; }
  return null;
}

// 有設定同步時，把異動排進 outbox（延遲載入避免循環相依）。
// 回傳 promise —— 呼叫端 await 之後再 drain 才不會漏。
async function queueSync(kind, rec) {
  try {
    const o = await import('./outbox.js');
    if (kind === 'submission') { await o.onSubmission(rec); return; }
    const gid = groupIdOfRecord(rec);
    if (gid) await o.enqueuePush(gid);
  } catch (e) { console.warn('queueSync', e); }
}

export async function init() {
  if (state.ready) return;
  const recs = await db.allRecords();
  for (const r of recs) state.byId.set(r.id, r);
  state.ready = true;
  migrateHere().catch(() => {});
}

// ---------- 寫入基本操作 ----------
// v1.56：時間戳單調 —— max(now, 先前+1)。時鐘慢的裝置改了東西，也一定贏過它看過的版本
function stamp(rec, prev = null) {
  rec.updatedAt = Math.max(Date.now(), ((prev && prev.updatedAt) || 0) + 1);
  rec.deviceId = deviceId();
  return rec;
}

export async function put(rec) {
  if (!rec.id) rec.id = uuid();
  if (!rec.createdAt) rec.createdAt = Date.now();
  stamp(rec, state.byId.get(rec.id));
  if (groupsOf(rec.type)) rec._f = seedF(rec, rec.updatedAt);   // 欄位級合併的時間戳（merge.js）
  state.byId.set(rec.id, rec);
  await db.putRecord(rec);
  emit();
  if (rec.type !== 'submission') await queueSync('push', rec);
  return rec;
}

export async function patch(id, changes) {
  const cur = state.byId.get(id);
  if (!cur) throw new Error('找不到記錄 ' + id);
  const next = { ...cur, ...changes };
  const groups = groupsOf(cur.type);
  if (groups) {
    // 沒有 _f 的舊記錄：先以「patch 前」的 updatedAt 播種全部欄位組（不允許部分 _f）
    const f = seedF(cur, cur.updatedAt || cur.createdAt || 0);
    const now = Date.now();
    for (const [g, fields] of Object.entries(groups)) {
      // 表單會把沒動的欄位一起送 —— 值沒變就不 bump，不然會搶走別人真正的修改
      if (fields.some((k) => k in changes) && groupChanged(cur, next, fields)) f[g] = Math.max(now, (f[g] || 0) + 1);
    }
    next._f = f;
  }
  stamp(next, cur);
  state.byId.set(id, next);
  await db.putRecord(next);
  emit();
  // 內部旗標（_enriched / _wikiTried 等）不值得觸發同步
  if (!Object.keys(changes).every((k) => k.startsWith('_'))) await queueSync('push', next);
  return next;
}

// ---------- 本機移除（v1.62，三代理 3:0）----------
//
// 「移除」跟「刪除」是兩回事。這個 App 沒有帳號、每個成員拿的是同一把群組祕鑰，
// 所以「同步刪除整趟旅程」等於把全家的照片交給最手滑的那一位——使用者實機踩到了。
// 現在的移除**只作用在這台裝置**：硬刪、不寫墓碑、不排同步。
//
// 三個非做不可的細節（三位代理各自獨立指出）：
// 1) **記憶體與 IndexedDB 要一起清**。importRecords 結尾是
//    `db.putRecords([...state.byId.values()])` —— 只刪 IndexedDB 的話，
//    下一次任何群組的同步都會把整趟旅程原封不動寫回去。
// 2) **要擋住同步把它拉回來**。syncedGroups() 讀的是本機有沒有群組記錄，
//    硬刪後 drain 就不碰它了；但正在跑的那一輪 drain 已經把群組清單抓在手上，
//    pull 回來的記錄會被塞回 state —— 所以另外記一個「已遺忘」名單當保險。
// 3) 群組底下若還有別的行程，只清這一趟，不動群組與成員。
const forgotten = new Set();
export const isForgotten = (groupId) => forgotten.has(groupId);
export function unforget(groupId) { forgotten.delete(groupId); }

// 列出「這一趟」或「這個群組」在本機的所有記錄 id（跟 exportGroup 同一套判斷）
export function recordsOfGroup(groupId, { onlyTripId = null } = {}) {
  const trips = list().filter((r) => r.type === 'trip' && r.groupId === groupId);
  const tripIds = new Set(onlyTripId ? [onlyTripId] : trips.map((r) => r.id));
  const wholeGroup = !onlyTripId || trips.length <= 1;
  return list().filter((r) => {
    if (r.id === groupId) return wholeGroup;
    if (r.groupId === groupId) return wholeGroup;             // member / 群組層記錄
    if (r.tripId && tripIds.has(r.tripId)) return true;
    return false;
  });
}

// 本機移除。回傳被刪掉的統計，讓 UI 可以照實說。
export async function forgetGroup(groupId, { onlyTripId = null } = {}) {
  const recs = recordsOfGroup(groupId, { onlyTripId });
  const trips = list().filter((r) => r.type === 'trip' && r.groupId === groupId);
  const wholeGroup = !onlyTripId || trips.length <= 1;
  const hashes = [];
  for (const r of recs) {
    if (r.type === 'submission') hashes.push(r.photoHash, r.thumbHash, r.originalHash);
    if (r.heroHash) hashes.push(r.heroHash);
    if (r.refHash) hashes.push(r.refHash);
  }
  if (wholeGroup) forgotten.add(groupId);                     // 先立旗標，再刪
  for (const r of recs) {
    state.byId.delete(r.id);                                  // 記憶體與 IndexedDB 一起清
    await db.deleteRecordHard(r.id);
  }
  emit();
  await gcBlobs(hashes.filter(Boolean));                      // 記錄清掉之後才算得準（跨行程共用的會留著）
  return { records: recs.length, wholeGroup };
}

// 中繼資料刪除 = 立墓碑（未來同步時對方才知道「這筆被刪了」）
export async function remove(id) {
  const cur = state.byId.get(id);
  if (!cur) return;
  await patch(id, { deleted: true });
}

// ---------- 反應（按讚）與留言 ----------
export async function toggleReaction(submissionId, actorId, emoji = '❤️') {
  const sub = state.byId.get(submissionId);
  if (!sub) return;
  const mine = list().find((r) => r.type === 'reaction' && r.submissionId === submissionId && r.actorId === actorId);
  if (mine) {
    state.byId.delete(mine.id);
    await db.deleteRecordHard(mine.id);
  } else {
    const rec = {
      id: uuid(), type: 'reaction', tripId: sub.tripId, submissionId,
      actorId, emoji, createdAt: Date.now(), deviceId: deviceId(),
    };
    state.byId.set(rec.id, rec);
    await db.putRecord(rec);
  }
  emit();
  await queueSync('push', sub);
}

export async function addComment(submissionId, actorId, text) {
  const sub = state.byId.get(submissionId);
  if (!sub || !String(text).trim()) return;
  const rec = {
    id: uuid(), type: 'comment', tripId: sub.tripId, submissionId,
    actorId, text: String(text).trim().slice(0, 240), createdAt: Date.now(), deviceId: deviceId(),
  };
  state.byId.set(rec.id, rec);
  await db.putRecord(rec);
  emit();
  await queueSync('push', rec);
  return rec;
}

export async function deleteComment(id) {
  const c = state.byId.get(id);
  if (!c || c.type !== 'comment') return;
  state.byId.delete(id);
  await db.deleteRecordHard(id);
  emit();
}

export function reactionsOf(submissionId) {
  return list().filter((r) => r.type === 'reaction' && r.submissionId === submissionId);
}
export function commentsOf(submissionId) {
  return list().filter((r) => r.type === 'comment' && r.submissionId === submissionId)
    .sort((a, b) => a.createdAt - b.createdAt);
}
export function myReaction(submissionId, actorId) {
  return reactionsOf(submissionId).find((r) => r.actorId === actorId) || null;
}

// ---------- 「我是誰」（每個行程記住一次，之後拍照不再追問） ----------
export function getActiveMember(tripId) {
  try { return localStorage.getItem('tripquest.me.' + tripId) || null; } catch { return null; }
}
export function setActiveMember(tripId, memberId) {
  try { localStorage.setItem('tripquest.me.' + tripId, memberId); } catch { /* noop */ }
}

// ---------- 「大家現在在哪一站」（同步給整個群組）----------
// id 固定成 'here:<行程id>'，所以每個群組永遠只有一筆。不同裝置改同一筆時走一般的
// 「後寫入者勝」合併，不會各自長出一筆來打架。
//
// **只有使用者親手指定時才寫入。** 景點完成後的「自動往下推進」是純推導、不寫任何東西 ——
// 這是避免同步風暴的關鍵：如果完成當下每台裝置都各自算出下一站再寫回去，五個人就會
// 寫五次、互相覆蓋。改成從「已完成」這個本來就會同步的事實各自推導，大家算出來的
// 結果一模一樣，卻一次寫入都沒有。
const HERE_ID = (tripId) => 'here:' + tripId;

// 原始記錄（含是誰設的、什麼時候設的），給畫面顯示「○○ 把大家帶到這裡」用
export function hereRecord(tripId) {
  const r = state.byId.get(HERE_ID(tripId));
  return r && !r.deleted && r.spotId ? r : null;
}

const spotDone = (spotId) => {
  const p = spotProgress(spotId);
  return p.total > 0 && p.done === p.total;
};

export function getHereSpot(tripId) {
  const rec = hereRecord(tripId);
  if (!rec) return null;
  const s = get(rec.spotId);
  if (!s || s.tripId !== tripId) return null;              // 景點被刪了 → 當作沒設
  // 「完成就自動往下推進」只能用在**設定之後才完成**的情況。使用者挑一個已經拍完的
  // 地方是很正常的（想再回去、或人就站在那裡要導航）—— 那是他的明確選擇，不能默默
  // 忽略，不然畫面看起來就像「我按了卻沒反應」。
  if (spotDone(rec.spotId) && !rec.wasDone) return null;
  return rec.spotId;
}

// actor：{ id, name } —— 是誰把大家帶過去的
export async function setHereSpot(tripId, spotId, actor = null) {
  const prev = state.byId.get(HERE_ID(tripId));
  return put({
    id: HERE_ID(tripId), type: 'here', tripId, spotId: spotId || null,
    byMemberId: (actor && actor.id) || null,
    byName: (actor && actor.name) || '',
    wasDone: spotId ? spotDone(spotId) : false,   // 設定當下就已經拍完 → 之後不要自動放手
    createdAt: (prev && prev.createdAt) || Date.now(),
  });
}
export async function clearHereSpot(tripId, actor = null) {
  if (!state.byId.get(HERE_ID(tripId))) return null;
  return setHereSpot(tripId, null, actor);
}

// v1.29 把這個存在 localStorage，改成同步記錄後搬過來一次
async function migrateHere() {
  for (const t of trips()) {
    const key = 'tripquest.here.' + t.id;
    let old = null;
    try { old = localStorage.getItem(key); localStorage.removeItem(key); } catch { continue; }
    if (!old || state.byId.get(HERE_ID(t.id)) || !get(old)) continue;
    try { await setHereSpot(t.id, old, null); } catch { /* noop */ }
  }
}

// PhotoSubmission 專用：直接新增，不走 stamp 的可變語意
export async function addSubmission(sub) {
  sub.id = sub.id || uuid();
  sub.type = 'submission';
  sub.createdAt = Date.now();
  sub.deviceId = deviceId();
  state.byId.set(sub.id, sub);
  await db.putRecord(sub);
  emit();
  await queueSync('submission', sub);
  return sub;
}

// 移除一張投稿（例如拍壞了）。投稿本身不可變（append-only），所以寫一筆「撤回」記錄
// 覆蓋顯示層 —— 硬刪的話，聯集合併時會在其他裝置復活。
export async function deleteSubmission(id) {
  const sub = state.byId.get(id);
  if (!sub || sub.type !== 'submission') return;
  const rec = {
    id: uuid(), type: 'retraction', tripId: sub.tripId, submissionId: id,
    createdAt: Date.now(), deviceId: deviceId(),
  };
  state.byId.set(rec.id, rec);
  await db.putRecord(rec);
  await gcBlobs([sub.photoHash, sub.thumbHash, sub.originalHash]);
  emit();
  await queueSync('push', rec);
}

function retractedIds() {
  const s = new Set();
  for (const r of state.byId.values()) if (r.type === 'retraction') s.add(r.submissionId);
  return s;
}

// ---------- 照片標記（上傳時不問，事後在照片牆標）----------
// 為什麼不直接改投稿：投稿是 append-only，importRecords 合併時對已存在的投稿直接跳過，
// 所以標記若寫回投稿裡，在自己手機上看起來有改，卻永遠傳不到旅伴的手機。
// 改成另存一筆記錄，id 固定成 'tag:<投稿id>' —— 不同裝置標同一張照片時 id 一致，
// 就會走一般的「後寫入者勝」合併，最後一次標記為準。
const TAG_PREFIX = 'tag:';

// 一張照片「現在」的標記。沒有事後標記時，沿用上傳當下寫進投稿的舊欄位。
// taggedAt 只在真的動到「照片裡有誰 / 誰拍的」時才寫 —— 只加了說明不算標記過人物，
// 否則照片牆會少算「還有幾張沒標」。
export function photoTag(sub) {
  if (!sub) return { photographerId: null, subjectIds: [], caption: '', explicit: false };
  const rec = state.byId.get(TAG_PREFIX + sub.id);
  const has = !!(rec && !rec.deleted);
  const explicit = has && !!rec.taggedAt;
  const live = (ids) => (Array.isArray(ids) ? ids.filter((id) => alive(state.byId.get(id))) : []);
  return {
    photographerId: (explicit ? rec.photographerId : null) || sub.memberId || null,
    subjectIds: explicit ? live(rec.subjectIds) : live(sub.subjectIds),
    caption: has ? (rec.caption || '') : (sub.caption || ''),
    explicit,
  };
}

// 只帶要改的欄位；沒帶到的沿用現況。
export async function setPhotoTag(submissionId, changes = {}) {
  const sub = state.byId.get(submissionId);
  if (!sub || sub.type !== 'submission') return null;
  const cur = photoTag(sub);
  const prev = state.byId.get(TAG_PREFIX + submissionId);
  const touchesPeople = 'subjectIds' in changes || 'photographerId' in changes;
  return put({
    id: TAG_PREFIX + submissionId,
    type: 'phototag',
    tripId: sub.tripId,
    submissionId,
    photographerId: ('photographerId' in changes ? changes.photographerId : cur.photographerId) || null,
    subjectIds: [...('subjectIds' in changes ? (changes.subjectIds || []) : cur.subjectIds)],
    caption: String(('caption' in changes ? changes.caption : cur.caption) || ''),
    taggedAt: touchesPeople ? Date.now() : (prev ? prev.taggedAt || null : null),
    createdAt: prev ? prev.createdAt : Date.now(),
  });
}

// 照片說明也放進標記記錄裡，這樣事後改的說明才會同步（寫回投稿一樣傳不出去）
export function photoCaption(sub) { return photoTag(sub).caption; }

export function isPhotoTagged(sub) {
  const t = photoTag(sub);
  return t.explicit || t.subjectIds.length > 0 || !!(sub && sub.forMemberId);
}

// 一個人的旅程不需要標「照片裡有誰」，所以那時候一律當作標好了
export function untaggedPhotos(tripId) {
  const trip = get(tripId);
  if (!trip || membersOf(trip.groupId).length < 2) return [];
  return submissionsOfTrip(tripId).filter((s) => !isPhotoTagged(s));
}

// 清掉不再被任何投稿參照的 blob
export async function gcBlobs(candidates) {
  const live = new Set();
  for (const r of state.byId.values()) {
    // originalHash 也算「還有人要」—— 打開「保留原檔」之後那份原始檔只存在這台
    // 裝置上，被 GC 掉就永遠回不來了
    if (r.type === 'submission') { live.add(r.photoHash); live.add(r.thumbHash); live.add(r.originalHash); }
  }
  for (const h of candidates || []) {
    if (h && !live.has(h)) await db.deleteBlob(h);
  }
}

// ---------- 選擇器 ----------
const alive = (r) => r && !r.deleted;
const list = () => [...state.byId.values()];

export function getRaw(id) { return state.byId.get(id) || null; }
export function get(id) { const r = state.byId.get(id); return alive(r) ? r : null; }

export function trips() {
  return list().filter((r) => r.type === 'trip' && alive(r))
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '') || b.createdAt - a.createdAt);
}
export function group(id) { return get(id); }
export function membersOf(groupId) {
  return list().filter((r) => r.type === 'member' && r.groupId === groupId && alive(r))
    .sort((a, b) => a.createdAt - b.createdAt);
}
export function spotsOf(tripId) {
  return list().filter((r) => r.type === 'spot' && r.tripId === tripId && alive(r))
    .sort((a, b) => (a.day || 0) - (b.day || 0) || (a.order || 0) - (b.order || 0) || a.createdAt - b.createdAt);
}
export function questsOf(spotId) {
  return list().filter((r) => r.type === 'quest' && r.spotId === spotId && alive(r))
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.createdAt - b.createdAt);
}
export function questsOfTrip(tripId) {
  return list().filter((r) => r.type === 'quest' && r.tripId === tripId && alive(r));
}
// 排序一定要有決勝條件：一次選三張同時匯入的照片 takenAt 會完全一樣（同一個
// lastModified），JS 的 sort 是穩定的，平手時就保留「插入順序」—— 而插入順序在
// 上傳的那台是上傳順序、在同步過來的那台是拉取順序，兩台的第 1 張會不一樣。
// 標記（tag:<subId>）本身同步得好好的，但照 index 比對就會看起來像「沒同步」。
const bySubTime = (a, b) =>
  ((a.takenAt || a.createdAt) - (b.takenAt || b.createdAt)) ||
  ((a.createdAt || 0) - (b.createdAt || 0)) ||
  String(a.id).localeCompare(String(b.id));

export function submissionsOf(questId) {
  const gone = retractedIds();
  return list().filter((r) => r.type === 'submission' && r.questId === questId && !gone.has(r.id))
    .sort((a, b) => (a.createdAt - b.createdAt) || String(a.id).localeCompare(String(b.id)));
}
export function submissionsOfTrip(tripId) {
  const gone = retractedIds();
  return list().filter((r) => r.type === 'submission' && r.tripId === tripId && !gone.has(r.id))
    .sort(bySubTime);
}

// 任務完成 = 至少一張投稿（推導，不落地）
export function isQuestDone(questId) {
  return submissionsOf(questId).length > 0;
}
export function tripProgress(tripId) {
  const qs = questsOfTrip(tripId);
  const done = qs.filter((q) => isQuestDone(q.id)).length;
  return { done, total: qs.length, ratio: qs.length ? done / qs.length : 0 };
}
export function spotProgress(spotId) {
  const qs = questsOf(spotId);
  const done = qs.filter((q) => isQuestDone(q.id)).length;
  return { done, total: qs.length, ratio: qs.length ? done / qs.length : 0 };
}

// 只在同步管線裡流動、絕不進任何「匯出／分享／給 AI」的型別（v1.60 三代理必修項）。
// 位置就是這種資料：exportRecords() 是全 App 的通用資料源（回顧、海報、匯出檔、
// AI payload 都吃它），所以預設就不吐 —— 未來新增的任何匯出功能預設安全，
// 不用每加一個出口就記得過濾一次。只有 exportGroup（同步）明確拿得到。
export const SENSITIVE_TYPES = new Set(['memberPos']);

// ---------- 匯出用：全部存活記錄 ----------
// all:true 只給位置模組自己用（要讀自己那筆來比對/寫墓碑）
export function exportRecords({ all = false } = {}) {
  return all ? list() : list().filter((r) => !SENSITIVE_TYPES.has(r.type));
}

// 把外來/本機直寫的記錄併進記憶體狀態（不觸發 queueSync —— 位置走自己的單筆推送）
export function mergeLocal(recs) {
  for (const r of recs) state.byId.set(r.id, r);
  emit();
}

// ---------- 同步用 ----------
// 有設定同步祕鑰的群組
function isForgottenRecord(rec) {
  if (!rec) return false;
  if (forgotten.has(rec.id) || forgotten.has(rec.groupId)) return true;
  if (rec.tripId) {
    const t = state.byId.get(rec.tripId);
    if (t && forgotten.has(t.groupId)) return true;
  }
  return false;
}

export function syncedGroups() {
  return list().filter((r) => r.type === 'group' && r.syncSecret && !r.deleted);
}

// 某個群組相關的所有記錄（含墓碑，要送出去）。
// 這是唯一會拿到 SENSITIVE_TYPES 的地方（位置要同步給旅伴才有意義）。
export function exportGroup(groupId) {
  const tripIds = new Set(list().filter((r) => r.type === 'trip' && r.groupId === groupId).map((r) => r.id));
  return list().filter((r) => {
    if (r.id === groupId) return true;
    if (r.groupId === groupId) return true;           // member
    if (r.tripId && tripIds.has(r.tripId)) return true; // spot / quest / submission / reaction / comment
    return false;
  }).map(stripForSync);
}

// 照片的 EXIF 座標「只存本機」是設定頁對使用者的承諾（allowGeo 的說明文字），
// 但 submission 記錄本來會整筆同步上去 —— 承諾其實是破的（v1.60 三代理查證發現）。
// 上傳前剝掉：本機留著（相簿地圖照用），伺服器與其他裝置永遠看不到。
function stripForSync(r) {
  if (r.type === 'submission' && r.gps) { const { gps, ...rest } = r; return rest; }
  return r;
}

// 依照片雜湊找出它屬於哪個群組（延遲下載全圖用）
export function groupForHash(hash) {
  const sub = list().find((r) => r.type === 'submission' && (r.photoHash === hash || r.thumbHash === hash));
  if (!sub) return null;
  const trip = state.byId.get(sub.tripId);
  const group = trip && state.byId.get(trip.groupId);
  return group && group.syncSecret ? group : null;
}
export async function importRecords(incoming, { merge = true } = {}) {
  const heal = new Set();                       // 本機持有伺服器沒有的欄位 → 之後再 push 一次
  for (const inc of incoming) {
    // 已經從這台裝置移除的群組：正在跑的那一輪 drain 可能還會送記錄進來，全部丟掉
    // （不然移除完幾秒後整趟旅程又長回來）。重新用邀請加入時會 unforget。
    if (forgotten.size && isForgottenRecord(inc)) continue;
    const cur = state.byId.get(inc.id);
    if (!cur) { state.byId.set(inc.id, inc); continue; }
    if (!merge) { state.byId.set(inc.id, inc); continue; }
    if (APPEND_ONLY.has(inc.type)) continue;    // append-only：已存在就跳過
    // 欄位級合併（merge.js；追蹤型別逐組 LWW，其餘整筆 LWW）
    const { rec, changed } = mergeRecord(cur, inc);
    if (changed) state.byId.set(inc.id, rec);
    // stable()：鍵序不同不算不同，不然每次 pull 都白推一次整包（v1.64 健檢）
    if (stable(rec) !== stable(inc)) { const gid = groupIdOfRecord(rec); if (gid) heal.add(gid); }
  }
  await db.putRecords([...state.byId.values()]);
  emit();
  for (const gid of heal) queueSync('push', { type: 'group', id: gid }).catch(() => {});
}
