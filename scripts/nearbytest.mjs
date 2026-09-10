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
    // ---- 石牌實測案例第二輪（v1.66）----
    // 使用者回報「私人空地排在真正的停車場前面」。這是它在 OSM 的實際長相：
    // 有人畫了一塊地說可以停車，然後沒有任何人回來補第二個欄位。它最近（15m），
    // 但**應該排在所有有登記證據的後面**（降權，不是排除 —— 鄉下可能只剩它）。
    el(12, 0.0001, 0.0001, { amenity: 'parking', parking: 'surface' }),
    // 出口是同一個停車場，而且比入口更近 —— 不能佔掉第二個名額，也不能贏過入口
    el(13, 0.0009, 0.0009, { amenity: 'parking_entrance', name: '羅東夜市地下停車場出口' }),
    // 名字就寫明是員工專用，卻沒有 access 標記（石牌實測有三個）→ 不列
    el(14, 0.002, 0.003, { amenity: 'parking', parking: 'surface', name: '員工停車場' }),
    // 同名不代表同一個場：石牌 1.5 公里內三個節點都叫「地下停車場」，相距 794m 起跳。
    // 這兩個相距約 1.1 公里，要當成兩個停車場（舊的全域同名去重會砍掉一個）
    el(15, 0.003, 0.003, { amenity: 'parking_entrance', name: '地下停車場' }),
    el(16, 0.009, 0.009, { amenity: 'parking_entrance', name: '地下停車場' }),
  ],
  'amenity=toilets': [
    el(21001, 0.001, -0.001, { amenity: 'toilets', wheelchair: 'yes', changing_table: 'yes', fee: 'no' }),
    el(21002, 0.004, 0.002, { amenity: 'toilets', operator: '北投區公所' }),                             // 沒 name 但有管理單位
    el(21003, 0.002, 0.002, { amenity: 'cafe', name: '丹提咖啡', 'toilets:wheelchair': 'yes' }),       // 附設（石牌實際標法：只有子鍵）
    el(21006, 0.0025, 0.0025, { amenity: 'cafe', name: '無障礙只在門口', wheelchair: 'yes', 'toilets:wheelchair': 'no' }),  // 店可進、廁所不行 → 不給 ♿
    el(21004, 0.003, -0.002, { amenity: 'restaurant', toilets: 'yes' }),                                 // 無名附設 → 不列
    el(21005, 0.002, -0.003, { amenity: 'cafe', name: '無廁咖啡', toilets: 'no' }),                       // 明確沒有廁所 → 不列
  ],
  'shop=convenience': [
    el(21, 0.002, 0.001, { shop: 'convenience', name: '7-Eleven 羅東門市', opening_hours: '24/7' }),
    el(22, -0.003, 0.002, { shop: 'convenience', brand: '全家', opening_hours: 'Mo-Su 06:00-23:00' }),
  ],
  'amenity=fuel': [el(31, 0.01, 0.01, { amenity: 'fuel', name: '台灣中油羅東站', opening_hours: '24/7' })],
};
// ---- mock Google Places（v1.70 雙軌）----
let placeReqs = [];
let placeMode = 'ok';
const PLACES = 8809;
const placesSrv = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    let j = {}; try { j = JSON.parse(body); } catch { /* noop */ }
    placeReqs.push({ body: j, key: req.headers['x-goog-api-key'], mask: req.headers['x-goog-fieldmask'] });
    if (placeMode === 'forbidden') { res.writeHead(403, cors); return res.end('{}'); }
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ places: [
      { id: 'p1', displayName: { text: '嗜嗜房羅東站' }, location: { latitude: C.lat + 0.001, longitude: C.lng + 0.001 },
        businessStatus: 'OPERATIONAL', shortFormattedAddress: '宜蘭縣羅東鎮公正路 1 號' },
      { id: 'p2', displayName: { text: '已歇業的停車場' }, location: { latitude: C.lat + 0.002, longitude: C.lng },
        businessStatus: 'CLOSED_PERMANENTLY', shortFormattedAddress: '' },
      { id: 'p3', displayName: { text: '羅東夜市停車場' }, location: { latitude: C.lat + 0.004, longitude: C.lng },
        businessStatus: 'OPERATIONAL', shortFormattedAddress: '宜蘭縣羅東鎮民權路' },
    ] }));
  });
});
placesSrv.listen(PLACES);

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
  await page.evaluateOnNewDocument((o) => {
    window.__TQ_OVERPASS_ENDPOINT = o.op;
    window.__TQ_PLACES_ENDPOINT = o.places;
  }, { op: `http://localhost:${OP}/`, places: `http://localhost:${PLACES}/places` });
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
  yes(parking.count.includes('10 個'), `private/permit/員工/無名入口被濾掉、出入口與同名去重（16 筆進 10 筆出）：「${parking.count.trim()}」`);
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
  yes(parking.cards.filter((c) => c.name.endsWith('平面停車場')).length === 3, '產生的通用名不參與去重（三塊不同的平面場都在）');
  yes(parking.cards.some((c) => c.chips.includes('限顧客')), 'access=customers 標「限顧客」');

  // ---- v1.66 停車場過濾 ----
  const bare = parking.cards.findIndex((c) => c.chips.includes('⚠️ 只有位置資料'));
  const evidenced = parking.cards.map((c, i) => (c.chips.includes('⚠️ 只有位置資料') ? -1 : i)).filter((i) => i >= 0);
  yes(bare >= 0 && bare > Math.max(...evidenced),
    `只有位置資料的空地被降到最後（它離中心 15 公尺、卻排第 ${bare + 1}／${parking.cards.length}）`);
  yes(bare >= 0, '降權不是排除：沒有登記證據的仍然列得出來（鄉下可能只剩它）');
  yes(!parking.cards.some((c) => c.name.includes('出口')),
    '停車場「出口」不獨立成一筆 —— 那是同一個停車場，而且導航到出口是錯的');
  const yeshi = parking.cards.filter((c) => c.name.includes('羅東夜市地下停車場'));
  yes(yeshi.length === 1 && yeshi[0].chips.includes('總車位 120'),
    '出入口合併後留下的是「入口」那一筆（出口比較近也一樣）：' + (yeshi[0] ? yeshi[0].chips.join('・') : '(沒有)'));
  yes(!parking.cards.some((c) => c.name.includes('員工')),
    '名字寫明員工專用、但沒有 access 標記的（石牌實測三個）→ 不列');
  yes(parking.cards.filter((c) => c.name.replace(/^\S+\s*/, '') === '地下停車場').length === 2,
    '同名但相距 1 公里 → 兩個不同的停車場都要列（舊的全域同名去重會砍掉一個）');

  // ---- v1.70 停車場雙軌（Google 選配）----
  yes(!(await page.evaluate(() => !!document.querySelector('.nl-google'))),
    '沒有地圖金鑰 → 不出現「用 Google 再查一次」（免費路徑完全不變）');
  yes(placeReqs.length === 0, `沒有金鑰 → 零個 Places 請求（實際 ${placeReqs.length}）`);

  await page.evaluate(async (t) => {
    const k = await import('./js/aikeys.js');
    await k.setTripKey(t, { mapsKey: 'AIzaPLACESPLACESPLACESPLACESPLACESPLA' });
  }, tid);
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}/nearby`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.nl-card', { timeout: 10000 });
  await page.waitForFunction(() => !!document.querySelector('.nl-google'), { timeout: 10000 });
  yes(placeReqs.length === 0, '有金鑰但沒按 → 還是不打 Google（OSM 仍然是預設）');

  await page.evaluate(() => document.querySelector('.nl-google').click());
  await page.waitForFunction(() => (document.querySelector('.nl-count') || {}).textContent?.includes('Google'), { timeout: 15000 });
  const g = await page.evaluate(() => ({
    count: document.querySelector('.nl-count')?.textContent || '',
    names: [...document.querySelectorAll('.nl-name')].map((n) => n.textContent.trim()),
    chips: [...document.querySelectorAll('.nl-card')].map((c) => [...c.querySelectorAll('.nl-chip')].map((x) => x.textContent)),
    note: document.querySelector('.nl-gnote')?.textContent || '',
    back: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('回到地圖資料')),
  }));
  yes(placeReqs.length === 1 && placeReqs[0].body.includedTypes[0] === 'parking',
    `按下去才打 Google，而且只要 parking 類型（實際 ${placeReqs.length} 次）`);
  yes(!/rating|userRatingCount/i.test(placeReqs[0].mask || ''),
    'FieldMask 沒有要評分與評論數 —— 那兩個欄位會把整個請求升到 Enterprise 級計費');
  yes(placeReqs[0].key === 'AIzaPLACESPLACESPLACESPLACESPLACESPLA', '金鑰放在 X-Goog-Api-Key 標頭');
  yes(g.names.some((n) => n.includes('嗜嗜房羅東站')), `列出 Google 的停車場（${g.names.slice(0, 2).join('、')}）`);
  yes(!g.names.some((n) => n.includes('已歇業')),
    'businessStatus 不是 OPERATIONAL 的不列 —— 這是 Google 比 OSM 強的地方');
  yes(g.chips.some((c) => c.includes('Google')), '每一張卡標明出處是 Google（條款要求）');
  yes(g.note.includes('不會存在手機裡') && g.note.includes('離線'),
    `講明 Places 的資料不存快取、離線看不到：「${g.note.slice(0, 40)}…」`);
  yes(g.back, '有「↖︎ 回到地圖資料（可離線）」可以切回去');

  const usedG = await page.evaluate(async (t) => (await (await import('./js/aikeys.js')).usageOf(t)).mapsUsed, tid);
  yes(usedG === 1, `Google 查詢計入用量（${usedG} 次）`);

  // 切回地圖資料
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('回到地圖資料')).click());
  await page.waitForFunction(() => !(document.querySelector('.nl-count') || {}).textContent?.includes('Google'), { timeout: 10000 });
  const backOsm = await page.evaluate(() => ({
    count: document.querySelector('.nl-count')?.textContent || '',
    hasGoogleChip: [...document.querySelectorAll('.nl-chip')].some((x) => x.textContent === 'Google'),
  }));
  yes(!backOsm.hasGoogleChip && backOsm.count.includes('停車場'),
    `切回去就是原本的地圖資料（「${backOsm.count.trim()}」）`);
  yes(/dir\/.*destination=24\.6|destination=24\.6/.test(decodeURIComponent(first.href)), `導航用座標不用店名：${decodeURIComponent(first.href).slice(-28)}`);
  yes(/^\d+ (公尺|公里)/.test(first.dist.trim()) && !first.dist.includes('往'), `只顯示距離、不顯示方位：「${first.dist.trim()}」`);
  yes(first.nameSize >= 16, `結果大字（名稱 ${first.nameSize}px）`);

  // ---------- 廁所 ----------
  await page.evaluate(() => [...document.querySelectorAll('.nl-cat')].find((x) => x.textContent.includes('廁所')).click());
  await page.waitForFunction(() => document.querySelector('.nl-count')?.textContent.includes('廁所'), { timeout: 8000 });
  const wc = await page.evaluate(() => [...document.querySelectorAll('.nl-card')].map((c) => ({
    name: c.querySelector('.nl-name').textContent, chips: [...c.querySelectorAll('.nl-chip')].map((x) => x.textContent) })));
  yes(wc.length === 4 && wc[0].chips.includes('♿ 無障礙') && wc[0].chips.includes('🚼 尿布台') && wc[0].chips.includes('免費'),
    `廁所：無障礙＋尿布台＋免費（${wc[0].chips.join(' / ')}）`);
  yes(wc.some((c) => c.name.includes('公共廁所')), '無名廁所給通用名「公共廁所」');
  yes(wc.some((c) => c.name.includes('北投區公所')), '沒名字但有管理單位的廁所 → 顯示管理單位');
  const dante = wc.find((c) => c.name.includes('丹提咖啡'));
  yes(dante && dante.chips.includes('附設廁所') && dante.chips.includes('♿ 無障礙'),
    'toilets=yes 的店家也列出：「丹提咖啡」標「附設廁所」＋無障礙（石牌案例）');
  yes(wc.length === 4 && !wc.some((c) => c.name.includes('無廁咖啡')), '無名附設與 toilets=no 都不列（6 筆進 4 筆出）');
  const gate = wc.find((c) => c.name.includes('無障礙只在門口'));
  yes(gate && gate.chips.includes('附設廁所') && !gate.chips.includes('♿ 無障礙'),
    '店門口無障礙≠廁所無障礙：附設的 ♿ 只看 toilets:wheelchair（石牌 7-Eleven 案例）');
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
  web.kill(); op.close(); placesSrv.close();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
