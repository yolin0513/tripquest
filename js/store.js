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
  return next;
}

// 中繼資料刪除 = 立墓碑（未來同步時對方才知道「這筆被刪了」）
export async function remove(id) {
  const cur = state.byId.get(id);
  if (!cur) return;
  await patch(id, { deleted: true });
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
  return sub;
}

// 移除一張投稿（例如拍壞了）。投稿本身不可變，所以用一筆「撤回標記」記錄覆蓋顯示層。
// 為了 v1 簡單：直接硬刪投稿記錄 + 清掉沒人用到的 blob。多裝置同步是 v2 才接，屆時改為 retraction 記錄。
export async function deleteSubmission(id) {
  const sub = state.byId.get(id);
  if (!sub || sub.type !== 'submission') return;
  state.byId.delete(id);
  await db.deleteRecordHard(id);
  await gcBlobs([sub.photoHash, sub.thumbHash]);
  emit();
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
  return list().filter((r) => r.type === 'submission' && r.questId === questId)
    .sort((a, b) => a.createdAt - b.createdAt);
}
export function submissionsOfTrip(tripId) {
  return list().filter((r) => r.type === 'submission' && r.tripId === tripId)
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
export async function importRecords(incoming, { merge = true } = {}) {
  for (const inc of incoming) {
    const cur = state.byId.get(inc.id);
    if (!cur) { state.byId.set(inc.id, inc); continue; }
    if (!merge) { state.byId.set(inc.id, inc); continue; }
    if (inc.type === 'submission') continue; // 只新增；已存在就跳過
    // 後寫入者勝，deviceId 決勝
    const incWins = (inc.updatedAt || 0) > (cur.updatedAt || 0) ||
      ((inc.updatedAt || 0) === (cur.updatedAt || 0) && String(inc.deviceId) > String(cur.deviceId));
    if (incWins) state.byId.set(inc.id, inc);
  }
  await db.putRecords([...state.byId.values()]);
  emit();
}
