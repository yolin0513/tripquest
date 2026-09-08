// v1.51 截圖：時刻鏈與移動時間、排順序預覽、建立行程的規劃入口
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = new URL('../screenshots/_v151/', import.meta.url);
await mkdir(OUT, { recursive: true });
const WEB = 5521, OSRM = 5522;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const osrmSrv = createServer((req, res) => {
  const m = req.url.match(/\/table\/v1\/[a-z]+\/([^?]+)/);
  const pts = m ? m[1].split(';').map((c) => c.split(',').map(Number)) : [];
  const R = 6371000, rad = (x) => x * Math.PI / 180;
  const dist = (a, b) => { const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
    const hh = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(hh)); };
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify({ code: 'Ok', durations: pts.map((a) => pts.map((b) => dist(a, b) / 8)) }));
}).listen(OSRM);
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
const shot = async (name) => { await page.screenshot({ path: fileURLToPath(new URL(name + '.png', OUT)) }); console.log('📸', name); };

try {
  await page.evaluateOnNewDocument((u) => { window.__TQ_OSRM_ENDPOINT = u; }, `http://localhost:${OSRM}`);
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  const tid = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭一日遊', region: '宜蘭',
      startDate: '2026-10-01', endDate: '2026-10-01', allowWiki: false });
    const mk = (name, order, lat, lng, extra = {}) => s.put({ id: uuid(), type: 'spot', tripId: tid,
      name, emoji: '📍', day: 1, order, lat, lng, ...extra });
    await mk('礁溪溫泉', 0, 24.827, 121.773, { startMin: 9 * 60, stayMin: 90 });
    await mk('羅東夜市', 1, 24.678, 121.767, { stayMin: 60 });
    await mk('幾米公園', 2, 24.754, 121.758, { stayMin: 40 });
    await mk('林場肉羹（訂位）', 3, 24.6786, 121.7712, { startMin: 12 * 60, stayMin: 60, pinned: true });
    await mk('梅花湖', 4, 24.639, 121.742, { stayMin: 60 });
    return tid;
  });

  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  await page.waitForFunction(() => document.querySelectorAll('.plan-travel-note').length >= 3, { timeout: 20000 });
  await sleep(400);
  await shot('01-時刻鏈-移動時間與遲到警告');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('排順序')).click());
  await page.waitForSelector('.modal-card', { timeout: 20000 });
  await sleep(300);
  await shot('02-排順序-預覽後才套用');
  await page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent.includes('套用')).click());
  await page.waitForFunction(() => document.querySelectorAll('.plan-travel-note').length >= 3, { timeout: 20000 });
  await sleep(500);
  await shot('03-套用後-時刻鏈即時重算');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(300);
  await shot('04-工具列-交通方式與來源標示');

  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/new`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('幫我規劃行程'))?.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await shot('05-建立行程-幫我規劃入口');
  console.log('\n截圖完成');
} catch (e) {
  console.error('例外：', e && e.stack || e);
  process.exitCode = 1;
} finally {
  await browser.close();
  web.kill(); osrmSrv.close();
}
