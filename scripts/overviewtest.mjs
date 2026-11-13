// 總覽地圖（日期列最前面那一格）的畫面測試（npm run overviewtest；在 test:chain 裡）。
// 涵蓋的程式：js/overmap.js js/tilemap.js js/daymap.js js/views/trip.js css/style.css
// 從一次性的 _overviewshots（被 .gitignore 擋）的 fake 模式搬進來：2026-11-05 Dispatch A1——總覽只被不會自動跑的腳本驗過。
// 截圖與 real 模式（真的抓 OSM 圖磚）留在一次性腳本；這支不打外網（§5.6），只放斷言（內容與 _overviewshots fake 相同，
// 那支 2026-11-05 實測 fake 19 項全過）。
// 驗什麼：日期列最前面是「總覽」；點進去只顯示總覽；圖釘數、寫第幾天、同天同色、線與圖釘同色、每天各自連線（夾站那段淡）、
// 每條線兩端同一天；圖釘落在 node 獨立算的 Mercator 位置（＋偏 10px 對照組）；點天數列／圖釘切天；
// 重畫後留在總覽（前置：新標題真的出現）；圖磚全 503 寫明沒網路。
// 合成資料：第 1 天宜蘭 4 站＋1 站沒座標；第 2 天台北 2 站；第 3 天 1 站沒座標。日期 2024 年。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { makeMargin } from './margin.mjs';   // 2026-11-12：門檻斷言印「實際／門檻／餘裕」（見 margin.mjs 檔頭）
const M = makeMargin();

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5787;
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
  [2, '台北車站', '10:00', 25.0478, 121.5170],
  [2, '台北 101', '14:00', 25.0340, 121.5645],
  [3, '朋友家', '', null, null],
];
const PLACED = SPOTS.filter((s) => s[3] != null);
const world = (lat, lng, z) => { const s = 256 * 2 ** z, r = lat * Math.PI / 180; return { x: (lng + 180) / 360 * s, y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * s }; };

async function newPage(tileMode) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setBypassServiceWorker(true);
  page.on('pageerror', (e) => { fail++; console.log('✗ pageerror ' + e.message); });
  await page.evaluateOnNewDocument((u) => { window.__TQ_TILE_URL = u; }, `http://localhost:${WEB}/__tiles/{z}/{x}/{y}.png`);
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    const u = new URL(rq.url());
    if (u.hostname === 'tile.openstreetmap.org') { console.log('✗ 打到真的 OSM：' + rq.url()); fail++; return rq.abort(); }
    if (!u.pathname.startsWith('/__tiles/')) return rq.continue();
    if (tileMode === 'dead') return rq.respond({ status: 503, body: 'no' });
    const [z, x, y] = u.pathname.split('/').slice(2).map((s) => parseInt(s, 10));
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${(x + y) % 2 ? '#e8efe6' : '#dfe8ee'}" stroke="#9aa" stroke-width="1"/><text x="8" y="20" font-size="14" fill="#678">${z}/${x}/${y}</text></svg>`;
    rq.respond({ status: 200, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body });
  });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  const tid = await page.evaluate(async (spots) => {
    const s = await import('./js/store.js');
    let k = 0; const uuid = () => `00000000-0000-4000-8000-${String(++k).padStart(12, '0')}`;
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '範例三天小旅行', region: '宜蘭', startDate: '2024-01-06', endDate: '2024-01-08' });
    let order = 0;
    for (const [day, name, startTime, lat, lng] of spots) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name, emoji: '📍', day, order: order++, startTime, ...(lat != null ? { lat, lng } : {}) });
      await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, order: 0, title: `拍下 ${name} 的一幕` });
    }
    return tid;
  }, SPOTS);
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  // 2026-11-13 總覽地圖搬到「行程」分頁：從任務頁點底部分頁「行程」進去（使用者的路）
  await page.waitForSelector('#tabbar a.tab', { timeout: 10000 });
  for (const a of await page.$$('#tabbar a.tab')) if ((await a.evaluate((e) => e.textContent)).includes('行程')) { await a.click(); break; }
  await page.waitForFunction(() => /\/itinerary$/.test(location.hash), { timeout: 10000 });
  // v1.86.0：這趟是 2024 年（已結束），行程分頁預設亮「回顧」——點最上面那一排的「行程」（使用者的路）
  await page.waitForSelector('.itin-seg button', { timeout: 10000 });
  for (const b of await page.$$('.itin-seg button')) if ((await b.evaluate((e) => e.textContent)) === '行程') { await b.click(); break; }
  await page.waitForSelector('.daystrip .ds-day', { timeout: 10000 });
  return { page, tid };
}
async function settle(page) {
  for (let k = 0; k < 6; k++) {
    await page.evaluate(() => { window.__ov = document.querySelector('.daycollapse.open'); });
    await sleep(2500);
    if (await page.evaluate(() => window.__ov === document.querySelector('.daycollapse.open'))) return k;
  }
  return -1;
}
async function showOpen(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.daycollapse.open .daymap') || document.querySelector('.daycollapse.open');
    const stuck = (document.getElementById('topbar')?.offsetHeight || 0) + (document.querySelector('.daystrip')?.offsetHeight || 0);
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - stuck - 8, behavior: 'instant' });
  });
  await sleep(700);
}
const read = (page) => page.evaluate(() => {
  const open = document.querySelector('.daycollapse.open');
  const tm = open?.querySelector('.tm');
  const r = tm?.getBoundingClientRect();
  const pinXY = (el) => { const b = el.getBoundingClientRect(); return { x: b.left - r.left - tm.clientLeft, y: b.top - r.top - tm.clientTop }; };
  return {
    openDay: open?.dataset.day,
    nOpen: document.querySelectorAll('.daycollapse.open').length,
    strip: [...document.querySelectorAll('.daystrip .ds-day')].map((e) => ({ day: e.dataset.day, t: e.querySelector('.ds-num')?.textContent, on: e.getAttribute('aria-pressed') === 'true' })),
    z: tm ? Number(tm.dataset.z) : NaN, w: r?.width, h: r?.height,
    pins: open ? [...open.querySelectorAll('.om-pin')].map((e) => ({ day: e.dataset.day, spot: e.dataset.spot, t: e.textContent, bg: getComputedStyle(e.querySelector('.om-pin-dot')).backgroundColor, ...(tm ? pinXY(e) : {}) })) : [],
    segs: open ? [...open.querySelectorAll('.om-seg')].map((e) => ({ day: e.dataset.day, gap: e.classList.contains('is-gap'), stroke: getComputedStyle(e).stroke, x1: +e.getAttribute('x1'), y1: +e.getAttribute('y1'), x2: +e.getAttribute('x2'), y2: +e.getAttribute('y2') })) : [],
    days: open ? [...open.querySelectorAll('.om-day')].map((e) => ({ day: e.dataset.day, t: e.textContent, empty: e.classList.contains('is-empty') })) : [],
    offline: open?.querySelector('.rm-offline')?.textContent || '',
    tiles: open ? [...open.querySelectorAll('.tm-tile')].map((e) => ({ key: e.src.split('/').slice(-3).join('/').replace('.png', ''), m: /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(e.style.transform)?.slice(1).map(Number), st: e.dataset.state })) : [],
    attr: open?.querySelector('.tm-attr')?.textContent || '',
  };
});

