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
// 回傳 { totals: {byMember, grand}, balances: {memberId: net}, transfers: [{from,to,amount}], missingRate:bool,
//        count（全部筆數）, counted（有算進合計與結清的筆數）, unconverted: [{code, total, count}] }
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
// v1.74.2 拆出來時與原本逐字相同；之後的修正見 docs/SPEC_分帳金額守恆.md（R1–R5）。
export function settleCore({ expenses, baseCurrency, ratesObj }) {
  const balances = {};   // memberId -> net（正 = 別人欠他）
  let grand = 0;
  const byMember = {};   // memberId -> 他付出去的總額（base）
  let missingRate = false;
  let counted = 0;
  const unconv = new Map();   // 幣別 -> { code, total（原幣別）, count }

  // 查得到匯率才會走到這裡（下面先整筆檢查過），所以沒有「查不到就回原值」這條路。
  // v1.74.3 以前查不到時回原值：日圓被當成台幣加進合計（SPEC_分帳金額守恆 D1）。
  const toBase = (amt, cur) => (cur === baseCurrency ? amt : convert(amt, cur, baseCurrency, ratesObj));

  for (const e of expenses) {
    // R1：查不到匯率的花費整筆不算——不進合計、不進誰付了多少、也不動淨額（付款與分攤兩邊都
    // 不算，所以守恆不受影響）。另外依幣別加總原幣別金額，讓畫面講得出有多少錢沒算進去。
    if (e.currency !== baseCurrency && convert(e.amount, e.currency, baseCurrency, ratesObj) == null) {
      missingRate = true;
      const u = unconv.get(e.currency) || { code: e.currency, total: 0, count: 0 };
      u.total += Number(e.amount) || 0;
      u.count++;
      unconv.set(e.currency, u);
      continue;
    }
    counted++;
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
  const unconverted = [...unconv.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { totals: { grand, byMember }, balances, transfers, missingRate, count: expenses.length, counted, unconverted };
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
