// 景點定位：照片 GPS 中位數、地名查詢（節流/快取/防呆）、手動貼座標（npm run geotest）
//
// 地名查詢打的是假的 Nominatim（本機起一個），才能驗三件真正要緊的事而不騷擾
// 真服務：①每秒最多一次、②查過必快取（第二輪零請求）、③離整趟太遠的結果要丟掉。

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5497, GEO = 5498;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });

// ---- 假的 Nominatim ----
const hits = [];   // {q, at}
const FIX = {
  '林場肉羹 宜蘭': [24.678, 121.771], '北門綠豆沙牛乳大王-羅東店 宜蘭': [24.679, 121.766],
  '山風民宿hillstay 宜蘭': [24.672, 121.769], '中興文化創意園區 宜蘭': [24.665, 121.752],
  '石頭鄉燜烤玉米-羅東總店 宜蘭': [24.677, 121.770],
  // 陷阱：同名的店在冰島（離中心 9000 公里）——防呆要把它丟掉
  '同名很遠的店 宜蘭': [64.14, -21.94],
};
const geoSrv = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const q = u.searchParams.get('q') || '';
  hits.push({ q, at: Date.now() });
  const hit = FIX[q];
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(hit ? [{ lat: String(hit[0]), lon: String(hit[1]), display_name: q }] : []));
}).listen(GEO);
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  await page.evaluate(async (geoUrl) => {
    (await import('./js/geocode.js')).setGeoEndpoint(geoUrl);
  }, `http://localhost:${GEO}/search`);

  // 行程：2 個有座標（羅東夜市、粉鳥林）＋ 6 個沒有（其中一個是「家」、一個是遠方陷阱）
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭遊', region: '宜蘭', allowWiki: false });
    const mk = async (name, extra = {}) => {
      const id = uuid();
      await s.put({ id, type: 'spot', tripId: tid, name, emoji: '📍', day: 1, order: 0, ...extra });
      return id;
    };
    const withCoord = [await mk('羅東觀光夜市', { lat: 24.6779, lng: 121.7674 }), await mk('粉鳥林', { lat: 24.4736, lng: 121.8355 })];
    const noCoord = {
      food: await mk('林場肉羹'),
      drink: await mk('北門綠豆沙牛乳大王-羅東店'),
      stay: await mk('山風民宿hillstay（好評）'),
      home: await mk('家'),
      far: await mk('同名很遠的店'),
      none: await mk('查不到的神祕小店'),
    };
    return { tid, withCoord, noCoord };
  });

  // ---------- parseCoordInput ----------
  console.log('— 貼座標 —');
  const parses = await page.evaluate(async () => {
    const { parseCoordInput } = await import('./js/geocode.js');
    return {
      raw: parseCoordInput('24.677, 121.767'),
      gmapAt: parseCoordInput('https://www.google.com/maps/@24.6779,121.7674,15z'),
      gmapPin: parseCoordInput('https://maps.google.com/maps?x=1!3d24.6779!4d121.7674!z'),
      junk: parseCoordInput('羅東夜市超好吃'),
      outOfRange: parseCoordInput('124.677, 921.767'),
    };
  });
  yes(parses.raw?.lat === 24.677, '「24.677, 121.767」解析成功');
  yes(parses.gmapAt?.lng === 121.7674, 'Google 地圖 @lat,lng 網址解析成功');
  yes(parses.gmapPin?.lat === 24.6779, 'Google 地圖 !3d!4d 網址解析成功');
  yes(parses.junk === null && parses.outOfRange === null, '亂貼的字與超出範圍的數字都拒絕');

  // ---------- 照片 GPS 中位數 ----------
  console.log('\n— 照片 GPS —');
  const med = await page.evaluate(async (ids) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const geo = await import('./js/geocode.js');
    // 「查不到的神祕小店」有三張照片：兩張在店裡、一張在車上拍的離群值
    const qid = uuid();
    await s.put({ id: qid, type: 'quest', tripId: ids.tid, spotId: ids.noCoord.none, title: 't', kind: 'thing', order: 0 });
    const mkSub = (gps) => s.addSubmission({ tripId: ids.tid, questId: qid, memberId: null,
      photoHash: uuid().replace(/-/g, ''), thumbHash: null, gps, takenAt: Date.now(), caption: '' });
    await mkSub({ lat: 24.701, lng: 121.801 });
    await mkSub({ lat: 24.702, lng: 121.802 });
    await mkSub({ lat: 24.950, lng: 122.100 });     // 離群值
    return geo.photoCoordsForSpot(ids.noCoord.none);
  }, ids);
  yes(med && med.lat === 24.702 && med.lng === 121.802, `取中位數，不被離群值拖走（${med.lat}, ${med.lng}）`, JSON.stringify(med));

  // ---------- 整趟補齊 ----------
  console.log('\n— 整趟補齊（假 Nominatim）—');
  const r1 = await page.evaluate(async (tid) => (await import('./js/geocode.js')).fillTripCoords(tid), ids.tid);
  const after = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    return Object.fromEntries(s.spotsOf(tid).map((x) => [x.name, { lat: x.lat, src: x.geoSrc || null }]));
  }, ids.tid);
  console.log('  結果：', JSON.stringify(r1));
  yes(r1.found >= 4, `補上了 ${r1.found} 個位置`);
  yes(after['林場肉羹'].src === 'osm' && Math.abs(after['林場肉羹'].lat - 24.678) < 0.01, '「林場肉羹」用地名查到（帶上了地區）');
  yes(after['山風民宿hillstay（好評）'].src === 'osm', '括號註記清掉後照樣查得到民宿');
  yes(after['查不到的神祕小店'].src === 'photo' && after['查不到的神祕小店'].lat === 24.702, '有照片 GPS 的優先用照片（中位數）');
  yes(after['家'].lat == null, '「家」這種名字不拿去查（清理後太短）');
  yes(after['同名很遠的店'].lat == null, '查到的座標離整趟 9000 公里 → 當查錯丟掉，不亂猜');

  // 節流：相鄰請求至少隔 1 秒
  let minGap = Infinity;
  for (let i = 1; i < hits.length; i++) minGap = Math.min(minGap, hits[i].at - hits[i - 1].at);
  yes(hits.length >= 4 && minGap >= 1000, `每秒最多一次（${hits.length} 個請求，最小間隔 ${minGap}ms）`);

  // 快取：再跑一輪，不可以有任何新請求（查到的存進景點了、查不到的有負面快取）
  const before = hits.length;
  const r2 = await page.evaluate(async (tid) => (await import('./js/geocode.js')).fillTripCoords(tid), ids.tid);
  yes(hits.length === before, `第二輪零請求（快取生效；這輪只剩 ${r2.tried} 個沒座標的再確認）`);

  // ---------- UI：plan 的按鈕、景點設定的位置區 ----------
  console.log('\n— UI —');
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  const planBtn = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent).find((x) => x.includes('自動找出景點位置')));
  yes(!!planBtn, `調整行程頁有入口：「${planBtn?.trim()}」`);

  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/spot/${ids.noCoord.home}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page.form');
  const spotUI = await page.evaluate(() => ({
    line: [...document.querySelectorAll('.form-hint')].map((x) => x.textContent).find((x) => x.includes('位置')),
    btns: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((x) => /查位置|貼座標|清除位置/.test(x)),
  }));
  yes(spotUI.line?.includes('還沒有位置'), `景點設定顯示狀態：「${spotUI.line}」`);
  yes(spotUI.btns.length === 3, `有 查位置 / 貼座標 / 清除位置 三顆（${spotUI.btns.join('、')}）`);

  // 貼座標 → 清除，走完整流程
  await page.evaluate(async (sid) => {
    const s = await import('./js/store.js');
    const { parseCoordInput } = await import('./js/geocode.js');
    const c = parseCoordInput('24.66, 121.75');
    await s.patch(sid, { lat: c.lat, lng: c.lng, geoSrc: 'manual' });
  }, ids.noCoord.home);
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/spot/${ids.noCoord.home}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page.form');
  const manual = await page.evaluate(() => [...document.querySelectorAll('.form-hint')].map((x) => x.textContent).find((x) => x.includes('位置')));
  yes(manual?.includes('手動'), `手動設定後顯示來源：「${manual}」`);

  console.log('\n定位測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); geoSrv.close();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
