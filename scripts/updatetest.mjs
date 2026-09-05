// Service Worker 更新流程（npm run updatetest）
//
// 使用者的實際體驗是「更新後要滑掉 App 重開兩次」。兩個原因：
//   1. 舊流程只跳一句「已更新，下次開啟生效」，沒有任何機制讓現在這一頁換成新版
//   2. install 時 addAll 走瀏覽器的 HTTP 快取（GitHub Pages max-age=600），
//      新版 SW 有機會把「舊的 JS」預存進新快取 → 重開之後跑的還是舊程式
//
// 這支測試用一個會改內容的本機伺服器，模擬真的部署了新版。
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5221;
const ok = (m) => console.log('✓ ' + m);
const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1; };

// 伺服器：可以切換「版本」，並且像 GitHub Pages 一樣送 max-age=600
let VERSION = 'A';
let STUBBORN = false;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const server = http.createServer(async (req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, rel);
  try {
    let buf = await readFile(file);
    // 換版時改兩個檔：sw.js 的 VERSION 與一個看得出來的標記
    if (rel === '/sw.js') {
      let t = String(buf).replace(/tripquest-v[\d.]+/, 'tripquest-vTEST' + VERSION);
      // STUBBORN：模擬「叫不動」的 SW（不理會 SKIP_WAITING），用來驗證逾時保護
      if (STUBBORN) t = t.replace(/if \(d === 'SKIP_WAITING'[^\n]*\n/, '\n');
      buf = Buffer.from(t);
    }
    if (rel === '/js/app.js') buf = Buffer.from(String(buf) + `\nwindow.__BUILD = '${VERSION}';\n`);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream',
      'Cache-Control': 'max-age=600',            // 跟 GitHub Pages 一樣
    });
    res.end(buf);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 180000 });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });

const BASE = `http://localhost:${PORT}/`;
const swVersion = () => page.evaluate(async () => {
  const r = await fetch('./sw.js?cb=' + Math.random());
  return ((await r.text()).match(/tripquest-v[\w.]+/) || ['?'])[0];
});

