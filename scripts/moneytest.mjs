// 算錢的測試（npm run moneytest；純 Node，不開瀏覽器）。
//
// 這之前**沒有任何一條斷言在驗金額**：全 repo 沒有一支測試提到 fmtMoney、匯率換算、
// 結清。改到 `js/expenses.js`／`js/fx.js` 會跑全套，但那是「沒人認領所以保守全跑」，
// 不是守護 —— 沒有人在看錢算得對不對。
//
// **期望值一律手算**，算式寫在每一段的註解裡；不准把程式的輸出貼回來當期望值。
// 畫面那一半在 settletest.mjs（真實入口：行程頁 → 分帳分頁 → 結清方案）。
//
// v1.74.2 盤點到的五個缺陷（`docs/SPEC_算錢的測試.md` §6 的 D1–D5）當時只留註解、不寫斷言
// （不把 bug 釘死成規格）；v1.74.4–v1.74.6 依 `docs/SPEC_分帳金額守恆.md` 修掉，斷言在 T1–T9。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, extra) => { console.log('✗ ' + m + (extra ? '\n   ' + extra : '')); process.exitCode = 1; };
const yes = (c, m, extra) => (c ? ok(m) : fail(m, extra));
const eq = (got, want, m) => (got === want ? ok(`${m}（${JSON.stringify(got)}）`) : fail(m, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
const near = (got, want, m, tol = 1e-9) => (Math.abs(got - want) <= tol ? ok(`${m}（${got}）`) : fail(m, `got=${got} want=${want}`));

// App 的程式是瀏覽器用的：fetch 相對路徑 → 讀檔；localStorage → 記憶體
globalThis.fetch = async (u) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, String(u).replace(/^\.\//, '')), 'utf8')) });
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const fx = await imp('js/fx.js');
const ex = await imp('js/expenses.js');
const places = await imp('js/places.js');
const CUR = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/currencies.json'), 'utf8'));

// 手寫的匯率表（USD 為基準，跟 open.er-api.com 的形狀一樣）
const RATES = { base: 'USD', rates: { USD: 1, TWD: 32, JPY: 160, EUR: 0.8 } };

// ---------- M1／M2 匯率換算 ----------
console.log('\n— M1／M2 convert —');
yes(RATES.rates.TWD > 0 && RATES.rates.JPY > 0, '前置：測試用的匯率表兩個幣別都有');
// 手算：100 TWD → USD = 100 / 32 = 3.125 → JPY = 3.125 × 160 = 500
near(fx.convert(100, 'TWD', 'JPY', RATES), 500, '100 TWD → JPY ＝ 100 / 32 × 160 ＝ 500');
// 手算：4000 JPY → USD = 25 → TWD = 25 × 32 = 800
near(fx.convert(4000, 'JPY', 'TWD', RATES), 800, '4000 JPY → TWD ＝ 4000 / 160 × 32 ＝ 800');
// 手算：USD 本身就是基準 → 50 USD → TWD = 50 × 32 = 1600
near(fx.convert(50, 'USD', 'TWD', RATES), 1600, '50 USD → TWD ＝ 50 × 32 ＝ 1600');
near(fx.convert(1600, 'TWD', 'USD', RATES), 50, '1600 TWD → USD ＝ 1600 / 32 ＝ 50');
eq(fx.convert(123.45, 'TWD', 'TWD', RATES), 123.45, '同幣別回原值');
// 來回換算要回得來（浮點容差）
near(fx.convert(fx.convert(777, 'TWD', 'JPY', RATES), 'JPY', 'TWD', RATES), 777, 'TWD → JPY → TWD 回得到原值', 1e-9);
eq(fx.convert(100, 'TWD', 'JPY', null), null, '沒有匯率表 → null（不是 0、不是原值）');
eq(fx.convert(100, 'TWD', 'JPY', { base: 'USD' }), null, 'rates 缺欄位 → null');
eq(fx.convert(100, 'XXX', 'TWD', RATES), null, '未知幣別（來源）→ null');
eq(fx.convert(100, 'TWD', 'XXX', RATES), null, '未知幣別（目標）→ null');
yes(!Number.isNaN(fx.convert(100, 'XXX', 'TWD', RATES)), '缺值不是 NaN');
eq(fx.convert(0, 'TWD', 'JPY', RATES), 0, '金額 0 → 0');

// ---------- M3 顯示格式 ----------
console.log('\n— M3 fmtMoney —');
const ZERO = (CUR.list || []).filter((c) => c.zero).map((c) => c.code);
yes(ZERO.length > 0, `前置：currencies.json 裡零小數的幣別有 ${ZERO.length} 個（${ZERO.join('、')}）`);
await fx.loadCurrencies();
eq(fx.fmtMoney(1234.567, 'TWD'), 'NT$1,234.57', 'TWD：兩位小數、有千分位、四捨五入');
eq(fx.fmtMoney(0, 'TWD'), 'NT$0.00', 'TWD：0 顯示 0.00');
// 負數：驗語意（負號沒被吃掉、數字對），不貼死符號與負號的前後位置 ——
// 實際輸出是 `NT$-250.00`，而畫面上根本不會走到這條路（應收／應付先取正值再格式化）。
{
  const neg = fx.fmtMoney(-250, 'TWD');
  yes(neg.includes('-') && neg.includes('250.00') && neg.includes('NT$'),
    `TWD：負數不會被吃掉（${neg}）`, neg);
  yes(!fx.fmtMoney(250, 'TWD').includes('-'), '對照組：正數不會冒出負號');
}
eq(fx.fmtMoney(1234567.891, 'TWD'), 'NT$1,234,567.89', 'TWD：很大的數也有千分位');
for (const code of ZERO) {
  const s = fx.fmtMoney(1234.567, code);
  yes(!s.includes('.'), `${code}：零小數（${s}）`, s);
  eq(fx.fmtMoney(1234.5, code).replace(/[^\d,]/g, ''), '1,235', `${code}：1234.5 進位成 1,235`);
}

// ---------- M4 每個人的分攤 ----------
console.log('\n— M4 sharePerMember —');
{
  const even = ex.sharePerMember({ amount: 100, participants: ['a', 'b', 'c'] });
  yes(Object.keys(even).length === 3, '前置：三個人都在結果裡');
  near(even.a, 100 / 3, '三人均分 100 → 每人 100/3');
  near(even.a + even.b + even.c, 100, '三份加起來還是 100');
  // 手算：權重 1:2，總權重 3 → 90 × 1/3 = 30、90 × 2/3 = 60
  const w = ex.sharePerMember({ amount: 90, participants: ['a', 'b'], shares: { a: 1, b: 2 } });
  eq(w.a, 30, '權重 1:2 分 90 → a 拿 30');
  eq(w.b, 60, '權重 1:2 分 90 → b 拿 60');
  // 只有部分成員參與：沒參與的人不在結果裡
  const part = ex.sharePerMember({ amount: 60, participants: ['a', 'c'] });
  yes(!('b' in part) && part.a === 30 && part.c === 30, '沒參與的人不在結果裡，參與的兩人各 30');
  // 權重只填一個人：總權重 1 → 他全拿
  const one = ex.sharePerMember({ amount: 50, participants: ['a', 'b'], shares: { a: 1, b: 0 } });
  eq(one.a, 50, '權重 1:0 → a 全拿');
  eq(one.b, 0, '權重 1:0 → b 是 0');
}
// v1.74.5 以前這裡是兩個已知缺陷：D2 權重全填 0 → 每人攤 0、總和不等於花費；D3 參與者是空的 →
// 付款人被記全額、沒有人被扣。修法（SPEC_分帳金額守恆 R2、R3）與斷言在下面 T4、T7。

// ---------- T4 份數全是 0：退回平均分（R2）----------
console.log('\n— T4 份數全是 0 —');
// 修正前沒有這個函式；拿不到就回 undefined，讓每一條都跑得到、各自紅（不要一個例外吞掉後面全部）
const fallbackOf = (e) => (typeof ex.sharesFallback === 'function' ? ex.sharesFallback(e) : undefined);
{
  // 手算：600 元 A 付，A、B、C 參與，份數都是 0 → 退回平均分，每人 600 / 3 ＝ 200
  //       A 淨額 ＝ 600 − 200 ＝ +400；B、C 各 −200；總和 0
  const e = { amount: 600, currency: 'TWD', payerId: 'A', participants: ['A', 'B', 'C'], shares: { A: 0, B: 0, C: 0 } };
  const sh = ex.sharePerMember(e);
  yes(sh.A === 200 && sh.B === 200 && sh.C === 200, 'T4 份數全 0 → 每人攤 600 / 3 ＝ 200', JSON.stringify(sh));
  eq(fallbackOf(e), true, 'T4 sharesFallback 講得出這一筆是「份數都是 0，先照平均分」');
  const r = ex.settleCore({ expenses: [e], baseCurrency: 'TWD', ratesObj: RATES });
  near(r.balances.A, 400, 'T4 A 淨額 ＝ 600 − 200 ＝ +400');
  near(r.balances.B, -200, 'T4 B 淨額 −200');
  near(Object.values(r.balances).reduce((a, b) => a + b, 0), 0, 'T4 淨額總和為 0', 0.01);
  // 負數當 0：{A:−1, B:2, C:0} → 有效份數 {0,2,0} → B 全拿 600
  const neg = ex.sharePerMember({ amount: 600, participants: ['A', 'B', 'C'], shares: { A: -1, B: 2, C: 0 } });
  yes(neg.A === 0 && neg.B === 600 && neg.C === 0, 'T4 負的份數當 0：{−1, 2, 0} → B 全拿 600', JSON.stringify(neg));
  // 全部都是負數 → 有效份數全 0 → 平均分
  const allNeg = ex.sharePerMember({ amount: 90, participants: ['A', 'B', 'C'], shares: { A: -1, B: -2, C: -3 } });
  yes(allNeg.A === 30 && allNeg.B === 30 && allNeg.C === 30, 'T4 份數全是負數 → 也退回平均分，各 30', JSON.stringify(allNeg));
  // 對照：份數 1:0 仍是「a 全拿」，而且不算退回平均分
  const one = { amount: 50, participants: ['a', 'b'], shares: { a: 1, b: 0 } };
  const so = ex.sharePerMember(one);
  yes(so.a === 50 && so.b === 0, 'T4 對照：份數 1:0 → a 全拿 50（沒被弄壞）', JSON.stringify(so));
  eq(fallbackOf(one), false, 'T4 對照：份數 1:0 不算「先照平均分」');
  eq(fallbackOf({ amount: 50, participants: ['a', 'b'], shares: null }), false, 'T4 對照：本來就平均分的不算');
}

// ---------- T7 參與者空、付款人空或不在成員裡（R3、R4）----------
console.log('\n— T7 參與者空、付款人空 —');
{
  const MEM = ['A', 'B'];
  // R3 參與者空 → 當成只有付款人自己分：300 元 A 付 → A 付 300、攤 300、淨額 0；合計照算 300
  const r3 = ex.settleCore({ expenses: [{ amount: 300, currency: 'TWD', payerId: 'A', participants: [], shares: null }],
    baseCurrency: 'TWD', ratesObj: RATES, memberIds: MEM });
  near(r3.balances.A || 0, 0, 'T7 參與者空 → 付款人自己分，A 淨額 0（不是 +300）');
  near(r3.totals.grand, 300, 'T7 參與者空 → 合計照算 300');
  near(Object.values(r3.balances).reduce((a, b) => a + b, 0), 0, 'T7 參與者空 → 淨額總和 0', 0.01);
  // 對照：補上參與者 A、B → A +150
  const r3c = ex.settleCore({ expenses: [{ amount: 300, currency: 'TWD', payerId: 'A', participants: ['A', 'B'], shares: null }],
    baseCurrency: 'TWD', ratesObj: RATES, memberIds: MEM });
  near(r3c.balances.A, 150, 'T7 對照：補上參與者 A、B → A 淨額 +150');

  // R4 付款人空 → 整筆不進淨額（沒有人被扣、也沒有人入帳），合計照算，noPayer 計 1
  const r4 = ex.settleCore({ expenses: [{ amount: 300, currency: 'TWD', payerId: '', participants: ['A', 'B'], shares: null }],
    baseCurrency: 'TWD', ratesObj: RATES, memberIds: MEM });
  yes(Object.values(r4.balances).every((v) => Math.abs(v) < 1e-9), 'T7 付款人空 → 沒有任何人被扣', JSON.stringify(r4.balances));
  eq(r4.noPayer, 1, 'T7 付款人空 → noPayer 是 1');
  near(r4.totals.grand, 300, 'T7 付款人空 → 合計照算 300');
  // 付款人不在這個群組的成員裡（例如被移除的旅伴）→ 同上
  const r4b = ex.settleCore({ expenses: [{ amount: 300, currency: 'TWD', payerId: 'Z', participants: ['A', 'B'], shares: null }],
    baseCurrency: 'TWD', ratesObj: RATES, memberIds: MEM });
  yes(Object.values(r4b.balances).every((v) => Math.abs(v) < 1e-9), 'T7 付款人不在成員裡 → 沒有任何人被扣', JSON.stringify(r4b.balances));
  eq(r4b.noPayer, 1, 'T7 付款人不在成員裡 → noPayer 是 1');
  // 對照：付款人是 A → 照常分，noPayer 0
  const r4c = ex.settleCore({ expenses: [{ amount: 300, currency: 'TWD', payerId: 'A', participants: ['A', 'B'], shares: null }],
    baseCurrency: 'TWD', ratesObj: RATES, memberIds: MEM });
  yes(r4c.noPayer === 0 && Math.abs(r4c.balances.B + 150) < 1e-9, 'T7 對照：付款人是 A → B 被扣 150、noPayer 0', JSON.stringify(r4c));
}

// ---------- T8 守恆的總斷言：各種怪資料混在一起 ----------
console.log('\n— T8 守恆：怪資料與正常資料混在一起 —');
{
  const NOJPY = { base: 'USD', rates: { USD: 1, TWD: 32 } };
  const MEM = ['A', 'B', 'C'];
  const mix = [
    { k: '正常', amount: 900, currency: 'TWD', payerId: 'A', participants: ['A', 'B', 'C'], shares: null },
    { k: '正常（除不盡）', amount: 100, currency: 'TWD', payerId: 'B', participants: ['A', 'B', 'C'], shares: null },
    { k: '查不到匯率', amount: 5000, currency: 'JPY', payerId: 'C', participants: ['A', 'C'], shares: null },
    { k: '份數全 0', amount: 600, currency: 'TWD', payerId: 'C', participants: ['A', 'B', 'C'], shares: { A: 0, B: 0, C: 0 } },
    { k: '參與者空', amount: 250, currency: 'TWD', payerId: 'B', participants: [], shares: null },
    { k: '付款人空', amount: 400, currency: 'TWD', payerId: '', participants: ['A', 'B'], shares: null },
    { k: '付款人不在成員裡', amount: 700, currency: 'TWD', payerId: 'Z', participants: ['B', 'C'], shares: null },
  ];
  const kinds = new Set(mix.map((e) => e.k));
  yes(['查不到匯率', '份數全 0', '參與者空', '付款人空', '付款人不在成員裡'].every((k) => kinds.has(k)),
    `前置：每一種怪法至少一筆（${[...kinds].join('、')}）`);
  const r = ex.settleCore({ expenses: mix, baseCurrency: 'TWD', ratesObj: NOJPY, memberIds: MEM });
  const sum = Object.values(r.balances).reduce((a, b) => a + b, 0);
  near(sum, 0, 'T8 淨額總和為 0', 0.01);
  yes(Object.values(r.balances).every((v) => Number.isFinite(v)), 'T8 每個人的淨額都是有限的數（沒有 NaN）', JSON.stringify(r.balances));
  const after = { ...r.balances };
  for (const t of r.transfers) { after[t.from] = (after[t.from] || 0) + t.amount; after[t.to] = (after[t.to] || 0) - t.amount; }
  yes(Object.values(after).every((v) => Math.abs(v) < 0.01), 'T8 照轉帳方案執行完，每個人都歸零', JSON.stringify(after));
  yes(Object.keys(r.balances).every((m) => MEM.includes(m)), 'T8 淨額裡只有這個群組的成員（沒有 Z、沒有空字串）', JSON.stringify(Object.keys(r.balances)));
}

// ---------- T9 除不盡：以最小單位的整數結清（R5，D5）----------
console.log('\n— T9 除不盡的一分錢 —');
{
  // 手算：100 元 A 付，A、B、C 均分 → 未捨入的淨額 A +66.666…、B −33.333…、C −33.333…
  //       換成「分」的整數：四捨五入是 +6667、−3333、−3333，總和 +1 → 差 1 分要照規則分掉，
  //       分完三個人的整數加起來恰好 0；A 的應收恰好等於兩筆轉帳相加。
  const cents = (v) => v * 100;
  const isWhole = (x) => Math.abs(x - Math.round(x)) < 1e-6;
  const exps = [{ amount: 100, currency: 'TWD', payerId: 'A', participants: ['A', 'B', 'C'], shares: null }];
  yes(!isWhole(cents(100 / 3)), '前置：100 / 3 換成分不是整數（這組資料真的除不盡）');
  const r = ex.settleCore({ expenses: exps, baseCurrency: 'TWD', ratesObj: RATES });
  const c = Object.fromEntries(Object.entries(r.balances).map(([m, v]) => [m, cents(v)]));
  yes(Object.values(c).every(isWhole), 'T9 每個人的淨額都是整分', JSON.stringify(c));
  const ci = Object.fromEntries(Object.entries(c).map(([m, v]) => [m, Math.round(v)]));
  eq(Object.values(ci).reduce((a, b) => a + b, 0), 0, 'T9 三個人的淨額（分）加起來恰好 0');
  const tc = r.transfers.map((t) => cents(t.amount));
  yes(tc.length === 2 && tc.every(isWhole), `前置：兩筆轉帳、金額都是整分（${JSON.stringify(tc)}）`);
  eq(tc.reduce((a, b) => a + Math.round(b), 0), ci.A, 'T9 A 的應收（分）恰好等於兩筆轉帳相加');
  yes(['A', 'B', 'C'].every((m) => Math.abs(c[m] - cents(m === 'A' ? 200 / 3 : -100 / 3)) <= 1),
    'T9 每個人跟未捨入的值差不到 1 分', JSON.stringify(c));
  // 確定性：同一組資料跑兩次一樣；參與者的順序換了也一樣
  const r2 = ex.settleCore({ expenses: exps, baseCurrency: 'TWD', ratesObj: RATES });
  const r3 = ex.settleCore({ expenses: [{ ...exps[0], participants: ['C', 'B', 'A'] }], baseCurrency: 'TWD', ratesObj: RATES });
  yes(JSON.stringify(r2.balances) === JSON.stringify(r.balances) && JSON.stringify(r2.transfers) === JSON.stringify(r.transfers),
    'T9 同一組資料跑兩次，淨額與轉帳一模一樣');
  yes(['A', 'B', 'C'].every((m) => r3.balances[m] === r.balances[m]), 'T9 參與者順序換了，誰多一分不變', JSON.stringify({ r: r.balances, r3: r3.balances }));
  // 零小數的基準幣別（日圓）：100 圓三人分 → 整數圓，同樣守恆
  const j = ex.settleCore({ expenses: [{ amount: 100, currency: 'JPY', payerId: 'A', participants: ['A', 'B', 'C'], shares: null }],
    baseCurrency: 'JPY', ratesObj: RATES, decimals: 0 });
  yes(Object.values(j.balances).every((v) => Number.isInteger(v)), 'T9 零小數：每個人的淨額都是整數圓', JSON.stringify(j.balances));
  eq(Object.values(j.balances).reduce((a, b) => a + b, 0), 0, 'T9 零小數：淨額加起來恰好 0');
  eq(j.transfers.reduce((a, t) => a + t.amount, 0), j.balances.A, 'T9 零小數：A 的應收恰好等於轉帳相加');
  yes(j.transfers.every((t) => Number.isInteger(t.amount)), 'T9 零小數：每筆轉帳都是整數圓', JSON.stringify(j.transfers));
  // 淨額 0.40 的一筆：捨入後不是 0 → 有一筆 0.40 的轉帳（不能一邊打平、一邊又要轉）
  const small = ex.settleCore({ expenses: [{ amount: 0.8, currency: 'TWD', payerId: 'A', participants: ['A', 'B'], shares: null }],
    baseCurrency: 'TWD', ratesObj: RATES });
  yes(small.transfers.length === 1 && Math.round(cents(small.transfers[0].amount)) === 40 && Math.round(cents(small.balances.B)) === -40,
    'T9 淨額 0.40：B 應付 0.40、也有一筆 0.40 的轉帳', JSON.stringify(small));
}

// ---------- M5 守恆 ----------
console.log('\n— M5 結清核心：守恆 —');
// 手算（基準 TWD，匯率同上）：
//   e1 900 TWD  A 付   A,B,C 均分      → 每人 300
//   e2 1600 JPY B 付   B,C 均分        → 1600 JPY = 320 TWD，每人 160 TWD
//   e3 600 TWD  C 付   A:C = 1:2       → A 200、C 400
//   付出：A 900、B 320、C 600；分攤：A 500、B 460、C 860
//   淨額：A +400、B −140、C −260（總和 0）
const SET = {
  expenses: [
    { amount: 900, currency: 'TWD', payerId: 'A', participants: ['A', 'B', 'C'], shares: null },
    { amount: 1600, currency: 'JPY', payerId: 'B', participants: ['B', 'C'], shares: null },
    { amount: 600, currency: 'TWD', payerId: 'C', participants: ['A', 'C'], shares: { A: 1, C: 2 } },
  ],
  baseCurrency: 'TWD', ratesObj: RATES,
};
{
  const people = new Set(SET.expenses.flatMap((e) => e.participants.concat(e.payerId)));
  const curs = new Set(SET.expenses.map((e) => e.currency));
  yes(people.size >= 3 && SET.expenses.length >= 3 && curs.size >= 2,
    `前置：${people.size} 個人、${SET.expenses.length} 筆、${curs.size} 種幣別`);
  const r = ex.settleCore(SET);
  near(r.totals.grand, 900 + 320 + 600, '合計 ＝ 900 + 320（1600 JPY）+ 600 ＝ 1820');
  near(r.totals.byMember.A, 900, 'A 付出 900');
  near(r.totals.byMember.B, 320, 'B 付出 320（1600 JPY 換算）');
  near(r.totals.byMember.C, 600, 'C 付出 600');
  near(r.balances.A, 400, 'A 淨額 ＝ 900 − (300 + 200) ＝ +400');
  near(r.balances.B, -140, 'B 淨額 ＝ 320 − (300 + 160) ＝ −140');
  near(r.balances.C, -260, 'C 淨額 ＝ 600 − (300 + 160 + 400) ＝ −260');
  near(Object.values(r.balances).reduce((a, b) => a + b, 0), 0, '每人淨額總和為 0（守恆）', 0.01);
  eq(r.missingRate, false, '匯率都查得到 → missingRate 是 false');
  eq(r.count, 3, '筆數 3');
  // 照轉帳方案執行之後，每個人的淨額都歸零
  const after = { ...r.balances };
  for (const t of r.transfers) { after[t.from] = (after[t.from] || 0) + t.amount; after[t.to] = (after[t.to] || 0) - t.amount; }
  yes(Object.values(after).every((v) => Math.abs(v) < 0.01), '照轉帳方案執行完，每個人的淨額都歸零', JSON.stringify(after));
}

// ---------- M6 轉帳方案：只驗語意 ----------
console.log('\n— M6 minTransfers（只驗語意，不貼死筆數）—');
{
  const r = ex.settleCore(SET);
  const n = new Set(Object.keys(r.balances)).size;
  yes(r.transfers.length > 0, `前置：這組資料有 ${r.transfers.length} 筆轉帳、${n} 個人`);
  yes(r.transfers.every((t) => t.amount > 0), '每一筆轉帳的金額都大於 0');
  yes(r.transfers.every((t) => t.from !== t.to), '沒有人付給自己');
  const payers = new Set(r.transfers.map((t) => t.from));
  const payees = new Set(r.transfers.map((t) => t.to));
  yes([...payers].every((p) => !payees.has(p)), '沒有人同時是付款方與收款方', `付款方 ${[...payers]} 收款方 ${[...payees]}`);
  const sum = r.transfers.reduce((a, t) => a + t.amount, 0);
  const debt = Object.values(r.balances).filter((v) => v < 0).reduce((a, v) => a - v, 0);
  near(sum, debt, '轉帳總額 ＝ 所有債務的總和', 0.01);
  yes(r.transfers.length <= n - 1, `筆數 ${r.transfers.length} ≤ 人數 − 1（${n - 1}）`);
  // 對照組：已經兩兩相抵 → 0 筆
  const zero = ex.settleCore({
    expenses: [
      { amount: 100, currency: 'TWD', payerId: 'A', participants: ['A'], shares: null },
      { amount: 100, currency: 'TWD', payerId: 'B', participants: ['B'], shares: null },
    ],
    baseCurrency: 'TWD', ratesObj: RATES,
  });
  eq(zero.transfers.length, 0, '對照組：各付各的（淨額都 0）→ 0 筆轉帳');
  // 一個人付、四個人分 → 三筆（≤ 人數 − 1），而且每筆都付給他
  const four = ex.settleCore({
    expenses: [{ amount: 400, currency: 'TWD', payerId: 'A', participants: ['A', 'B', 'C', 'D'], shares: null }],
    baseCurrency: 'TWD', ratesObj: RATES,
  });
  yes(four.transfers.length === 3 && four.transfers.every((t) => t.to === 'A'),
    `一人付四人分 → ${four.transfers.length} 筆、都付給 A`, JSON.stringify(four.transfers));
  near(four.transfers.reduce((a, t) => a + t.amount, 0), 300, '那三筆加起來 ＝ 400 × 3/4 ＝ 300', 0.01);
}

// ---------- 查不到匯率：旗標要誠實（唯一可以斷言的已知缺陷相關行為）----------
console.log('\n— 查不到匯率 —');
{
  const r = ex.settleCore({
    expenses: [{ amount: 12000, currency: 'JPY', payerId: 'A', participants: ['A', 'B'], shares: null }],
    baseCurrency: 'TWD', ratesObj: { base: 'USD', rates: { TWD: 32 } },   // 沒有 JPY
  });
  eq(r.missingRate, true, '查不到那個幣別的匯率 → missingRate 是 true');
  // v1.74.3 以前這裡是已知缺陷 D1：toBase() 查不到就回原值，12000 日圓被當成 12000 台幣加進合計。
  // 修法（SPEC_分帳金額守恆 R1）：整筆不進合計與結清，另外回傳 unconverted。斷言在下面 T1。
}

// ---------- T1 查不到匯率的花費整筆不算（SPEC_分帳金額守恆 R1）----------
console.log('\n— T1 查不到匯率：整筆不進合計與結清、另列 —');
{
  // 手算（基準 TWD，匯率表**沒有 JPY**）：
  //   t1 300 TWD   A 付  A,B 均分 → 各 150
  //   t2 100 TWD   B 付  A,B 均分 → 各 50
  //   j1 8000 JPY  A 付  A,B      → 查不到，整筆不算
  //   j2 4000 JPY  B 付  A,B      → 查不到，整筆不算
  //   合計 ＝ 300 + 100 ＝ 400；A 付出 300、B 付出 100
  //   淨額：A ＝ 300 − (150 + 50) ＝ +100；B ＝ 100 − (150 + 50) ＝ −100
  //   未換算：JPY 8000 + 4000 ＝ 12000，2 筆
  const NOJPY = { base: 'USD', rates: { USD: 1, TWD: 32 } };
  const exps = [
    { amount: 300, currency: 'TWD', payerId: 'A', participants: ['A', 'B'], shares: null },
    { amount: 8000, currency: 'JPY', payerId: 'A', participants: ['A', 'B'], shares: null },
    { amount: 100, currency: 'TWD', payerId: 'B', participants: ['A', 'B'], shares: null },
    { amount: 4000, currency: 'JPY', payerId: 'B', participants: ['A', 'B'], shares: null },
  ];
  yes(fx.convert(8000, 'JPY', 'TWD', NOJPY) === null, '前置：這張匯率表真的換不了 JPY');
  const r = ex.settleCore({ expenses: exps, baseCurrency: 'TWD', ratesObj: NOJPY });
  near(r.totals.grand, 300 + 100, 'T1 合計只含兩筆台幣 ＝ 300 + 100 ＝ 400');
  near(r.totals.byMember.A, 300, 'T1 A 付出只算台幣那筆 300');
  near(r.totals.byMember.B, 100, 'T1 B 付出只算台幣那筆 100');
  near(r.balances.A, 100, 'T1 A 淨額 ＝ 300 − 200 ＝ +100');
  near(r.balances.B, -100, 'T1 B 淨額 ＝ 100 − 200 ＝ −100');
  near(Object.values(r.balances).reduce((a, b) => a + b, 0), 0, 'T1 淨額總和為 0（守恆）', 0.01);
  yes(Array.isArray(r.unconverted) && r.unconverted.length === 1, `T1 unconverted 恰好一組（${JSON.stringify(r.unconverted)}）`);
  const u = (r.unconverted || [])[0] || {};
  eq(u.code, 'JPY', 'T1 那一組是 JPY');
  eq(u.total, 8000 + 4000, 'T1 原幣別加總 ＝ 8000 + 4000 ＝ 12000');
  eq(u.count, 2, 'T1 筆數 2');
  eq(r.missingRate, true, 'T1 missingRate 為 true');
  eq(r.count, 4, 'T1 count 仍是全部 4 筆');
  eq(r.counted, 2, 'T1 有算進去的是 2 筆');
  // 兩種查不到的幣別：順序穩定（照幣別代碼）
  const two = ex.settleCore({ expenses: [
    { amount: 5, currency: 'KRW', payerId: 'A', participants: ['A'], shares: null },
    ...exps,
  ], baseCurrency: 'TWD', ratesObj: NOJPY });
  eq((two.unconverted || []).map((x) => x.code).join(), 'JPY,KRW', 'T1 兩種查不到的幣別照代碼排序（JPY、KRW）');
  // 沒有匯率表（第一次開、離線）：外幣整筆不算，基準幣別照算
  const none = ex.settleCore({ expenses: exps, baseCurrency: 'TWD', ratesObj: null });
  near(none.totals.grand, 400, 'T1 匯率表是 null → 合計仍只含台幣 400');
  // 對照組：同一組資料、匯率表有 JPY → 沒有未換算、合計含四筆
  //   8000 JPY ＝ 8000 / 160 × 32 ＝ 1600；4000 JPY ＝ 800 → 合計 300 + 1600 + 100 + 800 ＝ 2800
  const full = ex.settleCore({ expenses: exps, baseCurrency: 'TWD', ratesObj: RATES });
  eq((full.unconverted || []).length, 0, 'T1 對照：匯率查得到 → unconverted 是空的');
  near(full.totals.grand, 300 + 1600 + 100 + 800, 'T1 對照：合計含四筆 ＝ 2800', 1e-9);
  eq(full.counted, 4, 'T1 對照：四筆都算進去');
}

// ---------- M7 getRates 的快取 ----------
console.log('\n— M7 getRates 快取 —');
{
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  let calls = 0;
  const serve = (payload, ok = true) => { globalThis.fetch = async () => { calls++; return { ok, status: ok ? 200 : 500, json: async () => payload }; }; };
  const PAYLOAD = { result: 'success', rates: { TWD: 32, JPY: 160 }, time_last_update_utc: 'Mon, 21 Sep 2026 00:00:00 +0000' };
  mem.delete('tripquest.fx');
  serve(PAYLOAD);
  const first = await fx.getRates();
  eq(calls, 1, '第一次：沒有快取 → 真的去抓');
  eq(first.stale, false, '第一次：不是 stale');
  near(first.rates.TWD, 32, '拿到的匯率就是伺服器給的');
  const second = await fx.getRates();
  eq(calls, 1, '12 小時內再要一次 → 不重抓（還是 1 次）');
  eq(second.stale, false, '快取命中：不標 stale');
  // 時間往前跳 13 小時 → 應該重抓
  const t0 = realNow();
  Date.now = () => t0 + 13 * 3600000;
  const third = await fx.getRates();
  eq(calls, 2, '超過 12 小時 → 重抓（2 次）');
  // 重抓失敗 → 回舊值並標 stale
  Date.now = () => t0 + 26 * 3600000;
  globalThis.fetch = async () => { calls++; throw new Error('斷網'); };
  const fourth = await fx.getRates();
  eq(calls, 3, '過期又抓失敗：有試著抓（3 次）');
  eq(fourth.stale, true, '抓失敗 → 回舊值並標 stale（畫面才講得出「離線快取」）');
  near(fourth.rates.TWD, 32, '舊值本身還在');
  // 沒有快取又抓失敗 → null（畫面要能分辨「沒有匯率」與「舊匯率」）
  mem.delete('tripquest.fx');
  const fifth = await fx.getRates();
  eq(fifth, null, '沒有快取又抓不到 → null');
  Date.now = realNow;
  globalThis.fetch = realFetch;
}

// ---------- M8 places：錯誤對映與計費守衛 ----------
console.log('\n— M8 places —');
{
  const realFetch = globalThis.fetch;
  const resp = (status, body) => { globalThis.fetch = async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }); };
  resp(403, {});
  eq((await places.nearbyParkingGoogle(25, 121, 'k')).reason, 'key', '403 → key（金鑰被拒）');
  resp(429, {});
  eq((await places.nearbyParkingGoogle(25, 121, 'k')).reason, 'quota', '429 → quota');
  resp(400, {});
  eq((await places.nearbyParkingGoogle(25, 121, 'k')).reason, 'bad', '400 → bad');
  resp(500, {});
  eq((await places.nearbyParkingGoogle(25, 121, 'k')).reason, 'http500', '500 → http500');
  globalThis.fetch = async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; };
  eq((await places.nearbyParkingGoogle(25, 121, 'k')).reason, 'timeout', '逾時 → timeout');
  globalThis.fetch = async () => { throw new Error('連不上'); };
  eq((await places.nearbyParkingGoogle(25, 121, 'k')).reason, 'network', '連不上 → network');
  globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => { throw new Error('不是 JSON'); } });
  eq((await places.nearbyParkingGoogle(25, 121, 'k')).reason, 'parse', '回應不是 JSON → parse');
  for (const [r, want] of [['key', '金鑰'], ['quota', '太頻繁'], ['network', '沒有網路'], ['timeout', '12 秒'], ['bad', 'Places API']]) {
    yes(places.placesErr(r).includes(want), `錯誤訊息講得出原因：${r} → 「${places.placesErr(r).slice(0, 18)}…」`);
  }
  yes(places.placesErr('zzz').includes('zzz'), '沒見過的原因也照實寫出來，不吞掉');

  // 對照組：正常回應照常解析（歇業、沒座標的不列）
  resp(200, { places: [
    { id: 'a', displayName: { text: '第一停車場' }, location: { latitude: 25.1, longitude: 121.5 }, shortFormattedAddress: '北市' },
    { id: 'b', displayName: { text: '歇業場' }, location: { latitude: 25.2, longitude: 121.5 }, businessStatus: 'CLOSED_PERMANENTLY' },
    { id: 'c', displayName: { text: '沒座標' }, location: {} },
  ] });
  const okRes = await places.nearbyParkingGoogle(25, 121, 'k');
  yes(okRes.ok && okRes.results.length === 1 && okRes.results[0].name === '第一停車場',
    `對照組：正常回應解析得出來，歇業與沒座標的不列（${okRes.results.length} 筆）`, JSON.stringify(okRes));
  yes(okRes.results[0].src === 'google', '每一筆標明出處是 google（條款要求）');

  // **計費守衛**：FieldMask 只要 Essentials/Pro 欄位。
  // 加上 rating／userRatingCount 會把整個請求升到 Enterprise 級（貴很多）——這是會花錢的。
  let sent = null;
  globalThis.fetch = async (u, o) => { sent = { u, o }; return { status: 200, ok: true, json: async () => ({ places: [] }) }; };
  await places.nearbyParkingGoogle(25, 121, 'KEY');
  const mask = sent.o.headers['X-Goog-FieldMask'];
  yes(!!mask, `前置：請求真的帶了 FieldMask（${mask}）`);
  for (const bad of ['rating', 'userRatingCount', 'reviews', 'priceLevel']) {
    yes(!mask.includes(bad), `FieldMask 不含 ${bad}（含了會升到最貴的計費級）`);
  }
  const allowed = ['places.id', 'places.displayName', 'places.location', 'places.businessStatus', 'places.shortFormattedAddress'];
  yes(mask.split(',').every((f) => allowed.includes(f.trim())),
    `FieldMask 只含宣告過的那幾個欄位（${mask.split(',').length} 個）`, mask);
  const body = JSON.parse(sent.o.body);
  yes(body.includedTypes.length === 1 && body.includedTypes[0] === 'parking', '只查停車場這一種類型');
  yes(sent.o.headers['X-Goog-Api-Key'] === 'KEY', '金鑰放在標頭、不在網址（不會進伺服器記錄）');
  yes(!String(sent.u).includes('KEY'), '網址裡沒有金鑰');
  globalThis.fetch = realFetch;
}

console.log(`\n${process.exitCode ? '✗ 有失敗' : '✓ 全部通過'}（${pass} 項）`);
