// 移除旅伴之後的帳（npm run membergonetest；SPEC_旅伴移除後的帳）。
// 涵蓋的程式：js/views/trip.js （旅程設定的 🗑️）、js/views/expenses.js 、js/expenses.js 、js/store.js 。
//
// 為什麼要有這一支：v1.74.9 以前，移除一位記過帳的旅伴不會有任何提醒；移除之後，他付的錢不進結清，
// 他在別人那筆裡的分攤卻還在帳上，結清方案寫成「（未指定） 給 阿公」，「每個人」又不列他。
// 這一支從使用者的路進去：首頁 → 行程卡 → ⚙️ 旅程設定 → 旅伴那一列的 🗑️ → 底部「分帳」。
// 資料全是自己造的（阿公／阿嬤／小美…）。期望值手算，算式寫在下面。
//
// X1 移除前的確認講得出帳（付了幾筆、分攤幾筆、「已移除」）；取消 → 人還在。對照：沒帳沒照片 → 直接移除
// X2 移除後的分帳頁：寫「小美（已移除）」、沒有「（未指定）」、沒有「沒有付款人」、每個人那區列她（最後）
// X3 settleTrip：已移除的旅伴付的照算；完全不認得的 id 仍是 noPayer；淨額總和 0
// X4 群組範圍：帳只在同群組的另一趟 → 這一趟的設定也講得出來
// X5 照片的確認不退步：只有照片 → 講照片；帳與照片都有 → 同一個對話框講兩件
// X6 已移除的旅伴不出現在挑人的地方（記帳表單的「誰付的」「分給誰」、ensureMember 的挑成員）

import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const WEB = 5257;
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

