// 交通方式的畫面測試（npm run legviewtest；在 test:chain 裡）。
// 涵蓋的程式：js/legs.js js/daymap.js js/realmap.js js/views/trip.js js/views/plan.js css/style.css
// 從一次性的 _legshots（被 .gitignore 擋）搬進來：2026-11-05 Dispatch——今天做的畫面只被不會自動跑的腳本驗過，
// 明天任何改動弄壞它都不會有東西紅。截圖與「實際大小輪廓」那段留在一次性腳本，這支只放斷言。
// 驗什麼：時間軸兩站之間的設定列（不預選、真實點擊設定、存 legFrom＋_f.leg）、播放游標依段換圖示
// （夾著沒座標的站＝圓點）、重排（走「調整每天的行程」的 ▼ 按鈕）與刪站後舊選擇不套用＋沒動到的那段仍在。
// 已知捷徑：刪站用 store.remove（畫面上的刪站在景點設定頁，這支沒走）。
// 突變實測（2026-11-05，在 _legshots 上）：拿掉 js/legs.js 的 legFrom 比對 → 正好紅重排兩條＋刪站一條。
// 圖磚攔成本機合成格線，不打 OSM。資料是合成的（日期 2024 年、店名自編）。
// 第 1 天 5 站：甲 → 乙 → 丙（沒座標）→ 丁 → 戊。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
const { LEG_ICON } = await import(new URL('../js/legs.js', import.meta.url));

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5781;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(900);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0, fail = 0;
const yes = (c, m, x) => { if (c) { pass++; console.log('✓ ' + m); } else { fail++; console.log('✗ ' + m + (x ? '｜' + x : '')); } };
const SPOTS = [
  [1, '甲・車站', '10:00', 24.754, 121.758],
  [1, '乙・博物館', '11:30', 24.869, 121.835],
  [1, '丙・巷口小店', '13:00', null, null],
  [1, '丁・溫泉公園', '15:00', 24.826, 121.770],
  [1, '戊・夜市', '19:00', 24.677, 121.770],
];

