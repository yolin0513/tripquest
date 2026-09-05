// 線上正式站的匯入流程驗證（node scripts/livecheck-import.mjs）
// 本機全過不代表線上正確 —— SW 快取、CSP、檔案有沒有真的上去都只在這裡才看得到。
import puppeteer from 'puppeteer';

const BASE = 'https://yolin0513.github.io/tripquest/';
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, e) => { console.error('✗ ' + m + (e ? '\n   ' + e : '')); process.exitCode = 1; };
const yes = (c, m, e) => (c ? ok(m) : fail(m, e));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const outbound = [];
page.on('request', (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith('data:')) outbound.push(u); });

const clickText = (sel, t) => page.evaluate((s, x) => {
  const el = [...document.querySelectorAll(s)].find((e) => (e.textContent || '').includes(x));
  if (el) el.click();
  return !!el;
}, sel, t);

try {
  await page.goto(BASE + '#/new', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('.page.form', { timeout: 30000 });
  const ver = await page.evaluate(() => fetch('./sw.js', { cache: 'reload' }).then((r) => r.text()).then((t) => (t.match(/tripquest-v[\d.]+/) || [''])[0]));
  yes(ver === 'tripquest-v1.36.0', `線上版本是 ${ver}`);

  await page.evaluate(() => { document.querySelector('details').open = true; });
  yes(await clickText('button', '匯入行程表'), '線上：進階區有匯入按鈕，按得下去');
  await page.waitForSelector('.imp-src', { timeout: 15000 });
  ok('線上：來源選單開得起來（新模組真的部署上去了）');

  yes(await clickText('.imp-src', '直接打字'), '線上：選「直接打字」');
  await page.waitForSelector('textarea.mono', { timeout: 15000 });
  await page.evaluate(() => {
    const ta = [...document.querySelectorAll('textarea')].pop();
    ta.value = '【第1天】台北\n09:00 台北101 停留2小時\n12:00 午餐：鼎泰豐\n14:00 - 16:30 士林夜市\n【第2天】\n09:00 九份老街（搭公車 約40分鐘）\n13:00 十分瀑布';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText('.modal-actions .btn', '讀讀看');
  await page.waitForSelector('.imp-row', { timeout: 15000 });

  const rows = await page.$$eval('.imp-row', (els) => els.map((e) => ({
    n: e.querySelector('.imp-name').value, d: e.querySelector('.imp-day-sel').value,
    t: e.querySelector('.imp-time').value, s: e.querySelector('.imp-stay').value,
  })));
  yes(rows.length === 5, `線上：解析出 5 筆（實得 ${rows.length}）`, JSON.stringify(rows));
  const by = (n) => rows.find((r) => r.n === n);
  yes(by('台北101') && by('台北101').s === '120', '線上：停留2小時 → 120 分');
  yes(by('士林夜市') && by('士林夜市').s === '150', '線上：14:00-16:30 → 150 分（不在預設選項也顯示得出來）');
  yes(by('九份老街') && by('九份老街').d === '2' && by('九份老街').s === '', '線上：第2天、搭公車40分鐘不算停留');
  yes(!rows.some((r) => /^[【\[]/.test(r.n) || r.n === '台北'), '線上：天標題不會變成景點');

  // 沒有超出畫面（v1.31 那個 modal 捲不動的 bug 不能再出現）
  const geo = await page.evaluate(() => {
    const c = document.querySelector('.modal-card');
    return { top: c.getBoundingClientRect().top, h: c.getBoundingClientRect().height, vh: innerHeight };
  });
  yes(geo.top >= -1 && geo.h <= geo.vh + 1, `線上：確認視窗在畫面內（top=${Math.round(geo.top)} h=${Math.round(geo.h)} vh=${geo.vh}）`);

  await clickText('.modal-actions .btn', '就這樣建立');
  await page.waitForFunction(() => document.querySelector('.imp-bar') && !document.querySelector('.imp-bar').hidden, { timeout: 15000 });
  await page.evaluate(() => {
    const f = document.querySelector('input.field[type=text]');
    f.value = '線上匯入驗證';
    f.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText('button.btn-primary', '產生拍照任務');
  await page.waitForFunction(() => location.hash.startsWith('#/trip/'), { timeout: 40000 });
  // 網址會比畫面早一步 —— 路由處理是非同步的（載主題、讀 store）。
  // 不等實際內容就斷言，量到的還是建立頁。
  await page.waitForSelector('.qcollapse', { timeout: 30000 });
  ok('線上：建立成功並跳到行程頁');

  const data = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const tid = location.hash.split('/')[2];
    const spots = s.spotsOf(tid).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    return { names: spots.map((x) => x.name), days: spots.map((x) => x.day), t0: spots[0] && spots[0].startMin, s0: spots[0] && spots[0].stayMin, q: s.questsOfTrip(tid).length };
  });
  yes(data.names.length === 5, `線上：建立了 5 個景點（${data.names.join('、')}）`);
  yes(data.q >= 5, `線上：出了 ${data.q} 個任務`);
  yes(data.t0 === 540 && data.s0 === 120, '線上：時間與停留有存進 spot');
  yes(String(data.days) === '1,1,1,2,2', `線上：天數分配正確（${data.days}）`);
  const shown = await page.evaluate(() => document.body.textContent.includes('09:00 停留 2 小時'));
  yes(shown, '線上：行程頁看得到「🕘 09:00 停留 2 小時」');

  // 純文字流程不該碰到任何 AI 服務
  yes(!outbound.some((u) => /api.anthropic.com|texttospeech.googleapis.com/.test(u)), '線上：純文字流程沒有連到 AI 服務', outbound.filter((u) => /api.anthropic.com|texttospeech.googleapis.com/.test(u)).join(' '));

  const realErrs = errs.filter((e) => !/favicon|net::ERR_(INTERNET|NAME)/.test(e));
  yes(realErrs.length === 0, '線上：沒有 JS 例外或主控台錯誤', realErrs.join(' | '));
} catch (e) {
  fail('線上驗證中斷：' + e.message);
} finally {
  await browser.close();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