// ---------- 手算（X2） ----------
// 這一趟（T1）：
//   晚餐 300 TWD 阿公付，阿公、阿嬤、小美均分 → 各 100
//   飲料  90 TWD 小美付，阿公、阿嬤、小美均分 → 各 30
//   淨額：阿公 ＝ 300 − 100 − 30 ＝ +170；阿嬤 ＝ −100 − 30 ＝ −130；小美 ＝ 90 − 100 − 30 ＝ −40（總和 0）
//   轉帳（貪婪）：阿嬤 → 阿公 130、小美 → 阿公 40
// 小美：這一趟付了 1 筆、分攤 2 筆；加上第三趟，整個群組付了 2 筆、分攤 3 筆；另外有 1 張照片
// 同群組的另一趟（T2）：阿姨付了一筆 → 阿姨在 T1 沒帳，但群組裡有 1 筆（X4）
// 表哥：只有 1 張照片（X5）；小華：什麼都沒有（X1 的對照組）
// 第三趟（T3，X3）：小美付 60（阿公、小美分）＋ 一筆付款人是從沒存在過的 id 的 50（阿公、阿嬤分）
try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  const ids = await page.evaluate(async () => {
    localStorage.setItem('tripquest.fx', JSON.stringify({ base: 'USD', rates: { USD: 1, TWD: 32 }, updatedAt: 'x', fetchedAt: Date.now() }));
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const g = uuid();
    const who = {};
    await s.put({ id: g, type: 'group', name: '範例家族' });
    for (const n of ['阿公', '阿嬤', '小美', '小華', '阿姨', '表哥']) { who[n] = uuid(); await s.put({ id: who[n], type: 'member', groupId: g, displayName: n }); }
    const T1 = uuid(), T2 = uuid(), T3 = uuid();
    await s.put({ id: T1, type: 'trip', groupId: g, title: '移除旅伴的一趟', region: '測試', baseCurrency: 'TWD', allowWiki: false, startDate: '2024-01-06', endDate: '2024-01-08' });
    await s.put({ id: T2, type: 'trip', groupId: g, title: '同群組的另一趟', region: '測試', baseCurrency: 'TWD', allowWiki: false, startDate: '2023-12-01', endDate: '2023-12-02' });
    await s.put({ id: T3, type: 'trip', groupId: g, title: '第三趟', region: '測試', baseCurrency: 'TWD', allowWiki: false, startDate: '2023-11-01', endDate: '2023-11-02' });
    let t = Date.now();
    const mk = (o) => s.put({ id: uuid(), type: 'expense', groupId: g, createdAt: t--, category: 'food', currency: 'TWD', shares: null, ...o });
    await mk({ tripId: T1, title: '晚餐', amount: 300, payerId: who['阿公'], participants: [who['阿公'], who['阿嬤'], who['小美']] });
    await mk({ tripId: T1, title: '飲料', amount: 90, payerId: who['小美'], participants: [who['阿公'], who['阿嬤'], who['小美']] });
    await mk({ tripId: T2, title: '另一趟的早餐', amount: 120, payerId: who['阿姨'], participants: [who['阿公'], who['阿姨']] });
    await mk({ tripId: T3, title: '小美付的', amount: 60, payerId: who['小美'], participants: [who['阿公'], who['小美']] });
    await mk({ tripId: T3, title: '不認得的人付的', amount: 50, payerId: 'nobody-' + uuid(), participants: [who['阿公'], who['阿嬤']] });
    const q = uuid();
    await s.put({ id: q, type: 'quest', tripId: T1, spotId: 'x', title: '拍一張' });
    for (const n of ['小美', '表哥']) await s.put({ id: uuid(), type: 'submission', tripId: T1, questId: q, memberId: who[n], photoHash: 'h', createdAt: t-- });
    return { g, T1, T2, T3, who };
  });
  const nameOfId = Object.fromEntries(Object.entries(ids.who).map(([n, id]) => [id, n]));

  // ---------- 真實入口：首頁 → 行程卡 → ⚙️ 旅程設定 ----------
  const openSettings = async () => {
    await page.goto('about:blank');
    await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.trip-card');
    let card = null;
    for (const c of await page.$$('.trip-card')) if ((await c.evaluate((e) => e.textContent)).includes('移除旅伴的一趟')) { card = c; break; }
    await card.click();
    await page.waitForFunction(() => location.hash.includes('/trip/') && !location.hash.includes('/settings'), { timeout: 8000 });
    await page.waitForFunction(() => { const b = document.getElementById('topActionBtn'); return b && !b.hidden && b.getAttribute('aria-label') === '旅程設定'; }, { timeout: 8000 });
    await (await page.$('#topActionBtn')).click();
    await page.waitForFunction(() => location.hash.includes('/settings') && document.querySelector('.member-row'), { timeout: 8000 });
    await sleep(200);
  };
  const rowsNow = () => page.evaluate(() => [...document.querySelectorAll('.member-row')].map((r) => r.querySelector('.member-row-main > div')?.textContent.trim()));
  // 按某位旅伴那一列的 🗑️；回傳有沒有跳出對話框與它的文字
  // 真的滑鼠點下去之前，先確認那一點底下「真的是」這一列的 🗑️；對不上就重捲重看。
  // 2026-09-23 在完整的鏈裡（機器忙）實測踩到：一開始那顆鈕在畫面外、要先捲過去，捲完到按下之間
  // 捲動位置或版面還在變，點擊落在別的地方 → 沒跳對話框、後面全部錯位。單獨跑時 5 次都綠，抓不到。
  const pressTrash = async (name) => {
    let pt = null;
    for (const t0 = Date.now(); !pt && Date.now() - t0 < 5000;) {
      pt = await page.evaluate((name) => {
        const row = [...document.querySelectorAll('.member-row')].find((r) => r.querySelector('.member-row-main > div')?.textContent.trim() === name);
        const btn = row && row.querySelector('.btn-danger');
        if (!btn) return null;
        btn.scrollIntoView({ block: 'center' });
        const r = btn.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const under = document.elementFromPoint(x, y);
        return under && (under === btn || btn.contains(under)) ? { x, y } : null;
      }, name);
      if (!pt) await sleep(100);
      else {
        await sleep(120);                              // 再確認一次：這段時間位置沒動才算數
        const still = await page.evaluate((name, x, y) => {
          const under = document.elementFromPoint(x, y);
          const row = under && under.closest('.member-row');
          return !!(under && under.closest('.btn-danger') && row && row.querySelector('.member-row-main > div')?.textContent.trim() === name);
        }, name, pt.x, pt.y);
        if (!still) pt = null;
      }
    }
    if (!pt) throw new Error('找不到（或點不到）旅伴那一列的 🗑️：' + name);
    await page.mouse.click(pt.x, pt.y);
    // 等條件、不等時間：對話框出現，或存檔裡他真的被刪了（沒帳沒照片 → 直接移除）。
    // 第一次按要先動態載入 expenses.js，固定等 500ms 會偶發來不及；用「那一列不見了」當條件也不行——
    // 清單重畫時所有列會短暫消失（寫這支時兩種都實測踩到）。
    const id = ids.who[name];
    for (const t0 = Date.now(); Date.now() - t0 < 8000;) {
      if (await page.$('#modalRoot .modal-actions')) break;
      if (!(await alive(id))) break;
      await sleep(100);
    }
    await sleep(150);
    return page.evaluate(() => {
      const m = document.querySelector('#modalRoot .modal-actions');
      return m ? { open: true, text: document.querySelector('#modalRoot').textContent.replace(/\s+/g, ' ') } : { open: false, text: '' };
    });
  };
  // 沒有對話框時不丟例外（修正前的程式有些情況根本不跳），讓後面每一條都跑得到、各自紅
  const pressModal = async (label) => {
    let hit = false;
    for (const b of await page.$$('#modalRoot .modal-actions button')) {
      if ((await b.evaluate((e) => e.textContent.trim())) === label) { await b.click(); hit = true; break; }
    }
    if (!hit) return false;
    await page.waitForFunction(() => !document.querySelector('#modalRoot .modal-actions'), { timeout: 5000 });
    await sleep(300);
    return true;
  };
  const alive = (id) => page.evaluate(async (id) => { const s = await import('./js/store.js'); return !!s.get(id); }, id);

  await openSettings();
  const r0 = await rowsNow();
  yes(['阿公', '阿嬤', '小美', '小華', '阿姨', '表哥'].every((n) => r0.includes(n)), `前置：旅程設定列出六位旅伴（${r0.join('／')}）`);
  const pre = await page.evaluate(async (tid, C) => {
    const { tripExpenses } = await import('./js/expenses.js');
    const es = tripExpenses(tid);
    return { paid: es.filter((e) => e.payerId === C).length, shared: es.filter((e) => e.participants.includes(C)).length };
  }, ids.T1, ids.who['小美']);
  yes(pre.paid >= 1 && pre.shared >= 1, `前置：小美確實付過 ${pre.paid} 筆、分攤 ${pre.shared} 筆`);

  // ---------- X1：有帳的旅伴 → 跳確認；取消 → 還在 ----------
  const d1 = await pressTrash('小美');
  yes(d1.open, 'X1 按小美的 🗑️ → 跳出確認', d1.text.slice(0, 120));
  // 帳按「整個群組」算：付了＝第一趟的飲料＋第三趟「小美付的」＝ 2 筆；
  // 分攤＝第一趟晚餐、飲料＋第三趟「小美付的」＝ 3 筆
  yes(d1.text.includes('付了 2 筆') && d1.text.includes('分攤 3 筆'), 'X1 確認裡講得出「付了 2 筆、參與分攤 3 筆」（整個群組）', d1.text.slice(0, 200));
  yes(d1.text.includes('小美（已移除）') && d1.text.includes('照樣算'), 'X1 確認裡講「照樣算、結清方案會寫成『小美（已移除）』」', d1.text.slice(0, 200));
  yes(d1.text.includes('記錯') && d1.text.includes('分帳'), 'X1 確認裡講「記錯了先到分帳改掉」', d1.text.slice(0, 260));
  yes(!/可能/.test(d1.text), 'X1 沒有「可能會對不上」這類講不清楚的話', d1.text.slice(0, 260));
  // X5（兩樣都有）：同一個對話框也講照片
  yes(d1.text.includes('1 張照片') && d1.text.includes('未指定'), 'X5 小美帳與照片都有 → 同一個對話框也講照片那一句', d1.text.slice(0, 300));
  const btns = await page.$$eval('#modalRoot .modal-actions button', (bs) => bs.map((b) => b.textContent.trim()));
  yes(btns.join('／') === '取消／移除', `X1 按鈕是「移除」「取消」（${btns.join('／')}）`);
  await pressModal('取消');
  yes(await alive(ids.who['小美']) && (await rowsNow()).includes('小美'), 'X1 按取消 → 小美還在');

  // 對照組：沒帳也沒照片 → 不跳、直接移除
  const dH = await pressTrash('小華');
  yes(!dH.open, 'X1 對照：小華沒帳沒照片 → 不跳對話框', dH.text.slice(0, 120));
  await sleep(300);
  yes(!(await alive(ids.who['小華'])) && !(await rowsNow()).includes('小華'), 'X1 對照：小華直接移除了');

  // ---------- X4：帳只在同群組的另一趟 ----------
  const dA = await pressTrash('阿姨');
  yes(dA.open && dA.text.includes('付了 1 筆') && dA.text.includes('分攤 1 筆'), 'X4 阿姨的帳只在同群組的另一趟 → 這一趟的設定也講得出「付了 1 筆、分攤 1 筆」', dA.text.slice(0, 200));
  await pressModal('取消');

  // ---------- X5：只有照片 ----------
  const dB = await pressTrash('表哥');
  yes(dB.open && dB.text.includes('1 張照片') && dB.text.includes('未指定'), 'X5 表哥只有照片 → 對話框講照片那一句', dB.text.slice(0, 200));
  yes(!dB.text.includes('分帳'), 'X5 表哥沒帳 → 不講帳', dB.text.slice(0, 200));
  await pressModal('取消');

  // ---------- 真的移除小美 ----------
  const d2 = await pressTrash('小美');
  yes(d2.open, '前置：再按一次小美的 🗑️ 又跳出確認');
  // 使用者真的會按的那一顆：現在叫「移除」；v1.74.9 以前的確認叫「確定」（讓修正前的程式也真的移除，
  // 後面 X2／X3 才驗得到它的帳面——按鈕名稱本身由上面 X1 那一條守）
  if (!(await pressModal('移除'))) await pressModal('確定');
  const raw = await page.evaluate(async (C) => { const s = await import('./js/store.js'); const r = s.getRaw(C); return r && { deleted: !!r.deleted, name: r.displayName }; }, ids.who['小美']);
  yes(raw && raw.deleted && raw.name === '小美', 'X2 前置：小美是軟刪除（墓碑還留著名字）', JSON.stringify(raw));
  yes(!(await rowsNow()).includes('小美'), 'X2 前置：旅程設定不再列小美');

  // ---------- X2：分帳頁 ----------
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.trip-card');
  for (const c of await page.$$('.trip-card')) if ((await c.evaluate((e) => e.textContent)).includes('移除旅伴的一趟')) { await c.click(); break; }
  await page.waitForFunction(() => location.hash.includes('/trip/') && [...document.querySelectorAll('#tabbar .tab')].some((t) => t.textContent.includes('分帳')), { timeout: 8000 });
  for (const t of await page.$$('#tabbar .tab')) if ((await t.evaluate((e) => e.textContent)).includes('分帳')) { await t.click(); break; }
  await page.waitForFunction(() => location.hash.includes('/expenses') && document.querySelector('.exp-summary'), { timeout: 8000 });
  await sleep(200);
  const ui = await page.evaluate(() => {
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    return {
      all: txt(document.querySelector('.page')),
      transfers: [...document.querySelectorAll('.exp-settle')].map((r) => ({ who: txt(r.querySelector('.exp-settle-txt')), amt: txt(r.querySelector('.exp-settle-amt')) })),
      persons: [...document.querySelectorAll('.exp-person')].map((r) => ({ name: txt(r.querySelector('.exp-person-main > div')), bal: txt(r.querySelector('.exp-person-bal')) })),
      items: [...document.querySelectorAll('.exp-item')].map(txt),
    };
  });
  yes(ui.transfers.length === 2, `前置：結清方案有 ${ui.transfers.length} 列`, JSON.stringify(ui.transfers));
  const tr = (w) => ui.transfers.find((x) => x.who === w);
  yes(tr('小美（已移除） 給 阿公') && tr('小美（已移除） 給 阿公').amt === 'NT$40.00', 'X2 結清方案「小美（已移除） 給 阿公 NT$40.00」（手算 90 − 100 − 30 ＝ −40）', JSON.stringify(ui.transfers));
  yes(tr('阿嬤 給 阿公') && tr('阿嬤 給 阿公').amt === 'NT$130.00', 'X2 結清方案「阿嬤 給 阿公 NT$130.00」', JSON.stringify(ui.transfers));
  yes(!ui.all.includes('（未指定）'), 'X2 整頁不出現「（未指定）」', ui.all.slice(0, 200));
  yes(!ui.all.includes('沒有付款人'), 'X2 小美付的那筆算進結清（不再出現「有 1 筆沒有付款人」）', ui.all.slice(0, 200));
  const last = ui.persons[ui.persons.length - 1];
  yes(last && last.name === '小美（已移除）' && last.bal === '應付 NT$40.00', 'X2「每個人」列出小美、排最後、標已移除、應付 NT$40.00', JSON.stringify(ui.persons));
  yes(!ui.persons.some((p) => p.name.startsWith('小華')), 'X2 小華已移除但這一趟沒帳 → 「每個人」不列他', JSON.stringify(ui.persons));
  yes(ui.items.some((t) => t.includes('飲料') && t.includes('小美（已移除） 付')), 'X2 明細副標「小美（已移除） 付」', JSON.stringify(ui.items));

  // ---------- X3：settleTrip（對外的函式）----------
  const core = await page.evaluate(async (T1, T3, C) => {
    const { settleTrip } = await import('./js/expenses.js');
    const { getRates } = await import('./js/fx.js');
    const rates = await getRates();
    const a = settleTrip(T1, 'TWD', rates);
    const b = settleTrip(T3, 'TWD', rates);
    const sum = (o) => Math.round(Object.values(o).reduce((x, y) => x + y, 0) * 100);
    return { a: { noPayer: a.noPayer, C: a.balances[C], paidC: a.totals.byMember[C], sum: sum(a.balances) },
      b: { noPayer: b.noPayer, C: b.balances[C], paidC: b.totals.byMember[C], sum: sum(b.balances), grand: b.totals.grand } };
  }, ids.T1, ids.T3, ids.who['小美']);
  eq(core.a.noPayer, 0, 'X3 這一趟：小美已移除，她付的那筆不算「沒有付款人」');
  eq(core.a.paidC, 90, 'X3 這一趟：小美付的 90 照樣算進「誰付了多少」');
  eq(core.a.sum, 0, 'X3 這一趟：淨額總和為 0（分）');
  // 第三趟手算：小美付 60（阿公、小美各 30）→ 小美 +30、阿公 −30；不認得的人付的 50 整筆不進淨額
  eq(core.b.noPayer, 1, 'X3 第三趟：付款人是從沒存在過的 id → 仍是 noPayer 1');
  eq(core.b.C, 30, 'X3 第三趟：已移除的小美付的照算（淨額 ＝ 60 − 30 ＝ +30）');
  eq(core.b.sum, 0, 'X3 第三趟：兩種 id 並存，淨額總和為 0（分）');
  eq(core.b.grand, 110, 'X3 第三趟：合計 ＝ 60 + 50（不認得的那筆照算進合計）');

  // ---------- X6：已移除的旅伴不出現在挑人的地方 ----------
  // 墓碑直接從記錄看（不靠新加的選擇器，修正前的程式也跑得到）
  const tomb = await page.evaluate(async (g) => { const s = await import('./js/store.js'); return s.exportRecords({ all: true }).filter((r) => r.type === 'member' && r.groupId === g && r.deleted).map((m) => m.displayName); }, ids.g);
  yes(tomb.includes('小美'), `X6 前置：群組裡確實有已移除的旅伴（${tomb.join('／')}）`);
  await (await page.$('#topActionBtn')).click();
  await page.waitForSelector('#modalRoot .exp-form', { timeout: 6000 });
  await sleep(200);
  const form = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#modalRoot .quick-pick')];
    return {
      payers: [...(rows[1]?.querySelectorAll('button') || [])].map((b) => b.textContent.trim()),
      parts: [...document.querySelectorAll('#modalRoot .exp-part-name')].map((e) => e.textContent.trim()),
    };
  });
  yes(form.payers.length >= 3 && !form.payers.some((n) => n.includes('小美')), `X6 記帳表單「誰付的」沒有小美（${form.payers.join('／')}）`);
  yes(form.parts.length >= 3 && !form.parts.some((n) => n.includes('小美')), `X6 記帳表單「分給誰」沒有小美（${form.parts.join('／')}）`);
  await pressModal('取消');
  const pick = await page.evaluate(async (T1) => {
    const { ensureMember } = await import('./js/claim.js');
    ensureMember(T1, { force: true });                  // 不等它：它會等使用者挑
    await new Promise((r) => setTimeout(r, 500));
    const names = [...document.querySelectorAll('#modalRoot button')].map((b) => b.textContent.trim());
    return names;
  }, ids.T1);
  yes(pick.some((n) => n.includes('阿公')) && !pick.some((n) => n.includes('小美')) && !pick.some((n) => n.includes('小華')),
    `X6「這是誰的手機」的挑成員沒有已移除的旅伴（${pick.join('／')}）`);

  console.log('\n旅伴移除測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
