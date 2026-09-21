// 分帳 —— 記帳 + 結清（最少轉帳次數）。資料跟著群組同步。

import * as store from './store.js';
import { uuid } from './ids.js';
import { convert } from './fx.js';

// store 沒有 expense 選擇器，這裡自己過濾（走 exportRecords 的存活記錄）
export function tripExpenses(tripId) {
  return store.exportRecords()
    .filter((r) => r.type === 'expense' && r.tripId === tripId && !r.deleted)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function saveExpense(e) {
  const rec = {
    id: e.id || uuid(),
    type: 'expense',
    tripId: e.tripId,
    groupId: e.groupId,
    title: (e.title || '').slice(0, 40) || '一筆花費',
    category: e.category || 'other',
    amount: Math.max(0, Number(e.amount) || 0),
    currency: e.currency || 'TWD',
    payerId: e.payerId || '',
    participants: Array.isArray(e.participants) ? e.participants : [],
    shares: e.shares || null,       // { memberId: weight }；null = 平均
    note: (e.note || '').slice(0, 200),
    createdAt: e.createdAt || Date.now(),
  };
  if (e.id && store.get(e.id)) await store.patch(e.id, rec);
  else await store.put(rec);
  return rec;
}

export async function deleteExpense(id) {
  await store.remove(id);
}

const CATEGORIES = [
  { id: 'food', label: '餐飲', emoji: '🍜' },
  { id: 'transport', label: '交通', emoji: '🚆' },
  { id: 'stay', label: '住宿', emoji: '🏨' },
  { id: 'ticket', label: '門票', emoji: '🎟️' },
  { id: 'shopping', label: '購物', emoji: '🛍️' },
  { id: 'other', label: '其他', emoji: '💰' },
];
export { CATEGORIES };
export function categoryOf(id) { return CATEGORIES.find((c) => c.id === id) || CATEGORIES[5]; }

// 每個人的分攤額（該筆花費、原幣別）
export function sharePerMember(e) {
  const parts = e.participants && e.participants.length ? e.participants : [];
  if (!parts.length) return {};
  const out = {};
  if (e.shares && Object.keys(e.shares).length) {
    const total = parts.reduce((s, m) => s + (Number(e.shares[m]) || 0), 0) || 1;
    for (const m of parts) out[m] = e.amount * (Number(e.shares[m]) || 0) / total;
  } else {
    const per = e.amount / parts.length;
    for (const m of parts) out[m] = per;
  }
  return out;
}

// 整趟結算。baseCurrency = 顯示幣別。ratesObj 來自 fx.getRates()。
// 回傳 { totals: {byMember, grand}, balances: {memberId: net}, transfers: [{from,to,amount}], missingRate:bool }
//
// 這一層只負責「去 store 拿這趟的花費」，算錢的部分全在 settleCore()。
// 拆開的理由（v1.74，只是搬家、一個運算都沒改）：`store` 讀 IndexedDB，
// 在 Node 裡 import 得進來但一碰就丟 `indexedDB is not defined`，所以金額的邊界情況
// （除不盡、查不到匯率、權重、轉帳收斂）沒辦法用便宜的純 Node 測試驗，
// 只能每一種都開一次瀏覽器。核心拆出來之後，moneytest 直接餵花費清單就能驗。
export function settleTrip(tripId, baseCurrency, ratesObj) {
  return settleCore({ expenses: tripExpenses(tripId), baseCurrency, ratesObj });
}

// 純計算：吃進花費清單、基準幣別、匯率表，不碰 store／fetch／DOM。
// **與拆出來之前逐字相同**：同樣的 toBase、同樣的 sharePerMember、同樣的 minTransfers、
// 同樣的 eps = 0.01。已知的缺陷（查不到匯率時直接把原幣別金額當基準幣別加總、
// 權重全 0、參與者空、付款人空）在這一版**刻意原樣保留**，修正另有規格。
export function settleCore({ expenses, baseCurrency, ratesObj }) {
  const balances = {};   // memberId -> net（正 = 別人欠他）
  let grand = 0;
  const byMember = {};   // memberId -> 他付出去的總額（base）
  let missingRate = false;

  const toBase = (amt, cur) => {
    if (cur === baseCurrency) return amt;
    const v = convert(amt, cur, baseCurrency, ratesObj);
    if (v == null) { missingRate = true; return amt; }
    return v;
  };

  for (const e of expenses) {
    const amtBase = toBase(e.amount, e.currency);
    grand += amtBase;
    if (e.payerId) {
      balances[e.payerId] = (balances[e.payerId] || 0) + amtBase;
      byMember[e.payerId] = (byMember[e.payerId] || 0) + amtBase;
    }
    const shares = sharePerMember(e);
    for (const [m, s] of Object.entries(shares)) {
      balances[m] = (balances[m] || 0) - toBase(s, e.currency);
    }
  }

  const transfers = minTransfers(balances);
  return { totals: { grand, byMember }, balances, transfers, missingRate, count: expenses.length };
}

// 貪婪法：最大債權人 <-> 最大債務人，逼近最少轉帳次數
function minTransfers(balances) {
  const eps = 0.01;
  const cred = [], debt = [];
  for (const [m, v] of Object.entries(balances)) {
    if (v > eps) cred.push({ m, v });
    else if (v < -eps) debt.push({ m, v: -v });
  }
  cred.sort((a, b) => b.v - a.v);
  debt.sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const pay = Math.min(debt[i].v, cred[j].v);
    out.push({ from: debt[i].m, to: cred[j].m, amount: pay });
    debt[i].v -= pay; cred[j].v -= pay;
    if (debt[i].v < eps) i++;
    if (cred[j].v < eps) j++;
  }
  return out;
}
