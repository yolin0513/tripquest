// 找附近（npm run nearbytest，v1.59）—— mock Overpass + 假定位：
//   · 行程頁入口 → 五分類大按鈕 → 停車場預設
//   · 欄位：總車位／無障礙格／收費／地下・平面／消費者限定；廁所無障礙＋尿布台；超商 24 小時
//   · 誠實標示：總車位≠即時剩餘；私人停車場被濾掉；無名設施給通用名
//   · 導航一律用座標（分店多、無名多——「地名優先」的合理例外）
//   · 離線／查詢失敗：講人話＋再試一次；快取還在就標示是舊資料

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5601, OP = 8807;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });

// ---- mock Overpass：依查詢裡的 selector 回對應設施 ----
const C = { lat: 24.677, lng: 121.7669 };                 // 羅東夜市一帶
const el = (id, dLat, dLng, tags) => ({ type: 'node', id, lat: C.lat + dLat, lon: C.lng + dLng, tags });
const FIX = {
  'amenity=parking': [
    el(1, 0.001, 0.001, { amenity: 'parking', name: '羅東夜市地下停車場', capacity: '120', 'capacity:disabled': '3', fee: 'yes', parking: 'underground' }),
    el(2, 0.003, -0.002, { amenity: 'parking', fee: 'no', parking: 'surface' }),                       // 無名、免費、平面
    el(3, -0.004, 0.003, { amenity: 'parking', access: 'private', name: '住戶專用' }),                  // 要被濾掉
    el(4, 0.006, 0.004, { amenity: 'parking', access: 'customers', parking: 'surface', name: '超商附設停車場' }),
    el(5, -0.008, -0.006, { amenity: 'parking', parking: 'multi-storey', capacity: '250' }),
  ],
  'amenity=toilets': [
    el(11, 0.001, -0.001, { amenity: 'toilets', wheelchair: 'yes', changing_table: 'yes', fee: 'no' }),
    el(12, 0.004, 0.002, { amenity: 'toilets' }),
  ],
  'shop=convenience': [
    el(21, 0.002, 0.001, { shop: 'convenience', name: '7-Eleven 羅東門市', opening_hours: '24/7' }),
    el(22, -0.003, 0.002, { shop: 'convenience', brand: '全家', opening_hours: 'Mo-Su 06:00-23:00' }),
  ],
  'amenity=fuel': [el(31, 0.01, 0.01, { amenity: 'fuel', name: '台灣中油羅東站', opening_hours: '24/7' })],
  'amenity=pharmacy': [el(41, 0.005, -0.004, { amenity: 'pharmacy', name: '大樹藥局' })],
};
let opDown = false;
const op = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (opDown) { res.writeHead(503); return res.end('busy'); }
    const q = decodeURIComponent(body);
    const key = Object.keys(FIX).find((k) => q.includes(`[${k}]`));
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ elements: key ? FIX[key] : [] }));
  });
});
op.listen(OP);
await sleep(1500);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

