// v1.48 實測：用使用者的真實行程（fixtures/yilan.txt）打「真的」Nominatim，
// 看涵蓋率前後對比，並輸出補完座標後的路線圖。
// ⚠️ 會發真實網路請求（每秒最多一次、有快取），所以是獨立腳本，不進 npm test。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = new URL('../screenshots/_v148/', import.meta.url);
await mkdir(OUT, { recursive: true });
const WEB = 5499;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const text = await readFile(fileURLToPath(new URL('./fixtures/yilan.txt', import.meta.url)), 'utf8');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
const savePng = async (name, dataURL) => {
  await writeFile(fileURLToPath(new URL(name + '.png', OUT)), Buffer.from(dataURL.split(',')[1], 'base64'));
  console.log('  📸 ' + name);
};

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // 用真實行程建立旅程（跟匯入流程同一條路）
  const seed = await page.evaluate(async (text) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { parseItinerary } = await import('./js/itinerary.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭遊', region: '宜蘭',
      startDate: '2026-09-05', endDate: '2026-09-06', allowWiki: false });
    const parsed = parseItinerary(text);
    const items = parsed.items.map((it) => ({ name: it.name, day: it.day, startMin: it.startMin ?? null, stayMin: it.stayMin ?? null }));
    const { spots, quests } = await generateForTrip({ tripId: tid, region: '宜蘭', items });
    for (const x of spots) await s.put(x);
    for (const x of quests) await s.put(x);
    const all = s.spotsOf(tid);
    return { tid,
      total: all.length,
      withCoord: all.filter((x) => x.lat != null && x.lng != null).length,
      names: all.map((x) => `${x.name}${x.lat != null ? ' ✓' : ''}`) };
  }, text);
  console.log(`\n匯入「宜蘭遊」：${seed.total} 個地點，補之前 ${seed.withCoord} 個有座標`);

  const mapShot = async () => await page.evaluate(async (tid) => {
    const mem = await import('./js/memory.js');
    const c = document.createElement('canvas');
    const player = await mem.createPlayer(c, tid, { length: 'full' });
    const t = await mem.buildTimeline(tid, { length: 'full' });
    const seg = t.segs.find((x) => x.kind === 'map');
    if (!seg) { player.destroy(); return null; }   // 有座標的不到 2 個 → 影片裡根本沒有路線圖段
    player.seek(seg.start + seg.dur * 0.95);
    await new Promise((r) => setTimeout(r, 400));
    player.seek(seg.start + seg.dur * 0.95);
    const png = c.toDataURL('image/png');
    player.destroy();
    return png;
  }, seed.tid);

  const beforePng = await mapShot();
  if (beforePng) await savePng('路線圖-補之前', beforePng);
  else console.log('  （補之前有座標的不到 2 個 —— 影片裡連路線圖段都不會出現）');

  // 打真的 Nominatim（節流 1.1 秒一發）
  console.log('\n開始向 Nominatim 查詢（真實網路，每秒最多一次）…');
  const t0 = Date.now();
  const r = await page.evaluate(async (tid) => {
    const { fillTripCoords } = await import('./js/geocode.js');
    return fillTripCoords(tid);
  }, seed.tid);
  const secs = Math.round((Date.now() - t0) / 1000);
  const after = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const all = s.spotsOf(tid);
    return { withCoord: all.filter((x) => x.lat != null && x.lng != null).length,
      list: all.map((x) => `${x.lat != null ? '✓' : '✗'} ${x.name}${x.geoSrc ? `（${x.geoSrc}）` : ''}`) };
  }, seed.tid);

  console.log(`\n查了 ${r.tried} 個、找到 ${r.found} 個，花 ${secs} 秒`);
  console.log(`涵蓋率：${seed.withCoord}/${seed.total} → ${after.withCoord}/${seed.total}`);
  for (const l of after.list) console.log('  ' + l);

  const afterPng = await mapShot();
  if (afterPng) await savePng('路線圖-補之後', afterPng);

  // 海報翻頁列（新文案：第 X 天 / 共 N 天；兩端隱藏）
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${seed.tid}/poster`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.pager:not([hidden])', { timeout: 40000 });
  await page.evaluate(() => document.querySelector('.pager').scrollIntoView({ block: 'center' }));
  await sleep(300);
  await page.screenshot({ path: fileURLToPath(new URL('海報-第一張-前一張已藏.png', OUT)) });
  await page.click('.pager-btn:last-of-type');
  await sleep(2500);
  await page.evaluate(() => document.querySelector('.pager').scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: fileURLToPath(new URL('海報-最後一張-下一張已藏.png', OUT)) });
  console.log('  📸 海報翻頁列 ×2');

  console.log('\nv1.48 實測結束');
} catch (e) {
  console.error('例外：', e && e.stack || e);
  process.exitCode = 1;
} finally {
  await browser.close();
  web.kill();
}
