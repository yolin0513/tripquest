// 分帳 —— 記帳 + 結清（最少轉帳次數）。資料跟著群組同步。

import * as store from './store.js';
import { uuid } from './ids.js';
import { convert, currencyInfo } from './fx.js';

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

// 份數：負數與非數字一律當 0（v1.74.5 以前 {−1, 2, 0} 會讓總份數變 1、B 攤到兩倍的錢）
const weightOf = (e, m) => Math.max(0, Number(e.shares[m]) || 0);

// 這一筆選了自訂比例、但參與的人份數加起來 ≤ 0 → sharePerMember 退回平均分。
// 這是替使用者補了一個他沒填的東西，所以明細要講出來（R2）。
export function sharesFallback(e) {
  const parts = e.participants || [];
  if (!parts.length || !e.shares || !Object.keys(e.shares).length) return false;
  return parts.reduce((s, m) => s + weightOf(e, m), 0) <= 0;
}

// 每個人的分攤額（該筆花費、原幣別）
export function sharePerMember(e) {
  const parts = e.participants && e.participants.length ? e.participants : [];
  // R3：參與者是空的 → 當成只有付款人自己分（表單擋得住，這是給同步來的舊資料的防線；
  // v1.74.5 以前回 {}，付款人被記全額應收、沒有任何人被扣）
  if (!parts.length) return e.payerId ? { [e.payerId]: e.amount } : {};
  const out = {};
  if (e.shares && Object.keys(e.shares).length && !sharesFallback(e)) {
    const total = parts.reduce((s, m) => s + weightOf(e, m), 0);
    for (const m of parts) out[m] = e.amount * weightOf(e, m) / total;
  } else {
    // 本來就平均分；或 R2：份數全是 0 → 退回平均分（v1.74.5 以前每人攤 0，那筆錢沒有人分攤）
    const per = e.amount / parts.length;
    for (const m of parts) out[m] = per;
  }
  return out;
}

// 整趟結算。baseCurrency = 顯示幣別。ratesObj 來自 fx.getRates()。
// 回傳 { totals: {byMember, grand}, balances: {memberId: net}, transfers: [{from,to,amount}], missingRate:bool,
//        count（全部筆數）, counted（有算進合計的筆數）, unconverted: [{code, total, count}],
//        noPayer（算進合計、但沒有付款人所以沒進結清的筆數）}
//
// 這一層只負責「去 store 拿這趟的花費」，算錢的部分全在 settleCore()。
// 拆開的理由（v1.74，只是搬家、一個運算都沒改）：`store` 讀 IndexedDB，
// 在 Node 裡 import 得進來但一碰就丟 `indexedDB is not defined`，所以金額的邊界情況
// （除不盡、查不到匯率、權重、轉帳收斂）沒辦法用便宜的純 Node 測試驗，
// 只能每一種都開一次瀏覽器。核心拆出來之後，moneytest 直接餵花費清單就能驗。
export function settleTrip(tripId, baseCurrency, ratesObj) {
  const trip = store.get(tripId);
  const memberIds = trip ? store.membersOf(trip.groupId).map((m) => m.id) : null;
  // 結清的最小單位：零小數的幣別（日圓、韓元…）是 1 圓，其他是 0.01（R5）
  const decimals = currencyInfo(baseCurrency).zero ? 0 : 2;
  return settleCore({ expenses: tripExpenses(tripId), baseCurrency, ratesObj, memberIds, decimals });
}

// 純計算：吃進花費清單、基準幣別、匯率表，不碰 store／fetch／DOM。
// v1.74.2 拆出來時與原本逐字相同；之後的修正見 docs/SPEC_分帳金額守恆.md（R1–R5）。
// memberIds（可省略）：這個群組現在的成員；付款人不在裡面的花費當成「沒有付款人」（R4）。
// decimals：基準幣別的小數位（預設 2）。回傳的 balances 與 transfers 都是捨入到這個單位之後的值。
export function settleCore({ expenses, baseCurrency, ratesObj, memberIds = null, decimals = 2 }) {
  const balances = {};   // memberId -> net（正 = 別人欠他）
  let grand = 0;
  const byMember = {};   // memberId -> 他付出去的總額（base）
  let missingRate = false;
  let counted = 0;
  let noPayer = 0;
  const isMember = memberIds ? new Set(memberIds) : null;
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
    // R4：沒有付款人、或付款人已不在這個群組 → 整筆不進淨額（不扣任何人、也沒有人入帳），
    // 合計照算、另外計數讓畫面講出來。v1.74.5 以前只保護入帳那一半：分攤照扣、沒有人收。
    if (!e.payerId || (isMember && !isMember.has(e.payerId))) { noPayer++; continue; }
    balances[e.payerId] = (balances[e.payerId] || 0) + amtBase;
    byMember[e.payerId] = (byMember[e.payerId] || 0) + amtBase;
    const shares = sharePerMember(e);
    for (const [m, s] of Object.entries(shares)) {
      balances[m] = (balances[m] || 0) - toBase(s, e.currency);
    }
  }

  // R5：以基準幣別的最小單位做整數運算。畫面上每個人的應收／應付與結清方案每一筆，
  // 都是同一組整數換出來的，加起來一定相等。v1.74.6 以前金額到顯示那一刻才各自四捨五入：
  // 三人分 100 → 應收 66.67、但兩筆轉帳 33.33 ＋ 33.33 ＝ 66.66。
  const unit = 10 ** decimals;
  const units = toUnits(balances, unit);
  const transfers = minTransfers(units).map((t) => ({ ...t, amount: t.amount / unit }));
  const rounded = Object.fromEntries(Object.entries(units).map(([m, v]) => [m, v / unit]));
  const unconverted = [...unconv.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { totals: { grand, byMember }, balances: rounded, transfers, missingRate, count: expenses.length, counted, unconverted, noPayer };
}

// 每人淨額 → 最小單位的整數，而且總和恰好 0。
// 先各自四捨五入；總和不是 0 時，把差的那幾個單位一個一個分掉：
// 未捨入淨額的絕對值最大的人先、同值比 id 字串（確定性：同一組資料永遠同一個人多那一分）。
function toUnits(balances, unit) {
  const out = {};
  for (const [m, v] of Object.entries(balances)) out[m] = Math.round(v * unit);
  let diff = Object.values(out).reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    const order = Object.keys(balances).sort((a, b) => (Math.abs(balances[b]) - Math.abs(balances[a])) || (a < b ? -1 : a > b ? 1 : 0));
    const step = diff > 0 ? -1 : 1;
    for (let k = 0; diff !== 0 && order.length; k++) {
      out[order[k % order.length]] += step;
      diff += step;
    }
  }
  return out;
}

// 貪婪法：最大債權人 <-> 最大債務人，逼近最少轉帳次數。吃的是最小單位的整數，門檻是「不等於 0」。
function minTransfers(units) {
  const cred = [], debt = [];
  for (const [m, v] of Object.entries(units)) {
    if (v > 0) cred.push({ m, v });
    else if (v < 0) debt.push({ m, v: -v });
  }
  cred.sort((a, b) => b.v - a.v);
  debt.sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const pay = Math.min(debt[i].v, cred[j].v);
    out.push({ from: debt[i].m, to: cred[j].m, amount: pay });
    debt[i].v -= pay; cred[j].v -= pay;
    if (debt[i].v === 0) i++;
    if (cred[j].v === 0) j++;
  }
  return out;
}
