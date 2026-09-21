// 分帳結清的真實入口測試（npm run settletest）。
//
// 為什麼要有這一支：`js/expenses.js` 與 `js/fx.js` 在這之前**沒有任何一條斷言在驗金額**
// （全 repo 沒有一支測試提到 fmtMoney、匯率、結清）。改到它們會跑全套，但那是「沒人認領
// 所以保守全跑」，不是守護 —— 沒有人在看錢算得對不對。
//
// 這一支走使用者的真實路徑：行程頁底部的「分帳」分頁 → 看結清方案；其中一筆用畫面上的
// 「記一筆花費」表單真的記進去（不是只灌資料）。**期望值是手算的**，寫在下面的算式裡，
// 不是把程式的輸出貼回來當期望值。
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

  // ---------- 記帳表單打得開（記帳那條路的入口） ----------
  // 這裡**只驗表單開得起來**，不從表單記一筆。2026-09-21 實測到：用真的滑鼠點
  // 「誰付的」與「分類」的 chip，選擇永遠跳回第一個選項（`field()` 把整列包在
  // `<label>` 裡，label 會把點擊轉發給第一個控制項；重繪後就落回第一顆）。
  // 在那個 bug 修好之前，從表單驅動的「記一筆」測不出使用者真的做得到的事 ——
  // 硬寫成用 JS 直接改 st 的話，就是一條沒有使用者在走的路。見回報與 SPEC §6。
  await page.evaluate(() => document.getElementById('topActionBtn').click());
  await page.waitForSelector('#modalRoot .exp-form', { timeout: 6000 });
  const form = await page.evaluate(() => {
    const root = document.querySelector('#modalRoot');
    const r = {
      numpad: root.querySelectorAll('.numpad-key, .numpad button').length > 0 || !!root.querySelector('.numpad-display'),
      payers: [...(document.querySelectorAll('#modalRoot .quick-pick')[1]?.querySelectorAll('button') || [])].map((b) => b.textContent.trim()),
      parts: root.querySelectorAll('.exp-part').length,
    };
    [...root.querySelectorAll('.modal-actions button')].find((b) => b.textContent.trim() === '取消').click();
    return r;
  });
  yes(form.numpad && form.payers.length === 3 && form.parts === 3,
    `「加一筆帳」表單打得開：數字鍵盤、三個付款人、三個參與者（${form.payers.join('／')}）`, JSON.stringify(form));
  await sleep(300);

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

  console.log('\n分帳結清測試結束');
  console.log('M10 用的指紋：' + JSON.stringify({ grand: round2(core.grand), balances: Object.fromEntries(Object.entries(core.balances).map(([k, v]) => [k === ids.A ? '阿公' : k === ids.B ? '阿嬤' : '小美', round2(v)])), transfers: core.transfers.map((t) => round2(t.amount)).sort(), count: core.count }));
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
