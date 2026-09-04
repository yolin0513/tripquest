// 狀態層 —— 所有寫入都經過這裡
// 三位架構代理一致要求的關鍵設計：
//   1. 每筆記錄帶 updatedAt + deviceId，中繼資料用「後寫入者勝 + 墓碑」合併
//   2. PhotoSubmission 只新增、不修改、不刪除 → 合併時就是集合聯集，永不衝突
//   3. 任務是否完成是「即時推導」出來的，不落地、不同步

import * as db from './db.js';
import { uuid, deviceId } from './ids.js';

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
}

// ---------- 寫入基本操作 ----------
function stamp(rec) {
  rec.updatedAt = Date.now();
  rec.deviceId = deviceId();
  return rec;
}

export async function put(rec) {
  if (!rec.id) rec.id = uuid();
  if (!rec.createdAt) rec.createdAt = Date.now();
  stamp(rec);
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
  stamp(next);
  state.byId.set(id, next);
  await db.putRecord(next);
  emit();
  // 內部旗標（_enriched / _wikiTried 等）不值得觸發同步
  if (!Object.keys(changes).every((k) => k.startsWith('_'))) await queueSync('push', next);
  return next;
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
  await gcBlobs([sub.photoHash, sub.thumbHash]);
  emit();
  await queueSync('push', rec);
}

function retractedIds() {
  const s = new Set();
  for (const r of state.byId.values()) if (r.type === 'retraction') s.add(r.submissionId);
  return s;
}

// 清掉不再被任何投稿參照的 blob
export async function gcBlobs(candidates) {
  const live = new Set();
  for (const r of state.byId.values()) {
    if (r.type === 'submission') { live.add(r.photoHash); live.add(r.thumbHash); }
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
export function submissionsOf(questId) {
  const gone = retractedIds();
  return list().filter((r) => r.type === 'submission' && r.questId === questId && !gone.has(r.id))
    .sort((a, b) => a.createdAt - b.createdAt);
}
export function submissionsOfTrip(tripId) {
  const gone = retractedIds();
  return list().filter((r) => r.type === 'submission' && r.tripId === tripId && !gone.has(r.id))
    .sort((a, b) => (a.takenAt || a.createdAt) - (b.takenAt || b.createdAt));
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

// ---------- 匯出用：全部存活記錄 ----------
export function exportRecords() {
  return list();
}

// ---------- 同步用 ----------
// 有設定同步祕鑰的群組
export function syncedGroups() {
  return list().filter((r) => r.type === 'group' && r.syncSecret && !r.deleted);
}

// 某個群組相關的所有記錄（含墓碑，要送出去）
export function exportGroup(groupId) {
  const tripIds = new Set(list().filter((r) => r.type === 'trip' && r.groupId === groupId).map((r) => r.id));
  return list().filter((r) => {
    if (r.id === groupId) return true;
    if (r.groupId === groupId) return true;           // member
    if (r.tripId && tripIds.has(r.tripId)) return true; // spot / quest / submission / reaction / comment
    return false;
  });
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
  for (const inc of incoming) {
    const cur = state.byId.get(inc.id);
    if (!cur) { state.byId.set(inc.id, inc); continue; }
    if (!merge) { state.byId.set(inc.id, inc); continue; }
    // append-only：已存在就跳過
    if (['submission', 'reaction', 'comment', 'retraction', 'memberClaim'].includes(inc.type)) continue;
    // 後寫入者勝，deviceId 決勝
    const incWins = (inc.updatedAt || 0) > (cur.updatedAt || 0) ||
      ((inc.updatedAt || 0) === (cur.updatedAt || 0) && String(inc.deviceId) > String(cur.deviceId));
    if (incWins) state.byId.set(inc.id, inc);
  }
  await db.putRecords([...state.byId.values()]);
  emit();
}
