// v1.67～v1.70 的重點截圖（npm run shots1670）。
//
// 不進 npm test —— 這是文件，不是驗證。跟 imgsample.mjs 同一類。
// 輸出 390×844 @2x（780×1688），檔名沿用 v<版本>-<描述>.png，
// 放 screenshots/features/，另外鏡像一份。
//
// 全部用假的外部服務（OSRM / Routes / Places / Overpass），所以畫面是決定性的，
// 也不會占用公共服務的額度。地名用宜蘭的真實地點，讓截圖看起來就是實際在用。

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'screenshots', 'features');
const MIRROR = process.env.TQ_SHOT_MIRROR
  || path.join(process.env.APPDATA || '', 'Claude', 'local-agent-mode-sessions',
    '96633e0f-6657-4920-af21-2039cbedc8f8', '5e6efb1a-4a56-4945-8423-90b8a2c6df6b',
    'agent', 'local_ditto_5e6efb1a-4a56-4945-8423-90b8a2c6df6b', 'outputs', 'tripquest');

const WEB = 5641, OSRM = 5642, ROUTES = 5643, PLACES = 5644, OP = 5645;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,GET,OPTIONS' };
const json = (res, o) => { res.writeHead(200, { ...CORS, 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

// ---- 假 OSRM：durations = 直線公尺 ÷ 8（宜蘭的路況大概是這個量級）----
const osrmSrv = createServer((req, res) => {
  const m = req.url.match(/\/table\/v1\/[a-z]+\/([^?]+)/);
  if (!m) { res.writeHead(404); return res.end(); }
  const pts = decodeURIComponent(m[1]).split(';').map((c) => c.split(',').map(Number));
  const R = 6371000, rad = (x) => x * Math.PI / 180;
  json(res, { code: 'Ok', durations: pts.map((a) => pts.map((b) => {
    const dl = rad(b[1] - a[1]), dg = rad(b[0] - a[0]);
    const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dg / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)) / 8);
  })) });
});
osrmSrv.listen(OSRM);

// ---- 假 Routes（大眾運輸）：兩段各給一條合理的宜蘭班次 ----
let legN = 0;
const LEGS = [
  { line: '區間車 4172', vehicle: 'COMMUTER_TRAIN', from: '頭城車站', to: '宜蘭車站', ride: 11, walk1: 9, walk2: 6 },
  { line: '首都客運 1766', vehicle: 'BUS', from: '宜蘭轉運站', to: '羅東夜市', ride: 26, walk1: 5, walk2: 4 },
];
const routesSrv = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    let j = {}; try { j = JSON.parse(body); } catch { /* noop */ }
    const L = LEGS[legN % LEGS.length]; legN++;
    const dep = new Date(j.departureTime || Date.now());
    const board = new Date(dep.getTime() + L.walk1 * 60000);
    const off = new Date(board.getTime() + L.ride * 60000);
    json(res, { routes: [{
      duration: String((L.walk1 + L.ride + L.walk2) * 60) + 's',
      legs: [{ steps: [
        { travelMode: 'WALK', staticDuration: String(L.walk1 * 60) + 's' },
        { travelMode: 'TRANSIT', staticDuration: String(L.ride * 60) + 's',
          transitDetails: {
            stopDetails: { departureStop: { name: L.from }, arrivalStop: { name: L.to },
              departureTime: board.toISOString(), arrivalTime: off.toISOString() },
            transitLine: { nameShort: L.line, name: L.line, vehicle: { type: L.vehicle } },
          } },
        { travelMode: 'WALK', staticDuration: String(L.walk2 * 60) + 's' },
      ] }],
    }] });
  });
});
routesSrv.listen(ROUTES);

// ---- 假 Places：羅東一帶的停車場 ----
const C = { lat: 24.6771, lng: 121.7669 };
const placesSrv = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    json(res, { places: [
      { id: 'g1', displayName: { text: '羅東夜市公有停車場' }, businessStatus: 'OPERATIONAL',
        location: { latitude: C.lat + 0.0011, longitude: C.lng + 0.0006 }, shortFormattedAddress: '宜蘭縣羅東鎮民權路' },
      { id: 'g2', displayName: { text: '嘟嘟房 羅東站' }, businessStatus: 'OPERATIONAL',
        location: { latitude: C.lat + 0.0022, longitude: C.lng - 0.0009 }, shortFormattedAddress: '宜蘭縣羅東鎮公正路 88 號' },
      { id: 'g3', displayName: { text: '（已歇業）舊中央市場停車場' }, businessStatus: 'CLOSED_PERMANENTLY',
        location: { latitude: C.lat + 0.003, longitude: C.lng }, shortFormattedAddress: '' },
      { id: 'g4', displayName: { text: 'Times 羅東中正路' }, businessStatus: 'OPERATIONAL',
        location: { latitude: C.lat - 0.0035, longitude: C.lng + 0.0012 }, shortFormattedAddress: '宜蘭縣羅東鎮中正路' },
    ] });
  });
});
placesSrv.listen(PLACES);