const page = await browser.newPage();
const stable = async (sel) => {
  for (let k = 0; k < 6; k++) {
    await page.evaluate((q) => { window.__p = document.querySelector(q); }, sel);
    await sleep(1800);
    if (await page.evaluate((q) => !!window.__p && window.__p === document.querySelector(q), sel)) return;
  }
};
const legs = () => page.evaluate(() => [...document.querySelectorAll('.daycollapse.open .tl-leg')].map((li) => ({
  spot: li.dataset.spot, mode: li.dataset.mode, text: li.querySelector('.tl-leg-btn').textContent.trim(),
  unset: li.querySelector('.tl-leg-btn').classList.contains('is-unset'),
  on: [...li.querySelectorAll('.tl-leg-opt.is-on')].map((b) => b.dataset.mode),
})));
const names = () => page.evaluate(() => [...document.querySelectorAll('.daycollapse.open .tl-item .qc-name')].map((e) => e.firstChild.textContent));
try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setBypassServiceWorker(true);
  page.on('pageerror', (e) => { fail++; console.log('✗ pageerror ' + e.message); });
  page.on('dialog', (d) => d.accept());
  await page.evaluateOnNewDocument((u) => { window.__TQ_TILE_URL = u; }, `http://localhost:${WEB}/__tiles/{z}/{x}/{y}.png`);
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    const u = new URL(rq.url());
    if (u.hostname === 'tile.openstreetmap.org') { fail++; console.log('✗ 打到真的 OSM'); return rq.abort(); }
    if (!u.pathname.startsWith('/__tiles/')) return rq.continue();
    const [, , x, y] = u.pathname.split('/').map((s) => parseInt(s, 10));
    rq.respond({ status: 200, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' },
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${(x + y) % 2 ? '#e8efe6' : '#dfe8ee'}" stroke="#9aa"/></svg>` });
  });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  const { tid, ids } = await page.evaluate(async (spots) => {
    const s = await import('./js/store.js');
    let k = 0; const uuid = () => `00000000-0000-4000-8000-${String(++k).padStart(12, '0')}`;
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '範例小旅行', region: '宜蘭', startDate: '2024-03-10', endDate: '2024-03-10' });
    let order = 0; const ids = [];
    for (const [day, name, startTime, lat, lng] of spots) {
      const sid = uuid(); ids.push(sid);
      await s.put({ id: sid, type: 'spot', tripId: tid, name, emoji: '📍', day, order: order++, startTime, ...(lat != null ? { lat, lng } : {}) });
      await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, order: 0, title: `拍下 ${name}` });
    }
    return { tid, ids };
  }, SPOTS);
  const [A, B, C, D, E] = ids;
  const openTrip = async () => {
    await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.daycollapse.open .tl-leg', { timeout: 10000 });
    await stable('.daycollapse.open .timeline');
  };
  await openTrip();

  // 一、一進來：5 站 → 4 列，全部「還沒設定」、選項裡沒有任何一個被預選
  let L = await legs();
  yes(L.length === 4, `5 站之間有 4 列「怎麼去」（實際 ${L.length}）`);
  yes(L.length === 4 && L.every((x) => x.unset && x.mode === '' && x.text.startsWith('怎麼去：還沒設定') && x.on.length === 0),
    '一開始每一列都寫「還沒設定」、沒有預選任何一種', JSON.stringify(L.map((x) => [x.text, x.on])));
  yes(L.map((x) => x.spot).join() === [B, C, D, E].join(), '每一列掛在到達站上（乙、丙、丁、戊）');

  // 二、從真實入口設：點「乙」前面那一列 → 選項打開 → 點「電車・捷運」
  const pickVia = async (spotId, mode) => {
    await page.evaluate((id) => document.querySelector(`.daycollapse.open .tl-leg[data-spot="${id}"]`).scrollIntoView({ block: 'center' }), spotId);
    await page.click(`.daycollapse.open .tl-leg[data-spot="${spotId}"] .tl-leg-btn`);
    await sleep(150);
    return page.evaluate((id) => !document.querySelector(`.daycollapse.open .tl-leg[data-spot="${id}"] .tl-leg-pick`).hidden, spotId);
  };
  const opened = await pickVia(B, 'train');
  yes(opened, '點那一列 → 七個選項打開');
  const optTexts = await page.evaluate((id) => [...document.querySelectorAll(`.daycollapse.open .tl-leg[data-spot="${id}"] .tl-leg-opt`)].map((b) => b.textContent.trim()), B);
  yes(optTexts.length === 7 && !optTexts.some((t) => t.includes('清除')), `沒設定時有 7 個選項、沒有「清除」（${optTexts.join('／')}）`);
  await page.click(`.daycollapse.open .tl-leg[data-spot="${B}"] .tl-leg-opt[data-mode="train"]`);
  await page.waitForFunction((id) => document.querySelector(`.daycollapse.open .tl-leg[data-spot="${id}"]`)?.dataset.mode === 'train', { timeout: 8000 }, B).catch(() => {});
  await stable('.daycollapse.open .timeline');
  await pickVia(E, 'bus');
  await page.click(`.daycollapse.open .tl-leg[data-spot="${E}"] .tl-leg-opt[data-mode="bus"]`);
  await page.waitForFunction((id) => document.querySelector(`.daycollapse.open .tl-leg[data-spot="${id}"]`)?.dataset.mode === 'bus', { timeout: 8000 }, E).catch(() => {});
  await stable('.daycollapse.open .timeline');
  L = await legs();
  const byS = Object.fromEntries(L.map((x) => [x.spot, x]));
  yes(byS[B]?.mode === 'train' && byS[B].text.includes('電車') && !byS[B].unset, `甲→乙 設成電車後那一列寫「${byS[B]?.text}」`);
  yes(byS[E]?.mode === 'bus' && byS[E].text.includes('公車'), `丁→戊 設成公車（${byS[E]?.text}）`);
  yes(byS[C]?.unset && byS[D]?.unset, '沒設的兩列（乙→丙、丙→丁）仍是「還沒設定」');
  const rec = await page.evaluate(async (id) => { const s = await import('./js/store.js'); const x = s.get(id); return { legFrom: x.legFrom, legMode: x.legMode, f: !!(x._f && x._f.leg) }; }, B);
  yes(rec.legFrom === A && rec.legMode === 'train' && rec.f, `存下去的是「前一站＝甲」＋電車，而且 _f.leg 有時間戳（${JSON.stringify(rec)}）`);
  await page.evaluate(() => document.querySelector('.daycollapse.open .timeline').scrollIntoView({ block: 'start' }));
  await sleep(300);

  // 三、播放（×4）：移動中的游標——甲→乙 是電車圖示、乙→丁（中間夾著沒座標的丙）是圓點、丁→戊 是公車；到站一律圓點
  await page.evaluate(() => { const el = document.querySelector('.daycollapse.open .daymap'); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 120, behavior: 'instant' }); });
  await sleep(400);
  await page.click('.daycollapse.open .dm-speed'); await page.click('.daycollapse.open .dm-speed');
  await page.click('.daycollapse.open .dm-play');
  const log = [];
  for (let k = 0; k < 500; k++) {
    const x = await page.evaluate(() => {
      const b = document.querySelector('.daycollapse.open .dm-player');
      const c = document.querySelector('.daycollapse.open .rm-cursor');
      return { phase: b.dataset.phase, step: b.dataset.step, pm: b.dataset.mode || '', cm: c.dataset.mode || '', ic: c.textContent, isMode: c.classList.contains('is-mode') };
    });
    log.push(x);
    if (x.phase === 'done') break;
    await sleep(30);
  }
  const mv = (n) => log.filter((x) => x.phase === 'move' && x.step === String(n));
  yes(log.at(-1).phase === 'done', `前置：播得完（記了 ${log.length} 筆）`);
  yes(mv(2).length > 0 && mv(2).every((x) => x.cm === 'train' && x.ic === LEG_ICON.train && x.isMode), `往乙移動中：游標是電車圖示（${mv(2).length} 筆）`, JSON.stringify(mv(2).slice(0, 2)));
  yes(mv(4).length > 0 && mv(4).every((x) => x.cm === '' && x.ic === '' && !x.isMode), `往丁移動中（中間夾著沒座標的丙）：游標是圓點（${mv(4).length} 筆）`, JSON.stringify(mv(4).slice(0, 2)));
  yes(mv(5).length > 0 && mv(5).every((x) => x.cm === 'bus' && x.ic === LEG_ICON.bus), `往戊移動中：游標是公車圖示（${mv(5).length} 筆）`);
  const atStop = log.filter((x) => x.phase === 'stop' || x.phase === 'missing');
  yes(atStop.length > 0 && atStop.every((x) => x.cm === '' && !x.isMode), `到站時一律圓點（${atStop.length} 筆）`);

  // 四、重排（真實路徑：調整每天的行程 → 乙「往後移」）：甲 丙 乙 丁 戊
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector(`.plan-row[data-id="${B}"] .plan-arrow[aria-label="往後移"]`, { timeout: 10000 });
  await page.click(`.plan-row[data-id="${B}"] .plan-arrow[aria-label="往後移"]`);
  await sleep(800);
  await openTrip();
  const order = await names();
  yes(order.join('，') === '甲・車站，丙・巷口小店，乙・博物館，丁・溫泉公園，戊・夜市', `前置：重排生效（${order.join('，')}）`);
  L = await legs();
  const b2 = Object.fromEntries(L.map((x) => [x.spot, x]));
  yes(b2[B]?.unset && b2[B].mode === '' && b2[B].on.length === 0, `重排後丙→乙 不套用乙原本的「電車」（寫「${b2[B]?.text}」）`);
  yes(L.filter((x) => x.mode === 'train').length === 0, '重排後畫面上沒有任何一段是電車');
  yes(b2[E]?.mode === 'bus', `對照：丁→戊 沒被動到，仍是公車（${b2[E]?.text}）`);

  // 五、刪站（丁）：戊的前一站變成乙，舊的「公車」（記的是丁）不套用
  await page.evaluate(async (id) => { const s = await import('./js/store.js'); await s.remove(id); }, D);
  await openTrip();
  const order2 = await names();
  yes(!order2.includes('丁・溫泉公園') && order2.length === 4, `前置：丁已刪（${order2.join('，')}）`);
  L = await legs();
  const b3 = Object.fromEntries(L.map((x) => [x.spot, x]));
  yes(b3[E]?.unset && b3[E].mode === '', `刪掉丁之後 乙→戊 不套用舊的「公車」（寫「${b3[E]?.text}」）`);
} catch (e) {
  fail++; console.log('✗ 例外 ' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n交通方式畫面：${pass} 項通過、${fail} 項失敗`);
process.exitCode = fail ? 1 : 0;