try {
  // ---------- 第一次安裝 ----------
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await sleep(800);
  const build0 = await page.evaluate(() => window.__BUILD);
  if (build0 === 'A') ok('第一次安裝：跑的是 A 版');
  else fail('初始版本不對：' + build0);

  // 放一些資料與待上傳佇列，等一下要驗證更新不會弄丟
  const seeded = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const db = await import('./js/db.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '更新測試', syncSecret: 'a'.repeat(32) });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '更新前就有的行程', allowWiki: false });
    const sid = uuid();
    await s.put({ id: sid, type: 'spot', tripId: tid, name: '更新前的景點', day: 1, order: 0 });
    await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, title: '更新前的任務', kind: 'thing', order: 0 });
    await db.outboxPut({ id: 'push:' + gid, op: 'push', groupId: gid, tries: 0, nextAt: 0 });
    await db.putBlob({ hash: 'testhash', blob: new Blob(['x'.repeat(2000)]), bytes: 2000, kind: 'photo' });
    return { tid, gid, records: s.exportRecords().length };
  });
  ok(`塞入資料：${seeded.records} 筆記錄 + 1 筆待上傳 + 1 個 blob`);

  // ---------- 部署新版 ----------
  VERSION = 'B';
  ok('（模擬部署了 B 版）');

  // 使用者「正在用」App：開著對話框，這時候不該自作主張重載
  await page.evaluate(async () => {
    const { promptDialog } = await import('./js/ui.js');
    promptDialog('假裝使用者正在打字');
  });
  await sleep(300);
  await page.evaluate(() => window.dispatchEvent(new Event('pointerdown')));   // 有互動過

  // 不要 await r.update()：更新有可能在這個呼叫進行中觸發重載，evaluate 就再也回不來了
  await page.evaluate(() => { navigator.serviceWorker.getRegistration().then((r) => r && r.update()); });
  await page.waitForSelector('#updateBar', { timeout: 20000 });
  const bar = await page.evaluate(() => {
    const b = document.getElementById('updateBar');
    const go = b.querySelector('.update-go');
    return {
      text: b.textContent,
      goSize: Math.round(go.getBoundingClientRect().height),
      jargon: /Service\s*Worker|cache|快取|SW/i.test(b.textContent),
      stillBuildA: window.__BUILD,
      dialogStillOpen: !!document.querySelector('.modal-card'),
    };
  });
  if (bar.dialogStillOpen && bar.stillBuildA === 'A') ok('使用者正在打字時不會自作主張重載，只出現提示');
  else fail('打斷了使用者：' + JSON.stringify(bar));
  if (!bar.jargon) ok(`提示文案沒有術語：「${bar.text.replace('✕', '')}」`);
  else fail('文案有術語：' + bar.text);
  if (bar.goSize >= 44) ok(`「點一下更新」觸控區 ${bar.goSize}px`);
  else fail('按鈕太小：' + bar.goSize);

  // ---------- 按一下更新 ----------
  await page.evaluate(() => document.querySelector('.modal-overlay')?.remove());
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }),
    page.evaluate(() => document.querySelector('#updateBar .update-go').click()),
  ]);
  await page.waitForSelector('.hero');
  await sleep(800);

  const after = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const db = await import('./js/db.js');
    return {
      build: window.__BUILD,
      records: s.exportRecords().length,
      trip: s.trips()[0]?.title,
      outbox: (await db.outboxAll()).length,
      blob: !!(await db.getBlob('testhash')),
      bar: !!document.getElementById('updateBar'),
    };
  });
  if (after.build === 'B') ok('按一下就換成 B 版（不用自己滑掉 App）');
  else fail('按了還是舊版：' + after.build);
  if (!after.bar) ok('更新完提示自動消失');
  else fail('提示還在');
  const sw = await swVersion();
  if (sw === 'tripquest-vTESTB') ok(`Service Worker 也是新版（${sw}）`);
  else fail('SW 版本不對：' + sw);

  // ---------- 資料完整 ----------
  if (after.records === seeded.records && after.trip === '更新前就有的行程') ok(`資料完整：${after.records} 筆記錄都在`);
  else fail(`資料掉了：${after.records} vs ${seeded.records}`);
  if (after.outbox === 1) ok('待上傳佇列沒被清掉，同步不會中斷');
  else fail('待上傳佇列不見了：' + after.outbox);
  if (after.blob) ok('照片 blob 還在');
  else fail('照片 blob 不見了');

  // ---------- 剛打開、還沒動作 → 完全無感自動更新 ----------
  VERSION = 'C';
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 390, height: 844 });
  page2.on('pageerror', (e) => console.log('  [p2 pageerror]', e.message));
  await page2.goto(BASE, { waitUntil: 'networkidle0' });
  await page2.waitForSelector('.hero');
  await sleep(4000);                      // 給它自己更新的時間
  const auto = await page2.evaluate(() => ({ build: window.__BUILD, bar: !!document.getElementById('updateBar') }));
  if (auto.build === 'C' && !auto.bar) ok('剛打開、還沒動作時：自動換好，完全沒打擾');
  else fail('沒有自動更新：' + JSON.stringify(auto));

  // ---------- 預存的是「新的」檔案，不是 HTTP 快取裡的舊檔 ----------
  const cached = await page2.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys.find((k) => k.includes('TESTC')) || keys[0]);
    const r = await c.match('./js/app.js') || await c.match('js/app.js');
    return r ? (await r.text()).includes("window.__BUILD = 'C'") : null;
  });
  if (cached === true) ok('預存的是最新的 JS（cache:reload 生效，不會存到 HTTP 快取裡的舊檔）');
  else fail('預存到舊檔了：' + cached);

  // ================= 多分頁：別的分頁先換好，這一頁不能卡住 =================
  // 使用者實際踩到的就是這個：另一個分頁（或剛開啟、閒著的那個）自動套用了更新，
  // controllerchange 在他按下按鈕**之前**就發生了。舊寫法只在 applying 時才重載，
  // 於是這一頁變成「舊 JS ＋ 新 SW」，之後按更新也永遠不會有反應。
  VERSION = 'D';
  const tabA = await browser.newPage();
  await tabA.setViewport({ width: 390, height: 844 });
  tabA.on('pageerror', (e) => console.log('  [tabA]', e.message));
  await tabA.goto(BASE, { waitUntil: 'networkidle0' });
  await tabA.waitForSelector('.hero');
  await tabA.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  // tabA 假裝「正在用」：不會自動更新，只會出現提示
  await tabA.evaluate(() => {
    try { sessionStorage.setItem('tripquest.autoUpdated', '1'); } catch {}
    window.dispatchEvent(new Event('pointerdown'));
  });

  VERSION = 'E';
  const tabB = await browser.newPage();      // 全新分頁、閒著 → 會自動套用
  await tabB.setViewport({ width: 390, height: 844 });
  await tabB.goto(BASE, { waitUntil: 'networkidle0' });
  await tabB.waitForSelector('.hero');
  await sleep(5000);

  const tabBBuild = await tabB.evaluate(() => window.__BUILD).catch(() => '?');
  if (tabBBuild === 'E') ok('閒著的分頁自動換好了');
  else fail('閒著的分頁沒換：' + tabBBuild);

  await sleep(3000);
  const tabAAfter = await tabA.evaluate(() => ({
    build: window.__BUILD, bar: !!document.getElementById('updateBar'),
  })).catch(() => ({ build: 'E', bar: false }));
  if (tabAAfter.build === 'E' || tabAAfter.bar) {
    ok('別的分頁換好之後，這一頁' + (tabAAfter.build === 'E' ? '也跟著換好了' : '出現了更新提示') + '（不會卡在舊版又按不動）');
  } else fail('這一頁卡住了：' + JSON.stringify(tabAAfter));

  if (tabAAfter.bar) {
    await tabA.evaluate(() => document.querySelector('#updateBar .update-go').click());
    // 這條路沒有 waiting 的 SW（別的分頁已經啟用了）→ 直接重載，快到來不及顯示文字，
    // 那是最好的結果。進行中回饋在下面「叫不動的 SW」那段驗（那裡才真的有等待時間）。
    const busy = await tabA.evaluate(() => document.getElementById('updateBar')?.textContent || '(已重載)').catch(() => '(已重載)');
    if (/更新中|請稍候|已重載/.test(busy) || busy === '') ok('按下去不是沒反應（' + (busy || '立刻重載') + '）');
    else fail('按下去沒有進行中的回饋：' + busy);
    await tabA.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
    await tabA.waitForSelector('.hero');
    await sleep(600);
    const done = await tabA.evaluate(() => window.__BUILD);
    if (done === 'E') ok('按一下之後真的換成新版');
    else fail('按了還是舊版：' + done);
  }
  await tabA.close(); await tabB.close();

  // ================= 逾時保護：SW 叫不動時也要能完成 =================
  STUBBORN = true;
  VERSION = 'F';
  const tabC = await browser.newPage();
  await tabC.setViewport({ width: 390, height: 844 });
  await tabC.goto(BASE, { waitUntil: 'networkidle0' });
  await tabC.waitForSelector('.hero');
  await tabC.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await tabC.evaluate(() => {
    try { sessionStorage.setItem('tripquest.autoUpdated', '1'); } catch {}
    window.dispatchEvent(new Event('pointerdown'));
  });
  VERSION = 'G';
  await tabC.evaluate(() => { navigator.serviceWorker.getRegistration().then((r) => r && r.update()); });
  await tabC.waitForSelector('#updateBar', { timeout: 20000 });
  const t0 = Date.now();
  await tabC.evaluate(() => document.querySelector('#updateBar .update-go').click());
  await sleep(500);
  const busyC = await tabC.evaluate(() => {
    const b = document.getElementById('updateBar');
    return b ? { text: b.textContent, disabled: !!b.querySelector('.update-go')?.disabled } : null;
  }).catch(() => null);
  if (busyC && /更新中/.test(busyC.text) && busyC.disabled) ok('等待期間按鈕顯示「' + busyC.text.replace('更新中…', '更新中… / ') + '」且不能重複按');
  else fail('等待期間沒有進行中的回饋：' + JSON.stringify(busyC));
  await tabC.waitForNavigation({ waitUntil: 'networkidle0', timeout: 25000 }).catch(() => {});
  await tabC.waitForSelector('.hero');
  await sleep(800);
  const spent = Date.now() - t0;
  const stub = await tabC.evaluate(() => window.__BUILD);
  if (stub === 'G') ok('SW 叫不動時也會完成更新（逾時保護，' + (spent / 1000).toFixed(1) + ' 秒）');
  else fail('叫不動的 SW 讓更新卡住了：' + stub + '（等了 ' + spent + 'ms）');
  if (spent < 12000) ok('不會讓使用者無限等待');
  else fail('等太久：' + spent + 'ms');
  await tabC.close();
  STUBBORN = false;

  console.log('\n更新流程測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  server.close();
}
