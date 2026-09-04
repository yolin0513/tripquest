// 當地緊急電話（依國家）+ 我的緊急聯絡人（本機）。

import * as db from './db.js';

let _data = null;
export async function loadEmergency() {
  if (!_data) {
    try { _data = await fetch('./data/emergency.json').then((r) => r.json()); }
    catch { _data = { generic: { all: '112' }, countries: {} }; }
  }
  return _data;
}

// countryCode: ISO-2（例 'JP'）。回傳該國號碼物件 + 名稱；找不到給 generic。
export function emergencyFor(code) {
  const D = _data || { generic: { all: '112' }, countries: {} };
  const c = (code || '').toUpperCase();
  const hit = D.countries[c];
  if (hit) return { code: c, ...hit, isGeneric: false };
  return { code: c || '', name: '當地', all: (D.generic && D.generic.all) || '112', isGeneric: true, note: D.generic && D.generic.note };
}

// 從行程推國家：trip.country（建立時存的 hierarchy 國家 id）→ 反查
export function countryOfTrip(trip) {
  if (!trip) return '';
  if (trip.country) return trip.country;
  // 舊行程沒有 country：從 region 名稱猜
  const r = (trip.region || '') + (trip.title || '');
  if (/日本|東京|大阪|京都|北海道|沖繩|福岡|名古屋/.test(r)) return 'JP';
  if (/韓國|首爾|釜山|濟州/.test(r)) return 'KR';
  if (/台|臺|北投|淡水|墾丁|花蓮|台南|高雄/.test(r)) return 'TW';
  return '';
}

// ---- 我的緊急聯絡人（本機，不同步；換手機要重設）----
const KEY = 'emergencyContacts';
export async function getContacts() {
  const v = await db.metaGet(KEY);
  return Array.isArray(v) ? v : [];
}
export async function setContacts(list) {
  await db.metaSet(KEY, list.slice(0, 8));
}
export async function addContact(c) {
  const list = await getContacts();
  list.push({ name: c.name || '', phone: c.phone || '', relation: c.relation || '' });
  await setContacts(list);
  return list;
}
