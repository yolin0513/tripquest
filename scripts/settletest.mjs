// 分帳結清的真實入口測試（npm run settletest）。
// 涵蓋的程式：js/views/expenses.js （分帳頁與「記一筆」表單）。寫出來是給挑選器認的 ——
// 這支從畫面進去，程式碼裡不會出現那個檔名，不寫的話改分帳頁不會挑中這一支。
//
// 為什麼要有這一支：`js/expenses.js` 與 `js/fx.js` 在這之前**沒有任何一條斷言在驗金額**
// （全 repo 沒有一支測試提到 fmtMoney、匯率、結清）。改到它們會跑全套，但那是「沒人認領
// 所以保守全跑」，不是守護 —— 沒有人在看錢算得對不對。
//
// 這一支走使用者的真實路徑：行程頁底部的「分帳」分頁 → 看結清方案；最後用畫面上的
// 「記一筆花費」表單、真的滑鼠點擊記兩筆（T0／T0b）。**期望值是手算的**，寫在下面的
// 算式裡，不是把程式的輸出貼回來當期望值。
//
// v1.74.2 時表單那段只驗「打得開」：當時「分類」「誰付的」的 chip 一點就跳回第一顆
// （`field()` 把整排按鈕包在 `<label>` 裡），從表單記帳測不出使用者做得到的事。
// v1.74.3 修掉之後改成真的記帳。
//
// 匯率用假的：把 fx 的 localStorage 快取先塞好（12 小時內不重抓），所以不打真網路。

import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const WEB = 5251;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const web = spawn('python', ['-m', 'http.server', String(WEB)], { stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));
const eq = (got, want, m) => (got === want ? ok(`${m}（${got}）`) : fail(m, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });

