// 每個行程的 AI 金鑰 —— 只存在建立者這台手機的 IndexedDB `tripSecrets` store。
//
// 絕不同步、絕不進備份、絕不進身分卡、絕不進邀請連結、絕不進 repo。
// 結構性保證：`tripSecrets` 是獨立 object store，所有匯出（exportGroup / exportRecords /
// exportBundle / exportCard）都只讀 `records`，SW 也只快取同源 GET。
// 見 scripts/secret-leak-test.mjs 的斷言。

import * as db from './db.js';

// 金鑰字串樣式（拿來洗白輸出、擋使用者貼錯欄位）
const SK_ANT = /sk-ant-[A-Za-z0-9_-]{20,}/g;
const G_KEY = /AIza[0-9A-Za-z_-]{35}/g;

export function scrubSecrets(s) {
  return String(s == null ? '' : s).replace(SK_ANT, '（金鑰已隱藏）').replace(G_KEY, '（金鑰已隱藏）');
}
export function looksLikeAnthropicKey(s) { return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(String(s || '').trim()); }
export function looksLikeGoogleKey(s) { return /^AIza[0-9A-Za-z_-]{30,}$/.test(String(s || '').trim()); }
export function containsSecret(s) {
  const t = String(s || '');
  return /sk-ant-[A-Za-z0-9_-]{12,}/.test(t) || /AIza[0-9A-Za-z_-]{20,}/.test(t);
}

// 這台手機的預設金鑰。放在同一個 tripSecrets store 的保留 id 底下，
// 這樣「絕不同步、絕不匯出」那些結構性保證（見 secret-leak-test）自動也涵蓋它，
// 不必再開一條新的儲存路徑、也不必再驗證一次。
// 為什麼需要它：匯入行程發生在旅程「還不存在」的時候，沒有 tripId 可以掛金鑰。
export const DEVICE_KEY_ID = '__device__';

export async function getDeviceKey() {
  return (await db.tripSecretGet(DEVICE_KEY_ID)) || null;
}
export async function setDeviceKey(patch) { await setTripKey(DEVICE_KEY_ID, patch); }
export async function clearDeviceKey() { await db.tripSecretDelete(DEVICE_KEY_ID); }

// 旅程建好之後把預設金鑰「複製」一份進去（不是共用）：
// 每趟各自算自己的花費上限，刪掉一趟不會影響別趟。
export async function adoptDeviceKey(tripId) {
  const d = await getDeviceKey();
  if (!d || !d.key) return false;
  const cur = await db.tripSecretGet(tripId);
  if (cur && cur.key) return false;                 // 已經有自己的金鑰就不覆蓋
  await setTripKey(tripId, { key: d.key, mapsKey: d.mapsKey || '',
    capUsd: d.capUsd ?? 2, mapsCap: d.mapsCap ?? MAPS_CAP_DEFAULT });
  return true;
}

export async function getTripKey(tripId) {
  const e = await db.tripSecretGet(tripId);
  if (!e) return null;
  // v1.71 移除了語音（TTS）功能。舊記錄可能還留著那把 ttsKey —— 讀到就順手清掉，
  // 不要讓一把再也用不到的金鑰繼續躺在手機裡。
  if (e.ttsKey) { delete e.ttsKey; await db.tripSecretSet(e); }
  return e;
}
export async function hasTripKey(tripId) {
  const e = await db.tripSecretGet(tripId);
  return !!(e && e.key);
}

// 地圖金鑰（Google Routes API，v1.68）的用量用**次數**算，不用美金：
// 免費額度是「每月幾千次呼叫」，換算成美金永遠顯示 $0，對使用者沒有意義。
// 每月自動歸零（ym = 'YYYY-MM'）。上限存在的理由不是省錢，是「迴圈寫錯一次
// 就可能燒掉整個月的額度」—— 這是保險絲不是預算。
export const MAPS_CAP_DEFAULT = 300;

// patch: { key?, mapsKey?, capUsd?, mapsCap? }
export async function setTripKey(tripId, patch) {
  const cur = (await db.tripSecretGet(tripId)) || { tripId, usedMicroUsd: 0 };
  await db.tripSecretSet({
    ...cur,
    tripId,
    provider: 'anthropic',
    key: patch.key !== undefined ? patch.key : (cur.key || ''),
    mapsKey: patch.mapsKey !== undefined ? patch.mapsKey : (cur.mapsKey || ''),
    capUsd: patch.capUsd !== undefined ? patch.capUsd : (cur.capUsd ?? 2),
    mapsCap: patch.mapsCap !== undefined ? patch.mapsCap : (cur.mapsCap ?? MAPS_CAP_DEFAULT),
    usedMicroUsd: cur.usedMicroUsd || 0,
    at: Date.now(),
  });
}

const ym = () => new Date().toISOString().slice(0, 7);

export async function getMapsKey(tripId) {
  const e = await db.tripSecretGet(tripId);
  return (e && e.mapsKey) || '';
}

// 回 { ok, used, cap }。ok=false 代表這個月用完了 —— 呼叫端要**明講**，不要靜默失敗。
export async function mapsBudget(tripId) {
  const e = await db.tripSecretGet(tripId);
  if (!e) return { ok: false, used: 0, cap: MAPS_CAP_DEFAULT, noKey: true };
  const cap = e.mapsCap ?? MAPS_CAP_DEFAULT;
  const c = e.mapsCalls && e.mapsCalls.ym === ym() ? e.mapsCalls.n : 0;
  return { ok: c < cap, used: c, cap, noKey: !e.mapsKey };
}

export async function addMapsCalls(tripId, n = 1) {
  // v1.73.1：一個交易裡讀完改完寫完，不然並發呼叫會互相蓋掉（見 db.tripSecretUpdate）
  await db.tripSecretUpdate(tripId, (e) => {
    const cur = e.mapsCalls && e.mapsCalls.ym === ym() ? e.mapsCalls.n : 0;
    e.mapsCalls = { ym: ym(), n: cur + Math.max(0, n) };
  });
}

export async function clearTripKey(tripId) { await db.tripSecretDelete(tripId); }
export async function wipeAllTripKeys() { await db.tripSecretClearAll(); }

export async function addUsage(tripId, microUsd) {
  // v1.73.1：同上。相簿頁與海報頁各有一個 Promise.all 兩路並發，
  // 以前其中一次的花費完全不入帳 —— 保險絲會比實際鬆。
  await db.tripSecretUpdate(tripId, (e) => {
    e.usedMicroUsd = (e.usedMicroUsd || 0) + Math.max(0, Math.round(microUsd || 0));
  });
}

export async function usageOf(tripId) {
  const e = await db.tripSecretGet(tripId);
  if (!e) return null;
  const capUsd = e.capUsd ?? 2;
  return {
    usedUsd: (e.usedMicroUsd || 0) / 1e6,
    capUsd,
    overCap: (e.usedMicroUsd || 0) >= capUsd * 1e6,
    hasKey: !!e.key,
    hasMaps: !!e.mapsKey,
    mapsUsed: e.mapsCalls && e.mapsCalls.ym === ym() ? e.mapsCalls.n : 0,
    mapsCap: e.mapsCap ?? MAPS_CAP_DEFAULT,
    maskedKey: e.key ? maskKey(e.key) : '',
  };
}

export function maskKey(k) {
  const s = String(k || '');
  if (s.length < 12) return '••••';
  return s.slice(0, 10) + '…' + s.slice(-4);
}