try {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(`http://localhost:${WEB}`, ['geolocation']);
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.setGeolocation({ latitude: C.lat, longitude: C.lng });
  await page.evaluateOnNewDocument((u) => { window.__TQ_OVERPASS_ENDPOINT = u; }, `http://localhost:${OP}/`);
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  const tid = await page.evaluate(async () => {
    const s = await import('./js/store.js'); const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '測試' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭行', region: '宜蘭', allowWiki: false });
    await s.put({ id: uuid(), type: 'spot', tripId: tid, name: '羅東夜市', emoji: '🏮', day: 1, order: 0, lat: 24.677, lng: 121.7669 });
    return tid;
  });

  // ---------- 入口 ----------
  await page.evaluate((t) => { location.hash = '#/trip/' + t; }, tid);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => x.textContent.includes('找附近')), { timeout: 10000 });
  const entry = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('找附近'));
    return b ? { txt: b.textContent, h: b.getBoundingClientRect().height } : null;
  });
  yes(entry && entry.txt.includes('停車場') && entry.h >= 40, `行程頁有「找附近」入口（${entry && Math.round(entry.h)}px）`);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.includes('找附近')).click());
  await page.waitForSelector('.nl-cats', { timeout: 10000 });

  // ---------- 分類按鈕 ----------
  const cats = await page.$$eval('.nl-cat', (els) => els.map((e) => ({ t: e.textContent, h: e.getBoundingClientRect().height, emoji: e.querySelector('.nl-cat-emoji').getBoundingClientRect().height })));
  yes(cats.length === 5 && ['停車場', '廁所', '便利商店', '加油站', '藥局'].every((x) => cats.some((c) => c.t.includes(x))), '五個分類都在');
  yes(cats.every((c) => c.h >= 52 && c.emoji >= 22), `分類是大按鈕（高 ${Math.round(cats[0].h)}px、大圖示）`);

  // ---------- 停車場（預設分類） ----------
  await page.waitForSelector('.nl-card', { timeout: 10000 });
  const parking = await page.evaluate(() => ({
    note: document.querySelector('.nl-note')?.textContent || '',
    count: document.querySelector('.nl-count')?.textContent || '',
    cards: [...document.querySelectorAll('.nl-card')].map((c) => ({
      name: c.querySelector('.nl-name').textContent,
      dist: c.querySelector('.nl-dist').textContent,
      chips: [...c.querySelectorAll('.nl-chip')].map((x) => x.textContent),
      href: c.querySelector('.nl-go').href,
      nameSize: parseFloat(getComputedStyle(c.querySelector('.nl-name')).fontSize),
    })),
  }));
  yes(parking.note.includes('總車位') && parking.note.includes('不是現在剩幾格'), '誠實標示：總車位 ≠ 即時剩餘');
  yes(parking.note.includes('免金鑰') || parking.note.includes('先不提供'), '誠實標示：即時車位沒有免金鑰來源、先不提供');
  yes(parking.count.includes('4 個'), `私人停車場被濾掉（5 筆進 4 筆出）：「${parking.count.trim()}」`);
  yes(!parking.cards.some((c) => c.name.includes('住戶專用')), 'access=private 不出現在清單');
  const first = parking.cards[0];
  yes(first.name.includes('羅東夜市地下停車場'), `距離排序：最近的在最上面（${first.name}）`);
  yes(first.chips.includes('總車位 120') && first.chips.includes('♿ 無障礙 3 格') && first.chips.includes('收費') && first.chips.includes('地下'),
    `欄位齊：${first.chips.join(' / ')}`);
  const unnamed = parking.cards.find((c) => c.chips.includes('免費'));
  yes(unnamed && unnamed.name.includes('停車場') && unnamed.chips.includes('平面'), '無名停車場給通用名＋免費＋平面');
  yes(parking.cards.some((c) => c.chips.includes('消費者限定')), 'access=customers 標「消費者限定」');
  yes(/dir\/.*destination=24\.6|destination=24\.6/.test(decodeURIComponent(first.href)), `導航用座標不用店名：${decodeURIComponent(first.href).slice(-28)}`);
  yes(/往[東南西北]{1,2} /.test(first.dist), `有方向與距離：「${first.dist}」`);
  yes(first.nameSize >= 16, `結果大字（名稱 ${first.nameSize}px）`);

  // ---------- 廁所 ----------
  await page.evaluate(() => [...document.querySelectorAll('.nl-cat')].find((x) => x.textContent.includes('廁所')).click());
  await page.waitForFunction(() => document.querySelector('.nl-count')?.textContent.includes('廁所'), { timeout: 8000 });
  const wc = await page.evaluate(() => [...document.querySelectorAll('.nl-card')].map((c) => ({
    name: c.querySelector('.nl-name').textContent, chips: [...c.querySelectorAll('.nl-chip')].map((x) => x.textContent) })));
  yes(wc.length === 2 && wc[0].chips.includes('♿ 無障礙') && wc[0].chips.includes('🚼 尿布台') && wc[0].chips.includes('免費'),
    `廁所：無障礙＋尿布台＋免費（${wc[0].chips.join(' / ')}）`);
  yes(wc.some((c) => c.name.includes('公共廁所')), '無名廁所給通用名「公共廁所」');
  const noteHidden = await page.evaluate(() => document.querySelector('.nl-note').hidden);
  yes(noteHidden, '車位數的說明只在停車場分類出現');

  // ---------- 便利商店 ----------
  await page.evaluate(() => [...document.querySelectorAll('.nl-cat')].find((x) => x.textContent.includes('便利商店')).click());
  await page.waitForFunction(() => document.querySelector('.nl-count')?.textContent.includes('便利商店'), { timeout: 8000 });
  const cv = await page.evaluate(() => [...document.querySelectorAll('.nl-card')].map((c) => ({
    name: c.querySelector('.nl-name').textContent, chips: [...c.querySelectorAll('.nl-chip')].map((x) => x.textContent) })));
  yes(cv.some((c) => c.name.includes('7-Eleven') && c.chips.includes('🕐 24 小時')), '超商：品牌名＋24 小時標示');
  yes(cv.some((c) => c.name.includes('全家') && c.chips.some((x) => x.includes('06:00-23:00'))), '非 24 小時的顯示營業時間');

  // ---------- 加油站與藥局 ----------
  for (const [label, expect] of [['加油站', '台灣中油'], ['藥局', '大樹藥局']]) {
    await page.evaluate((l) => [...document.querySelectorAll('.nl-cat')].find((x) => x.textContent.includes(l)).click(), label);
    await page.waitForFunction((l) => document.querySelector('.nl-count')?.textContent.includes(l), { timeout: 8000 }, label);
    const names = await page.$$eval('.nl-card .nl-name', (els) => els.map((e) => e.textContent).join(','));
    yes(names.includes(expect), `${label}：${names}`);
  }

  // ---------- 換中心（用景點當中心） ----------
  await page.select('.nl-center', await page.$eval('.nl-center option:nth-child(2)', (o) => o.value));
  await page.waitForFunction(() => document.querySelector('.nl-centerline')?.textContent.includes('羅東夜市'), { timeout: 8000 });
  ok('可以改用景點當中心（「以『羅東夜市』為中心」）');

  // ---------- 快取＋服務掛掉 ----------
  opDown = true;
  await page.evaluate(() => [...document.querySelectorAll('.nl-cat')].find((x) => x.textContent.includes('停車場')).click());
  await page.waitForSelector('.nl-card', { timeout: 8000 });
  ok('服務掛了但一天內查過 → 用快取照樣有結果');
  // 沒快取的分類 + 服務掛 → 講人話
  await page.evaluate(() => { localStorage.removeItem('tripquest.nearlife'); });
  await page.evaluate(() => [...document.querySelectorAll('.nl-cat')].find((x) => x.textContent.includes('廁所')).click());
  await page.waitForFunction(() => document.querySelector('.nl-list')?.textContent.includes('再試一次'), { timeout: 15000 });
  const failTxt = await page.evaluate(() => document.querySelector('.nl-list').textContent);
  yes(failTxt.includes('查不到') && !/503|Error/.test(failTxt), `查詢失敗講人話＋再試一次：「${failTxt.trim().slice(0, 22)}…」`);

  console.log('\n找附近測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); op.close();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