// ---- 假 Overpass：OSM 那一份（刻意混進 v1.66 會降權的「只有位置資料」空地）----
const el = (id, dLat, dLng, tags) => ({ type: 'node', id, lat: C.lat + dLat, lon: C.lng + dLng, tags });
const way = (id, dLat, dLng, tags) => ({ type: 'way', id, center: { lat: C.lat + dLat, lon: C.lng + dLng }, tags });
const opSrv = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const q = decodeURIComponent(body);
    if (!q.includes('[amenity=parking]')) return json(res, { elements: [] });
    json(res, { elements: [
      way(1, 0.0003, 0.0002, { amenity: 'parking', parking: 'surface' }),                    // 只有位置資料 → 降到後面
      way(2, 0.0005, -0.0003, { amenity: 'parking', parking: 'surface' }),                   // 同上
      way(3, 0.0012, 0.0007, { amenity: 'parking', name: '羅東夜市公有停車場', fee: 'yes', capacity: '186', parking: 'surface', 'addr:street': '民權路' }),
      el(4, 0.0024, -0.001, { amenity: 'parking_entrance', name: '嘟嘟房羅東站', parking: 'underground', fee: 'yes' }),
      way(5, -0.0036, 0.0013, { amenity: 'parking', name: 'Times 羅東中正路', fee: 'yes', capacity: '42', parking: 'surface' }),
      way(6, 0.006, 0.004, { amenity: 'parking', parking: 'surface' }),
    ] });
  });
});
opSrv.listen(OP);

