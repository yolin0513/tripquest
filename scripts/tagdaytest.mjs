// 「重要／訂好位」標籤＋花費標第幾天的畫面測試（npm run tagdaytest；在 test:chain 裡）。資料全是合成的（日期 2024 年、名字自編）。
// 涵蓋的程式：js/views/trip.js js/views/expenses.js js/expenses.js css/style.css
// 從一次性的 _tagshots（被 .gitignore 擋）搬進來（2026-11-05：今天做的畫面要有會自動跑的斷言守著）；截圖留在一次性腳本。
// 走真實入口：景點卡上的兩顆切換鈕；分帳頁右上「＋」打開的記帳表單、真的點數字鍵與「哪一天」。期望金額是手算的。
// 突變實測（2026-11-05，在 _tagshots 上）：表單預選第 1 天 → 紅「預設不標」「編輯舊花費仍不標」；
// 拿掉沒標日期的計數 → 紅「另有 1 筆沒標日期」；標籤改成不是 false 就顯示 → 紅「一開始沒有標籤」「對照組第 2 站」。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5783;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(900);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0, fail = 0;
const yes = (c, m, x) => { if (c) { pass++; console.log('✓ ' + m); } else { fail++; console.log('✗ ' + m + (x ? '｜' + x : '')); } };
const page = await browser.newPage();
const stable = async (sel) => {
  for (let k = 0; k < 6; k++) {
    await page.evaluate((q) => { window.__p = document.querySelector(q); }, sel);
    await sleep(1500);
    if (await page.evaluate((q) => !!window.__p && window.__p === document.querySelector(q), sel)) return;
  }
};
const btnByText = async (sel, text) => {
  for (const b of await page.$$(sel)) if ((await b.evaluate((e) => e.textContent.trim())) === text) return b;
  return null;
};
try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setBypassServiceWorker(true);
  page.on('pageerror', (e) => { fail++; console.log('✗ pageerror ' + e.message); });
  await page.setRequestInterception(true);
  page.on('request', (rq) => { const u = new URL(rq.url()); if (u.hostname !== 'localhost') return rq.abort(); rq.continue(); });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  const ids = await page.evaluate(async () => {
    localStorage.setItem('tripquest.fx', JSON.stringify({ base: 'USD', rates: { USD: 1, TWD: 32 }, updatedAt: 'Mon, 21 Sep 2026 00:00:00 +0000', fetchedAt: Date.now() }));
    const s = await import('./js/store.js');
    let k = 0; const uuid = () => `00000000-0000-4000-8000-${String(++k).padStart(12, '0')}`;
    const g = uuid(), tid = uuid(), A = uuid(), B = uuid();
    await s.put({ id: g, type: 'group', name: '家族' });
    await s.put({ id: A, type: 'member', groupId: g, displayName: '甲哥' });
    await s.put({ id: B, type: 'member', groupId: g, displayName: '乙姊' });
    await s.put({ id: tid, type: 'trip', groupId: g, title: '範例三天', region: '宜蘭', baseCurrency: 'TWD', allowWiki: false, startDate: '2024-03-10', endDate: '2024-03-12' });
    const sp = [];
    for (const [day, name] of [[1, '甲・餐廳'], [1, '乙・車站'], [2, '丙・溫泉']]) {
      const id = uuid(); sp.push(id);
      await s.put({ id, type: 'spot', tripId: tid, name, emoji: '📍', day, order: sp.length, startTime: '' });
      await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: id, order: 0, title: `拍下 ${name}` });
    }
    // 一筆舊花費：沒有 day（模擬投票前記的）
    await s.put({ id: uuid(), type: 'expense', tripId: tid, groupId: g, createdAt: Date.now(), title: '舊的一筆', category: 'food', amount: 300, currency: 'TWD', payerId: A, participants: [A, B], shares: null });
    return { tid, sp };
  });
  const { tid, sp } = ids;

  // ===== 一、重要／訂好位 =====
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.daycollapse.open .qcollapse');
  await stable('.daycollapse.open .timeline');
  const tagState = () => page.evaluate(() => [...document.querySelectorAll('.daycollapse.open .qcollapse')].map((q) => ({
    spot: q.dataset.spot, tags: [...q.querySelectorAll('.qc-tag')].map((t) => t.textContent.trim()),
    toggles: [...q.querySelectorAll('.tag-toggle')].map((b) => [b.dataset.tag, b.getAttribute('aria-pressed'), b.textContent.trim()]),
  })));
  let T = await tagState();
  yes(T.length === 2 && T.every((x) => x.tags.length === 0), `一開始第 1 天兩站都沒有任何標籤（${JSON.stringify(T.map((x) => x.tags))}）`);
  // 卡片收著的要先展開（使用者也是這樣）——第 1 站是現在這一站、預設展開
  const ensureOpen = async (id) => {
    const open = await page.evaluate((i) => document.querySelector(`.qcollapse[data-spot="${i}"]`).classList.contains('open'), id);
    if (!open) { await page.click(`.qcollapse[data-spot="${id}"] .qc-toggle`); await sleep(200); }
  };
  await ensureOpen(sp[0]);
  T = await tagState();
  const t0 = T.find((x) => x.spot === sp[0]);
  yes(t0.toggles.length === 2 && t0.toggles.every((x) => x[1] === 'false'), `展開後看得到兩顆切換鈕、都沒按下（${JSON.stringify(t0.toggles)}）`);
  await page.click(`.qcollapse[data-spot="${sp[0]}"] .tag-toggle[data-tag="important"]`);
  await page.waitForFunction((i) => document.querySelector(`.qcollapse[data-spot="${i}"] .tag-toggle[data-tag="important"]`)?.getAttribute('aria-pressed') === 'true', { timeout: 6000 }, sp[0]).catch(() => {});
  await stable('.daycollapse.open .timeline');
  await ensureOpen(sp[0]);
  await page.click(`.qcollapse[data-spot="${sp[0]}"] .tag-toggle[data-tag="booked"]`);
  await page.waitForFunction((i) => document.querySelector(`.qcollapse[data-spot="${i}"] .tag-toggle[data-tag="booked"]`)?.getAttribute('aria-pressed') === 'true', { timeout: 6000 }, sp[0]).catch(() => {});
  await stable('.daycollapse.open .timeline');
  T = await tagState();
  const a0 = T.find((x) => x.spot === sp[0]), a1 = T.find((x) => x.spot === sp[1]);
  yes(a0.tags.join() === '⭐ 重要,✅ 訂好位', `點兩顆之後第 1 站名稱下出現「⭐ 重要」「✅ 訂好位」（${a0.tags.join('、')}）`);
  yes(a1.tags.length === 0, '對照：沒點的第 2 站仍然沒有標籤');
  const rec = await page.evaluate(async (i) => { const s = await import('./js/store.js'); const x = s.get(i); return { important: x.important, booked: x.booked, fi: !!x._f?.important, fb: !!x._f?.booked }; }, sp[0]);
  yes(rec.important === true && rec.booked === true && rec.fi && rec.fb, `存下去的是 true＋_f 兩組都有時間戳（${JSON.stringify(rec)}）`);
  await page.evaluate((i) => document.querySelector(`.qcollapse[data-spot="${i}"]`).scrollIntoView({ block: 'start' }), sp[0]);
  await sleep(300);
  // 再點一下取消「重要」
  await ensureOpen(sp[0]);
  await page.click(`.qcollapse[data-spot="${sp[0]}"] .tag-toggle[data-tag="important"]`);
  await page.waitForFunction((i) => document.querySelector(`.qcollapse[data-spot="${i}"] .tag-toggle[data-tag="important"]`)?.getAttribute('aria-pressed') === 'false', { timeout: 6000 }, sp[0]).catch(() => {});
  await stable('.daycollapse.open .timeline');
  T = await tagState();
  yes(T.find((x) => x.spot === sp[0]).tags.join() === '✅ 訂好位', `再點一下「重要」→ 取消，只剩訂好位（${T.find((x) => x.spot === sp[0]).tags.join('、')}）`);

  // ===== 二、花費標第幾天 =====
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}/expenses`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.exp-item');
  const daySec = () => page.evaluate(() => ({
    days: [...document.querySelectorAll('.exp-day')].map((d) => d.textContent.replace(/\s+/g, ' ').trim()),
    noday: document.querySelector('.exp-noday')?.textContent.trim() || '',
    items: [...document.querySelectorAll('.exp-item')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
  }));
  let D = await daySec();
  yes(D.days.length === 0 && D.noday === '', `只有一筆沒標日期的舊花費時：不出現「每天花多少」（${JSON.stringify(D.days)}）`);
  yes(D.items.length === 1 && !D.items[0].includes('第 '), `舊花費明細不寫第幾天（${D.items[0]}）`);
  const openForm = async () => { await (await page.$('#topActionBtn')).click(); await page.waitForSelector('#modalRoot .exp-form', { timeout: 6000 }); await sleep(250); };
  const dayRow = () => page.evaluate(() => [...document.querySelectorAll('#modalRoot .exp-dayrow button')].map((b) => [b.dataset.day, b.textContent.trim(), b.classList.contains('on')]));
  await openForm();
  let R = await dayRow();
  yes(R.length === 4 && R[0][1] === '不標' && R[0][2] && R.slice(1).every((x) => !x[2]),
    `新的一筆：「哪一天」有 不標＋第 1～3 天，預設是「不標」、沒有預選任何一天（${JSON.stringify(R)}）`);
  yes(R[1][1] === '第 1 天 3/10' && R[3][1] === '第 3 天 3/12', `天數照行程日期（${R[1][1]}、${R[3][1]}）`);
  const typeAmount = async (digits) => { for (const d of digits) { const k = await btnByText('#modalRoot .numpad-key', d); await k.click(); } };
  const save = async () => { await (await btnByText('#modalRoot .modal-actions button', '儲存')).click(); await page.waitForFunction(() => !document.querySelector('#modalRoot .exp-form'), { timeout: 6000 }); await sleep(400); };
  await typeAmount('500');
  await (await page.$('#modalRoot .exp-dayrow button[data-day="2"]')).click(); await sleep(150);
  R = await dayRow();
  yes(R.find((x) => x[0] === '2')[2] && R.filter((x) => x[2]).length === 1, '點「第 2 天」→ 只有它被選中');
  await save();
  await openForm();
  await typeAmount('120');
  await (await page.$('#modalRoot .exp-dayrow button[data-day="2"]')).click(); await sleep(100);
  await save();
  await openForm();
  await typeAmount('80');
  await (await page.$('#modalRoot .exp-dayrow button[data-day="1"]')).click(); await sleep(100);
  await save();
  await page.waitForSelector('.exp-day');
  D = await daySec();
  // 手算：第 1 天 80（1 筆）；第 2 天 500＋120＝620（2 筆）；舊的 300 沒標
  yes(D.days.length === 2 && D.days[0].startsWith('第 1 天') && D.days[0].includes('1 筆') && D.days[0].includes('80'),
    `第 1 天：1 筆、80（${D.days[0]}）`);
  yes(D.days[1]?.startsWith('第 2 天') && D.days[1].includes('2 筆') && D.days[1].includes('620'), `第 2 天：2 筆、620（${D.days[1]}）`);
  yes(D.noday === '另有 1 筆沒標日期，沒有分進哪一天。', `舊的那筆照實寫「另有 1 筆沒標日期」（${D.noday}）`);
  yes(!D.days.some((x) => x.startsWith('第 3 天')), '沒有花費的第 3 天不列（不顯示 0）');
  yes(D.items.filter((x) => x.includes('第 2 天')).length === 2 && D.items.filter((x) => x.includes('第 1 天')).length === 1, '明細每筆寫它標的那一天');
  await page.evaluate(() => document.querySelector('.exp-days')?.scrollIntoView({ block: 'center' }));
  await sleep(300);
  // 編輯舊的那筆：表單照它原本（沒標）→ 仍是「不標」；改成第 3 天
  let old = null;
  for (const b of await page.$$('.exp-item')) if ((await b.evaluate((e) => e.textContent)).includes('舊的一筆')) old = b;
  await old.click(); await page.waitForSelector('#modalRoot .exp-form'); await sleep(250);
  R = await dayRow();
  yes(R[0][2] && R.filter((x) => x[2]).length === 1, '編輯沒標的舊花費：表單仍是「不標」（不替它補一天）');
  await (await page.$('#modalRoot .exp-dayrow button[data-day="3"]')).click(); await sleep(100);
  await save();
  D = await daySec();
  yes(D.noday === '' && D.days.some((x) => x.startsWith('第 3 天') && x.includes('300')), `舊的那筆改成第 3 天之後「沒標日期」那行消失（${D.days.join('｜')}）`);
} catch (e) {
  fail++; console.log('✗ 例外 ' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n重要／訂好位＋花費第幾天：${pass} 項通過、${fail} 項失敗`);
process.exitCode = fail ? 1 : 0;
