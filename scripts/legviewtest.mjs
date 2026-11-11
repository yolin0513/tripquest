// 交通方式的畫面測試（npm run legviewtest；在 test:chain 裡）。
// 涵蓋的程式：js/legs.js js/daymap.js js/realmap.js js/views/trip.js js/views/plan.js css/style.css
// 從一次性的 _legshots（被 .gitignore 擋）搬進來：2026-11-05 Dispatch——今天做的畫面只被不會自動跑的腳本驗過，
// 明天任何改動弄壞它都不會有東西紅。截圖與「實際大小輪廓」那段留在一次性腳本，這支只放斷言。
// 驗什麼：時間軸兩站之間的設定列（不預選、真實點擊設定、存 legFrom＋_f.leg）、播放游標依段換圖示
// （夾著沒座標的站＝圓點）、重排（走「調整每天的行程」的 ▼ 按鈕）與刪站後舊選擇不套用＋沒動到的那段仍在；
// 選項格子（2026-11-11 A 方案：名字一律一行、15 種寬度×字級）與「點寫著搭車的那一格 → 存 car」。
// 已知捷徑：刪站用 store.remove（畫面上的刪站在景點設定頁，這支沒走）。
// 突變實測（2026-11-05，在 _legshots 上）：拿掉 js/legs.js 的 legFrom 比對 → 正好紅重排兩條＋刪站一條。
// 圖磚攔成本機合成格線，不打 OSM。資料是合成的（日期 2024 年、店名自編）。
// 第 1 天 5 站：甲 → 乙 → 丙（沒座標）→ 丁 → 戊。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { blankTextScan } from './blanktext.mjs';
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
  // 空值被印成文字（2026-11-11 Yolin 截圖：沒設定那一組的選項旁出現純文字 null）。整個行程頁掃一次，含收起來的選項。
  // 為什麼之前沒抓到：這裡本來就測了「沒設定」的狀態，但只數 .tl-leg-opt 按鈕（下面「7 個選項、沒有清除」那條）——
  // 那個 null 是按鈕旁邊的文字節點，不是按鈕，數按鈕永遠看不到它。
  const blank0 = await blankTextScan(page);
  yes(blank0.ok && blank0.texts > 0 && blank0.hits.length === 0,
    `全部沒設定時：整個行程頁沒有空值被印成文字（掃了 ${blank0.texts} 個文字節點、${blank0.attrs} 個屬性；對照樣本${blank0.ok ? '全中' : '沒中：' + blank0.broken.join('、')}）`,
    blank0.hits.slice(0, 3).map((h) => `${h.where}［${h.kind}］${h.text}`).join('；'));

  // 二、從真實入口設：點「乙」前面那一列 → 選項打開 → 點「鐵路」（代號 train；2026-11-11 前叫「電車・捷運」）
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
  yes(byS[B]?.mode === 'train' && byS[B].text.includes('鐵路') && !byS[B].unset, `甲→乙 設成鐵路（train）後那一列寫「${byS[B]?.text}」`);
  yes(byS[E]?.mode === 'bus' && byS[E].text.includes('公車'), `丁→戊 設成公車（${byS[E]?.text}）`);
  yes(byS[C]?.unset && byS[D]?.unset, '沒設的兩列（乙→丙、丙→丁）仍是「還沒設定」');
  const rec = await page.evaluate(async (id) => { const s = await import('./js/store.js'); const x = s.get(id); return { legFrom: x.legFrom, legMode: x.legMode, f: !!(x._f && x._f.leg) }; }, B);
  yes(rec.legFrom === A && rec.legMode === 'train' && rec.f, `存下去的是「前一站＝甲」＋電車，而且 _f.leg 有時間戳（${JSON.stringify(rec)}）`);
  const blank1 = await blankTextScan(page);
  yes(blank1.ok && blank1.texts > 0 && blank1.hits.length === 0,
    `設了兩段、兩段沒設時：整個行程頁沒有空值被印成文字（掃了 ${blank1.texts} 個文字節點、${blank1.attrs} 個屬性）`,
    blank1.hits.slice(0, 3).map((h) => `${h.where}［${h.kind}］${h.text}`).join('；'));
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

  // 六、選項的格子（2026-11-11 Yolin 選 A：「選項內的文字及換行請整齊」；開車・計程車改名「搭車」）
  // 現在順序是 甲 丙 乙 戊；丙那一列（甲→丙）沒設定、打開有 7 格。
  // 打開用真的點擊（pickVia）。背景重畫會把打開的選項收起來（既有的時序問題，見 STATUS），這裡最多重點 3 次——
  // 「點了會打開」那件事由上面第二步那條守，這裡守的是格子本身。
  const openC = async () => { for (let k = 0; k < 3; k++) if (await pickVia(C)) return true; return false; };
  // 量格子：每格的名字只准一行（文字範圍的每個框同一個 top），而且整段落在格子內緣（扣框線與內距）裡。
  // 量的時候把選項區的 hidden 拿掉——換寬度、換字級時背景重畫可能把它收起來；這段量的是排版，不是開關。
  const legFit = () => page.evaluate((id) => {
    const pick = document.querySelector(`.daycollapse.open .tl-leg[data-spot="${id}"] .tl-leg-pick`);
    if (!pick) return { n: 0, bad: ['找不到選項區'] };
    pick.hidden = false;
    const bad = []; let n = 0;
    for (const b of pick.querySelectorAll('.tl-leg-opt')) {
      const nm = b.querySelector('.tl-leg-name');
      if (!nm) { bad.push('有一格沒有名字'); continue; }
      n++;
      const cs = getComputedStyle(b), r = b.getBoundingClientRect();
      const L = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) - 0.5;
      const R = r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight) + 0.5;
      const rg = document.createRange(); rg.selectNodeContents(nm);
      const lines = new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size;
      const nr = rg.getBoundingClientRect();
      if (lines !== 1) bad.push(`「${nm.textContent}」折成 ${lines} 行`);
      if (nr.left < L || nr.right > R) bad.push(`「${nm.textContent}」超出格子（${Math.round(nr.left)}～${Math.round(nr.right)}，內緣 ${Math.round(L)}～${Math.round(R)}）`);
    }
    return { n, bad };
  }, C);
  const MOB = (w) => ({ width: w, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const setFs = (v) => page.evaluate((v) => { if (v === 'm') delete document.documentElement.dataset.fs; else document.documentElement.dataset.fs = v; }, v);
  const opened6 = await openC();
  const shown = await page.evaluate((id) => [...document.querySelectorAll(`.daycollapse.open .tl-leg[data-spot="${id}"] .tl-leg-opt .tl-leg-name`)].map((e) => e.textContent.trim()), C);
  const WANT = ['走路', '鐵路', '公車', '搭車', '船', '飛機', '其他'];
  // 對照組：名字改成可以折行、寬度壓到 1 個字，必須量到「折成 2 行」——量法抓不到折行，下面的「都一行」就不算數。
  // 第一版用「可折行＋字放大」：名字改短（最長 2 個字）之後放大也折不了行，對照組量不到、自己報紅（2026-11-11）——
  // 對照組不能靠名字的長度，所以改成壓寬度，任何 2 個字以上的名字都一定折。
  await page.setViewport(MOB(320)); await setFs('xl');
  await page.evaluate(() => { const s = document.createElement('style'); s.id = 'ctl-wrap'; s.textContent = '.tl-leg-name { white-space: normal !important; display: inline-block; width: 1em !important; }'; document.head.append(s); });
  await sleep(120);
  const ctl = await legFit();
  await page.evaluate(() => document.getElementById('ctl-wrap')?.remove());
  const ctlCaught = ctl.bad.some((x) => /折成 [2-9] 行/.test(x));
  const fitBad = []; let combos = 0;
  for (const w of [320, 360, 390, 430, 440]) for (const fs of ['m', 'l', 'xl']) {
    await page.setViewport(MOB(w)); await setFs(fs); await sleep(100);
    const r = await legFit(); combos++;
    if (r.n !== 7) fitBad.push(`${w}px／${fs}：只量到 ${r.n} 格（應為 7）`);
    for (const b of r.bad) fitBad.push(`${w}px／${fs}：${b}`);
  }
  await setFs('m'); await page.setViewport(MOB(390)); await sleep(150);
  yes(opened6 && shown.join('｜') === WANT.join('｜') && ctlCaught && combos === 15 && fitBad.length === 0,
    `選項格子：7 格名字照順序（${shown.join('｜')}）、15 種寬度×字級每個名字都一行、都在格子裡（對照組：可折行＋壓成 1 字寬時${ctlCaught ? '量得到折行' : '量不到折行'}）`,
    [!opened6 && '選項打不開', `${fitBad.length} 處：` + fitBad.slice(0, 4).join('；'), !ctlCaught && `對照組 ${JSON.stringify(ctl.bad.slice(0, 2))}`].filter(Boolean).join('｜'));

  // 選了之後存進去的值：從畫面上寫「搭車」的那一格點（使用者看到的是字），存進去的必須是代號 car——
  // 不是字「搭車」、也不是新代號。顯示名稱和存進去的值是兩件事，改名時最容易把它們搞混。
  await openC();
  let carTile = null;
  for (const t of await page.$$(`.daycollapse.open .tl-leg[data-spot="${C}"] .tl-leg-opt`)) {
    if ((await t.$eval('.tl-leg-name', (e) => e.textContent.trim()).catch(() => '')) === '搭車') carTile = t;
  }
  if (carTile) await carTile.click();
  await page.waitForFunction((id) => document.querySelector(`.daycollapse.open .tl-leg[data-spot="${id}"]`)?.dataset.mode === 'car', { timeout: 8000 }, C).catch(() => {});
  const rec6 = await page.evaluate(async (id) => { const s = await import('./js/store.js'); const x = s.get(id); return { legFrom: x.legFrom, legMode: x.legMode }; }, C);
  const btn6 = await page.$eval(`.daycollapse.open .tl-leg[data-spot="${C}"] .tl-leg-btn`, (e) => e.textContent.trim()).catch(() => '');
  yes(!!carTile && rec6.legMode === 'car' && rec6.legFrom === A && btn6.includes('搭車') && !btn6.includes('計程車'),
    `點畫面上寫「搭車」的那一格 → 存進去的是代號 car、前一站＝甲；按鈕寫「${btn6}」`, `${carTile ? '' : '找不到寫「搭車」的格子｜'}${JSON.stringify(rec6)}`);

  // 舊值：舊版客戶端存的是代號（train），不是字；改名之後不遷移資料（Dispatch 2026-11-11：只在顯示層對應，伺服器不改寫）。
  // 直接把一筆 train 寫進資料庫（不經新畫面，等於舊版手機推上來的那一筆）→ 重開頁面，那一列要寫新名字「鐵路」，
  // 不能寫舊名字、也不能變「還沒設定」（換代號就會變這樣）。丙→乙 這段現在沒設定，前一站是丙。
  await page.evaluate(async (id, from) => { const s = await import('./js/store.js'); await s.patch(id, { legFrom: from, legMode: 'train' }); }, B, C);
  await openTrip();
  const old6 = await page.evaluate((id) => { const li = document.querySelector(`.daycollapse.open .tl-leg[data-spot="${id}"]`); return { mode: li?.dataset.mode, text: li?.querySelector('.tl-leg-btn')?.textContent.trim() || '' }; }, B);
  yes(old6.mode === 'train' && old6.text.includes('鐵路') && !old6.text.includes('電車') && !old6.text.includes('還沒設定'),
    `舊版存的 train（直接寫進資料庫）→ 畫面寫新名字（「${old6.text}」）`, JSON.stringify(old6));
} catch (e) {
  fail++; console.log('✗ 例外 ' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n交通方式畫面：${pass} 項通過、${fail} 項失敗`);
process.exitCode = fail ? 1 : 0;
