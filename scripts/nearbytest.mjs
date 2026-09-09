// 找附近（npm run nearbytest，v1.59）—— mock Overpass + 假定位：
//   · 行程頁入口 → 真的到達找附近頁（網址＋畫面）→ 四分類大按鈕 → 停車場預設
//   · 路由完整性稽核：app.js 每條 view import 都要在 sw.js SHELL；notFound 退回行程頁
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
    // ---- 石牌實測案例（v1.59.2）----
    el(6, 0.0008, 0.0006, { amenity: 'parking_entrance', name: '石牌國小地下停車場', parking: 'underground' }),  // 只標入口的地下停車場
    el(7, 0.0009, 0.0007, { amenity: 'parking_entrance', name: '石牌國小地下停車場', parking: 'underground' }),  // 第二個入口（要去重）
    el(8, 0.0004, -0.0004, { amenity: 'parking_entrance' }),                                            // 無名入口（大樓車道）→ 不列
    el(9, -0.002, 0.001, { amenity: 'parking', access: 'permit', parking: 'surface' }),                 // 要許可證 → 不列
    el(10, 0.005, 0.005, { amenity: 'parking', 'addr:street': '明德路', parking: 'surface', fee: 'yes' }),
    el(11, 0.004, -0.003, { amenity: 'parking', parking: 'lane' }),                                     // 無名路邊格
  ],
  'amenity=toilets': [
    el(21001, 0.001, -0.001, { amenity: 'toilets', wheelchair: 'yes', changing_table: 'yes', fee: 'no' }),
    el(21002, 0.004, 0.002, { amenity: 'toilets', operator: '北投區公所' }),                             // 沒 name 但有管理單位
  ],
  'shop=convenience': [
    el(21, 0.002, 0.001, { shop: 'convenience', name: '7-Eleven 羅東門市', opening_hours: '24/7' }),
    el(22, -0.003, 0.002, { shop: 'convenience', brand: '全家', opening_hours: 'Mo-Su 06:00-23:00' }),
  ],
  'amenity=fuel': [el(31, 0.01, 0.01, { amenity: 'fuel', name: '台灣中油羅東站', opening_hours: '24/7' })],
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
  const arrived = await page.evaluate(() => ({ hash: location.hash, cats: !!document.querySelector('.nl-cats') }));
  yes(/\/trip\/[A-Za-z0-9-]+\/nearby$/.test(arrived.hash) && arrived.cats,
    `點入口「真的」到達找附近頁（${arrived.hash.replace(/[A-Za-z0-9-]{20,}/, '…')}）`);

  // ---------- 分類按鈕 ----------
  const cats = await page.$$eval('.nl-cat', (els) => els.map((e) => ({ t: e.textContent, h: e.getBoundingClientRect().height, emoji: e.querySelector('.nl-cat-emoji').getBoundingClientRect().height })));
  yes(cats.length === 4 && ['停車場', '廁所', '便利商店', '加油站'].every((x) => cats.some((c) => c.t.includes(x))), '四個分類都在');
  yes(!cats.some((c) => c.t.includes('藥局')), '藥局不在（SOS 頁已有，不重複）');
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
  yes(parking.count.includes('7 個'), `private/permit/無名入口被濾掉、同名入口去重（11 筆進 7 筆出）：「${parking.count.trim()}」`);
  yes(!parking.cards.some((c) => c.name.includes('住戶專用')), 'access=private 不出現在清單');
  yes(!parking.cards.some((c) => c.chips.includes('停車場入口') && !c.name), '無名入口（大樓車道口）不出現');
  const names = parking.cards.map((c) => c.name).join('|');
  yes(parking.cards.filter((c) => c.name.includes('石牌國小地下停車場')).length === 1,
    '只標「入口」的地下停車場查得到，且兩個入口去重成一筆（石牌案例）');
  const first = parking.cards[0];
  yes(first.name.includes('石牌國小地下停車場') && first.chips.includes('停車場入口') && first.chips.includes('地下'),
    `距離排序：最近的入口在最上面（${first.name}｜${first.chips.join('/')}）`);
  const luodong = parking.cards.find((c) => c.name.includes('羅東夜市地下停車場'));
  yes(luodong && luodong.chips.includes('總車位 120') && luodong.chips.includes('♿ 無障礙 3 格') && luodong.chips.includes('收費') && luodong.chips.includes('地下'),
    `欄位齊：${luodong.chips.join(' / ')}`);
  yes(parking.cards.some((c) => c.name.includes('明德路 · 平面停車場')), `無名但有街道 → 「明德路 · 平面停車場」（${names.slice(0, 60)}…）`);
  yes(parking.cards.some((c) => c.name.endsWith('路邊停車格')), '無名路邊格 → 「路邊停車格」不是一律「停車場」');
  const unnamed = parking.cards.find((c) => c.chips.includes('免費'));
  yes(unnamed && unnamed.name.endsWith('平面停車場') && !unnamed.name.includes('明德路'), '無名平面場 → 「平面停車場」');
  yes(parking.cards.filter((c) => c.name.endsWith('平面停車場')).length === 2, '產生的通用名不參與去重（兩塊不同的平面場都在）');
  yes(parking.cards.some((c) => c.chips.includes('限顧客')), 'access=customers 標「限顧客」');
  yes(/dir\/.*destination=24\.6|destination=24\.6/.test(decodeURIComponent(first.href)), `導航用座標不用店名：${decodeURIComponent(first.href).slice(-28)}`);
  yes(/^\d+ (公尺|公里)/.test(first.dist.trim()) && !first.dist.includes('往'), `只顯示距離、不顯示方位：「${first.dist.trim()}」`);
  yes(first.nameSize >= 16, `結果大字（名稱 ${first.nameSize}px）`);

  // ---------- 廁所 ----------
  await page.evaluate(() => [...document.querySelectorAll('.nl-cat')].find((x) => x.textContent.includes('廁所')).click());
  await page.waitForFunction(() => document.querySelector('.nl-count')?.textContent.includes('廁所'), { timeout: 8000 });
  const wc = await page.evaluate(() => [...document.querySelectorAll('.nl-card')].map((c) => ({
    name: c.querySelector('.nl-name').textContent, chips: [...c.querySelectorAll('.nl-chip')].map((x) => x.textContent) })));
  yes(wc.length === 2 && wc[0].chips.includes('♿ 無障礙') && wc[0].chips.includes('🚼 尿布台') && wc[0].chips.includes('免費'),
    `廁所：無障礙＋尿布台＋免費（${wc[0].chips.join(' / ')}）`);
  yes(wc.some((c) => c.name.includes('公共廁所')), '無名廁所給通用名「公共廁所」');
  yes(wc.some((c) => c.name.includes('北投區公所')), '沒名字但有管理單位的廁所 → 顯示管理單位');
  const noteHidden = await page.evaluate(() => document.querySelector('.nl-note').hidden);
  yes(noteHidden, '車位數的說明只在停車場分類出現');

  // ---------- 便利商店 ----------
  await page.evaluate(() => [...document.querySelectorAll('.nl-cat')].find((x) => x.textContent.includes('便利商店')).click());
  await page.waitForFunction(() => document.querySelector('.nl-count')?.textContent.includes('便利商店'), { timeout: 8000 });
  const cv = await page.evaluate(() => [...document.querySelectorAll('.nl-card')].map((c) => ({
    name: c.querySelector('.nl-name').textContent, chips: [...c.querySelectorAll('.nl-chip')].map((x) => x.textContent) })));
  yes(cv.some((c) => c.name.includes('7-Eleven') && c.chips.includes('🕐 24 小時')), '超商：品牌名＋24 小時標示');
  yes(cv.some((c) => c.name.includes('全家') && c.chips.some((x) => x.includes('06:00-23:00'))), '非 24 小時的顯示營業時間');

  // ---------- 加油站 ----------
  {
    await page.evaluate(() => [...document.querySelectorAll('.nl-cat')].find((x) => x.textContent.includes('加油站')).click());
    await page.waitForFunction(() => document.querySelector('.nl-count')?.textContent.includes('加油站'), { timeout: 8000 });
    const names = await page.$$eval('.nl-card .nl-name', (els) => els.map((e) => e.textContent).join(','));
    yes(names.includes('台灣中油'), `加油站：${names}`);
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

  // ---------- notFound 退路：/trip/<id>/亂路 → 回該行程頁（不是首頁） ----------
  await page.evaluate((t) => { location.hash = '#/trip/' + t + '/nosuchpage'; }, tid);
  await page.waitForFunction((t) => location.hash === '#/trip/' + t, { timeout: 8000 }, tid);
  ok('對不上的 /trip/<id>/* 路由退回行程頁，不會被踢回主畫面（SW 換版空窗的保險絲）');

  // ---------- 分享按鈕搬到旅程設定 ----------
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => x.textContent.includes('找附近')), { timeout: 10000 });
  const tripBtns = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent).join('|'));
  yes(!tripBtns.includes('把任務分享給旅伴'), '行程頁不再有「把任務分享給旅伴」');
  await page.evaluate((t) => { location.hash = '#/trip/' + t + '/settings'; }, tid);
  await page.waitForFunction(() => document.body.textContent.includes('旅伴與電話'), { timeout: 10000 });
  const st0 = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.section-label')].map((x) => x.textContent);
    const btn = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('把任務分享給旅伴'));
    const crewIdx = labels.indexOf('旅伴與電話');
    return { has: !!btn, h: btn && btn.getBoundingClientRect().height, crewIdx,
      btnBelowLabel: btn && [...document.querySelectorAll('.section-label')][crewIdx].getBoundingClientRect().top < btn.getBoundingClientRect().top };
  });
  yes(st0.has && st0.h >= 40 && st0.btnBelowLabel, `旅程設定頁有分享按鈕、緊貼「旅伴與電話」區（${Math.round(st0.h)}px，零旅伴時）`);
  // 多旅伴時也正常
  await page.evaluate(async (t) => {
    const s = await import('./js/store.js'); const { uuid } = await import('./js/ids.js');
    const trip = s.get(t);
    await s.put({ id: uuid(), type: 'member', groupId: trip.groupId, displayName: '媽媽' });
    await s.put({ id: uuid(), type: 'member', groupId: trip.groupId, displayName: '爸爸' });
  }, tid);
  await page.evaluate((t) => { location.hash = '#/trip/' + t + '/settings#r' + Date.now(); }, tid);
  await page.evaluate((t) => { location.hash = '#/trip/' + t + '/settings'; }, tid);
  await page.waitForFunction(() => document.body.textContent.includes('媽媽'), { timeout: 10000 });
  const st1 = await page.evaluate(() => [...document.querySelectorAll('button')].filter((x) => x.textContent.includes('把任務分享給旅伴')).length);
  yes(st1 === 1, '多旅伴時分享按鈕仍只有一顆、排版正常');

  // ---------- 路由完整性稽核（防「畫面有入口、路由沒註冊」再犯） ----------
  {
    const { readFileSync } = await import('node:fs');
    const appSrc = readFileSync(ROOT + 'js/app.js', 'utf8');
    const swSrc = readFileSync(ROOT + 'sw.js', 'utf8');
    const viewImports = [...new Set([...appSrc.matchAll(/views\/([a-z-]+\.js)/g)].map((m) => m[1]))];
    const missing = viewImports.filter((f) => !swSrc.includes(`./js/views/${f}`));
    yes(missing.length === 0, `app.js 引用的 ${viewImports.length} 個 view 都在 SW 預快取清單`, missing.join(','));
    const navTargets = [...new Set([...readFileSync(ROOT + 'js/views/trip.js', 'utf8').matchAll(/navigate\(`\/trip\/\$\{tripId\}\/([a-z]+)/g)].map((m) => m[1]))];
    const noRoute = navTargets.filter((seg) => !appSrc.includes(`route('/trip/:id/${seg}'`));
    yes(noRoute.length === 0, `行程頁 navigate 的 ${navTargets.length} 個目標都有註冊路由`, noRoute.join(','));
  }

  console.log('\n找附近測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); op.close();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
