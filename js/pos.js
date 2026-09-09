// 旅伴位置分享（v1.60）—— 走失時家人找得到人。
//
// 三個 Fable 5.1 代理獨立審查（3:0 GO-with-changes），必修項全部落地：
//
// 1) **墓碑不帶座標**。store.remove() 是 patch({deleted:true})，展開語意會把 lat/lng
//    一起留在墓碑裡 —— 關掉分享之後座標仍躺在 D1 與每台旅伴的手機上，正是長輩
//    「我關掉了啊」最會被背叛的地方。這裡改寫整筆，只留識別欄位。
// 2) **id 帶 deviceId**（pos:<tripId>:<memberId>:<deviceId>）。一個人兩台手機共用
//    一筆會互相覆寫：留在飯店的舊手機每次同步到新位置都覺得「差了三公里」而寫回去，
//    位置來回跳；而且 A 手機關掉、B 手機又蓋回來，「我關掉了」等於沒關。
// 3) **不進 APPEND_ONLY**（伺服器對它是「已存在就跳過」，位置會永遠停在第一筆），
//    也不進 TRACKED（單一寫入者、沒有欄位級衝突）—— 走整筆 updatedAt LWW。
// 4) **單筆推送**。一般的 store.put 會排 enqueuePush → 把整個群組幾百筆記錄推一遍；
//    位置每幾分鐘寫一次的話，行動網路與電池都撐不住。這裡直接送這一筆。
// 5) **會過期**：本機超過 24 小時不顯示也自我清除；伺服器每天把 48 小時以上的
//    改寫成無座標墓碑（見 workers/worker.mjs 的 scheduled）。
// 6) **誠實**：PWA 沒有背景定位，App 沒開就不會更新 —— 這是「最後看到的位置」，
//    不是即時追蹤。介面一律講「最後看到 14:32」，而且 accM 太大時不報公尺數。
//
// 開關存在本機（不同步）：任何人都不能從別的裝置替你打開。

import * as store from './store.js';
import * as db from './db.js';
import { deviceId } from './ids.js';
import { currentPosition, haversine } from './geo.js';
import { activeMemberId } from './claim.js';
import { getConfig, syncEnabled, adapterForGroup } from './sync.js';

const KEY = (tripId) => 'tripquest.poshare.' + tripId;
export const MAX_AGE_MS = 24 * 3600 * 1000;      // 超過就不顯示、也自我清除
const STALE_MS = 30 * 60 * 1000;                 // 超過就標「較舊」
const MIN_GAP_MS = 3 * 60 * 1000;                // 兩次更新至少間隔
const MIN_MOVE_M = 100;                          // 移動不到這個距離就不寫（省流量）
const COARSE = 4;                                // 座標小數位數（約 11 公尺）

export const posId = (tripId, memberId) => `pos:${tripId}:${memberId}:${deviceId()}`;

// ---------- 開關（本機、per-trip、per-device）----------
export function sharing(tripId) {
  try { return localStorage.getItem(KEY(tripId)) === '1'; } catch { return false; }
}
export async function setSharing(tripId, on) {
  try { localStorage.setItem(KEY(tripId), on ? '1' : '0'); } catch { /* noop */ }
  if (on) await updateNow(tripId, { force: true });
  else await stopSharing(tripId);
}

// 關掉：立刻把自己那筆改成「沒有座標的墓碑」並送出去。
// 不用 store.remove（那會保留 lat/lng）。
export async function stopSharing(tripId) {
  const me = activeMemberId(tripId);
  const trip = store.get(tripId);
  if (!trip) return;
  const ids = me ? [posId(tripId, me)] : [];
  // 保險：這台裝置在這個行程留下的任何一筆（換過認領身分也要清乾淨）
  for (const r of store.exportRecords({ all: true })) {
    if (r.type === 'memberPos' && r.tripId === tripId && r.deviceId === deviceId() && !ids.includes(r.id)) ids.push(r.id);
  }
  for (const id of ids) {
    const cur = store.getRaw(id);
    if (!cur || cur.deleted) continue;
    await putPos({ id, type: 'memberPos', tripId, memberId: cur.memberId || me || null, deleted: true });
  }
}

// ---------- 行程期間才分享（前後各留一天緩衝）----------
export function inTripWindow(trip, now = Date.now()) {
  if (!trip) return false;
  const day = 86400000;
  const s = trip.startDate ? Date.parse(trip.startDate + 'T00:00:00') : null;
  const e = trip.endDate ? Date.parse(trip.endDate + 'T23:59:59') : null;
  if (s == null && e == null) return true;                 // 沒設日期的行程：不擋
  if (s != null && now < s - day) return false;
  if (e != null && now > e + day) return false;
  return true;
}

