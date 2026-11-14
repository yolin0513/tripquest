// 交通方式的畫面測試（npm run legviewtest；在 test:chain 裡）。
// 涵蓋的程式：js/legs.js js/daymap.js js/realmap.js js/views/trip.js js/views/plan.js css/style.css
// 從一次性的 _legshots（被 .gitignore 擋）搬進來：2026-11-05 Dispatch——今天做的畫面只被不會自動跑的腳本驗過，
// 明天任何改動弄壞它都不會有東西紅。截圖與「實際大小輪廓」那段留在一次性腳本，這支只放斷言。
// 驗什麼：時間軸兩站之間的設定列（不預選、真實點擊設定、存 legFrom＋_f.leg）、播放游標依段換圖示
// （夾著沒座標的站＝圓點）、重排（走「調整每天的行程」的 ▼ 按鈕）與刪站後舊選擇不套用＋沒動到的那段仍在；
// 選項格子（2026-11-11 A 方案：名字一律一行、15 種寬度×字級）與「點寫著搭車的那一格 → 存 car」；
// 背景寫入不收起打開的選項、收起來時補重畫（2026-11-11 守夜）。
// v1.87.0（Yolin 看 v1.86.0 實機）：「怎麼去」只在行程分頁——任務頁沒有「怎麼去」也沒有地圖（零），
//   全部的設定都在行程分頁做；行程分頁那一天是行程內容在上、可以播放的路線圖在最下面（二之二）。
// 不打真網路（共用慣例 §5.6；v1.87.0 補上——之前維基、路線服務的請求照樣放出去）：
//   圖磚攔成本機合成格線；其他外站一律當場回 404（跟維基查不到那一條同一種回應：只寫「查過了」的旗標、不推高 updatedAt）。
//   這支原本 flaky 的根因就在這裡：背景補維基圖片寫 heroHash → 任務頁的簽章變了 → 整頁重畫、點到一半的節點被換掉。
// 已知捷徑：刪站用 store.remove（畫面上的刪站在景點設定頁，這支沒走）。
// 突變實測（2026-11-05，在 _legshots 上）：拿掉 js/legs.js 的 legFrom 比對 → 正好紅重排兩條＋刪站一條。
// 資料是合成的（日期 2024 年、店名自編）。第 1 天 5 站：甲 → 乙 → 丙（沒座標）→ 丁 → 戊。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { blankTextScan } from './blanktext.mjs';
const { LEG_ICON } = await import(new URL('../js/legs.js', import.meta.url));

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5781;
const ORIGIN = `http://localhost:${WEB}`;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(900);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0, fail = 0;
const yes = (c, m, x) => { if (c) { pass++; console.log('✓ ' + m); } else { fail++; console.log('✗ ' + m + (x ? '｜' + x : '')); } };
const J = (x) => JSON.stringify(x);
const SPOTS = [
  [1, '甲・車站', '10:00', 24.754, 121.758],
  [1, '乙・博物館', '11:30', 24.869, 121.835],
  [1, '丙・巷口小店', '13:00', null, null],
  [1, '丁・溫泉公園', '15:00', 24.826, 121.770],
  [1, '戊・夜市', '19:00', 24.677, 121.770],
];
// 行程分頁裡打開的那一天（v1.87.0 起「怎麼去」只在這裡；選擇器一律從 .itin-page 開頭，跑到任務頁就什麼都量不到）
const DC = '.itin-page .daycollapse.open';
// 八（v1.87.1「約幾點到」）的另一趟：一天 6 站，名字自編、座標合成（彼此相隔幾公里，不會被當成跨區）。
// [名字, 自己填的幾點到, 停留分鐘, lat, lng]
const ETA = [
  ['子・老街口', '10:00', 180, 24.600, 121.700],
  ['丑・河濱公園', '', 60, 24.640, 121.720],
  ['寅・小書店', '', 30, 24.680, 121.740],
  ['卯・茶屋', '16:00', 30, 24.720, 121.760],
  ['辰・漁港', '', 0, 24.760, 121.780],
  ['巳・夜市口', '', 0, 24.800, 121.800],
];
// 相鄰兩站的合成車程（秒）：40、16、10、25、12 分；不相鄰的隨便給（用不到）
const ETA_SEC = [2400, 960, 600, 1500, 720];
let osrmFake = 0;
// 路線服務的 /table：座標全是這一趟的才回合成的矩陣（其他照舊 404——原本那一趟的行為不變）
function fakeTable(pathname) {
  const pts = decodeURIComponent(pathname.split('/').pop() || '').split(';').map((s) => s.split(',').map(Number));
  const idx = pts.map(([lng, lat]) => ETA.findIndex((e) => Math.abs(e[3] - lat) < 1e-9 && Math.abs(e[4] - lng) < 1e-9));
  if (!idx.length || idx.some((i) => i < 0)) return null;
  const sec = (a, b) => (a === b ? 0 : Math.abs(a - b) === 1 ? ETA_SEC[Math.min(a, b)] : 3000);
  return JSON.stringify({ code: 'Ok', durations: idx.map((a) => idx.map((b) => sec(a, b))) });
}

