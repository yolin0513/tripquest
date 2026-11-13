// 每日地圖播放列的畫面測試（npm run playertest；在 test:chain 裡）。
// 涵蓋的程式：js/daymap.js js/realmap.js js/tilemap.js js/legs.js js/views/trip.js css/style.css
// 從一次性的 _playershots（被 .gitignore 擋）搬進來：2026-11-05 Dispatch A1——播放列只被不會自動跑的腳本驗過。
// 截圖留在一次性腳本，這支只放斷言（內容與 _playershots 相同；_playershots 2026-11-04 實測 19 項全過）。
// 驗什麼：×4 每站都停、沒位置的站停下寫明、移動中沒時鐘、×4 總時間 < ×1 的四成、
// 鍵盤 Home／→ 拖進度條、手指點進度條（游標落在圖釘上＋對照組）、播放中拖到最後接著播完、
// 播放列被換掉（回首頁再回來）之後倍速還是選的那一檔。
// 圖磚攔成本機合成格線，不打 OSM。資料是合成的（日期 2024 年）。第 1 天 5 站、第 3 站沒座標。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5785;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(900);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0, fail = 0;
const yes = (c, m, x) => { if (c) { pass++; console.log('✓ ' + m); } else { fail++; console.log('✗ ' + m + (x ? '｜' + x : '')); } };
const SPOTS = [
  [1, '宜蘭火車站', '10:00', 24.754, 121.758],
  [1, '蘭陽博物館', '11:30', 24.869, 121.835],
  [1, '巷口的私房小店', '13:00', null, null],
  [1, '礁溪溫泉公園', '15:00', 24.826, 121.770],
  [1, '羅東夜市', '19:00', 24.677, 121.770],
  [2, '回程休息站', '16:00', 24.7, 121.7],
];