// ---------- 寫入（單筆推送，不觸發整包 push）----------
async function putPos(rec) {
  const next = { ...rec, updatedAt: Date.now(), deviceId: deviceId() };
  if (!next.createdAt) next.createdAt = store.getRaw(rec.id)?.createdAt || Date.now();
  await db.putRecord(next);
  store.mergeLocal([next]);
  pushOne(next).catch(() => { /* 下一次 drain 會補送整包 */ });
  return next;
}

// 只送這一筆。位置每幾分鐘一次，不能每次都把整個群組推上去。
async function pushOne(rec) {
  if (!syncEnabled()) return;
  const trip = store.get(rec.tripId);
  const g = trip && store.getRaw(trip.groupId);
  if (!g || !g.syncSecret) return;
  const adapter = adapterForGroup(g.id, g.syncSecret);
  await adapter.push([rec]);
}

// ---------- 更新自己的位置 ----------
let lastAt = 0;
export async function updateNow(tripId, { force = false, high = false, sos = false } = {}) {
  const trip = store.get(tripId);
  if (!trip || !sharing(tripId) || !inTripWindow(trip)) return null;
  const me = activeMemberId(tripId);
  if (!me) return null;                                     // 還沒說「這是誰的手機」
  const now = Date.now();
  if (!force && now - lastAt < MIN_GAP_MS) return null;
  const pos = await currentPosition({ maxAgeMs: high ? 0 : 120000, high });
  if (!pos) return null;
  lastAt = now;
  const id = posId(tripId, me);
  const cur = store.getRaw(id);
  // 沒怎麼移動就不寫（省流量）—— 只跟「自己上一次寫的」比，不跟別台比
  if (!force && cur && !cur.deleted && cur.lat != null
      && haversine({ lat: cur.lat, lng: cur.lng }, pos) < MIN_MOVE_M
      && now - (cur.at || 0) < 6 * 3600 * 1000) return null;
  return putPos({
    id, type: 'memberPos', tripId, memberId: me,
    lat: +pos.lat.toFixed(COARSE), lng: +pos.lng.toFixed(COARSE),
    accM: Math.round(pos.acc || 0), at: now, sos: !!sos || undefined,
  });
}

// 順風更新：其他功能（SOS、找附近、天氣）拿到位置時順手更新，不另開高頻定位
export async function piggyback(tripId) {
  try { await updateNow(tripId); } catch { /* noop */ }
}

// ---------- 自我過期：超過 24 小時的自己那筆，改成無座標墓碑 ----------
export async function expireMine(tripId) {
  const now = Date.now();
  const trip = store.get(tripId);
  for (const r of store.exportRecords({ all: true })) {
    if (r.type !== 'memberPos' || r.deleted || r.tripId !== tripId) continue;
    if (r.deviceId !== deviceId()) continue;
    const old = now - (r.at || 0) > MAX_AGE_MS;
    const outside = !inTripWindow(trip, now);
    if (old || outside) {
      await putPos({ id: r.id, type: 'memberPos', tripId, memberId: r.memberId || null, deleted: true });
    }
  }
}

// ---------- 讀：某個行程每位旅伴的最新位置 ----------
// 同一個人可能有多台裝置 → 取 at 最新的那筆。超過 24 小時的一律當「沒有分享」。
export function positionsOf(tripId) {
  const now = Date.now();
  const best = new Map();
  for (const r of store.exportRecords({ all: true })) {
    if (r.type !== 'memberPos' || r.deleted || r.tripId !== tripId) continue;
    if (r.lat == null || r.lng == null) continue;
    if (now - (r.at || 0) > MAX_AGE_MS) continue;
    const cur = best.get(r.memberId);
    if (!cur || (r.at || 0) > (cur.at || 0)) best.set(r.memberId, r);
  }
  return best;
}

// 顯示用：距離、精度、時間。誠實原則都在這裡：
// accM 太大（iOS 的「概略位置」可能是幾公里）就不報公尺數。
export function describe(rec, from) {
  const now = Date.now();
  const ageMs = now - (rec.at || 0);
  const coarse = (rec.accM || 0) > 300;
  const dist = from ? Math.round(haversine(from, { lat: rec.lat, lng: rec.lng })) : null;
  return {
    dist, coarse, accM: rec.accM || 0,
    stale: ageMs > STALE_MS,
    sos: !!rec.sos,
    when: new Date(rec.at || now).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }),
    ago: fmtAgo(ageMs),
  };
}

function fmtAgo(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return '剛剛';
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.round(h / 24)} 天前`;
}

export const _internals = { MIN_MOVE_M, MIN_GAP_MS, STALE_MS, COARSE };
void getConfig;