// ---------- 手算（測試的期望值來源） ----------
// 匯率（USD 為基準）：TWD 32、JPY 160 → 1500 JPY = 1500 / 160 * 32 = 300 TWD
//
// e1 晚餐   900 TWD  阿公付   三人均分     → 每人 300
// e2 門票  1500 JPY  阿嬤付   阿嬤、小美均分 → 每人 750 JPY = 150 TWD
// e3 計程車 600 TWD  小美付   阿公:小美 = 1:2 → 阿公 200、小美 400
//
// 合計 = 900 + 300 + 600 = 1800；每人平均 = 600
// 付出：阿公 900、阿嬤 300、小美 600
// 分攤：阿公 300 + 200 = 500；阿嬤 300 + 150 = 450；小美 300 + 150 + 400 = 850
// 淨額 = 付出 − 分攤：阿公 +400、阿嬤 −150、小美 −250（總和 0）
// 轉帳（貪婪：最大債務人先對最大債權人）：小美→阿公 250、阿嬤→阿公 150
const WANT = {
  grand: 'NT$1,800.00', avg: 'NT$600.00',
  paid: { 阿公: 'NT$900.00', 阿嬤: 'NT$300.00', 小美: 'NT$600.00' },
  net: { 阿公: '應收 NT$400.00', 阿嬤: '應付 NT$150.00', 小美: '應付 NT$250.00' },
  transfers: [['小美', '阿公', 'NT$250.00'], ['阿嬤', '阿公', 'NT$150.00']],
};

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  const ids = await page.evaluate(async () => {
    // 假匯率：塞進 fx 的 localStorage 快取（12 小時內不會重抓 → 不打真網路）
    localStorage.setItem('tripquest.fx', JSON.stringify({
      base: 'USD', rates: { USD: 1, TWD: 32, JPY: 160 },
      updatedAt: 'Mon, 21 Sep 2026 00:00:00 +0000', fetchedAt: Date.now(),
    }));
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const g = uuid(), tid = uuid(), A = uuid(), B = uuid(), C = uuid();
    await s.put({ id: g, type: 'group', name: '家族' });
    await s.put({ id: A, type: 'member', groupId: g, displayName: '阿公' });
    await s.put({ id: B, type: 'member', groupId: g, displayName: '阿嬤' });
    await s.put({ id: C, type: 'member', groupId: g, displayName: '小美' });
    await s.put({ id: tid, type: 'trip', groupId: g, title: '分帳的一趟', region: '宜蘭', baseCurrency: 'TWD', allowWiki: false });
    const mk = async (o) => { const id = uuid(); await s.put({ id, type: 'expense', tripId: tid, groupId: g, createdAt: Date.now(), ...o }); return id; };
    await mk({ title: '晚餐', category: 'food', amount: 900, currency: 'TWD', payerId: A, participants: [A, B, C], shares: null });
    await mk({ title: '門票', category: 'ticket', amount: 1500, currency: 'JPY', payerId: B, participants: [B, C], shares: null });
    await mk({ title: '計程車', category: 'transport', amount: 600, currency: 'TWD', payerId: C, participants: [A, C], shares: { [A]: 1, [C]: 2 } });
    return { tid, A, B, C };
  });
  const seeded = await page.evaluate(async (tid) => {
    const { tripExpenses } = await import('./js/expenses.js');
    return tripExpenses(tid).length;
  }, ids.tid);
  yes(seeded === 3, `前置：三筆花費真的存了（${seeded}）`);

  // ---------- 真實入口：從「我的旅程」點進去 → 底部「分帳」分頁 ----------
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.trip-card, .card');
  await page.evaluate((title) => {
    [...document.querySelectorAll('button, a, .trip-card, .card')].find((x) => x.textContent.includes(title)).click();
  }, '分帳的一趟');
  await page.waitForSelector('.qcollapse, .page', { timeout: 8000 });
  await page.evaluate(() => {
    // 底部功能列是 #tabbar 裡的 <a class="tab">，文字是「💰分帳」（emoji 黏在前面）
    [...document.querySelectorAll('#tabbar .tab')].find((x) => x.textContent.includes('分帳')).click();
  });
  await page.waitForFunction(() => location.hash.includes('/expenses'), { timeout: 8000 });
  await page.waitForSelector('.exp-total-num', { timeout: 8000 });
  ok('真實入口：行程頁 → 底部「分帳」分頁');

  // ---------- 畫面上的金額 = 手算的值 ----------
  await page.waitForSelector('.exp-total-num');
  const ui = await page.evaluate(() => {
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
    const rows = [...document.querySelectorAll('.exp-person')].map((r) => ({
      name: txt(r.querySelector('.exp-person-name')) || txt(r).split(' ')[0],
      body: txt(r),
    }));
    // 轉帳列：一列一個 .exp-settle（誰給誰 ＋ 金額）
    const transfers = [...document.querySelectorAll('.exp-settle')].map((r) => ({
      who: txt(r.querySelector('.exp-settle-txt')), amt: txt(r.querySelector('.exp-settle-amt')),
    }));
    const persons = [...document.querySelectorAll('.exp-person')].map((r) => txt(r));
    return {
      grand: txt(document.querySelector('.exp-total-num')),
      sub: txt(document.querySelector('.exp-total .muted')),
      rows, transfers, persons,
      all: document.querySelector('.page').textContent.replace(/\s+/g, ' '),
    };
  });
  eq(ui.grand, WANT.grand, '總額＝手算 900 + 300（1500 JPY）+ 600');
  yes(ui.all.includes(WANT.avg), `每人平均＝${WANT.avg}`, ui.sub);
  for (const [name, paid] of Object.entries(WANT.paid)) {
    yes(ui.all.includes(`付了 ${paid}`), `${name} 付了 ${paid}`, ui.all.slice(0, 200));
  }
  for (const [name, net] of Object.entries(WANT.net)) {
    yes(ui.all.includes(net), `${name} ${net}`, ui.all.slice(0, 200));
  }
  // 轉帳列要**在那一列裡**比對金額：比對整頁文字的話，「應付 NT$250.00」也含這個字串，
  // 把轉帳金額改掉照樣會綠（2026-09-21 突變實測踩到）。
  yes(ui.transfers.length === WANT.transfers.length, `前置：畫面上有 ${ui.transfers.length} 列轉帳`, JSON.stringify(ui.transfers));
  for (const [from, to, amt] of WANT.transfers) {
    const row = ui.transfers.find((t) => t.who === `${from} 給 ${to}`);
    yes(!!row, `結清方案有「${from} 給 ${to}」這一列`, JSON.stringify(ui.transfers));
    yes(row && row.amt === amt, `那一列的金額是 ${amt}`, row ? row.amt : '（找不到那一列）');
  }
  // 每個人那一區也要在自己的列裡比對
  for (const [name, net] of Object.entries(WANT.net)) {
    const row = ui.persons.find((p) => p.includes(name));
    yes(row && row.includes(net), `「每個人」區：${name} ${net}`, row);
  }

  // ---------- 核心與畫面同源：settleTrip 回傳的值就是畫面上的值 ----------
  const core = await page.evaluate(async (tid) => {
    const { settleTrip } = await import('./js/expenses.js');
    const { getRates } = await import('./js/fx.js');
    const rates = await getRates();
    const s = await settleTrip(tid, 'TWD', rates);
    return { grand: s.totals.grand, byMember: s.totals.byMember, balances: s.balances, transfers: s.transfers, missingRate: s.missingRate, count: s.count };
  }, ids.tid);
  const round2 = (v) => Math.round(v * 100) / 100;
  eq(round2(core.grand), 1800, '核心：總額 1800');
  eq(round2(core.balances[ids.A]), 400, '核心：阿公淨額 +400');
  eq(round2(core.balances[ids.B]), -150, '核心：阿嬤淨額 −150');
  eq(round2(core.balances[ids.C]), -250, '核心：小美淨額 −250');
  eq(round2(Object.values(core.balances).reduce((a, b) => a + b, 0)), 0, '核心：淨額總和守恆為 0');
  eq(core.missingRate, false, '核心：三筆的匯率都查得到 → missingRate 是 false');
  yes(core.transfers.length === 2 && core.transfers.every((t) => t.to === ids.A),
    `核心：兩筆轉帳、都是付給阿公（${core.transfers.length}）`, JSON.stringify(core.transfers));

  console.log('M10 用的指紋：' + JSON.stringify({ grand: round2(core.grand), balances: Object.fromEntries(Object.entries(core.balances).map(([k, v]) => [k === ids.A ? '阿公' : k === ids.B ? '阿嬤' : '小美', round2(v)])), transfers: core.transfers.map((t) => round2(t.amount)).sort(), count: core.count }));

  // ---------- T0：從真的表單記一筆（R0，SPEC_分帳金額守恆）----------
  // 放在金額比對**之後**：這裡新記的幾筆會改變合計，上面的 WANT 不受影響。
  //
  // 點擊一律用 ElementHandle.click()：它移動真的滑鼠、在元素中心按下放開（pointerdown →
  // mouseup → click），跟手指點下去是同一條路。v1.74.2 就是這樣實測到 bug 的：
  // 「分類」「誰付的」整排按鈕包在 `<label>` 裡，被點的那顆重繪後離開 DOM，點擊冒泡到
  // label 時被轉發給排第一的控制項，選擇落回第一顆。用 `el.click()` 在 page.evaluate 裡
  // 點也會重現（同一個冒泡），但我們要的是使用者那條路。
  const openForm = async () => {
    const btn = await page.$('#topActionBtn');
    await btn.click();
    try {
      await page.waitForSelector('#modalRoot .exp-form', { timeout: 6000 });
    } catch (e) {
      const why = await page.evaluate(() => ({
        hash: location.hash, top: document.getElementById('topActionBtn')?.outerHTML.slice(0, 200),
        modal: document.getElementById('modalRoot')?.innerHTML.slice(0, 300),
        hit: (() => { const b = document.getElementById('topActionBtn'); if (!b) return null; const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el && (el.id || el.className || el.tagName); })(),
      }));
      throw new Error('記帳表單沒打開：' + JSON.stringify(why));
    }
    await sleep(250);
  };
  const formState = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('#modalRoot .quick-pick')];
    const pick = (row) => [...(row?.querySelectorAll('button') || [])].map((b) => ({ t: b.textContent.trim(), on: b.classList.contains('on') }));
    const parts = [...document.querySelectorAll('#modalRoot .exp-part')].map((p) => ({
      t: p.querySelector('.exp-part-name')?.textContent.trim(),
      on: !!p.querySelector('input[type=checkbox]')?.checked,
      share: p.querySelector('.exp-share')?.value ?? null,
    }));
    return { cat: pick(rows[0]), pay: pick(rows[1]), parts };
  });
  const handles = async (sel) => page.$$(sel);
  const labelOf = async (text) => {
    // 欄位標題那段字（.form-label）；點它是使用者會做的事（手指落在標題上）
    const hs = await handles('#modalRoot .form-label');
    for (const hd of hs) if ((await hd.evaluate((e) => e.textContent.trim())) === text) return hd;
    return null;
  };
  const typeAmount = async (digits) => {
    for (const d of digits) {
      const keys = await handles('#modalRoot .numpad-key');
      for (const k of keys) if ((await k.evaluate((e) => e.textContent.trim())) === d) { await k.click(); break; }
    }
  };
  const save = async () => {
    const bs = await handles('#modalRoot .modal-actions button');
    for (const b of bs) if ((await b.evaluate((e) => e.textContent.trim())) === '儲存') { await b.click(); break; }
    await page.waitForFunction(() => !document.querySelector('#modalRoot .exp-form'), { timeout: 6000 });
    await sleep(300);
  };
  const stored = (title) => page.evaluate(async (tid, title) => {
    const { tripExpenses } = await import('./js/expenses.js');
    return tripExpenses(tid).find((e) => e.title === title) || null;
  }, ids.tid, title);

  await openForm();
  let st0 = await formState();
  yes(st0.pay.length >= 3 && st0.cat.length >= 2, `前置：表單有 ${st0.pay.length} 個付款人、${st0.cat.length} 個分類`, JSON.stringify(st0));
  yes(st0.pay[0].on && !st0.pay[2].on && st0.cat[0].on && !st0.cat[1].on,
    '前置：一開始選中的是第一個付款人與第一個分類（不然「點了才變」分不出來）', JSON.stringify(st0));

  // 依排的順序取：第一排是分類、第二排是付款人
  const payBtns = await page.$$('#modalRoot .quick-pick');
  const catBtns = await payBtns[0].$$('button');
  const whoBtns = await payBtns[1].$$('button');
  await whoBtns[2].click(); await sleep(150);
  await catBtns[1].click(); await sleep(150);
  let st1 = await formState();
  yes(st1.pay[2].on && !st1.pay[0].on, `T0 點第三個付款人「${st1.pay[2].t}」→ 它被選中、第一個沒有`, JSON.stringify(st1.pay));
  yes(st1.cat[1].on && !st1.cat[0].on, `T0 點第二個分類「${st1.cat[1].t}」→ 它被選中、第一個沒有`, JSON.stringify(st1.cat));

  // 手指落在欄位標題上（「誰付的」「分類」這幾個字）不應該改掉已經選好的
  for (const t of ['誰付的', '分類']) {
    const lb = await labelOf(t);
    if (lb) { await lb.click(); await sleep(150); }
  }
  const st2 = await formState();
  yes(st2.pay[2].on && !st2.pay[0].on && st2.cat[1].on && !st2.cat[0].on,
    'T0 點「誰付的」「分類」的標題字 → 已選的付款人與分類不變', JSON.stringify({ pay: st2.pay, cat: st2.cat }));

  await typeAmount(['1', '2', '0']);
  const titleIn = await page.$('#modalRoot .exp-form input.field[type=text]');
  await titleIn.click(); await titleIn.type('回程計程車');
  await save();
  const e0 = await stored('回程計程車');
  yes(!!e0, 'T0 從表單記的那一筆真的存進去了');
  // 旅伴在表單上的排列順序不固定（store.membersOf 沒排序），所以期望值用「點的那一顆上寫的名字」，
  // 不寫死是誰。前置已確認它不是第一顆。
  const nameOf = { [ids.A]: '阿公', [ids.B]: '阿嬤', [ids.C]: '小美' };
  const clickedPayer = st1.pay[2].t;
  yes(clickedPayer !== st0.pay[0].t, `前置：點的付款人「${clickedPayer}」不是一開始選中的「${st0.pay[0].t}」`);
  eq(e0 && (nameOf[e0.payerId] || e0.payerId), clickedPayer, `T0 存進去的付款人是點的那一個（${clickedPayer}）`);
  eq(e0 && e0.category, 'transport', 'T0 存進去的分類是點的那一個（交通）');
  eq(e0 && e0.amount, 120, 'T0 存進去的金額是鍵盤按的 120');

  // ---------- T0b：「分給誰」那一格 ----------
  await openForm();
  const p0 = await formState();
  yes(p0.parts.length === 3 && p0.parts.every((p) => p.on), `前置：三個人一開始都有勾（${p0.parts.map((p) => p.t).join('／')}）`, JSON.stringify(p0.parts));
  // 點第二個人的名字（手指最常落的地方）
  const names = await page.$$('#modalRoot .exp-part-name');
  await names[1].click(); await sleep(150);
  const p1 = await formState();
  yes(!p1.parts[1].on && p1.parts[0].on && p1.parts[2].on, `T0b 點「${p1.parts[1].t}」→ 只有他取消、第一個人沒變`, JSON.stringify(p1.parts));
  // 再點他的勾選框本身，勾回來
  const boxes = await page.$$('#modalRoot .exp-part input[type=checkbox]');
  await boxes[1].click(); await sleep(150);
  const p2 = await formState();
  yes(p2.parts.every((p) => p.on), 'T0b 點他的勾選框 → 勾回來、其他人不變', JSON.stringify(p2.parts));
  // 手指落在「分給誰」這幾個字上，不應該動到任何人的勾
  const lbParts = await labelOf('分給誰');
  if (lbParts) { await lbParts.click(); await sleep(150); }
  const p3 = await formState();
  yes(p3.parts.every((p) => p.on), 'T0b 點「分給誰」的標題字 → 沒有人的勾被改掉', JSON.stringify(p3.parts));
  // 切到自訂比例，把第二個人的份數改成 2
  const toggles = await page.$$('#modalRoot .exp-form .btn-ghost');
  for (const t of toggles) if ((await t.evaluate((e) => e.textContent)).includes('自訂比例')) { await t.click(); break; }
  await sleep(200);
  const shares = await page.$$('#modalRoot .exp-share');
  yes(shares.length === 3, `T0b 切到自訂比例 → 出現 ${shares.length} 個份數欄`);
  await shares[1].click({ clickCount: 3 }); await shares[1].type('2'); await sleep(100);
  const p4 = await formState();
  yes(p4.parts.every((p) => p.on) && p4.parts[1].share === '2', 'T0b 在份數欄打字 → 值是 2、焦點沒跳走、勾選沒變', JSON.stringify(p4.parts));
  await typeAmount(['4', '0', '0']);
  const titleIn2 = await page.$('#modalRoot .exp-form input.field[type=text]');
  await titleIn2.click(); await titleIn2.type('水果');
  await save();
  const e1 = await stored('水果');
  yes(!!e1, 'T0b 那一筆存進去了');
  yes(e1 && e1.participants.length === 3 && [ids.A, ids.B, ids.C].every((m) => e1.participants.includes(m)), 'T0b 存進去的參與者是三個人', JSON.stringify(e1 && e1.participants));
  // 份數改成 2 的是表單上第二個人（順序不固定，用他的名字對）
  const twoName = p4.parts[1].t;
  const gotShares = e1 && e1.shares ? Object.fromEntries(Object.entries(e1.shares).map(([k, v]) => [nameOf[k] || k, v])) : null;
  const wantShares = Object.fromEntries(['阿公', '阿嬤', '小美'].map((n) => [n, n === twoName ? 2 : 1]));
  yes(!!gotShares && ['阿公', '阿嬤', '小美'].every((n) => gotShares[n] === wantShares[n]),
    `T0b 存進去的份數是 ${JSON.stringify(wantShares)}（${twoName} 是 2）`, JSON.stringify(gotShares));

  // ---------- T2／T3：查不到匯率（R1）----------
  // 另開幾趟行程，資料用 page.evaluate 灌，進去的路照使用者的走：首頁 → 行程卡 → 底部「分帳」。
  // 匯率快取換成**沒有 JPY** 的一張（fetchedAt 是現在 → 12 小時內不重抓、不打真網路）。
  await page.evaluate(() => localStorage.setItem('tripquest.fx', JSON.stringify({
    base: 'USD', rates: { USD: 1, TWD: 32 }, updatedAt: 'Mon, 21 Sep 2026 00:00:00 +0000', fetchedAt: Date.now(),
  })));
  const seedTrip = (title, rows) => page.evaluate(async (title, rows) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const g = uuid(), tid = uuid(), who = { 阿公: uuid(), 阿嬤: uuid() };
    await s.put({ id: g, type: 'group', name: title });
    for (const [n, id] of Object.entries(who)) await s.put({ id, type: 'member', groupId: g, displayName: n });
    await s.put({ id: tid, type: 'trip', groupId: g, title, region: '測試', baseCurrency: 'TWD', allowWiki: false });
    let t = Date.now();
    for (const r of rows) {
      await s.put({ id: uuid(), type: 'expense', tripId: tid, groupId: g, createdAt: t--, title: r.title, category: 'food',
        amount: r.amount, currency: r.currency, payerId: who[r.payer], participants: r.parts.map((n) => who[n]), shares: null });
    }
    return tid;
  }, title, rows);
  const openTripExpenses = async (title) => {
    await page.goto('about:blank');
    await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.trip-card, .card');
    let card = null;
    for (const c of await page.$$('.trip-card')) if ((await c.evaluate((e) => e.textContent)).includes(title)) { card = c; break; }
    if (!card) throw new Error('首頁找不到行程卡：' + title);
    await card.click();
    // 不能只等 `#tabbar .tab`：首頁本來就有底部功能列，那個條件在換頁前就成立了
    await page.waitForFunction(() => location.hash.includes('/trip/')
      && [...document.querySelectorAll('#tabbar .tab')].some((t) => t.textContent.includes('分帳')), { timeout: 8000 });
    let tab = null;
    for (const t of await page.$$('#tabbar .tab')) if ((await t.evaluate((e) => e.textContent)).includes('分帳')) { tab = t; break; }
    await tab.click();
    await page.waitForFunction(() => location.hash.includes('/expenses'), { timeout: 8000 });
    await page.waitForSelector('.exp-summary', { timeout: 8000 });
    await sleep(200);
    return page.evaluate(() => {
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
      const labels = [...document.querySelectorAll('.page .section-label')];
      const settleLabel = labels.find((x) => x.textContent.includes('結清方案'));
      const personLabel = labels.find((x) => x.textContent.includes('每個人'));
      // 「結清方案」那一區＝它的標題到「每個人」標題之間的元素
      const settleArea = [];
      for (let el = settleLabel && settleLabel.nextElementSibling; el && el !== personLabel; el = el.nextElementSibling) settleArea.push(txt(el));
      return {
        summary: txt(document.querySelector('.exp-summary')),
        grand: txt(document.querySelector('.exp-total-num')) || null,
        settle: settleArea.join(' | '),
        all: txt(document.querySelector('.page')),
      };
    });
  };

  // T2：兩筆台幣 ＋ 兩筆日圓（查不到）
  // 手算：t1 300 TWD 阿公付、兩人分；t2 100 TWD 阿嬤付、兩人分 → 合計 400；
  //       阿公淨額 300 − 150 − 50 ＝ +100 → 結清：阿嬤給阿公 100
  //       日圓 8000 ＋ 4000 ＝ 12000（2 筆）沒有算進去
  const CUR = JSON.parse(await (await import('node:fs')).promises.readFile(new URL('../data/currencies.json', import.meta.url), 'utf8'));
  const yen = CUR.list.find((c) => c.code === 'JPY').symbol;
  await seedTrip('查不到日圓的一趟', [
    { title: '早餐', amount: 300, currency: 'TWD', payer: '阿公', parts: ['阿公', '阿嬤'] },
    { title: '拉麵', amount: 8000, currency: 'JPY', payer: '阿公', parts: ['阿公', '阿嬤'] },
    { title: '飲料', amount: 100, currency: 'TWD', payer: '阿嬤', parts: ['阿公', '阿嬤'] },
    { title: '車票', amount: 4000, currency: 'JPY', payer: '阿嬤', parts: ['阿公', '阿嬤'] },
  ]);
  const r2 = await openTripExpenses('查不到日圓的一趟');
  yes(!!yen, `前置：日圓的符號從 currencies.json 讀到「${yen}」`);
  eq(r2.grand, 'NT$400.00', 'T2 合計只含兩筆台幣（300 + 100）');
  const yenAmt = `${yen}12,000`;
  yes(r2.summary.includes(yenAmt) && r2.summary.includes('2 筆') && r2.summary.includes('沒有算進'),
    `T2 總覽看得到「${yenAmt}（2 筆）」與「沒有算進」`, r2.summary);
  yes(r2.settle.includes(yenAmt) && r2.settle.includes('沒有算進'), 'T2 結清方案那一區也看得到同一句', r2.settle);
  yes(r2.summary.includes('2 筆算進合計') && r2.summary.includes('2 筆沒有'), 'T2「共 4 筆」分得出幾筆有算、幾筆沒算', r2.summary);
  yes(r2.settle.includes('阿嬤 給 阿公') && r2.settle.includes('NT$100.00'), 'T2 結清方案只算台幣：阿嬤給阿公 NT$100.00', r2.settle);
  yes(!r2.all.includes('可能不準'), 'T2 舊的「換算可能不準」不再出現', r2.all.slice(0, 200));

  // T3：這趟只有查不到匯率的日圓 → 合計不是 0 元、結清不是「打平」
  await seedTrip('只有日圓的一趟', [
    { title: '拉麵', amount: 8000, currency: 'JPY', payer: '阿公', parts: ['阿公', '阿嬤'] },
  ]);
  const r3 = await openTripExpenses('只有日圓的一趟');
  yes(!r3.summary.includes('NT$0.00'), 'T3 全部查不到 → 合計不是「NT$0.00」', r3.summary);
  yes(r3.summary.includes('還沒有可以換算'), 'T3 合計那格照實講「還沒有可以換算的花費」', r3.summary);
  yes(!r3.settle.includes('打平') && r3.settle.includes('查到匯率之後'), 'T3 結清方案不是「打平」，而是「查到匯率之後才算得出來」', r3.settle);
  yes(!r3.all.includes('NT$0.00'), 'T3 整頁沒有任何「NT$0.00」（每個人那一區也不冒充 0）', r3.all.slice(0, 300));
  // 對照組：真的打平的一趟仍顯示打平
  await seedTrip('真的打平的一趟', [
    { title: '各付各的', amount: 100, currency: 'TWD', payer: '阿公', parts: ['阿公'] },
  ]);
  const r3c = await openTripExpenses('真的打平的一趟');
  yes(r3c.settle.includes('打平'), 'T3 對照：真的打平 → 結清方案仍寫「打平」', r3c.settle);

  console.log('\n分帳結清測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
