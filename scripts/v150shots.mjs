// v1.50 截圖：搜尋景點加入（規劃第 1 批）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = new URL('../screenshots/_v150/', import.meta.url);
await mkdir(OUT, { recursive: true });
const WEB = 5513, GEO = 5514;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const FIX = {
  '林場肉羹 宜蘭': [
    { lat: '24.6786', lon: '121.7712', display_name: '林場肉羹, 中正路, 羅東鎮, 宜蘭縣, 臺灣',
      class: 'amenity', type: 'restaurant', address: { country: '臺灣', county: '宜蘭縣', town: '羅東鎮' } },
    { lat: '24.9986', lon: '121.5112', display_name: '林場肉羹 分店, 某路, 新北市, 臺灣',
      class: 'amenity', type: 'restaurant', address: { country: '臺灣', city: '新北市' } },
  ],
};
const geoSrv = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(FIX[u.searchParams.get('q') || ''] || []));
}).listen(GEO);
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
const shot = async (name) => { await page.screenshot({ path: fileURLToPath(new URL(name + '.png', OUT)) }); console.log('📸', name); };

try {
  await page.evaluateOnNewDocument((geoUrl) => { window.__TQ_GEO_ENDPOINT = geoUrl; }, `http://localhost:${GEO}/search`);
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  const tid = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭三日遊', region: '宜蘭',
      startDate: '2026-10-01', endDate: '2026-10-03', allowWiki: false });
    await s.put({ id: uuid(), type: 'spot', tripId: tid, name: '羅東觀光夜市', emoji: '🏮',
      day: 1, order: 0, lat: 24.6779, lng: 121.7674, startMin: 18 * 60, stayMin: 90 });
    return tid;
  });

  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  await shot('01-調整行程頁-搜尋加入與匯出入口');

  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}/findspot?day=2`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.fs-bar input');
  await page.evaluate(() => { document.querySelector('.fs-bar input').value = '林場肉羹'; });
  await page.click('.fs-bar button');
  await page.waitForSelector('.fs-row');
  await shot('02-搜尋結果-候選清單');
  await page.evaluate(() => document.querySelector('.fs-row .fs-add').click());
  await page.waitForSelector('.fs-panel');
  await page.evaluate(() => { document.querySelector('.fs-panel input[type=time]').value = '12:30'; });
  await shot('03-加入設定-哪一天幾點停留');
  await page.evaluate(() => document.querySelector('.fs-panel .btn-block').click());
  await sleep(700);
  await shot('04-已加入-可繼續搜尋');
  console.log('\n截圖完成');
} catch (e) {
  console.error('例外：', e && e.stack || e);
  process.exitCode = 1;
} finally {
  await browser.close();
  web.kill(); geoSrv.close();
}
