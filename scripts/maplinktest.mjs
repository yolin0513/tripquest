// 貼地圖連結 → 位置（npm run maplinktest，v1.61）：
//   · 直接有座標的：完整 Google 網址、Apple 地圖、geo:、純數字、多行分享文字
//   · Google 短網址：借道 Worker 跟隨轉址；有座標就用，只有地名就查、讓使用者挑
//   · 失敗時的訊息要可行動（列出可貼格式＋「地圖上長按會出現座標」）
//   · 離線時明講要連線
//   · Worker /resolve 的安全邊界：白名單、不當任意網址代理

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5651, RES = 8825, GEO = 8827;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });

// mock /resolve（模擬 Worker 的兩種回應）與 mock Nominatim
let resolveMode = 'name';
const resolveSrv = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  if (resolveMode === 'coords') return res.end(JSON.stringify({ lat: 24.62099, lng: 121.81579, src: 'url' }));
  if (resolveMode === 'fail') { res.writeHead(404); return res.end('{}'); }
  res.end(JSON.stringify({ query: '270宜蘭縣蘇澳鎮新城里蘇新路81號諾貝爾奶凍 國道五號蘇澳服務區 - 蘇澳店', src: 'name' }));
});
resolveSrv.listen(RES);
const geoSrv = createServer((req, res) => {
  const q = decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('q') || '');
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  // 只認得「蘇澳服務區」——跟真 Nominatim 一樣（整串地址查不到）
  if (q.includes('蘇澳服務區')) {
    return res.end(JSON.stringify([
      { lat: '24.62099', lon: '121.81579', display_name: '蘇澳服務區, 蘇新路, 蘇澳鎮, 宜蘭縣, 臺灣', type: 'services', class: 'highway' },
    ]));
  }
  res.end('[]');
});
geoSrv.listen(GEO);
await sleep(1500);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.evaluateOnNewDocument((r, g) => {
    window.__TQ_RESOLVE_ENDPOINT = r;
    window.__TQ_GEO_ENDPOINT = g;
  }, `http://localhost:${RES}/resolve`, `http://localhost:${GEO}/search`);
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // ---------- 純解析（不需網路） ----------
  console.log('\n— 直接看得懂的格式 —');
  const p = await page.evaluate(async () => {
    const { parseCoordInput, findShortMapLink } = await import('./js/geocode.js');
    return {
      plain: parseCoordInput('24.677, 121.767'),
      fullwidth: parseCoordInput('24.677，121.767'),
      space: parseCoordInput('24.67790 121.76740'),
      gmapAt: parseCoordInput('https://www.google.com/maps/place/羅東夜市/@24.6779,121.7674,17z/data=!3m1'),
      gmap3d: parseCoordInput('https://maps.google.com/maps?q=x!3d24.6779!4d121.7674'),
      apple: parseCoordInput('https://maps.apple.com/?ll=25.0330,121.5654&q=台北101'),
      appleAddr: parseCoordInput('https://maps.apple.com/?address=xx&daddr=24.6779,121.7674'),
      geoUri: parseCoordInput('geo:24.6779,121.7674?z=17'),
      multiline: parseCoordInput('羅東夜市\nhttps://www.google.com/maps/@24.6779,121.7674,15z'),
      cjkUrl: parseCoordInput('https://www.google.com/maps/place/礁溪溫泉公園/@24.8271,121.7736,17z'),
      junk: parseCoordInput('羅東夜市超好吃'),
      outOfRange: parseCoordInput('124.677, 921.767'),
      short: findShortMapLink('看看這個 https://maps.app.goo.gl/S1Y7cDPnhw2jNsrd9?g_st=ic 謝謝'),
      shortOld: findShortMapLink('https://goo.gl/maps/abc123XYZ'),
      notShort: findShortMapLink('https://evil.example.com/maps/x'),
    };
  });
  yes(p.plain && p.plain.lat === 24.677, '純數字「24.677, 121.767」');
  yes(p.fullwidth && p.fullwidth.lat === 24.677, '全形逗號');
  yes(p.space && p.space.lat === 24.6779, '空格分隔');
  yes(p.gmapAt && p.gmapAt.lat === 24.6779, 'Google 完整網址 @lat,lng（含中文地名）');
  yes(p.gmap3d && p.gmap3d.lat === 24.6779, 'Google !3d..!4d..');
  yes(p.apple && p.apple.lat === 25.033, 'Apple 地圖 ?ll=');
  yes(p.appleAddr && p.appleAddr.lat === 24.6779, 'Apple 地圖 &daddr=');
  yes(p.geoUri && p.geoUri.lat === 24.6779, 'geo: URI（Android 分享）');
  yes(p.multiline && p.multiline.lat === 24.6779, '多行分享文字（地名＋換行＋網址）');
  yes(p.cjkUrl && p.cjkUrl.lat === 24.8271, '網址裡有中文地名也不影響');
  yes(!p.junk && !p.outOfRange, '看不懂的與超出範圍的都回 null');
  yes(p.short === 'https://maps.app.goo.gl/S1Y7cDPnhw2jNsrd9?g_st=ic', '從一整段文字裡撈出短網址');
  yes(p.shortOld === 'https://goo.gl/maps/abc123XYZ', '舊的 goo.gl/maps 短網址也認得');
  yes(p.notShort === null, '非 Google 的網址不會被當短網址');

  // ---------- 地名候選拆解 ----------
  const cands = await page.evaluate(async () => {
    const { placeCandidates } = await import('./js/geocode.js');
    return placeCandidates('270宜蘭縣蘇澳鎮新城里蘇新路81號諾貝爾奶凍 國道五號蘇澳服務區 - 蘇澳店');
  });
  yes(cands.includes('蘇澳服務區') && cands.indexOf('蘇澳服務區') < cands.indexOf('蘇澳店') && cands.length <= 8,
    `地址拆成可查的候選（${cands.length} 個）：純地標名「蘇澳服務區」排在通用的「蘇澳店」之前`);
  yes(!cands.some((x) => /^[號段0-9]/.test(x)), '不會產生「號蘇澳服務區」這種切壞的碎片');

  // ---------- 短網址 → 地名 → 查詢 → 存位置（走 UI） ----------
  console.log('\n— 短網址（使用者實際貼的那條）—');
  const tid = await page.evaluate(async () => {
    const s = await import('./js/store.js'); const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid(), sid = uuid();
    await s.put({ id: gid, type: 'group', name: 'G' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭行', region: '宜蘭', allowWiki: false });
    await s.put({ id: sid, type: 'spot', tripId: tid, name: '蘇澳休息站', emoji: '📍', day: 1, order: 0 });
    window.__sid = sid;
    return tid;
  });
  const openPaste = async (text) => {
    await page.evaluate((s) => { location.hash = '#/trip/' + window.__tid + '/spot/' + s; }, await page.evaluate(() => window.__sid));
    await page.waitForSelector('.spot-stay', { timeout: 10000 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('貼座標')).click());
    await page.waitForSelector('.modal-card input.field', { timeout: 8000 });
    await page.type('.modal-card input.field', text);
    await page.evaluate(() => [...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent.includes('確定')).click());
  };
  await page.evaluate((t) => { window.__tid = t; }, tid);

  // 貼上前的說明
  await page.evaluate((s) => { location.hash = '#/trip/' + window.__tid + '/spot/' + s; }, await page.evaluate(() => window.__sid));
  await page.waitForSelector('.spot-stay', { timeout: 10000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('貼座標')).click());
  await page.waitForSelector('.modal-card input.field', { timeout: 8000 });
  const hint = await page.evaluate(() => document.querySelector('.modal-card .form-hint')?.textContent || '');
  yes(hint.includes('maps.app.goo.gl') && hint.includes('Apple') && hint.includes('緯度'),
    `貼上前就講清楚可以貼什麼：「${hint.slice(0, 40)}…」`);
  await page.evaluate(() => [...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent.includes('取消')).click());
  await sleep(200);

  resolveMode = 'name';
  await openPaste('https://maps.app.goo.gl/S1Y7cDPnhw2jNsrd9?g_st=ic');
  // 查到的結果一律讓使用者確認（不自動套用——實測過模糊比對會挑到 22 公里外的同連鎖分店）
  await page.waitForFunction(() => document.querySelector('.modal-title')?.textContent.includes('是這個地方嗎'), { timeout: 25000 });
  const picker = await page.evaluate(() => ({
    intro: document.querySelector('.modal-body .form-hint')?.textContent || '',
    items: [...document.querySelectorAll('.modal-body .stack button')].map((b) => b.innerText.replace(/\s+/g, ' ')),
    retry: [...document.querySelectorAll('.modal-actions button')].map((b) => b.textContent).join('|'),
  }));
  yes(picker.items.length >= 1 && picker.items[0].includes('蘇澳服務區'),
    `查到的結果先讓使用者確認：「${picker.items[0]}」`);
  yes(picker.retry.includes('都不是'), '有「都不是，我自己找」可以自己改搜尋詞');
  await page.evaluate(() => document.querySelector('.modal-body .stack button').click());
  await page.waitForFunction(async () => {
    const s = await import('./js/store.js');
    return s.getRaw(window.__sid).lat != null;
  }, { timeout: 10000 }).catch(() => {});
  const saved = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const r = s.getRaw(window.__sid);
    return { lat: r.lat, lng: r.lng, src: r.geoSrc };
  });
  yes(saved.lat != null && Math.abs(saved.lat - 24.621) < 0.01 && Math.abs(saved.lng - 121.816) < 0.01,
    `短網址 → 地名 → 查到座標並存起來（${saved.lat}, ${saved.lng}）`);

  // 短網址直接帶座標的情況
  await page.evaluate(async () => { const s = await import('./js/store.js'); await s.patch(window.__sid, { lat: null, lng: null, geoSrc: null }); });
  resolveMode = 'coords';
  await openPaste('https://maps.app.goo.gl/AbCdEf123');
  await page.waitForFunction(async () => {
    const s = await import('./js/store.js');
    return s.getRaw(window.__sid).lat != null;
  }, { timeout: 15000 }).catch(() => {});
  const saved2 = await page.evaluate(async () => (await import('./js/store.js')).getRaw(window.__sid).lat);
  yes(saved2 != null && Math.abs(saved2 - 24.621) < 0.01, `短網址轉址後直接有座標時也能存（${saved2}）`);

  // ---------- 同連鎖不同分店：靠原文的鄉鎮名分辨 ----------
  const tok = await page.evaluate(async () => {
    const { adminTokens } = await import('./js/geocode.js');
    return adminTokens('270宜蘭縣蘇澳鎮新城里蘇新路81號諾貝爾奶凍 國道五號蘇澳服務區 - 蘇澳店');
  });
  yes(tok.includes('蘇澳鎮') && tok.includes('宜蘭縣'), `抓得出原文的行政區（${tok.join('、')}）——用來分辨同連鎖的別家分店`);

  // ---------- 失敗訊息可行動 ----------
  console.log('\n— 失敗時講得清楚 —');
  await openPaste('這裡好好玩喔');
  await page.waitForFunction(() => document.body.textContent.includes('這個貼上的內容用不了'), { timeout: 8000 });
  const explain = await page.evaluate(() => document.querySelector('.modal-card').innerText.replace(/\s+/g, ' '));
  yes(explain.includes('長按') && explain.includes('座標'), '教「在地圖上長按會出現座標」這條替代路');
  yes(explain.includes('maps.app.goo.gl') && explain.includes('Apple') && explain.includes('24.677'),
    '列出可以貼的三種格式（含實際例子）');
  await page.evaluate(() => [...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent.includes('知道了')).click());
  await sleep(200);

  // 離線
  await page.setOfflineMode(true);
  await openPaste('https://maps.app.goo.gl/OfflineTest1');
  await page.waitForFunction(() => document.body.textContent.includes('這個貼上的內容用不了'), { timeout: 8000 });
  const offTxt = await page.evaluate(() => document.querySelector('.modal-card').innerText.replace(/\s+/g, ' '));
  yes(offTxt.includes('連上網') && offTxt.includes('長按'), '離線：明講要連線，並給貼座標的替代做法');
  await page.setOfflineMode(false);
  await page.evaluate(() => [...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent.includes('知道了')).click());

  // ---------- Worker /resolve 的安全邊界（原始碼守衛） ----------
  console.log('\n— /resolve 安全邊界 —');
  const { readFile } = await import('node:fs/promises');
  const w = await readFile(ROOT + 'workers/worker.mjs', 'utf8');
  yes(w.includes('SHORT_HOSTS') && w.includes("'maps.app.goo.gl'"), '只接受白名單上的短網址網域');
  yes(w.includes("redirect: 'manual'") && !/handleResolve[\s\S]{0,2000}res\.text\(\)/.test(w),
    '只讀 location 標頭、從不讀回應內容（不當內容代理，也避開 HTML 裡的預設地圖中心陷阱）');
  yes(w.includes('redirect blocked'), '轉址跳出白名單就中止（不能當 SSRF 跳板）');
  yes(/hop < 5/.test(w) && w.includes('AbortSignal.timeout ? AbortSignal.timeout(6000)'), '限制轉址次數（5）與逾時（6 秒）');
  yes(w.includes("/^\\/sorry\\b/"), '不跟進 Google 的機器人驗證頁（那裡的 q= 是內部 token）');
  yes(w.includes('looksLikeToken'), '不把 Google 的內部 token 當成地名回傳');
  yes(/handleResolve[\s\S]{0,1500}no-store/.test(w) || w.includes('function noStore'), '回應 no-store，不記錄使用者貼的網址');

  console.log('\n地圖連結測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); resolveSrv.close(); geoSrv.close();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
