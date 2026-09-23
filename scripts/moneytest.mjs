// 算錢的測試（npm run moneytest；純 Node，不開瀏覽器）。
//
// 這之前**沒有任何一條斷言在驗金額**：全 repo 沒有一支測試提到 fmtMoney、匯率換算、
// 結清。改到 `js/expenses.js`／`js/fx.js` 會跑全套，但那是「沒人認領所以保守全跑」，
// 不是守護 —— 沒有人在看錢算得對不對。
//
// **期望值一律手算**，算式寫在每一段的註解裡；不准把程式的輸出貼回來當期望值。
// 畫面那一半在 settletest.mjs（真實入口：行程頁 → 分帳分頁 → 結清方案）。
//
// 已知缺陷**不寫斷言**（不把 bug 釘死成規格）：見下面標「已知缺陷」的註解與
// `docs/SPEC_算錢的測試.md` §6。唯一的例外是「查不到匯率時 missingRate 為 true」——
// 那個旗標本身是對的行為。

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
// 已知缺陷（不寫斷言）：
//  · D2 權重全填 0 → total 退回 1，每人攤 0，總和不等於花費金額（實測：表單存得進去）
//  · D3 參與者是空的 → 回 {}，付款人被記全額、沒有人被扣（表單擋得住）
//  修正時在這裡補斷言，見 docs/SPEC_算錢的測試.md §6。

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