const shots = [];
async function shot(page, name, note) {
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file });
  fs.copyFileSync(file, path.join(MIRROR, name + '.png'));
  const b = fs.readFileSync(file);
  shots.push({ name, px: b.readUInt32BE(16) + '×' + b.readUInt32BE(20), kb: Math.round(b.length / 1024), note });
  console.log(`  📸 ${name}.png  ${b.readUInt32BE(16)}×${b.readUInt32BE(20)}  ${Math.round(b.length / 1024)}KB`);
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(MIRROR, { recursive: true });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(`http://localhost:${WEB}`, ['geolocation']);
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.setGeolocation({ latitude: C.lat, longitude: C.lng });
  await page.evaluateOnNewDocument((o) => {
    window.__TQ_OSRM_ENDPOINT = o.osrm;
    window.__TQ_ROUTES_ENDPOINT = o.routes;
    window.__TQ_PLACES_ENDPOINT = o.places;
    window.__TQ_OVERPASS_ENDPOINT = o.op;
  }, { osrm: `http://localhost:${OSRM}`, routes: `http://localhost:${ROUTES}/routes`,
    places: `http://localhost:${PLACES}/places`, op: `http://localhost:${OP}/interpreter` });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    const d = new Date(Date.now() + 21 * 86400000);
    const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const end = new Date(d.getTime() + 2 * 86400000);
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭家族小旅行', region: '宜蘭',
      country: 'TW', startDate: iso(d), endDate: iso(end), allowWiki: false, allowGeo: false });
    const mk = async (name, emoji, day, order, lat, lng, extra = {}) => {
      const id = uuid();
      await s.put({ id, type: 'spot', tripId: tid, name, emoji, day, order, lat, lng, ...extra });
      return id;
    };
    // 第 1 天：一個時間都沒填 → 用「這一天幾點出發」推算，停留依景點類別
    // 三個景點分屬不同類別，預設停留才看得出差別（博物館 120／公園 60／夜市 90）
    await mk('蘭陽博物館', '🏛️', 1, 0, 24.8703, 121.8316);
    await mk('幾米公園', '📖', 1, 1, 24.7540, 121.7580);
    await mk('羅東夜市', '🏮', 1, 2, 24.6771, 121.7669);
    // 第 2 天：訂位的餐廳被拖到博物館後面 → 前後顛倒
    await mk('頭城老街', '🏮', 2, 0, 24.8580, 121.8230, { startMin: 14 * 60, stayMin: 90 });
    const rest = await mk('龍記活海產（已訂位）', '🦐', 2, 1, 24.8690, 121.8250, { startMin: 11 * 60 + 30, stayMin: 90 });
    // 第 3 天：前一站的固定時段還沒結束，下一站就開始了 → 重疊
    const tea = await mk('掌上明珠茶園', '🍵', 3, 0, 24.6690, 121.7220, { startMin: 13 * 60, stayMin: 120 });
    await mk('三星青蔥文化館', '🧅', 3, 1, 24.6690, 121.6520, { startMin: 14 * 60, stayMin: 60 });
    return { tid, rest, tea, iso: iso(d) };
  });

  // ================= v1.67 =================
  console.log('— v1.67 —');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  await page.waitForFunction(() => document.querySelectorAll('.plan-eta:not([hidden])').length >= 2, { timeout: 25000 });
  await page.waitForFunction(() => !!document.querySelector('.plan-conflict'), { timeout: 30000 });
  await page.waitForFunction(() => !!document.querySelector('.pd-check[data-day="3"]'), { timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(800);
  await shot(page, 'v1670-時刻表推算-停留時間依景點類別',
    '第 1 天一個時間都沒填，照樣排得出時刻表；溫泉／瀑布／夜市各用不同的預設停留，而且標明是推算');

  // 捲到第 2 天的矛盾提示
  await page.evaluate(() => {
    const n = document.querySelector('.plan-conflict');
    if (n) n.scrollIntoView({ block: 'center' });
  });
  await sleep(500);
  await shot(page, 'v1670-固定時刻互相矛盾-順序排反了',
    '訂位 11:30 的餐廳被排在 14:00 的博物館後面 —— 完全不需要估算就成立的錯誤');

  // ================= v1.69 =================
  console.log('— v1.69 —');
  await page.waitForFunction(() => !!document.querySelector('.pd-check[data-day="3"]'), { timeout: 30000 });
  await page.evaluate(() => document.querySelector('.pd-check[data-day="3"]').scrollIntoView({ block: 'center' }));
  await sleep(400);
  await page.evaluate(() => document.querySelector('.pd-check[data-day="3"]').click());
  await page.waitForSelector('.chk-item', { timeout: 20000 });
  await sleep(600);
  await shot(page, 'v1690-行程檢查-預覽後才套用',
    '一次最多三條、依當天時間先後排；每一條都可以單獨「這樣改」或「這樣沒關係」');

  await page.evaluate(() => [...document.querySelectorAll('.chk-item .btn')].find((b) => b.textContent.includes('這樣改')).click());
  await page.waitForFunction(() => document.querySelector('.chk-item.done'), { timeout: 20000 });
  await sleep(700);
  await shot(page, 'v1690-行程檢查-套用後原地可復原',
    '套用後原地變成「✓ 已改好」不無聲消失，而且那一列自己帶「復原」');
  await page.evaluate(() => document.querySelector('.modal-actions .btn')?.click());
  await sleep(500);

  // 第 1 天的「這一天幾點出發」
  await page.waitForFunction(() => !!document.querySelector('.pd-start[data-day="1"]'), { timeout: 30000 });
  await page.evaluate(() => document.querySelector('.pd-start[data-day="1"]').scrollIntoView({ block: 'start' }));
  await sleep(500);
  await shot(page, 'v1690-這一天幾點出發-可以改而且會同步',
    '沒有人填時間的那一天才出現；這是使用者自己設的值（trip.dayStarts），全家看到同一份');

  // ================= v1.68 =================
  console.log('— v1.68 —');
  await page.evaluate(async (tid) => {
    const k = await import('./js/aikeys.js');
    await k.setTripKey(tid, { mapsKey: 'AIzaSHOTSHOTSHOTSHOTSHOTSHOTSHOTSHOTS' });
  }, ids.tid);
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/settings`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page');
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.textContent === '地圖金鑰（Google）'), { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => {
    const n = [...document.querySelectorAll('.section-label')].find((x) => x.textContent.includes('地圖加值'));
    if (n) n.scrollIntoView({ block: 'start' });
  });
  await sleep(600);
  await shot(page, 'v1680-地圖加值-自帶金鑰與用量',
    '跟 AI 金鑰分開、也獨立於 AI 開關；用量算次數不算錢，預設 300 次／月是保險絲不是預算');

  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  await page.waitForFunction(() => document.querySelector('.pd-transit[data-day="1"]'), { timeout: 25000 });
  await page.evaluate(() => document.querySelector('.pd-transit[data-day="1"]').click());
  await page.waitForFunction(() => document.querySelectorAll('.plan-travel-note.transit').length >= 2, { timeout: 30000 });
  await sleep(700);
  await page.evaluate(() => document.querySelector('.plan-travel-note.transit')?.scrollIntoView({ block: 'center' }));
  await sleep(400);
  await shot(page, 'v1680-大眾運輸-實際班次而不是開車估算',
    '路線名／上下車站／發車時刻／轉乘／走路都列出來；開車估算降級成灰色附註');

  // ================= v1.70 =================
  console.log('— v1.70 —');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/nearby`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.nl-card', { timeout: 25000 });
  await sleep(700);
  await shot(page, 'v1700-找附近-地圖資料是預設-可離線',
    'OSM 那一份：有登記證據的排前面，「只有位置資料」的空地降到後面並標出來（v1.66）');

  await page.waitForFunction(() => !!document.querySelector('.nl-google'), { timeout: 15000 });
  await page.evaluate(() => document.querySelector('.nl-google').click());
  await page.waitForFunction(() => (document.querySelector('.nl-count') || {}).textContent?.includes('Google'), { timeout: 20000 });
  await sleep(700);
  await shot(page, 'v1700-找附近-用Google再查一次',
    '歇業的直接不列；每張卡標明出處；明說這份不存在手機裡、離線看不到，可以一鍵切回地圖資料');

  console.log('\n完成 ' + shots.length + ' 張');
  console.log('  → ' + OUT);
  console.log('  → ' + MIRROR);
} catch (e) {
  console.error('✗ 例外：' + (e && e.stack || e));
  process.exitCode = 1;
} finally {
  await browser.close();
  web.kill(); osrmSrv.close(); routesSrv.close(); placesSrv.close(); opSrv.close();
}