const page = await browser.newPage();
const stable = async (sel) => {
  for (let k = 0; k < 6; k++) {
    await page.evaluate((q) => { window.__p = document.querySelector(q); }, sel);
    await sleep(1800);
    if (await page.evaluate((q) => !!window.__p && window.__p === document.querySelector(q), sel)) return;
  }
};
const legs = () => page.evaluate((dc) => [...document.querySelectorAll(`${dc} .tl-leg`)].map((li) => ({
  spot: li.dataset.spot, mode: li.dataset.mode, text: li.querySelector('.tl-leg-btn').textContent.trim(),
  unset: li.querySelector('.tl-leg-btn').classList.contains('is-unset'),
  on: [...li.querySelectorAll('.tl-leg-opt.is-on')].map((b) => b.dataset.mode),
})), DC);
// 行程分頁的站名：「📍 甲・車站」→ 拿掉最前面的表情符號
const names = () => page.evaluate((dc) => [...document.querySelectorAll(`${dc} .tl-item .itin-stop`)].map((e) => e.textContent.replace(/^\S+\s/, '')), DC);
const ext = new Map();   // 攔下的外站請求（主機 → 次數），結尾印出來
try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setBypassServiceWorker(true);
  page.on('pageerror', (e) => { fail++; console.log('✗ pageerror ' + e.message); });
  page.on('dialog', (d) => d.accept());
  await page.evaluateOnNewDocument((u) => { window.__TQ_TILE_URL = u; }, `${ORIGIN}/__tiles/{z}/{x}/{y}.png`);
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    if (!/^https?:/.test(rq.url())) return rq.continue();   // data:、blob:
    const u = new URL(rq.url());
    if (u.hostname === 'tile.openstreetmap.org') { fail++; console.log('✗ 打到真的 OSM'); return rq.abort(); }
    if (u.origin !== ORIGIN) {
      if (u.hostname === 'routing.openstreetmap.de') {
        const body = fakeTable(u.pathname);
        if (body) { osrmFake++; return rq.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body }); }
      }
      ext.set(u.hostname, (ext.get(u.hostname) || 0) + 1);
      return rq.respond({ status: 404, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' });
    }
    if (!u.pathname.startsWith('/__tiles/')) return rq.continue();
    const [, , x, y] = u.pathname.split('/').map((s) => parseInt(s, 10));
    rq.respond({ status: 200, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' },
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${(x + y) % 2 ? '#e8efe6' : '#dfe8ee'}" stroke="#9aa"/></svg>` });
  });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
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
  // 進行程分頁的「行程」那一格。第一次走使用者的路（零：任務頁 → 底部「行程」→ 最上面那一排的「行程」）；
  // 之後直接開行程分頁的網址——剛剛選的那一格記在 sessionStorage，同一個分頁重開還是「行程」；萬一沒記住就再點一次。
  const openItin = async () => {
    await page.goto(`${ORIGIN}/#/trip/${tid}/itinerary`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.itin-page .itin-seg', { timeout: 10000 });
    if (await page.evaluate(() => document.getElementById('itin-pane-plan')?.hidden !== false)) {
      for (const b of await page.$$('.itin-seg button')) if ((await b.evaluate((e) => e.textContent)) === '行程') { await b.click(); break; }
    }
    await page.waitForSelector(`${DC} .tl-leg`, { timeout: 10000 });
    await stable(`${DC} .timeline`);
  };

  // 零、任務頁（v1.87.0；Yolin 看 v1.86.0 實機「任務頁不顯示移動方式，只在行程頁顯示」）：
  // 任務頁的時間軸在、5 站都在（「沒有」才有母體），但沒有任何一列「怎麼去」、也沒有當天地圖。
  await page.goto(`${ORIGIN}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.daycollapse.open .timeline .tl-item', { timeout: 10000 });
  await stable('.daycollapse.open .timeline');
  const task0 = await page.evaluate(() => ({
    task: !document.querySelector('.itin-page') && !!document.querySelector('#view .page .qcollapse'),
    items: document.querySelectorAll('.daycollapse.open .timeline > .tl-item').length,
    legs: document.querySelectorAll('#view .tl-leg, #view .tl-leg-btn, #view .tl-leg-route').length,
    map: document.querySelectorAll('#view .daymap').length,
  }));
  yes(task0.task && task0.items === 5 && task0.legs === 0 && task0.map === 0,
    `零 任務頁：時間軸 5 站都在，沒有「怎麼去」（${task0.legs} 列）、沒有當天地圖（${task0.map} 張）`, JSON.stringify(task0));
  for (const a of await page.$$('#tabbar a.tab')) if ((await a.evaluate((e) => e.textContent)).includes('行程')) { await a.click(); break; }
  // v1.86.0：這趟是 2024 年（已結束），行程分頁預設亮「回顧」——點最上面那一排的「行程」（使用者的路）
  await page.waitForFunction(() => /\/itinerary$/.test(location.hash) && document.querySelector('.itin-seg'), { timeout: 10000 });
  for (const b of await page.$$('.itin-seg button')) if ((await b.evaluate((e) => e.textContent)) === '行程') { await b.click(); break; }
  await page.waitForSelector(`${DC} .tl-leg`, { timeout: 10000 });
  await stable(`${DC} .timeline`);

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
  const pickVia = async (spotId) => {
    await page.evaluate((dc, id) => document.querySelector(`${dc} .tl-leg[data-spot="${id}"]`).scrollIntoView({ block: 'center' }), DC, spotId);
    await page.click(`${DC} .tl-leg[data-spot="${spotId}"] .tl-leg-btn`);
    await sleep(150);
    return page.evaluate((dc, id) => !document.querySelector(`${dc} .tl-leg[data-spot="${id}"] .tl-leg-pick`).hidden, DC, spotId);
  };
  const modeIs = (id, mode) => page.waitForFunction((dc, id, mode) => document.querySelector(`${dc} .tl-leg[data-spot="${id}"]`)?.dataset.mode === mode, { timeout: 8000 }, DC, id, mode).catch(() => {});
  const opened = await pickVia(B);
  yes(opened, '點那一列 → 七個選項打開');
  const optTexts = await page.evaluate((dc, id) => [...document.querySelectorAll(`${dc} .tl-leg[data-spot="${id}"] .tl-leg-opt`)].map((b) => b.textContent.trim()), DC, B);
  yes(optTexts.length === 7 && !optTexts.some((t) => t.includes('清除')), `沒設定時有 7 個選項、沒有「清除」（${optTexts.join('／')}）`);
  await page.click(`${DC} .tl-leg[data-spot="${B}"] .tl-leg-opt[data-mode="train"]`);
  await modeIs(B, 'train');
  await stable(`${DC} .timeline`);
  await pickVia(E);
  await page.click(`${DC} .tl-leg[data-spot="${E}"] .tl-leg-opt[data-mode="bus"]`);
  await modeIs(E, 'bus');
  await stable(`${DC} .timeline`);
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
  // 設好的「怎麼去」在任務頁照樣不出現（設了之後才有字可以漏出去）
  await page.goto(`${ORIGIN}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.daycollapse.open .timeline .tl-item', { timeout: 10000 });
  const task1 = await page.evaluate(() => ({
    items: document.querySelectorAll('.daycollapse.open .timeline > .tl-item').length,
    legs: document.querySelectorAll('#view .tl-leg, #view .tl-leg-btn, #view .tl-leg-route').length,
    words: /鐵路|公車|怎麼去/.test(document.querySelector('#view .page')?.textContent || ''),
  }));
  yes(task1.items === 5 && task1.legs === 0 && !task1.words, `設了鐵路、公車之後，任務頁照樣沒有「怎麼去」（${task1.legs} 列；字面上有沒有「鐵路／公車／怎麼去」：${task1.words}）`, JSON.stringify(task1));
  await openItin();

  // 二之二（v1.87.0；Yolin 看 v1.86.0 實機）：行程分頁那一天——行程內容（時間軸、怎麼去）在上、可以播放的路線圖在最下面
  const ord = await page.evaluate((dc) => {
    const inner = document.querySelector(`${dc} .dc-inner`);
    if (!inner) return null;
    const tl = inner.querySelector(':scope > .timeline'), map = inner.querySelector(':scope > .daymap');
    return { tl: !!tl, map: !!map, tlFirst: !!tl && inner.firstElementChild === tl, mapLast: !!map && inner.lastElementChild === map,
      above: !!tl && !!map && tl.getBoundingClientRect().bottom <= map.getBoundingClientRect().top + 1, play: !!map && !!map.querySelector('.dm-play') };
  }, DC);
  yes(!!ord && ord.tl && ord.map && ord.tlFirst && ord.mapLast && ord.above && ord.play,
    '行程分頁那一天：時間軸在最上面、可以播放的路線圖在最下面（畫面上也是時間軸在地圖上方）', JSON.stringify(ord));
  L = await legs();
  const itinB = L.find((x) => x.spot === B), itinE = L.find((x) => x.spot === E);
  yes(L.length === 4 && itinB?.mode === 'train' && itinB.text.includes('鐵路') && itinE?.mode === 'bus',
    `重開行程分頁，設好的「怎麼去」還在：4 段、甲→乙 鐵路、丁→戊 公車（${L.map((x) => x.mode || '－').join('、')}）`);

  // 三、播放（×4）：移動中的游標——甲→乙 是電車圖示、乙→丁（中間夾著沒座標的丙）是圓點、丁→戊 是公車；到站一律圓點
  await page.evaluate((dc) => { const el = document.querySelector(`${dc} .daymap`); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 120, behavior: 'instant' }); }, DC);
  await sleep(400);
  await page.click(`${DC} .dm-speed`); await page.click(`${DC} .dm-speed`);
  await page.click(`${DC} .dm-play`);
  const log = [];
  for (let k = 0; k < 500; k++) {
    const x = await page.evaluate((dc) => {
      const b = document.querySelector(`${dc} .dm-player`);
      const c = document.querySelector(`${dc} .rm-cursor`);
      return { phase: b.dataset.phase, step: b.dataset.step, pm: b.dataset.mode || '', cm: c.dataset.mode || '', ic: c.textContent, isMode: c.classList.contains('is-mode') };
    }, DC);
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
  await page.goto(`${ORIGIN}/#/trip/${tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector(`.plan-row[data-id="${B}"] .plan-arrow[aria-label="往後移"]`, { timeout: 10000 });
  await page.click(`.plan-row[data-id="${B}"] .plan-arrow[aria-label="往後移"]`);
  await sleep(800);
  await openItin();
  const order = await names();
  yes(order.join('，') === '甲・車站，丙・巷口小店，乙・博物館，丁・溫泉公園，戊・夜市', `前置：重排生效（${order.join('，')}）`);
  L = await legs();
  const b2 = Object.fromEntries(L.map((x) => [x.spot, x]));
  yes(b2[B]?.unset && b2[B].mode === '' && b2[B].on.length === 0, `重排後丙→乙 不套用乙原本的「電車」（寫「${b2[B]?.text}」）`);
  yes(L.filter((x) => x.mode === 'train').length === 0, '重排後畫面上沒有任何一段是電車');
  yes(b2[E]?.mode === 'bus', `對照：丁→戊 沒被動到，仍是公車（${b2[E]?.text}）`);

  // 五、刪站（丁）：戊的前一站變成乙，舊的「公車」（記的是丁）不套用
  await page.evaluate(async (id) => { const s = await import('./js/store.js'); await s.remove(id); }, D);
  await openItin();
  const order2 = await names();
  yes(!order2.includes('丁・溫泉公園') && order2.length === 4, `前置：丁已刪（${order2.join('，')}）`);
  L = await legs();
  const b3 = Object.fromEntries(L.map((x) => [x.spot, x]));
  yes(b3[E]?.unset && b3[E].mode === '', `刪掉丁之後 乙→戊 不套用舊的「公車」（寫「${b3[E]?.text}」）`);

  // 六、選項的格子（2026-11-11 Yolin 選 A：「選項內的文字及換行請整齊」；開車・計程車改名「搭車」）
  // 現在順序是 甲 丙 乙 戊；丙那一列（甲→丙）沒設定、打開有 7 格。
  // 打開用真的點擊（pickVia）。背景重畫會把打開的選項收起來（既有的時序問題，見 STATUS），這裡最多重點 3 次——
  // 「點了會打開」那件事由上面第二步那條守，這裡守的是格子本身。
  // （2026-11-11 守夜修了那個時序問題：選項開著時背景變動不重畫，由下面第七段守；重點 3 次留著、無害。）
  const openC = async () => { for (let k = 0; k < 3; k++) if (await pickVia(C)) return true; return false; };
  // 量格子：每格的名字只准一行（文字範圍的每個框同一個 top），而且整段落在格子內緣（扣框線與內距）裡。
  // 量的時候把選項區的 hidden 拿掉——換寬度、換字級時背景重畫可能把它收起來；這段量的是排版，不是開關。
  const legFit = () => page.evaluate((dc, id) => {
    const pick = document.querySelector(`${dc} .tl-leg[data-spot="${id}"] .tl-leg-pick`);
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
  }, DC, C);
  const MOB = (w) => ({ width: w, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const setFs = (v) => page.evaluate((v) => { if (v === 'm') delete document.documentElement.dataset.fs; else document.documentElement.dataset.fs = v; }, v);
  const opened6 = await openC();
  const shown = await page.evaluate((dc, id) => [...document.querySelectorAll(`${dc} .tl-leg[data-spot="${id}"] .tl-leg-opt .tl-leg-name`)].map((e) => e.textContent.trim()), DC, C);
  const WANT = ['走路', '鐵路', '公車', '搭車', '船', '飛機', '其他'];
  // 對照組：名字改成可以折行、寬度壓到 1 個字，必須量到「折成 2 行」——量法抓不到折行，下面的「都一行」就不算數。
  // 第一版用「可折行＋字放大」：名字改短（最長 2 個字）之後放大也折不了行，對照組量不到、自己報紅（2026-11-11）——
  // 對照組不能靠名字的長度，所以改成壓寬度，任何 2 個字以上的名字都一定折。
  await page.setViewport(MOB(320)); await setFs('l');
  await page.evaluate(() => { const s = document.createElement('style'); s.id = 'ctl-wrap'; s.textContent = '.tl-leg-name { white-space: normal !important; display: inline-block; width: 1em !important; }'; document.head.append(s); });
  await sleep(120);
  const ctl = await legFit();
  await page.evaluate(() => document.getElementById('ctl-wrap')?.remove());
  const ctlCaught = ctl.bad.some((x) => /折成 [2-9] 行/.test(x));
  const fitBad = []; let combos = 0;
  // 2026-11-12 拿掉 'xl'（「特大」從 App 拿掉）：5 種寬度 × 2 種字級 = 10 種
  for (const w of [320, 360, 390, 430, 440]) for (const fs of ['m', 'l']) {
    await page.setViewport(MOB(w)); await setFs(fs); await sleep(100);
    const r = await legFit(); combos++;
    if (r.n !== 7) fitBad.push(`${w}px／${fs}：只量到 ${r.n} 格（應為 7）`);
    for (const b of r.bad) fitBad.push(`${w}px／${fs}：${b}`);
  }
  await setFs('m'); await page.setViewport(MOB(390)); await sleep(150);
  yes(opened6 && shown.join('｜') === WANT.join('｜') && ctlCaught && combos === 10 && fitBad.length === 0,
    `選項格子：7 格名字照順序（${shown.join('｜')}）、${combos} 種寬度×字級每個名字都一行、都在格子裡（對照組：可折行＋壓成 1 字寬時${ctlCaught ? '量得到折行' : '量不到折行'}）`,
    [!opened6 && '選項打不開', `${fitBad.length} 處：` + fitBad.slice(0, 4).join('；'), !ctlCaught && `對照組 ${JSON.stringify(ctl.bad.slice(0, 2))}`].filter(Boolean).join('｜'));

  // 選了之後存進去的值：從畫面上寫「搭車」的那一格點（使用者看到的是字），存進去的必須是代號 car——
  // 不是字「搭車」、也不是新代號。顯示名稱和存進去的值是兩件事，改名時最容易把它們搞混。
  await openC();
  let carTile = null;
  for (const t of await page.$$(`${DC} .tl-leg[data-spot="${C}"] .tl-leg-opt`)) {
    if ((await t.$eval('.tl-leg-name', (e) => e.textContent.trim()).catch(() => '')) === '搭車') carTile = t;
  }
  if (carTile) await carTile.click();
  await modeIs(C, 'car');
  const rec6 = await page.evaluate(async (id) => { const s = await import('./js/store.js'); const x = s.get(id); return { legFrom: x.legFrom, legMode: x.legMode }; }, C);
  const btn6 = await page.$eval(`${DC} .tl-leg[data-spot="${C}"] .tl-leg-btn`, (e) => e.textContent.trim()).catch(() => '');
  yes(!!carTile && rec6.legMode === 'car' && rec6.legFrom === A && btn6.includes('搭車') && !btn6.includes('計程車'),
    `點畫面上寫「搭車」的那一格 → 存進去的是代號 car、前一站＝甲；按鈕寫「${btn6}」`, `${carTile ? '' : '找不到寫「搭車」的格子｜'}${JSON.stringify(rec6)}`);

  // 舊值：舊版客戶端存的是代號（train），不是字；改名之後不遷移資料（Dispatch 2026-11-11：只在顯示層對應，伺服器不改寫）。
  // 直接把一筆 train 寫進資料庫（不經新畫面，等於舊版手機推上來的那一筆）→ 重開頁面，那一列要寫新名字「鐵路」，
  // 不能寫舊名字、也不能變「還沒設定」（換代號就會變這樣）。丙→乙 這段現在沒設定，前一站是丙。
  await page.evaluate(async (id, from) => { const s = await import('./js/store.js'); await s.patch(id, { legFrom: from, legMode: 'train' }); }, B, C);
  await openItin();
  const old6 = await page.evaluate((dc, id) => { const li = document.querySelector(`${dc} .tl-leg[data-spot="${id}"]`); return { mode: li?.dataset.mode, text: li?.querySelector('.tl-leg-btn')?.textContent.trim() || '' }; }, DC, B);
  yes(old6.mode === 'train' && old6.text.includes('鐵路') && !old6.text.includes('電車') && !old6.text.includes('還沒設定'),
    `舊版存的 train（直接寫進資料庫）→ 畫面寫新名字（「${old6.text}」）`, JSON.stringify(old6));

  // 七、背景變動不收起打開的選項（2026-11-11 守夜第 2 項；v1.87.0 改在行程分頁）。
  // v1.87.0 起「怎麼去」只在行程分頁；行程分頁的簽章（itinSignature）本來就不含補維基圖片寫的欄位（heroHash／heroAttr）：
  //   七之一 補圖那一類寫入（甲的 heroAttr，updatedAt 照樣推高）→ 行程分頁不重畫（這一支原本 flaky 的根因：任務頁會重畫）；
  //   七之二 會讓行程分頁重畫的背景變動＝旅伴同步進來改了行程：造情境用 store.patch 甲的表情符號（簽章裡有、畫面上看得到；
  //          甲前面沒有「怎麼去」那一列，不會動到要量的東西）。
  // 先做對照：選項關著時，改表情符號要讓整頁重畫（時間軸換成新節點）——不然「選項還開著」「沒重畫」可能只是根本不會重畫。
  // 現在順序是 甲 丙 乙 戊；戊那一列（乙→戊）沒設定。
  const EMO = ['🚉', '🏯', '⛩️'];
  const bgPatch = (n, kind) => page.evaluate(async (id, n, kind, emo) => {
    const s = await import('./js/store.js'); const b = s.get(id).updatedAt || 0;
    await s.patch(id, kind === 'emoji' ? { emoji: emo[n] } : { heroAttr: `背景補圖（測試 ${n}）` });
    return s.get(id).updatedAt > b;
  }, A, n, kind, EMO);
  const markTl = () => page.evaluate((dc) => { window.__tl7 = document.querySelector(`${dc} .timeline`); }, DC);
  const sameTl = () => page.evaluate((dc) => !!window.__tl7 && window.__tl7 === document.querySelector(`${dc} .timeline`), DC);
  const redrawn = (ms) => page.waitForFunction((dc) => !!window.__tl7 && window.__tl7 !== document.querySelector(`${dc} .timeline`), { timeout: ms }, DC).then(() => true, () => false);
  await stable(`${DC} .timeline`);
  await markTl();
  const t7 = Date.now();
  const bumped0 = await bgPatch(0, 'emoji');
  const redrew0 = await redrawn(6000);
  const lag7 = Date.now() - t7;
  const wait7 = Math.max(1500, lag7 * 3);
  const emo0 = await page.evaluate((dc) => document.querySelector(`${dc} .tl-item .itin-stop`)?.textContent || '', DC);
  yes(bumped0 && redrew0 && emo0.startsWith(EMO[0]), `前置：選項關著時背景改甲的表情符號（旅伴同步那一類）→ 整頁重畫、甲寫成「${emo0}」（${lag7} 毫秒）`, JSON.stringify({ bumped0, redrew0 }));
  await stable(`${DC} .timeline`);
  await markTl();
  const bumpedH = await bgPatch(0, 'hero');
  await sleep(wait7);
  const sameH = await sameTl();
  yes(redrew0 && bumpedH && sameH, `七之一 背景補維基圖片那一類寫入（甲的 heroAttr，updatedAt 有推高）→ 行程分頁不重畫（等了 ${wait7} 毫秒＝對照組的 3 倍、至少 1.5 秒）`,
    JSON.stringify({ redrew0, bumpedH, sameH }));
  await stable(`${DC} .timeline`);
  const open7 = await pickVia(E);
  await markTl();
  const bumped1 = await bgPatch(1, 'emoji');
  await sleep(wait7);
  const still7 = await page.evaluate((dc, id) => { const p = document.querySelector(`${dc} .tl-leg[data-spot="${id}"] .tl-leg-pick`); return !!p && !p.hidden; }, DC, E);
  const same7 = await sameTl();
  yes(redrew0 && open7 && bumped1 && still7 && same7, `七之二 選項打開時背景改了行程（甲的表情符號）→ 選項還開著、沒有整頁重畫（等了 ${wait7} 毫秒）`,
    JSON.stringify({ redrew0, open7, bumped1, still7, same7 }));
  // 收起來（再點一次那一列）→ 剛才擋下的重畫要補上，不然改過的行程要等下一次別的變動才出現。
  // 要先確認上一條真的擋下了（still7、same7），不然時間軸早就換過、這條會白白成立。
  await page.click(`${DC} .tl-leg[data-spot="${E}"] .tl-leg-btn`);
  const redrew1 = await redrawn(6000);
  const emo1 = await page.evaluate((dc) => document.querySelector(`${dc} .tl-item .itin-stop`)?.textContent || '', DC);
  yes(still7 && same7 && redrew1 && emo1.startsWith(EMO[1]), `收起選項 → 剛才擋下的重畫補上（時間軸換成新節點、甲寫成「${emo1}」）`, JSON.stringify({ still7, same7, redrew1 }));

  // 八、行程分頁的「約幾點到」與停留時間（v1.87.1；Yolin 看 v1.87.0 實機：第一站 10:00 到、停 3 小時，下一段設成搭車約 40 分，
  //    後面幾站沒帶出時間；第一站卡上也看不到停留時間）。另一趟（上面的 ETA）：
  //    子 10:00 停 3 小時 →(搭車 40 分)→ 丑 停 1 小時 →(16 分)→ 寅 停 30 分 →(10 分)→ 卯 自己填 16:00、停 30 分 →(25 分)→ 辰 沒設停留 →(12 分)→ 巳
  //    期望（2026-11-14 事前寫）：子「10:00」、丑「約 13:40 到」、寅「約 14:56 到」、卯照他填的「16:00」（推出來會是 15:36，不覆蓋）、
  //    辰「約 16:55 到」（從卯填的 16:00 接）、巳「上一站沒設停留時間，推不出幾點到」。站卡第二行：子「停留 3 小時」、丑「停留 1 小時」、
  //    寅、卯「停留 30 分」，辰、巳沒有。子→丑那一段從畫面設（使用者的路：點「怎麼去：還沒設定」→ 搭車）；設之前丑、寅推不出來
  //    （鏈的起點那一段沒有車程），辰、巳照樣有（從卯填的時間接）。其餘四段事先寫好。
  const etaIds = await page.evaluate(async (spots, firstTrip) => {
    const s = await import('./js/store.js');
    let k = 0; const uuid = () => `00000000-0000-4000-9000-${String(++k).padStart(12, '0')}`;
    const tid = uuid();
    await s.put({ id: tid, type: 'trip', groupId: s.get(firstTrip).groupId, title: '範例時間推算', region: '宜蘭', startDate: '2024-04-01', endDate: '2024-04-01' });
    const ids = spots.map(() => uuid());
    for (let i = 0; i < spots.length; i++) {
      const [name, startTime, stayMin, lat, lng] = spots[i];
      await s.put({ id: ids[i], type: 'spot', tripId: tid, name, emoji: '📍', day: 1, order: i, lat, lng,
        ...(startTime ? { startTime } : {}), ...(stayMin ? { stayMin } : {}),
        ...(i >= 2 ? { legFrom: ids[i - 1], legMode: 'car' } : {}) });
    }
    return { tid, ids };
  }, ETA, tid);
  const etaRead = () => page.evaluate((dc) => [...document.querySelectorAll(`${dc} .timeline > .tl-item`)].map((li) => {
    const t = li.querySelector(':scope > .tl-time');
    return { t: t ? t.textContent : '', eta: !!t && t.classList.contains('tl-eta'), miss: !!t && t.classList.contains('tl-eta-miss'),
      w: t && t.textContent ? getComputedStyle(t).fontWeight : '', stay: li.querySelector('.itin-stay')?.textContent || '' };
  }), DC);
  const cellIs = (i, text) => page.waitForFunction((dc, i, text) => {
    const li = [...document.querySelectorAll(`${dc} .timeline > .tl-item`)][i];
    return !!li && li.querySelector(':scope > .tl-time')?.textContent === text;
  }, { timeout: 15000 }, DC, i, text).then(() => true, () => false);
  await page.goto(`${ORIGIN}/#/trip/${etaIds.tid}/itinerary`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.itin-page .itin-seg', { timeout: 10000 });
  if (await page.evaluate(() => document.getElementById('itin-pane-plan')?.hidden !== false)) {
    for (const b of await page.$$('.itin-seg button')) if ((await b.evaluate((e) => e.textContent)) === '行程') { await b.click(); break; }
  }
  await page.waitForSelector(`${DC} .tl-leg`, { timeout: 10000 });
  const pre8 = (await cellIs(4, '約 16:55 到')) && (await cellIs(5, '上一站沒設停留時間，推不出幾點到'));
  const R0 = await etaRead();
  yes(pre8 && J(R0.map((x) => x.t)) === J(['10:00', '', '', '16:00', '約 16:55 到', '上一站沒設停留時間，推不出幾點到'])
    && J(R0.map((x) => x.stay)) === J(['停留 3 小時', '停留 1 小時', '停留 30 分', '停留 30 分', '', '']),
    `八之一 子→丑還沒設怎麼去：丑、寅推不出來；卯照他填的、辰從卯接上「約 16:55 到」、巳說缺上一站的停留；站卡寫停留時間（${J(R0.map((x) => x.t))}；${J(R0.map((x) => x.stay))}）`);
  // 從畫面設子→丑＝搭車（那一列掛在丑上）：點「怎麼去：還沒設定」→ 點寫著「搭車」的那一格
  await page.click(`${DC} .tl-leg[data-spot="${etaIds.ids[1]}"] .tl-leg-btn`);
  const carOpt = await page.evaluateHandle((dc, id) => [...document.querySelectorAll(`${dc} .tl-leg[data-spot="${id}"] .tl-leg-opt`)]
    .find((b) => b.querySelector('.tl-leg-name')?.textContent === '搭車') || null, DC, etaIds.ids[1]);
  const tapped = !!(await carOpt.evaluate((b) => !!b));
  if (tapped) await carOpt.asElement().click();
  const got13 = (await cellIs(1, '約 13:40 到')) && (await cellIs(2, '約 14:56 到'));
  const R1 = await etaRead();
  const mins8 = await page.evaluate((dc) => [...document.querySelectorAll(`${dc} .tl-leg-min`)].map((x) => x.textContent), DC);
  yes(tapped && got13 && J(R1.map((x) => x.t)) === J(['10:00', '約 13:40 到', '約 14:56 到', '16:00', '約 16:55 到', '上一站沒設停留時間，推不出幾點到'])
    && J(mins8) === J(['約 40 分', '約 16 分', '約 10 分', '約 25 分', '約 12 分']),
    `八之二 從畫面把子→丑設成搭車 → 丑「約 13:40 到」（10:00＋停 3 小時＋40 分）、寅「約 14:56 到」，其餘不變；每段車程照畫面上寫的分鐘算（${J(R1.map((x) => x.t))}；${J(mins8)}）`);
  // 使用者填的不覆蓋、推算的看得出不同：卯、子照舊是他填的那幾個字、不是推算的樣式；推算的字比他填的細；推出來的不寫進資料
  const kept = await page.evaluate(async (ids) => {
    const s = await import('./js/store.js');
    return ids.map((id) => { const r = s.get(id); return [r.startTime || '', r.startMin ?? null]; });
  }, etaIds.ids);
  const userW = R1.filter((x) => x.t && !x.eta && !x.miss).map((x) => x.w), etaW = R1.filter((x) => x.eta).map((x) => x.w);
  yes(got13 && !R1[0].eta && !R1[3].eta && R1[1].eta && R1[2].eta && R1[4].eta && R1[5].miss
    && userW.length === 2 && etaW.length === 3 && userW.every((w) => etaW.every((e) => Number(e) < Number(w)))
    && J(kept) === J([['10:00', null], ['', null], ['', null], ['16:00', null], ['', null], ['', null]]),
    `八之三 自己填的時間不被蓋掉（資料照舊、推出來的沒寫進去）、推算的「約…到」字比較細（自己填的 ${J(userW)}、推算的 ${J(etaW)}；資料 ${J(kept)}）`);
  const blank8 = await blankTextScan(page);
  yes(blank8.ok && blank8.texts > 0 && blank8.hits.length === 0,
    `八之四 推算之後整個行程頁沒有空值被印成字（掃了 ${blank8.texts} 個文字節點、${blank8.attrs} 個屬性；對照樣本${blank8.ok ? '全中' : '沒中：' + blank8.broken.join('、')}）`,
    blank8.hits.slice(0, 3).map((h) => `${h.where}［${h.kind}］${h.text}`).join('；'));
  // 八之五、八之六（v1.87.1 Dispatch 加，可推翻；2026-11-14 事前寫）：從畫面把子→丑改成鐵路、再改成公車（使用者改主意的路）。
  //   期望：丑寫「鐵路／公車沒有車程資料，之後幾站推不出幾點到」（小字那一種樣式）、寅推不出來（留白）、卯照他填的 16:00、
  //   辰從卯接上「約 16:55 到」、巳照樣缺停留；子→丑那一段不寫分鐘（不拿開車時間冒充）。還沒選怎麼去的那一段留白，八之一已經驗過（丑是空的）。
  const NODATA = '鐵路／公車沒有車程資料，之後幾站推不出幾點到';
  // 點之前先記下那一顆的正中間被什麼蓋住（說明行印出來、不判定），再捲到畫面中間才點（使用者也是看得到才點）。
  // 15:27 第一次跑：八之五（鐵路，選項第一列）過、八之六（公車，第二列）讀到整天都不在——推論是那一格落在底部分頁列後面、
  // 點到了分頁列、換了頁（同一類見 css「動作列不黏底」那段註解）；這一行就是用來證實或推翻這個推論的。
  const coverOf = (el) => el.evaluate((e) => {
    const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !t ? '（在畫面外）' : (e === t || e.contains(t)) ? '' : (t.getAttribute('class') || t.tagName);
  });
  const tapCentered = async (el) => { const c = await coverOf(el); await el.evaluate((e) => e.scrollIntoView({ block: 'center' })); await el.click(); return c; };
  const pickLeg = async (spotId, label) => {
    const btn = await page.$(`${DC} .tl-leg[data-spot="${spotId}"] .tl-leg-btn`);
    if (!btn) return { ok: false, cover: '找不到「怎麼去」按鈕' };
    const c1 = await tapCentered(btn);
    const opt = await page.evaluateHandle((dc, id, label) => [...document.querySelectorAll(`${dc} .tl-leg[data-spot="${id}"] .tl-leg-opt`)]
      .find((b) => b.querySelector('.tl-leg-name')?.textContent === label) || null, DC, spotId, label);
    const ok = !!(await opt.evaluate((b) => !!b));
    const c2 = ok ? await tapCentered(opt.asElement()) : '';
    return { ok, cover: `按鈕${c1 ? '被「' + c1 + '」蓋住' : '沒被蓋住'}、「${label}」那一格${c2 ? '被「' + c2 + '」蓋住' : '沒被蓋住'}` };
  };
  const legSwitched = (spotId, mode) => page.waitForSelector(`${DC} .tl-leg[data-spot="${spotId}"][data-mode="${mode}"]`, { timeout: 10000 }).then(() => true, () => false);
  for (const [no, label, mode] of [['八之五', '鐵路', 'train'], ['八之六', '公車', 'bus']]) {
    const tapN = await pickLeg(etaIds.ids[1], label);
    console.log(`・${no} 點之前：${tapN.cover}`);
    const switched = tapN.ok && (await legSwitched(etaIds.ids[1], mode));
    const gotN = switched && (await cellIs(1, NODATA)) && (await cellIs(4, '約 16:55 到'));
    const RN = await etaRead();
    const minsN = await page.evaluate((dc) => [...document.querySelectorAll(`${dc} .tl-leg-min`)].map((x) => x.textContent), DC);
    const hashN = await page.evaluate(() => location.hash);
    yes(gotN && J(RN.map((x) => x.t)) === J(['10:00', NODATA, '', '16:00', '約 16:55 到', '上一站沒設停留時間，推不出幾點到'])
      && RN[1].miss && !RN[1].eta && J(minsN) === J(['', '約 16 分', '約 10 分', '約 25 分', '約 12 分']),
      `${no} 從畫面把子→丑改成${label} → 丑寫「${NODATA}」、寅留白、卯照他填的、辰「約 16:55 到」；那一段不寫分鐘（${J(RN.map((x) => x.t))}；${J(minsN)}）`,
      `點到了：${tapN.ok}、換成${label}：${switched}、現在的網址 ${hashN}`);
  }
} catch (e) {
  fail++; console.log('✗ 例外 ' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
// 說明行（不是判定）：攔下了哪些外站請求——不打真網路的證據；0 次也照實印
console.log(`・外站請求一律當場回 404、沒有放出去：${[...ext].map(([h, n]) => `${h}×${n}`).join('、') || '這一輪 0 次'}`);
console.log(`・路線服務：八那一趟的座標回合成車程 ${osrmFake} 次（其他照舊 404，算在上一行）`);
console.log(`\n交通方式畫面：${pass} 項通過、${fail} 項失敗`);
process.exitCode = fail ? 1 : 0;
