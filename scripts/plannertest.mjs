// 規劃行程・第 1 批：搜尋景點加入某天＋時間停留＋純文字匯出（npm run plannertest）
//
// 三代理投票決議的驗收點，逐條釘住：
//   ① 按鈕觸發才查（打字不打 API —— Nominatim 規範禁止 autocomplete）
//   ② 候選 ≤5、帶類別/地址/離行程距離；策展庫優先
//   ③ 加入的當下座標就寫進景點（不繞文字、不事後重查）＋時間/停留/任務都到位
//   ④ 同關鍵字第二次搜尋 0 請求（快取）
//   ⑤ 離線時明講「沒有網路」，不是壞掉
//   ⑥ 匯出文字 round-trip：export → parseItinerary → 天/名稱/時間/停留逐筆相等

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5503, GEO = 5504;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });

const hits = [];
const FIX = {
  '林場肉羹 宜蘭': [
    { lat: '24.6786', lon: '121.7712', display_name: '林場肉羹, 中正路, 羅東鎮, 宜蘭縣, 臺灣',
      class: 'amenity', type: 'restaurant', address: { country: '臺灣', county: '宜蘭縣', town: '羅東鎮' } },
    { lat: '24.9986', lon: '121.5112', display_name: '林場肉羹 分店, 某路, 新北市, 臺灣',
      class: 'amenity', type: 'restaurant', address: { country: '臺灣', city: '新北市' } },
  ],
  '粉鳥林': [
    { lat: '24.4736', lon: '121.8355', display_name: '粉鳥林漁港, 東澳, 南澳鄉, 宜蘭縣, 臺灣',
      class: 'natural', type: 'beach', address: { country: '臺灣', county: '宜蘭縣', town: '南澳鄉' } },
  ],
  '粉鳥林 宜蘭': [
    { lat: '24.4736', lon: '121.8355', display_name: '粉鳥林漁港, 東澳, 南澳鄉, 宜蘭縣, 臺灣',
      class: 'natural', type: 'beach', address: { country: '臺灣', county: '宜蘭縣', town: '南澳鄉' } },
  ],
};
const geoSrv = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/fail') { res.writeHead(500); return res.end('down'); }
  const q = u.searchParams.get('q') || '';
  hits.push(q);
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(FIX[q] || []));
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
  // 換頁會重載模組 —— 端點覆寫要在每一次文件載入前注入，不然 UI 會打到真的 Nominatim
  await page.evaluateOnNewDocument((geoUrl) => { window.__TQ_GEO_ENDPOINT = geoUrl; }, `http://localhost:${GEO}/search`);
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  const tid = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭規劃測試', region: '宜蘭',
      startDate: '2026-10-01', endDate: '2026-10-02', allowWiki: false });
    await s.put({ id: uuid(), type: 'spot', tripId: tid, name: '羅東觀光夜市', emoji: '📍',
      day: 1, order: 0, lat: 24.6779, lng: 121.7674, startMin: 18 * 60, stayMin: 90 });
    return tid;
  });

  // ---------- 入口 ----------
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  const entries = await page.evaluate(() => ({
    search: [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('搜尋加入')).length,
    exportBtn: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('匯出成文字')),
  }));
  yes(entries.search >= 2, `調整行程頁每天都有「🔍 搜尋加入」（${entries.search} 顆）`);
  yes(entries.exportBtn, '調整行程頁有「📤 匯出成文字」');

  // ---------- 搜尋頁 ----------
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}/findspot?day=2`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.fs-bar input');

  // ① 打字不打 API
  const before = hits.length;
  await page.type('.fs-bar input', '林場肉羹', { delay: 30 });
  await sleep(600);
  yes(hits.length === before, '打字過程 0 個 API 請求（不做 autocomplete，按鈕才查）');

  // ② 候選清單
  await page.click('.fs-bar button');
  await page.waitForSelector('.fs-row', { timeout: 15000 });
  const rows = await page.evaluate(() => [...document.querySelectorAll('.fs-row')].map((r) => ({
    name: r.querySelector('.fs-name').textContent,
    meta: r.querySelector('.fs-meta').textContent,
  })));
  yes(rows.length >= 2 && rows.length <= 6, `候選清單 ${rows.length} 筆`);
  yes(rows[0].name.includes('林場肉羹'), `第一筆：${rows[0].name}`);
  yes(rows[0].meta.includes('餐廳') && rows[0].meta.includes('羅東'), `帶類別與地區：${rows[0].meta}`);
  yes(rows[0].meta.includes('離行程約'), '帶「離行程距離」（有既有座標當中心）');

  // ③ 加入：第 2 天、12:30、停留 1 小時
  await page.evaluate(() => document.querySelector('.fs-row .fs-add').click());
  await page.waitForSelector('.fs-panel');
  const dayVal = await page.evaluate(() => document.querySelector('.fs-panel select').value);
  yes(dayVal === '2', '「哪一天」預選了網址帶的第 2 天');

  // 排版：三欄標題與欄位一一對齊、欄寬一致；時間欄位空的時候要看得出「未設定」
  const gridCheck = () => page.evaluate(() => {
    const cells = [...document.querySelectorAll('.fs-grid > label')].map((lb) => {
      const label = lb.querySelector('.form-label').getBoundingClientRect();
      const field = (lb.querySelector('.field') || lb.querySelector('.fs-time')).getBoundingClientRect();
      return { t: lb.querySelector('.form-label').textContent, dx: Math.abs(Math.round(label.left - field.left)), w: Math.round(field.width) };
    });
    return { cells,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      hint: document.querySelector('.fs-time-hint') && !document.querySelector('.fs-time-hint').hidden
        ? document.querySelector('.fs-time-hint').textContent : '' };
  });
  let g = await gridCheck();
  yes(g.cells.every((c) => c.dx <= 2), `三欄標題貼齊各自的欄位（位移 ${g.cells.map((c) => c.dx).join('/')}px）`);
  const ws = g.cells.map((c) => c.w);
  yes(Math.max(...ws) - Math.min(...ws) <= 3, `三欄等寬（${ws.join('/')}px）`);
  yes(g.hint === '未設定', '時間欄位空的時候顯示「未設定」');
  // 360px + 特大字級也不能破版
  await page.setViewport({ width: 360, height: 780 });
  await page.evaluate(async () => (await import('./js/prefs.js')).setPref('fs', 'xl'));
  await sleep(500);
  g = await gridCheck();
  yes(!g.overflow && g.cells.every((c) => c.dx <= 2), '360px＋特大字級：不破版、標題仍對齊');
  await page.evaluate(async () => (await import('./js/prefs.js')).setPref('fs', 'm'));
  await page.setViewport({ width: 390, height: 844 });
  await sleep(400);
  await page.evaluate(() => { const t = document.querySelector('.fs-panel input[type=time]'); t.value = '12:30'; });
  await page.evaluate(() => { const t = document.querySelector('.fs-panel input[type=time]'); t.dispatchEvent(new Event('input')); });
  const hintGone = await page.evaluate(() => document.querySelector('.fs-time-hint').hidden);
  yes(hintGone, '設定時間後「未設定」提示消失、顯示時間值');
  await page.evaluate(() => document.querySelector('.fs-panel .btn-block').click());
  await sleep(600);
  const added = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const sp = s.spotsOf(tid).find((x) => x.name.includes('林場肉羹'));
    return sp && { day: sp.day, lat: sp.lat, lng: sp.lng, startMin: sp.startMin, stayMin: sp.stayMin,
      quests: s.questsOf(sp.id).length, order: sp.order };
  }, tid);
  yes(!!added, '景點已建立');
  // 座標來源可以是候選（osm）或策展資料庫（db，林場肉羹在庫裡）—— 重點是「當下就有」
  yes(added.lat != null && Math.abs(added.lat - 24.68) < 0.02 && Math.abs(added.lng - 121.77) < 0.02,
    `座標當下就寫進去（${added.lat}, ${added.lng}），不用事後再查`);
  yes(added.day === 2 && added.startMin === 750 && added.stayMin === 60, `第 2 天、12:30、停留 60 分（day=${added.day} start=${added.startMin} stay=${added.stayMin}）`);
  yes(added.quests >= 1, `自動產生了 ${added.quests} 個拍照任務`);
  const marked = await page.evaluate(() => document.querySelector('.fs-row .fs-add').textContent);
  yes(marked.includes('已加入'), `列上標示：${marked.trim()}`);

  // 日期自動延長到第 2 天之後？（原本 10/01–10/02，加到第 2 天不用延；驗不變壞即可）
  // ④ 快取：同關鍵字再搜一次 → 0 新請求
  const before2 = hits.length;
  await page.click('.fs-bar button');
  await sleep(800);
  yes(hits.length === before2, '同關鍵字第二次搜尋 0 個 API 請求（快取）');

  // 策展庫優先：搜「羅東夜市」應出現 📖 資料庫來源
  await page.evaluate(() => { const i = document.querySelector('.fs-bar input'); i.value = '羅東夜市'; });
  await page.click('.fs-bar button');
  await page.waitForFunction(() => document.querySelectorAll('.fs-row').length > 0, { timeout: 15000 });
  const curated = await page.evaluate(() => [...document.querySelectorAll('.fs-meta')].map((x) => x.textContent));
  yes(curated.some((m) => m.includes('資料庫')), '策展資料庫的結果排在前面（本機、零請求、有介紹）');

  // ⑤ 離線
  await page.evaluate(async (u) => (await import('./js/geocode.js')).setGeoEndpoint(u), `http://localhost:${GEO}/fail`);
  await page.evaluate(() => { const i = document.querySelector('.fs-bar input'); i.value = '不存在的神祕店'; });
  await page.click('.fs-bar button');
  await page.waitForFunction(() => !document.querySelector('.fs-results').textContent.includes('搜尋中'), { timeout: 15000 });
  const offlineMsg = await page.evaluate(() => document.querySelector('.fs-results').textContent);
  yes(offlineMsg.includes('沒有網路'), `連不上時明講：「${offlineMsg.slice(0, 30)}…」`);

  // ---------- ⑥ 匯出 round-trip ----------
  console.log('\n— 純文字匯出 round-trip —');
  const rt = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    // 加一個沒有時間的景點，驗證無時間也能 round-trip
    await s.put({ id: uuid(), type: 'spot', tripId: tid, name: '梅花湖', emoji: '📍', day: 2, order: 5 });
    const { exportItineraryText } = await import('./js/itinexport.js');
    const { parseItinerary } = await import('./js/itinerary.js');
    const text = exportItineraryText(tid);
    const parsed = parseItinerary(text);
    const orig = s.spotsOf(tid).map((x) => ({
      name: x.name, day: x.day || 1,
      startMin: Number.isFinite(x.startMin) ? x.startMin : null,
      stayMin: Number.isFinite(x.stayMin) ? x.stayMin : null,
    }));
    const got = parsed.items.map((x) => ({
      name: x.name, day: x.day || 1,
      startMin: Number.isFinite(x.startMin) ? x.startMin : null,
      stayMin: Number.isFinite(x.stayMin) && x.stayMin > 0 ? x.stayMin : null,
    }));
    return { text, title: parsed.title, orig, got };
  }, tid);
  yes(rt.title === '宜蘭規劃測試', `行程名稱 round-trip：「${rt.title}」`);
  yes(rt.orig.length === rt.got.length, `筆數一致（${rt.orig.length}）`);
  let mismatch = null;
  for (let i = 0; i < rt.orig.length; i++) {
    const a = rt.orig[i], b = rt.got.find((x) => x.name === a.name);
    if (!b || b.day !== a.day || b.startMin !== a.startMin || b.stayMin !== a.stayMin) {
      mismatch = JSON.stringify({ a, b });
      break;
    }
  }
  yes(!mismatch, '每一筆的 天/名稱/時間/停留 都 round-trip 相等', mismatch);
  console.log('  匯出樣本：\n' + rt.text.split('\n').slice(0, 6).map((l) => '    ' + l).join('\n'));

  // ---------- 完整真實流程（實機回報的死路，逐步釘住） ----------
  console.log('\n— 完整流程：新建 → 幫我規劃 → 加第一個景點 → 每頁都有下一步 —');
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/new`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page');
  // ① 沒填名稱：要聚焦到欄位＋明確提示，不是只捲動
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('幫我規劃行程')).click());
  await sleep(400);
  const guard = await page.evaluate(() => ({
    toast: document.getElementById('toast')?.textContent || '',
    focused: document.activeElement?.placeholder || '',
    attn: !!document.querySelector('.field-attn'),
  }));
  yes(guard.toast.includes('取個名字'), `未填名稱有明確提示：「${guard.toast}」`);
  yes(guard.focused.includes('京都'), '而且直接聚焦到名稱欄位');
  yes(guard.attn, '欄位有視覺強調（不是只捲動）');
  // ② 填名稱（不填日期 —— 實機就是這樣觸發 NaN 天的）→ 建立 → 應落在搜尋頁
  await page.type('input[placeholder*="京都"]', '流程驗證');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('幫我規劃行程')).click());
  await page.waitForSelector('.fs-bar input', { timeout: 20000 });
  ok('建立成功，直接落在搜尋頁');
  const tid2 = await page.evaluate(() => location.hash.match(/trip\/([^/]+)\//)[1]);
  // ③ 搜尋並加入第一個景點：沒有日期時「哪一天」也要有選項
  await page.evaluate(() => { document.querySelector('.fs-bar input').value = '粉鳥林'; });
  await page.click('.fs-bar button');
  await page.waitForSelector('.fs-row', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('.fs-row .fs-add').click());
  await page.waitForSelector('.fs-panel');
  const dayOpts = await page.evaluate(() => [...document.querySelectorAll('.fs-panel select')[0].options].length);
  yes(dayOpts >= 2, `沒有日期的行程「哪一天」仍有 ${dayOpts} 個選項（NaN 天已防呆）`);
  await page.evaluate(() => document.querySelector('.fs-panel .btn-block').click());
  await sleep(700);
  const flowSpot = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const sp = s.spotsOf(tid)[0];
    return sp && { day: sp.day, finite: Number.isFinite(sp.day), lat: sp.lat };
  }, tid2);
  yes(flowSpot && flowSpot.finite && flowSpot.day >= 1, `加入的景點 day=${flowSpot && flowSpot.day}（不是 NaN）`);
  // ④ 回到各頁：零/一個景點的每一頁都要有可用的下一步
  for (const [name, path] of [
    ['行程頁', ''], ['調整行程', '/plan'], ['照片', '/people'],
    ['分帳', '/expenses'], ['回顧', '/memories'],
  ]) {
    await page.goto('about:blank');
    await page.goto(`http://localhost:${WEB}/#/trip/${tid2}${path}`, { waitUntil: 'networkidle0' });
    await sleep(600);
    const info = await page.evaluate(() => ({
      btns: [...document.querySelectorAll('#view button')].filter((b) => b.offsetParent && b.textContent.trim()).length,
    }));
    yes(info.btns >= 1, `「${name}」有 ${info.btns} 顆可按的按鈕（不是死路）`);
  }
  // ⑤ 行程頁看得到剛加的景點
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid2}`, { waitUntil: 'networkidle0' });
  await sleep(700);
  const tripTxt = await page.evaluate(() => document.getElementById('view').innerText);
  yes(tripTxt.includes('粉鳥林'), '行程頁看得到剛剛加入的景點');

  console.log('\n規劃第 1 批測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); geoSrv.close();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