try {
  const { page } = await newPage('fake');
  console.log(`  等重畫停下：${await settle(page)} 輪`);
  let r = await read(page);
  yes(r.strip.length === 4 && r.strip[0].day === '0' && r.strip[0].t === '總覽', `日期列最前面是「總覽」、後面三天（${r.strip.map((s) => s.t).join('／')}）`);
  yes(r.openDay !== '0' && r.nOpen === 1, `新打開行程停在某一天、不是總覽（現在第 ${r.openDay} 天）`);

  // 使用者的路：點日期列的「總覽」
  await page.click('.daystrip .ds-day[data-day="0"]');
  await sleep(600);
  await showOpen(page);
  await page.waitForFunction(() => [...document.querySelectorAll('.daycollapse.open .tm-tile')].some((e) => e.dataset.state === 'ok'), { timeout: 8000 }).catch(() => {});
  await sleep(500);
  r = await read(page);
  console.log(`  z=${r.z} 寬 ${r.w}｜圖釘 ${r.pins.length}｜線 ${r.segs.length}｜圖磚 ${r.tiles.length}（ok ${r.tiles.filter((t) => t.st === 'ok').length}）`);
  yes(r.openDay === '0' && r.nOpen === 1 && r.strip[0].on && r.strip.filter((s) => s.on).length === 1, '點「總覽」→ 只顯示總覽、日期列只有總覽亮');
  yes(r.pins.length === PLACED.length, `前置：圖釘數＝有座標的站數 ${PLACED.length}（母體非空）`, r.pins.length);
  yes(r.pins.map((p) => p.t).join('') === PLACED.map((s) => s[0]).join(''), `圖釘上寫的是第幾天（${r.pins.map((p) => p.t).join('')}）`);
  const bgOf = (d) => [...new Set(r.pins.filter((p) => p.day === d).map((p) => p.bg))];
  yes(bgOf('1').length === 1 && bgOf('2').length === 1 && bgOf('1')[0] !== bgOf('2')[0], `同一天同色、兩天不同色（${bgOf('1')}｜${bgOf('2')}）`);
  const strokeOf = (d) => [...new Set(r.segs.filter((s) => s.day === d).map((s) => s.stroke))];
  yes(strokeOf('1').join() === bgOf('1').join() && strokeOf('2').join() === bgOf('2').join(), `線的顏色＝那一天圖釘的顏色（${strokeOf('1')}｜${strokeOf('2')}）`);
  // 線：第 1 天 4 站有座標（第 3 站沒有）→ 1-2、2-4（夾站、淡）、4-5 共 3 條；第 2 天 1 條；天與天之間 0 條
  const segDays = r.segs.map((s) => s.day + (s.gap ? '淡' : '')).join(',');
  yes(segDays === '1,1淡,1,2', `每天各自連線、夾了沒位置的站那段是淡的、天與天之間不連（${segDays}）`);
  const at = (x, y) => r.pins.find((p) => Math.abs(p.x - x) < 1.5 && Math.abs(p.y - y) < 1.5);
  const cross = r.segs.filter((s) => { const a = at(s.x1, s.y1), b = at(s.x2, s.y2); return !a || !b || a.day !== b.day; });
  yes(cross.length === 0, '每條線的兩端都是同一天的兩根圖釘（找得到端點、而且同一天）', JSON.stringify(cross));
  yes(r.pins.every((p) => p.x >= 0 && p.x <= r.w && p.y >= 0 && p.y <= r.h), '全部圖釘都在地圖框內（兩個城市一起看得到）', JSON.stringify(r.pins.map((p) => [Math.round(p.x), Math.round(p.y)])));
  yes(r.attr.includes('© OpenStreetMap contributors'), '總覽也有著作權字樣');
  yes(r.days.map((d) => d.day + (d.empty ? '空' : '')).join(',') === '1,2,3空' && r.days[0].t.includes('1 站沒有位置'), `天數列：三天都列、第 3 天標成沒位置、第 1 天寫明幾站沒位置（${r.days.map((d) => d.t).join('｜')}）`);
  // 圖釘位置：node 自己算落在哪一張圖磚的哪一點，對 App 擺的圖磚位置
  const off = (dx) => PLACED.map((s, i) => {
    const p = world(s[3], s[4], r.z), key = `${r.z}/${Math.floor(p.x / 256)}/${Math.floor(p.y / 256)}`;
    const t = r.tiles.find((tt) => tt.key === key);
    if (!t || !t.m) return 99;
    const ex = t.m[0] + (p.x % 256) + dx, ey = t.m[1] + (p.y % 256);
    return Math.hypot(ex - r.pins[i].x, ey - r.pins[i].y);
  });
  const d0 = off(0), d10 = off(10);
  const rPin = M.within(d0, '<', 1.5, 'px', '圖釘位置誤差');   // 對照組（下一條，故意偏 10px）不套：它在確認比對抓得到偏移，不是在守版面
  yes(rPin.ok, `圖釘落在 node 獨立算的位置（誤差 ${d0.map((d) => d.toFixed(2)).join('、')}px）${rPin.tail}`);
  yes(d10.every((d) => d > 8), '對照組：故意偏 10px 每一根都抓得到');

  // 點天數列的第 2 天 → 切到第 2 天
  await page.click('.daycollapse.open .om-day[data-day="2"]');
  await sleep(600);
  r = await read(page);
  yes(r.openDay === '2' && r.strip.find((s) => s.day === '2').on && !r.strip[0].on, '點總覽下面的「第 2 天」→ 換到第 2 天、日期列跟著亮第 2 天');
  // 回總覽、點第 1 天的圖釘 → 第 1 天
  await page.click('.daystrip .ds-day[data-day="0"]'); await sleep(600); await showOpen(page);
  await page.evaluate(() => document.querySelector('.daycollapse.open .om-pin[data-day="1"]').click());
  await sleep(600);
  r = await read(page);
  yes(r.openDay === '1', '點總覽上第 1 天的圖釘 → 換到第 1 天');
  // 選總覽之後整頁重畫（同步進來）→ 還是總覽
  await page.click('.daystrip .ds-day[data-day="0"]'); await sleep(600);
  await page.evaluate(async () => { const s = await import('./js/store.js'); const t = s.trips()[0]; await s.patch(t.id, { title: t.title + '！' }); });
  await sleep(1500);
  r = await read(page);
  const retitled = await page.evaluate(() => document.body.textContent.includes('範例三天小旅行！'));
  yes(retitled, '前置：整頁真的重畫了（新標題出現在畫面上）');
  yes(r.openDay === '0', '選了總覽之後整頁重畫：還停在總覽');
  await page.close();

  const { page: p2 } = await newPage('dead');
  await settle(p2);
  await p2.click('.daystrip .ds-day[data-day="0"]'); await sleep(600); await showOpen(p2);
  await p2.waitForFunction(() => !!document.querySelector('.daycollapse.open .rm-offline'), { timeout: 8000 }).catch(() => {});
  const d = await read(p2);
  yes(d.offline.includes('目前沒有網路') && d.days.length === 3, `圖磚全部載不到 → 寫明沒網路、天數列照樣在（${d.offline.slice(0, 20)}…，${d.days.length} 天）`);
  await p2.close();
  console.log('\n' + M.summary());
} catch (e) {
  fail++; console.log('✗ 例外 ' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n總覽地圖：${pass} 項通過、${fail} 項失敗`);
process.exitCode = fail ? 1 : 0;