const page = await browser.newPage();
try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setBypassServiceWorker(true);
  page.on('pageerror', (e) => { fail++; console.log('✗ pageerror ' + e.message); });
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
  const tid = await page.evaluate(async (spots) => {
    const s = await import('./js/store.js');
    let k = 0; const uuid = () => `00000000-0000-4000-8000-${String(++k).padStart(12, '0')}`;
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '範例宜蘭小旅行', region: '宜蘭', startDate: '2024-01-06', endDate: '2024-01-07' });
    let order = 0;
    for (const [day, name, startTime, lat, lng] of spots) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name, emoji: '📍', day, order: order++, startTime, ...(lat != null ? { lat, lng } : {}) });
      await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, order: 0, title: `拍下 ${name}` });
    }
    return tid;
  }, SPOTS);
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  // 2026-11-13 當天地圖（查看路線）搬到「行程」分頁：從任務頁點底部分頁「行程」進去（使用者的路）
  await page.waitForSelector('#tabbar a.tab', { timeout: 10000 });
  for (const a of await page.$$('#tabbar a.tab')) if ((await a.evaluate((e) => e.textContent)).includes('行程')) { await a.click(); break; }
  await page.waitForFunction(() => /\/itinerary$/.test(location.hash), { timeout: 10000 });
  // v1.86.0：這趟是 2024 年（已結束），行程分頁預設亮「回顧」——點最上面那一排的「行程」（使用者的路）。
  // 後面回首頁再回來（location.hash）時不再點：同一個分頁階段記得剛剛看的是「行程」（sessionStorage）
  await page.waitForSelector('.itin-seg button', { timeout: 10000 });
  for (const b of await page.$$('.itin-seg button')) if ((await b.evaluate((e) => e.textContent)) === '行程') { await b.click(); break; }
  await page.waitForSelector('.daycollapse.open .dm-player', { timeout: 10000 });
  // 等背景重畫停下（地圖元素連續 2.5 秒沒被換掉）
  for (let k = 0; k < 6; k++) {
    await page.evaluate(() => { window.__p = document.querySelector('.daycollapse.open .dm-player'); });
    await sleep(2500);
    if (await page.evaluate(() => window.__p === document.querySelector('.daycollapse.open .dm-player'))) break;
  }
  // 播放列捲到畫面中間（點得到、地圖也看得到）
  await page.evaluate(() => { const el = document.querySelector('.daycollapse.open .daymap'); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 150, behavior: 'instant' }); });
  await sleep(700);

  const st = () => page.evaluate(() => {
    const b = document.querySelector('.daycollapse.open .dm-player');
    const cur = document.querySelector('.daycollapse.open .rm-cursor');
    const pin = (n) => document.querySelector(`.daycollapse.open .rm-pin[data-n="${n}"]`)?.style.transform || '';
    return { phase: b.dataset.phase, step: b.dataset.step, speed: b.dataset.speed, clock: b.querySelector('.dm-clock').hidden ? '' : b.querySelector('.dm-clock').textContent,
      where: b.querySelector('.dm-where').textContent, seek: b.querySelector('.dm-seek').value, max: b.querySelector('.dm-seek').max, vt: b.querySelector('.dm-seek').getAttribute('aria-valuetext'),
      btn: b.querySelector('.dm-play').textContent, spd: b.querySelector('.dm-speed').textContent,
      cur: cur && !cur.hidden ? cur.style.transform : '', curDim: !!cur?.classList.contains('is-dim'), pin2: pin(2), pin4: pin(4) };
  });
  let s = await st();
  yes(s.max === '5' && s.seek === '0' && s.spd === '×1' && s.phase === 'idle', `一進來：進度條 0／5、倍速 ×1、還沒開始（${JSON.stringify({ max: s.max, seek: s.seek, spd: s.spd, phase: s.phase })}）`);

  // 播一遍：每 40ms 記一次狀態，直到走完
  const runOnce = async () => {
    const log = [];
    const t0 = Date.now();
    await page.click('.daycollapse.open .dm-play');
    for (let k = 0; k < 600; k++) {
      const x = await st(); log.push(x);
      if (x.phase === 'done') break;
      await sleep(40);
    }
    return { log, ms: Date.now() - t0 };
  };
  await page.click('.daycollapse.open .dm-speed'); await page.click('.daycollapse.open .dm-speed');
  s = await st();
  yes(s.spd === '×4' && s.speed === '4', `點兩下倍速鈕 → ×4（${s.spd}）`);
  const fast = await runOnce();
  const seq = [...new Set(fast.log.filter((x) => x.phase === 'stop' || x.phase === 'missing').map((x) => x.step))].join(',');
  yes(fast.log.at(-1).phase === 'done', `前置：×4 播得完（${fast.ms}ms、記了 ${fast.log.length} 筆）`);
  yes(seq === '1,2,3,4,5', `×4 照樣每一站都停，沒有跳站（到站順序 ${seq}）`);
  const miss = fast.log.find((x) => x.phase === 'missing');
  yes(!!miss && miss.step === '3' && miss.where.includes('這一站沒有位置') && miss.curDim, `×4 沒位置的第 3 站照樣停下來寫明、游標留在上一站變淡（${miss && miss.where.replace('\n', '／')}）`);
  const moving = fast.log.filter((x) => x.phase === 'move');
  yes(moving.length > 0 && moving.every((x) => x.clock === ''), `移動中不顯示時鐘（移動中記到 ${moving.length} 筆，全部沒有時鐘）`);
  const stops = fast.log.filter((x) => x.phase === 'stop');
  yes(stops.length > 0 && stops.every((x) => x.clock === SPOTS[Number(x.step) - 1][2] && x.seek === x.step), `到站時時鐘＝那一站填的時間、進度條在那一站（到站 ${stops.length} 筆）`);
  // ×1 再播一遍量時間（倍速鈕再點一下：×4 → ×1）
  await page.click('.daycollapse.open .dm-speed');
  s = await st();
  yes(s.spd === '×1', `倍速鈕再點一下 → 回到 ×1（${s.spd}）`);
  const slow = await runOnce();
  yes(slow.log.at(-1).phase === 'done', `前置：×1 播得完（${slow.ms}ms）`);
  yes(fast.ms < slow.ms * 0.4, `×4 的總時間不到 ×1 的四成（×4 ${fast.ms}ms、×1 ${slow.ms}ms）`);

  // 拖進度條（停著的時候）：鍵盤是 range 的真實操作方式之一——Home、→→→ 到第 3 站（沒位置）
  await page.focus('.daycollapse.open .dm-seek');
  await page.keyboard.press('Home'); await sleep(200);
  s = await st();
  yes(s.phase === 'idle' && s.seek === '0' && s.cur === '', `進度條拉回 0 → 回到還沒開始、游標收起來（${s.phase}）`);
  for (let k = 0; k < 3; k++) { await page.keyboard.press('ArrowRight'); await sleep(150); }
  s = await st();
  yes(s.phase === 'missing' && s.step === '3' && s.where.includes('這一站沒有位置') && s.curDim && s.cur === s.pin2, `拖到第 3 站（沒位置）→ 停下來寫明、游標淡淡地留在第 2 站（${s.where.replace('\n', '／')}）`);
  yes(s.vt === '第 3 站 巷口的私房小店', `進度條念得出是哪一站（aria-valuetext：${s.vt}）`);
  await sleep(1200);
  s = await st();
  yes(s.phase === 'missing' && s.step === '3', `停著的時候拖：不會自己往下走（1.2 秒後還在第 ${s.step} 站）`);
  // 用手指點進度條上第 4 站的位置（真的指標事件）
  const box = await page.evaluate(() => { const r = document.querySelector('.daycollapse.open .dm-seek').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.mouse.click(box.x + box.w * 0.8, box.y + box.h / 2);
  await sleep(300);
  s = await st();
  yes(s.phase === 'stop' && s.step === '4' && s.clock === '15:00' && s.cur === s.pin4 && !s.curDim, `點進度條第 4 站的位置 → 到第 4 站：時鐘 15:00、游標正好在第 4 站的圖釘上（${s.step}，${s.clock}）`);
  yes(s.cur !== s.pin2, '對照組：游標位置跟第 2 站的圖釘不同（比得出差別）');

  // 播放中拖：先播，到第 2 站之後按 End → 跳到第 5 站，停完就「走完了」
  await page.focus('.daycollapse.open .dm-seek'); await page.keyboard.press('Home'); await sleep(150);
  await page.click('.daycollapse.open .dm-play');
  for (let k = 0; k < 200; k++) { const x = await st(); if (x.phase === 'stop' && x.step === '2') break; await sleep(40); }
  s = await st();
  yes(s.step === '2', `前置：播到第 2 站（${s.phase} ${s.step}）`);
  await page.focus('.daycollapse.open .dm-seek'); await page.keyboard.press('End');
  await sleep(150);
  s = await st();
  yes(s.phase === 'stop' && s.step === '5' && s.clock === '19:00', `播放中拖到最後 → 到第 5 站（${s.step}，${s.clock}）`);
  let doneAt = null;
  for (let k = 0; k < 120; k++) { const x = await st(); if (x.phase === 'done') { doneAt = x; break; } await sleep(40); }
  yes(!!doneAt && doneAt.btn.includes('再播一次'), `播放中拖完放開會接著播：第 5 站停完就「走完了」（${doneAt && doneAt.where}）`);

  // 倍速記得住：播放列被整個換掉（背景重畫、離開再回來）之後還是使用者選的那一檔。
  // 2026-11-06：連跑 10 次紅 6 次——背景重畫換掉播放列、倍速回到 ×1，使用者選的 ×4 播到一半自己變回 ×1。
  // 這裡用「回首頁再回來」這條真實路徑把播放列換掉（不等背景重畫碰巧發生），先確認真的換了一個新的。
  await page.click('.daycollapse.open .dm-speed');
  s = await st();
  const picked = s.spd;
  yes(picked === '×2' || picked === '×4', `前置：倍速換到 ×1 以外（${picked}）`);
  await page.evaluate(() => { window.__oldPlayer = document.querySelector('.daycollapse.open .dm-player'); location.hash = '#/'; });
  await page.waitForSelector('.hero', { timeout: 10000 });
  await page.evaluate((t) => { location.hash = `#/trip/${t}/itinerary`; }, tid);
  await page.waitForSelector('.daycollapse.open .dm-player', { timeout: 10000 });
  const renewed = await page.evaluate(() => !!window.__oldPlayer && window.__oldPlayer !== document.querySelector('.daycollapse.open .dm-player') && !window.__oldPlayer.isConnected);
  yes(renewed, '前置：播放列真的換成新的一份（舊的已不在畫面上）');
  s = await st();
  yes(s.spd === picked && s.speed === picked.slice(1), `倍速記得住：播放列換掉之後還是 ${picked}（${s.spd}、data-speed ${s.speed}）`);
} catch (e) {
  fail++; console.log('✗ 例外 ' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n播放列：${pass} 項通過、${fail} 項失敗`);
process.exitCode = fail ? 1 : 0;
